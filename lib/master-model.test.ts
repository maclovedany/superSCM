import assert from 'node:assert/strict';
import test from 'node:test';
import {
  departureLabel,
  normalizeItemPolicy,
  normalizeMasterReadiness,
  normalizeSupplier,
  normalizeSupplierDeparture,
  normalizeSupplyEntity,
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
