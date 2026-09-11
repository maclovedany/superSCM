// 발주 일정 · 입고 차이 모델 테스트 — Task 10b
//
// ★ 여기서 검증하는 함수들은 supabase/migrations/20260911001000_stage1_procurement_schedule.sql의
//   core.build_procurement_schedule 계산 순서(공급처 매핑 → 출항일 규칙 → 공급처 유효 여부 →
//   준비기간 → KR 영업일 확정)를 그대로 옮긴 거울이다. 화면은 이 함수로 다시 계산하지 않고
//   analytics.v_procurement_schedule에 저장된 값을 그대로 보여준다.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDays,
  bundleKey,
  computeProcurementScheduleLine,
  confirmedKrDate,
  dayOfWeek,
  findDepartureDate,
  isoWeekOf,
  isWeekend,
  monthsBetweenInclusive,
  normalizeReceiptGapEntityRow,
  normalizeReceiptGapItemRow,
  normalizeReceiptGapMonthRow,
  normalizeScheduleRow,
  previousBusinessDay,
  ruleActiveOn,
  ruleMatchesDate,
  validateBuildScheduleInput,
  validateRecordActualReceiptInput,
  type DepartureRule,
} from './model.ts';

// ══ 날짜 기본 연산 ═══════════════════════════════════════════════

test('addDays — 월 경계를 넘는다', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});

test('dayOfWeek — Postgres extract(dow)와 같다(0=일 ~ 6=토)', () => {
  assert.equal(dayOfWeek('2026-01-01'), 4); // 목요일
  assert.equal(dayOfWeek('2026-09-13'), 0); // 일요일
});

test('isWeekend', () => {
  assert.equal(isWeekend('2026-09-12'), true); // 토요일
  assert.equal(isWeekend('2026-09-11'), false); // 금요일
});

// ══ 출항일 규칙 매칭 ═════════════════════════════════════════════

function rule(partial: Partial<DepartureRule>): DepartureRule {
  return {
    departureId: 'D1', weekday: null, weekOfMonth: null, dayOfMonth: null,
    active: true, validFrom: null, validTo: null,
    ...partial,
  };
}

test('ruleMatchesDate — 요일만', () => {
  const weeklyWed = rule({ weekday: 3 });
  assert.equal(ruleMatchesDate(weeklyWed, '2026-11-04'), true); // 수요일
  assert.equal(ruleMatchesDate(weeklyWed, '2026-11-05'), false);
});

test('ruleMatchesDate — 요일 + 주차(매월 N번째 요일)', () => {
  const secondTue = rule({ weekday: 2, weekOfMonth: 2 });
  assert.equal(ruleMatchesDate(secondTue, '2026-11-10'), true); // 11월 둘째 화요일
  assert.equal(ruleMatchesDate(secondTue, '2026-11-03'), false); // 첫째 화요일
  assert.equal(ruleMatchesDate(secondTue, '2026-11-17'), false); // 셋째 화요일
});

test('ruleMatchesDate — 매월 일자', () => {
  const day20 = rule({ dayOfMonth: 20 });
  assert.equal(ruleMatchesDate(day20, '2026-11-20'), true);
  assert.equal(ruleMatchesDate(day20, '2026-11-21'), false);
});

test('ruleActiveOn — active false 또는 적용기간 밖이면 거짓', () => {
  assert.equal(ruleActiveOn(rule({ active: false }), '2026-11-20'), false);
  assert.equal(ruleActiveOn(rule({ validFrom: '2026-12-01' }), '2026-11-20'), false);
  assert.equal(ruleActiveOn(rule({ validTo: '2026-10-31' }), '2026-11-20'), false);
  assert.equal(ruleActiveOn(rule({ validFrom: '2026-01-01', validTo: '2026-12-31' }), '2026-11-20'), true);
});

// ══ 출항일 계산 ═══════════════════════════════════════════════════

test('findDepartureDate — 규칙이 없으면 DEPARTURE_RULE_UNSET', () => {
  const result = findDepartureDate([], '2026-11-01');
  assert.deepEqual(result, { departureDate: null, reasonCode: 'DEPARTURE_RULE_UNSET' });
});

test('findDepartureDate — 규칙이 모두 비활성이면 DEPARTURE_RULE_UNSET', () => {
  const result = findDepartureDate([rule({ weekday: 3, active: false })], '2026-11-01');
  assert.deepEqual(result, { departureDate: null, reasonCode: 'DEPARTURE_RULE_UNSET' });
});

test('findDepartureDate — 그달 1일 이후 첫 일치일을 찾는다(매월 20일)', () => {
  const result = findDepartureDate([rule({ dayOfMonth: 20 })], '2026-11-01');
  assert.deepEqual(result, { departureDate: '2026-11-20', reasonCode: null });
});

test('findDepartureDate — 두 활성 규칙이 같은 날 겹치면 DEPARTURE_RULE_AMBIGUOUS', () => {
  const result = findDepartureDate(
    [rule({ departureId: 'D1', weekday: 3 }), rule({ departureId: 'D2', weekday: 3 })],
    '2026-11-01',
  );
  assert.deepEqual(result, { departureDate: null, reasonCode: 'DEPARTURE_RULE_AMBIGUOUS' });
});

test('findDepartureDate — 적용기간 밖 규칙은 건너뛰고 유효한 규칙의 날짜를 쓴다', () => {
  const result = findDepartureDate(
    [rule({ departureId: 'D1', weekday: 3, validTo: '2026-10-31' }), rule({ departureId: 'D2', dayOfMonth: 20 })],
    '2026-11-01',
  );
  // D1은 11월에는 이미 기간이 끝났으므로 11/4(수)에는 D2만 매칭되지 않는다 — D2의 11/20이 유일한 매칭일
  assert.deepEqual(result, { departureDate: '2026-11-20', reasonCode: null });
});

// ══ 영업일 조정(KR) ══════════════════════════════════════════════

test('previousBusinessDay — 주말이면 이전 금요일(달력 행 없이)', () => {
  assert.equal(previousBusinessDay('2026-09-13', new Map()), '2026-09-11');
});

test('previousBusinessDay — 이미 영업일이면 그대로', () => {
  assert.equal(previousBusinessDay('2026-09-11', new Map()), '2026-09-11');
});

test('previousBusinessDay — 금요일 공휴일 + 주말이면 그 전 목요일', () => {
  const overrides = new Map([['2026-11-20', false]]);
  assert.equal(previousBusinessDay('2026-11-20', overrides), '2026-11-19');
});

test('previousBusinessDay — 30일 넘게 영업일이 없으면 null', () => {
  const overrides = new Map<string, boolean>();
  for (let i = 0; i < 40; i += 1) overrides.set(addDays('2026-11-20', -i), false);
  assert.equal(previousBusinessDay('2026-11-20', overrides), null);
});

test('monthsBetweenInclusive — 월 경계를 포함한 목록', () => {
  assert.deepEqual(monthsBetweenInclusive('2026-10-31', '2026-11-03'), ['2026-10', '2026-11']);
  assert.deepEqual(monthsBetweenInclusive('2026-11-05', '2026-11-05'), ['2026-11']);
});

test('confirmedKrDate — 달력 준비 안 된 달은 CALENDAR_NOT_READY(주말만으로 추정하지 않는다)', () => {
  const result = confirmedKrDate('2026-08-15', new Map(), new Set());
  assert.deepEqual(result, { date: null, reasonCode: 'CALENDAR_NOT_READY' });
});

test('confirmedKrDate — 조정 결과가 이전 달로 넘어가면 그 달도 준비돼야 한다', () => {
  // 2026-11-01(일)은 이전 영업일로 당기면 10월로 넘어간다 — 11월만 준비돼 있으면 부족하다
  const overrides = new Map<string, boolean>();
  const readyNovOnly = new Set(['2026-11']);
  assert.deepEqual(confirmedKrDate('2026-11-01', overrides, readyNovOnly), { date: null, reasonCode: 'CALENDAR_NOT_READY' });
  const readyBoth = new Set(['2026-10', '2026-11']);
  assert.deepEqual(confirmedKrDate('2026-11-01', overrides, readyBoth), { date: '2026-10-30', reasonCode: null });
});

test('confirmedKrDate — 금요일 공휴일 + 주말 → 목요일(해당 달 준비됨)', () => {
  const overrides = new Map([['2026-11-20', false]]);
  const ready = new Set(['2026-11']);
  assert.deepEqual(confirmedKrDate('2026-11-20', overrides, ready), { date: '2026-11-19', reasonCode: null });
});

// ══ ISO 주차 번들 키 ═════════════════════════════════════════════

test('isoWeekOf — 연 경계(2026-12-31 → 2026-W53)', () => {
  assert.deepEqual(isoWeekOf('2026-12-31'), { isoYear: 2026, isoWeek: 53 });
});

test('isoWeekOf — 연초 월요일은 그 해 1주차', () => {
  assert.deepEqual(isoWeekOf('2024-01-01'), { isoYear: 2024, isoWeek: 1 });
});

test('bundleKey — 문자열 표현', () => {
  assert.equal(bundleKey('2026-12-31'), '2026-W53');
  assert.equal(bundleKey('2026-11-20'), '2026-W47');
});

// ══ 전체 파이프라인(computeProcurementScheduleLine) ══════════════

const readyNov = new Set(['2026-11']);
const baseSupplier = { supplierId: 'SUP-T10B-1', entityId: 'T10B', active: true, validFrom: null, validTo: null };
const baseEntity = { entityId: 'T10B', prepDays: 7 };
const day20Rule = [rule({ dayOfMonth: 20 })];

test('computeProcurementScheduleLine — 품목에 공급처 매핑이 없으면 SUPPLIER_UNSET', () => {
  const result = computeProcurementScheduleLine({
    itemSupplierId: null, supplier: null, departureRules: [], entity: null,
    planMonthStart: '2026-11-01', calendarOverrides: new Map(), readyMonths: readyNov,
  });
  assert.equal(result.calculationStatus, 'EXCLUDED');
  assert.equal(result.reasonCode, 'SUPPLIER_UNSET');
  assert.equal(result.departureDate, null);
});

test('computeProcurementScheduleLine — supplier_id는 있지만 core.supplier 행이 없으면 SUPPLIER_UNSET', () => {
  const result = computeProcurementScheduleLine({
    itemSupplierId: 'SUP-UNKNOWN', supplier: null, departureRules: [], entity: null,
    planMonthStart: '2026-11-01', calendarOverrides: new Map(), readyMonths: readyNov,
  });
  assert.equal(result.reasonCode, 'SUPPLIER_UNSET');
});

test('computeProcurementScheduleLine — 출항일 규칙이 없으면 DEPARTURE_RULE_UNSET', () => {
  const result = computeProcurementScheduleLine({
    itemSupplierId: 'SUP-T10B-1', supplier: baseSupplier, departureRules: [], entity: baseEntity,
    planMonthStart: '2026-11-01', calendarOverrides: new Map(), readyMonths: readyNov,
  });
  assert.equal(result.reasonCode, 'DEPARTURE_RULE_UNSET');
});

test('computeProcurementScheduleLine — 규칙이 겹치면 DEPARTURE_RULE_AMBIGUOUS', () => {
  const result = computeProcurementScheduleLine({
    itemSupplierId: 'SUP-T10B-1', supplier: baseSupplier,
    departureRules: [rule({ departureId: 'D1', weekday: 3 }), rule({ departureId: 'D2', weekday: 3 })],
    entity: baseEntity, planMonthStart: '2026-11-01', calendarOverrides: new Map(), readyMonths: readyNov,
  });
  assert.equal(result.reasonCode, 'DEPARTURE_RULE_AMBIGUOUS');
});

test('computeProcurementScheduleLine — 출항일에 공급처가 비활성/기간 밖이면 SUPPLIER_INACTIVE(출항일은 남는다)', () => {
  const result = computeProcurementScheduleLine({
    itemSupplierId: 'SUP-T10B-1',
    supplier: { ...baseSupplier, validTo: '2026-10-31' },
    departureRules: day20Rule, entity: baseEntity,
    planMonthStart: '2026-11-01', calendarOverrides: new Map(), readyMonths: readyNov,
  });
  assert.equal(result.reasonCode, 'SUPPLIER_INACTIVE');
  assert.equal(result.departureDate, '2026-11-20');
  assert.equal(result.requestedOrderDate, null);
});

test('computeProcurementScheduleLine — 준비기간이 없거나(법인 미확인) 0이면 PREP_DAYS_UNSET', () => {
  const noEntity = computeProcurementScheduleLine({
    itemSupplierId: 'SUP-T10B-1', supplier: baseSupplier, departureRules: day20Rule, entity: null,
    planMonthStart: '2026-11-01', calendarOverrides: new Map(), readyMonths: readyNov,
  });
  assert.equal(noEntity.reasonCode, 'PREP_DAYS_UNSET');
  assert.equal(noEntity.departureDate, '2026-11-20');

  const zeroPrepDays = computeProcurementScheduleLine({
    itemSupplierId: 'SUP-T10B-1', supplier: baseSupplier, departureRules: day20Rule,
    entity: { entityId: 'JP', prepDays: 0 },
    planMonthStart: '2026-11-01', calendarOverrides: new Map(), readyMonths: readyNov,
  });
  assert.equal(zeroPrepDays.reasonCode, 'PREP_DAYS_UNSET');
});

test('computeProcurementScheduleLine — 달력이 준비되지 않으면 CALENDAR_NOT_READY', () => {
  const result = computeProcurementScheduleLine({
    itemSupplierId: 'SUP-T10B-1', supplier: baseSupplier, departureRules: day20Rule, entity: baseEntity,
    planMonthStart: '2026-11-01', calendarOverrides: new Map(), readyMonths: new Set(),
  });
  assert.equal(result.reasonCode, 'CALENDAR_NOT_READY');
  assert.equal(result.departureDate, '2026-11-20');
  assert.equal(result.baseOrderDate, '2026-11-13');
});

test('computeProcurementScheduleLine — 정상 계산(입고일만 금요일 공휴일+주말로 당겨진다)', () => {
  const overrides = new Map([['2026-11-20', false]]); // 계획 입고일(11/20, 금)을 공휴일로 등록
  const result = computeProcurementScheduleLine({
    itemSupplierId: 'SUP-T10B-1', supplier: baseSupplier, departureRules: day20Rule, entity: baseEntity,
    planMonthStart: '2026-11-01', calendarOverrides: overrides, readyMonths: readyNov,
  });
  assert.equal(result.calculationStatus, 'SCHEDULED');
  assert.equal(result.reasonCode, null);
  assert.equal(result.departureDate, '2026-11-20'); // 출항일(매월 20일 규칙)
  assert.equal(result.prepDays, 7);
  assert.equal(result.baseOrderDate, '2026-11-13'); // 기준 발주일 = 출항일 − 준비기간
  assert.equal(result.requestedOrderDate, '2026-11-13'); // 금요일 · 평일이라 조정 없음
  assert.equal(result.plannedReceiptDate, '2026-11-20'); // 요청 발주일 + 7일
  assert.equal(result.confirmedReceiptDate, '2026-11-19'); // 계획 입고일이 공휴일(금)이라 목요일로 당김
  assert.equal(result.bundleIsoYear, 2026);
  assert.equal(result.bundleIsoWeek, 47);
});

test('computeProcurementScheduleLine — 연 경계 ISO 주차(2026-12-31 → 2026-W53)', () => {
  const result = computeProcurementScheduleLine({
    itemSupplierId: 'SUP-T10B-1', supplier: baseSupplier,
    departureRules: [rule({ dayOfMonth: 31 })], entity: baseEntity,
    planMonthStart: '2026-12-01', calendarOverrides: new Map(), readyMonths: new Set(['2026-12']),
  });
  assert.equal(result.departureDate, '2026-12-31');
  assert.equal(result.bundleIsoYear, 2026);
  assert.equal(result.bundleIsoWeek, 53);
});

// ══ 조회 행 정규화 ════════════════════════════════════════════════

test('normalizeScheduleRow — analytics.v_procurement_schedule 컬럼명', () => {
  const row = normalizeScheduleRow({
    schedule_id: 'sch-1', plan_id: 'plan-1', plan_month: '2026-11-01', item_id: 'T10BITM1', item_name: '품목1',
    final_order_qty: 120, supplier_id: 'SUP-T10B-1', supplier_name: '공급처1', entity_id: 'T10B', entity_name: '법인1',
    departure_date: '2026-11-20', prep_days: 7, base_order_date: '2026-11-13', requested_order_date: '2026-11-13',
    planned_receipt_date: '2026-11-20', confirmed_receipt_date: '2026-11-19',
    bundle_iso_year: 2026, bundle_iso_week: 47, bundle_key: '2026-W47',
    calculation_status: 'SCHEDULED', reason_code: null, actual_receipt_date: null, gap_days: null,
    gap_reason_code: 'ACTUAL_RECEIPT_UNSET', superseded_at: null, superseded_by_plan_id: null,
  });
  assert.equal(row.scheduleId, 'sch-1');
  assert.equal(row.itemId, 'T10BITM1');
  assert.equal(row.finalOrderQty, 120);
  assert.equal(row.confirmedReceiptDate, '2026-11-19');
  assert.equal(row.calculationStatus, 'SCHEDULED');
  assert.equal(row.actualReceiptDate, null);
  assert.equal(row.gapReasonCode, 'ACTUAL_RECEIPT_UNSET');
  assert.equal(row.supersededAt, null);
});

test('normalizeScheduleRow — fix round 1: superseded_at · superseded_by_plan_id를 그대로 옮긴다', () => {
  const row = normalizeScheduleRow({
    schedule_id: 'sch-1', calculation_status: 'SCHEDULED',
    superseded_at: '2026-11-05T00:00:00Z', superseded_by_plan_id: 'plan-2',
  });
  assert.equal(row.supersededAt, '2026-11-05T00:00:00Z');
  assert.equal(row.supersededByPlanId, 'plan-2');
});

test('normalizeScheduleRow — 알 수 없는 상태는 EXCLUDED로 안전하게 처리한다', () => {
  const row = normalizeScheduleRow({ schedule_id: 'x', calculation_status: 'UNKNOWN_STATUS' });
  assert.equal(row.calculationStatus, 'EXCLUDED');
});

test('normalizeReceiptGapEntityRow / Item / Month', () => {
  const entity = normalizeReceiptGapEntityRow({ entity_id: 'T10B', entity_name: '법인1', n_total: 5, n_actual_recorded: 3, n_actual_unset: 2, avg_gap_days: 1.5, sum_gap_days: 4.5 });
  assert.equal(entity.entityId, 'T10B');
  assert.equal(entity.nTotal, 5);
  assert.equal(entity.avgGapDays, 1.5);

  const item = normalizeReceiptGapItemRow({ item_id: 'T10BITM1', item_name: '품목1', n_total: 2, n_actual_recorded: 0, n_actual_unset: 2, avg_gap_days: null, sum_gap_days: null });
  assert.equal(item.itemId, 'T10BITM1');
  assert.equal(item.avgGapDays, null);

  const month = normalizeReceiptGapMonthRow({ target_month: '2026-11-01', n_total: 5, n_actual_recorded: 5, n_actual_unset: 0, avg_gap_days: -1, sum_gap_days: -5 });
  assert.equal(month.targetMonth, '2026-11-01');
  assert.equal(month.avgGapDays, -1);
});

// ══ 입력 검증 ═════════════════════════════════════════════════════

test('validateBuildScheduleInput', () => {
  const ok = validateBuildScheduleInput({ planId: '11111111-1111-4111-8111-111111111111' });
  assert.equal(ok.ok, true);
  const bad = validateBuildScheduleInput({ planId: 'not-a-uuid' });
  assert.equal(bad.ok, false);
});

test('validateRecordActualReceiptInput — 빈 문자열은 null(취소)로 취급한다', () => {
  const cleared = validateRecordActualReceiptInput({ scheduleId: '11111111-1111-4111-8111-111111111111', actualReceiptDate: '', note: '' });
  assert.equal(cleared.ok, true);
  if (cleared.ok) {
    assert.equal(cleared.value.actualReceiptDate, null);
    assert.equal(cleared.value.note, null);
  }
});

test('validateRecordActualReceiptInput — 날짜 형식이 아니면 거절', () => {
  const bad = validateRecordActualReceiptInput({ scheduleId: '11111111-1111-4111-8111-111111111111', actualReceiptDate: '2026/11/19', note: null });
  assert.equal(bad.ok, false);
});

test('validateRecordActualReceiptInput — 정상 입력', () => {
  const ok = validateRecordActualReceiptInput({ scheduleId: '11111111-1111-4111-8111-111111111111', actualReceiptDate: '2026-11-19', note: '검수 완료' });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.actualReceiptDate, '2026-11-19');
    assert.equal(ok.value.note, '검수 완료');
  }
});
