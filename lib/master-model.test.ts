import assert from 'node:assert/strict';
import test from 'node:test';
import {
  departureLabel,
  normalizeCalendarReadiness,
  normalizeItemPolicy,
  normalizeMasterHistoryEntry,
  normalizeMasterReadiness,
  normalizeSupplier,
  normalizeSupplierDeparture,
  normalizeSupplyEntity,
  validateAddHolidayInput,
  validateCalendarReadinessInput,
  validateDeactivateDepartureRuleInput,
  validateDepartureRuleInput,
  validateRemoveHolidayInput,
  validateSupplierInput,
  validateSupplyEntityInput,
} from './master-model.ts';

test('해외법인 뷰 한 행을 화면 모델로 옮긴다', () => {
  const row = normalizeSupplyEntity({
    entity_id: 'JP', entity_name: '일본', country_code: 'JP',
    prep_days: 7, active: true, valid_from: '2026-01-01', valid_to: null,
    note: null, n_active_suppliers: 3, reason_code: null,
  });
  assert.equal(row.entityId, 'JP');
  assert.equal(row.prepDays, 7);
  assert.equal(row.activeSupplierCount, 3);
  assert.equal(row.reasonCode, null);
});

test('출항 준비기간이 아직 없으면 사유 코드가 남는다', () => {
  // ★ prep_days 0 을 "준비기간 0일" 로 읽으면 발주일이 출항일과 같아집니다.
  //   뷰가 붙여 준 사유 코드를 화면이 그대로 들고 있어야 합니다.
  const row = normalizeSupplyEntity({ entity_id: 'NL', prep_days: 0, reason_code: 'PREP_DAYS_UNSET' });
  assert.equal(row.prepDays, 0);
  assert.equal(row.reasonCode, 'PREP_DAYS_UNSET');
});

test('공급처 리드타임이 없으면 null 이다 — 0 으로 채우지 않는다', () => {
  const row = normalizeSupplier({
    supplier_id: 'SUP-01', supplier_name: '후지 일본공장', entity_id: 'JP',
    lead_time_days: null, active: true, n_departure_rules: 0, reason_code: 'LEADTIME_UNSET',
  });
  assert.equal(row.leadTimeDays, null);
  assert.equal(row.reasonCode, 'LEADTIME_UNSET');
});

test('MOQ 가 없으면 1, 목표 DoS 가 없으면 발주 차단 — 기본값 규칙이 서로 다르다', () => {
  // stage1 §6 · §7. 이 둘을 같게 처리하면 두 규칙 중 하나가 반드시 깨집니다.
  const noMoq = normalizeItemPolicy({
    item_id: 'ITEM002', moq: null, effective_moq: 1,
    target_dos_days: null, order_blocked: true, reason_code: 'TARGET_DOS_UNSET',
  });
  assert.equal(noMoq.moq, null, '원본 값은 null 로 보존합니다');
  assert.equal(noMoq.effectiveMoq, 1, 'MOQ 는 1 로 계산을 이어갑니다');
  assert.equal(noMoq.orderBlocked, true, '목표 DoS 는 계산을 멈춥니다');

  const ready = normalizeItemPolicy({
    item_id: 'ITEM001', moq: 50, effective_moq: 50,
    target_dos_days: 30, order_blocked: false, reason_code: null,
  });
  assert.equal(ready.effectiveMoq, 50);
  assert.equal(ready.orderBlocked, false);
});

test('배정 방식은 AUTO 와 MANUAL 뿐이고 모르는 값은 AUTO 로 본다', () => {
  assert.equal(normalizeItemPolicy({ item_id: 'A', allocation_mode: 'MANUAL' }).allocationMode, 'MANUAL');
  assert.equal(normalizeItemPolicy({ item_id: 'A', allocation_mode: '이상한값' }).allocationMode, 'AUTO');
  assert.equal(normalizeItemPolicy({ item_id: 'A' }).allocationMode, 'AUTO');
});

test('출항일 규칙은 요일과 일자 중 하나로 읽힌다', () => {
  assert.equal(departureLabel({ weekday: 3, dayOfMonth: null }), '매주 수요일');
  assert.equal(departureLabel({ weekday: 0, dayOfMonth: null }), '매주 일요일');
  assert.equal(departureLabel({ weekday: null, dayOfMonth: 15 }), '매월 15일');
  assert.equal(departureLabel({ weekday: null, dayOfMonth: null }), '규칙 없음');
});

test('출항일 뷰 한 행을 옮긴다', () => {
  const row = normalizeSupplierDeparture({
    departure_id: 1, supplier_id: 'SUP-01', supplier_name: '후지 일본공장',
    entity_id: 'JP', weekday: 3, day_of_month: null,
  });
  assert.equal(row.departureId, 1);
  assert.equal(row.weekday, 3);
  assert.equal(row.dayOfMonth, null);
  assert.equal(row.active, true, '구형 뷰(active 없음)는 true 로 본다');
});

// ══ Task 10a ═══════════════════════════════════════════════════

test('주차 규칙("매월 N번째 요일")은 weekday 와 weekOfMonth 가 함께 있을 때만 나온다', () => {
  assert.equal(departureLabel({ weekday: 2, dayOfMonth: null, weekOfMonth: 2 }), '매월 2번째 화요일');
  // weekOfMonth 없이 weekday 만 있으면 기존처럼 "매주"
  assert.equal(departureLabel({ weekday: 2, dayOfMonth: null }), '매주 화요일');
});

test('출항일 뷰 한 행에 week_of_month · active 를 함께 옮긴다', () => {
  const row = normalizeSupplierDeparture({
    departure_id: 2, supplier_id: 'SUP-02', supplier_name: '후지 베트남공장',
    entity_id: 'VN', weekday: 1, day_of_month: null, week_of_month: 2, active: false,
  });
  assert.equal(row.weekOfMonth, 2);
  assert.equal(row.active, false);
});

test('달력 준비 상태 한 행을 옮긴다', () => {
  const row = normalizeCalendarReadiness({
    country_code: 'KR', cal_year: 2026, cal_month: 9, ready: true,
    note: '2026년 9월 공휴일 입력 완료', marked_by_name: '관리자1', marked_at: '2026-09-12T00:00:00Z', n_holidays: 2,
  });
  assert.equal(row.ready, true);
  assert.equal(row.holidayCount, 2);
});

test('마스터 변경 이력 한 행을 옮긴다', () => {
  const row = normalizeMasterHistoryEntry({
    id: 10, at: '2026-09-12T00:00:00Z', actor_name: '관리자1', action: 'SUPPLY_ENTITY_UPDATED',
    target_type: 'supply_entity', target_id: 'JP', before: { prep_days: 0 }, after: { prep_days: 7, reason: '현업 확인' },
  });
  assert.equal(row.action, 'SUPPLY_ENTITY_UPDATED');
  assert.deepEqual(row.after, { prep_days: 7, reason: '현업 확인' });
});

test('해외법인 편집 입력 — 정상값은 통과하고 대문자로 정규화한다', () => {
  const result = validateSupplyEntityInput({
    entityId: 'jp', entityName: '일본', countryCode: 'jp', prepDays: '7', active: 'true',
    validFrom: '2026-01-01', validTo: '', note: '', reason: '현업 확인 완료',
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.entityId, 'JP');
    assert.equal(result.value.prepDays, 7);
    assert.equal(result.value.validTo, null);
  }
});

test('해외법인 편집 입력 — 변경 사유가 없으면 거절한다', () => {
  const result = validateSupplyEntityInput({
    entityId: 'JP', entityName: '일본', countryCode: 'JP', prepDays: '7', active: 'true',
    validFrom: '', validTo: '', note: '', reason: '   ',
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reasonCode, 'REASON_REQUIRED');
});

test('해외법인 편집 입력 — 비활성 전환은 종료일이 있어야 한다(과거 이력은 지우지 않는다)', () => {
  const result = validateSupplyEntityInput({
    entityId: 'JP', entityName: '일본', countryCode: 'JP', prepDays: '7', active: 'false',
    validFrom: '', validTo: '', note: '', reason: '조달 중단',
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reasonCode, 'VALID_TO_REQUIRED_ON_DEACTIVATE');
});

test('해외법인 편집 입력 — 준비기간을 비우면 0(아직 못 받은 값)으로 본다', () => {
  const result = validateSupplyEntityInput({
    entityId: 'JP', entityName: '일본', countryCode: 'JP', prepDays: '', active: 'true',
    validFrom: '', validTo: '', note: '', reason: '신규 법인 등록',
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.prepDays, 0);
});

test('공급처 편집 입력 — 퇴출(비활성)은 종료일 없이 거절한다', () => {
  const result = validateSupplierInput({
    supplierId: 'SUP-01', supplierName: '후지 일본공장', entityId: 'JP', leadTimeDays: '10',
    active: 'false', validFrom: '', validTo: '', note: '', reason: '거래 종료',
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reasonCode, 'VALID_TO_REQUIRED_ON_DEACTIVATE');
});

test('공급처 편집 입력 — 소속 법인이 없으면 거절한다', () => {
  const result = validateSupplierInput({
    supplierId: 'SUP-01', supplierName: '후지 일본공장', entityId: '', leadTimeDays: '',
    active: 'true', validFrom: '', validTo: '', note: '', reason: '신규 등록',
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reasonCode, 'ENTITY_ID_REQUIRED');
});

test('출항일 규칙 입력 — 매주 요일 규칙', () => {
  const result = validateDepartureRuleInput({
    departureId: '', supplierId: 'SUP-01', ruleType: 'WEEKDAY', weekday: '3', weekOfMonth: '',
    dayOfMonth: '', validFrom: '', validTo: '', note: '', reason: '신규 등록',
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.weekday, 3);
    assert.equal(result.value.weekOfMonth, null);
    assert.equal(result.value.dayOfMonth, null);
    assert.equal(result.value.departureId, null, '빈 departureId 는 새 규칙(create)이다');
  }
});

test('출항일 규칙 입력 — 매월 N번째 요일(주차) 규칙', () => {
  const result = validateDepartureRuleInput({
    departureId: '5', supplierId: 'SUP-01', ruleType: 'WEEK_OF_MONTH', weekday: '1', weekOfMonth: '2',
    dayOfMonth: '', validFrom: '', validTo: '', note: '', reason: '규칙 변경',
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.weekday, 1);
    assert.equal(result.value.weekOfMonth, 2);
    assert.equal(result.value.departureId, 5, '기존 id 가 있으면 replace 다');
  }
});

test('출항일 규칙 입력 — 매월 일자 규칙', () => {
  const result = validateDepartureRuleInput({
    departureId: '', supplierId: 'SUP-01', ruleType: 'MONTH_DAY', weekday: '', weekOfMonth: '',
    dayOfMonth: '15', validFrom: '', validTo: '', note: '', reason: '신규 등록',
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.dayOfMonth, 15);
});

test('출항일 규칙 입력 — 잘못된 주차는 거절한다', () => {
  const result = validateDepartureRuleInput({
    departureId: '', supplierId: 'SUP-01', ruleType: 'WEEK_OF_MONTH', weekday: '1', weekOfMonth: '9',
    dayOfMonth: '', validFrom: '', validTo: '', note: '', reason: '신규 등록',
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reasonCode, 'WEEK_OF_MONTH_INVALID');
});

test('출항일 규칙 비활성화 입력 검증', () => {
  const ok = validateDeactivateDepartureRuleInput({ departureId: '5', reason: '공급처 변경' });
  assert.equal(ok.ok, true);
  const bad = validateDeactivateDepartureRuleInput({ departureId: '5', reason: '' });
  assert.equal(bad.ok, false);
});

test('공휴일 추가 입력 검증', () => {
  const ok = validateAddHolidayInput({ countryCode: 'kr', calendarDate: '2026-09-25', holidayName: '추석', reason: '2026년 공휴일 입력' });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.countryCode, 'KR');

  const bad = validateAddHolidayInput({ countryCode: 'KR', calendarDate: '2026/09/25', holidayName: '추석', reason: '사유' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.reasonCode, 'DATE_INVALID');
});

test('공휴일 제거 입력 검증', () => {
  const result = validateRemoveHolidayInput({ countryCode: 'KR', calendarDate: '2026-09-25', reason: '착오 등록 정정' });
  assert.equal(result.ok, true);
});

test('달력 월 준비 상태 입력 검증', () => {
  const ok = validateCalendarReadinessInput({ countryCode: 'kr', calYear: '2026', calMonth: '9', ready: 'true', reason: '9월 공휴일 입력 완료' });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.calMonth, 9);

  const bad = validateCalendarReadinessInput({ countryCode: 'KR', calYear: '2026', calMonth: '13', ready: 'true', reason: '사유' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.reasonCode, 'MONTH_INVALID');
});

test('준비 상태 요약은 빈 값을 0 으로 채운다 — 세는 값이라 null 이 아니다', () => {
  const empty = normalizeMasterReadiness({});
  assert.equal(empty.entities, 0);
  assert.equal(empty.targetDosUnset, 0);

  const filled = normalizeMasterReadiness({
    n_entities: 5, n_prep_days_unset: 5, n_suppliers: 0, n_leadtime_unset: 0,
    n_departure_rules: 0, n_calendar_days: 0, n_item_policies: 23, n_target_dos_unset: 23,
  });
  assert.equal(filled.entities, 5);
  assert.equal(filled.prepDaysUnset, 5);
  assert.equal(filled.targetDosUnset, 23);
});
