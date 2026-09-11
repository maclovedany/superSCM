import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPROVED_DEMAND_EXCLUSION_LABELS,
  APPROVED_DEMAND_SOURCE_LABELS,
  normalizeApprovedDemandDetailRow,
  normalizeApprovedDemandMonthlyRow,
  normalizePlanMonth,
  validateRequestEventDemand,
  validateSetSupplyMeetingResult,
} from './approved-model.ts';

// ★ stage1.md §5 "추가 수요 반영 기준" — 확정 근거 세 가지만 화면 라벨을 갖는다.
test('원천 코드는 CONFIRMED_ORDER · SUPPLY_MEETING · EVENT_DEMAND 세 가지만 라벨을 갖는다', () => {
  assert.deepEqual(Object.keys(APPROVED_DEMAND_SOURCE_LABELS).sort(), ['CONFIRMED_ORDER', 'EVENT_DEMAND', 'SUPPLY_MEETING']);
});

test('제외 사유 라벨 — 수급회의 미승인 · 이벤트 승인대기 · 이벤트 반려', () => {
  assert.equal(APPROVED_DEMAND_EXCLUSION_LABELS.MEETING_NOT_APPROVED, '수급회의 미승인');
  assert.equal(APPROVED_DEMAND_EXCLUSION_LABELS.EVENT_NOT_APPROVED, '이벤트 승인 대기');
  assert.equal(APPROVED_DEMAND_EXCLUSION_LABELS.EVENT_REJECTED, '이벤트 반려됨');
});

test('계획월 정규화 — YYYY-MM은 YYYY-MM-01로', () => {
  assert.equal(normalizePlanMonth('2026-05'), '2026-05-01');
  assert.equal(normalizePlanMonth('2026-05-17'), '2026-05-01');
});

test('계획월 정규화 — 형식이 아니면 null', () => {
  assert.equal(normalizePlanMonth('2026/05'), null);
  assert.equal(normalizePlanMonth(''), null);
  assert.equal(normalizePlanMonth('2026-13'), null);
});

test('상세 행 정규화 — counted=false면 exclusionLabel을 채운다', () => {
  const row = normalizeApprovedDemandDetailRow({
    source_code: 'SUPPLY_MEETING',
    plan_month: '2026-05-01',
    item_id: 'ITEM001',
    item_name: '테스트 품목',
    qty: 10,
    counted: false,
    exclusion_reason: 'MEETING_NOT_APPROVED',
    reference_id: 'r-1',
    reference_label: null,
    customer_name: null,
    entered_by_name: 'SCM품목담당1',
    entered_at: '2026-05-01T00:00:00Z',
    decision_comment: null,
    status_label: 'NOT_APPROVED',
  });
  assert.equal(row.sourceLabel, '수급회의 승인');
  assert.equal(row.counted, false);
  assert.equal(row.exclusionLabel, '수급회의 미승인');
});

test('상세 행 정규화 — 알 수 없는 제외 사유 코드는 코드 그대로 보여준다(임의 값으로 바꾸지 않는다)', () => {
  const row = normalizeApprovedDemandDetailRow({
    source_code: 'EVENT_DEMAND',
    counted: false,
    exclusion_reason: 'UNKNOWN_CODE',
  });
  assert.equal(row.exclusionLabel, 'UNKNOWN_CODE');
});

test('상세 행 정규화 — counted=true면 exclusionLabel이 null', () => {
  const row = normalizeApprovedDemandDetailRow({ source_code: 'CONFIRMED_ORDER', counted: true, exclusion_reason: null });
  assert.equal(row.exclusionLabel, null);
});

test('월간 행 정규화 — 없는 값은 0으로 채운다(뷰가 coalesce로 이미 0을 보장하지만 방어적으로 둔다)', () => {
  const row = normalizeApprovedDemandMonthlyRow({ plan_month: '2026-05-01', item_id: 'ITEM001', item_name: '품목' });
  assert.equal(row.approvedQty, 0);
  assert.equal(row.confirmedOrderQty, 0);
  assert.equal(row.supplyMeetingQty, 0);
  assert.equal(row.eventDemandQty, 0);
});

test('수급회의 결과 입력 검증 — 계획월 형식 오류를 거절', () => {
  const result = validateSetSupplyMeetingResult({ planMonth: '2026/05', itemId: 'ITEM001', qty: '10', approved: true });
  assert.equal(result.ok, false);
});

test('수급회의 결과 입력 검증 — 품목코드 없으면 거절', () => {
  const result = validateSetSupplyMeetingResult({ planMonth: '2026-05', itemId: '  ', qty: '10', approved: true });
  assert.equal(result.ok, false);
});

test('수급회의 결과 입력 검증 — 수량 0은 허용(수급회의에서 취소로 0 입력 가능)', () => {
  const result = validateSetSupplyMeetingResult({ planMonth: '2026-05', itemId: 'ITEM001', qty: '0', approved: false });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.qty, 0);
});

test('수급회의 결과 입력 검증 — 음수 수량은 거절', () => {
  const result = validateSetSupplyMeetingResult({ planMonth: '2026-05', itemId: 'ITEM001', qty: '-1', approved: false });
  assert.equal(result.ok, false);
});

test('수급회의 결과 입력 검증 — 정상 입력은 계획월을 YYYY-MM-01로 정규화하고 approved를 boolean으로 바꾼다', () => {
  const result = validateSetSupplyMeetingResult({ planMonth: '2026-05', itemId: 'item-001', qty: '25.5', approved: 'true' });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, {
      planMonth: '2026-05-01', itemId: 'item-001', qty: 25.5, approved: true, basisSubmissionLineId: null, reason: null,
    });
  }
});

test('이벤트 추가 수요 요청 검증 — 고객·기종·수량·사유가 모두 있어야 한다(stage1.md §5)', () => {
  assert.equal(validateRequestEventDemand({ planMonth: '2026-05', itemId: '', customerName: 'A사', qty: '10', reason: '이벤트' }).ok, false);
  assert.equal(validateRequestEventDemand({ planMonth: '2026-05', itemId: 'ITEM001', customerName: '', qty: '10', reason: '이벤트' }).ok, false);
  assert.equal(validateRequestEventDemand({ planMonth: '2026-05', itemId: 'ITEM001', customerName: 'A사', qty: '0', reason: '이벤트' }).ok, false);
  assert.equal(validateRequestEventDemand({ planMonth: '2026-05', itemId: 'ITEM001', customerName: 'A사', qty: '10', reason: '' }).ok, false);
});

test('이벤트 추가 수요 요청 검증 — 정상 입력은 통과한다', () => {
  const result = validateRequestEventDemand({
    planMonth: '2026-05', itemId: 'ITEM001', customerName: 'A사', qty: '100', reason: 'A사 프로모션 대응(품목 ITEM001, 100대)',
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, {
    planMonth: '2026-05-01', itemId: 'ITEM001', customerName: 'A사', qty: 100,
    reason: 'A사 프로모션 대응(품목 ITEM001, 100대)',
  });
});
