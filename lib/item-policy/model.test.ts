import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ITEM_POLICY_ALLOCATION_MODES,
  normalizeItemPolicy,
  normalizeItemPolicyRevisionRow,
  validateRequestItemPolicyChange,
} from './model.ts';

// ★ stage1 §2 — 배정 방식은 AUTO/MANUAL 두 가지만 있다.
test('배정 방식은 AUTO · MANUAL 두 가지만 있다', () => {
  assert.deepEqual(ITEM_POLICY_ALLOCATION_MODES, ['AUTO', 'MANUAL']);
});

// ══ validateRequestItemPolicyChange ══════════════════════════════════

test('변경 요청 검증 — 정상 입력은 모든 값을 그대로 통과시킨다', () => {
  const result = validateRequestItemPolicyChange({
    itemId: 'ITEM001',
    targetDosDays: '30',
    allocationMode: 'MANUAL',
    targetStockQty: '500',
    unitPrice: '1200',
    moq: '50',
    packSize: '10',
    minOrderAmount: '100000',
    reason: '거래처 협의로 MOQ 조정',
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    itemId: 'ITEM001',
    targetDosDays: 30,
    allocationMode: 'MANUAL',
    targetStockQty: 500,
    unitPrice: 1200,
    moq: 50,
    packSize: 10,
    minOrderAmount: 100000,
    reason: '거래처 협의로 MOQ 조정',
  });
});

test('변경 요청 검증 — 품목코드가 없으면 거절', () => {
  const result = validateRequestItemPolicyChange({
    itemId: '  ',
    targetDosDays: '30',
    allocationMode: 'AUTO',
    targetStockQty: '',
    unitPrice: '',
    moq: '',
    packSize: '',
    minOrderAmount: '',
    reason: '사유',
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reasonCode, 'ITEM_ID_REQUIRED');
});

test('변경 요청 검증 — 배정 방식이 AUTO/MANUAL이 아니면 거절', () => {
  const result = validateRequestItemPolicyChange({
    itemId: 'ITEM001',
    targetDosDays: '',
    allocationMode: 'HYBRID',
    targetStockQty: '',
    unitPrice: '',
    moq: '',
    packSize: '',
    minOrderAmount: '',
    reason: '사유',
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reasonCode, 'ALLOCATION_MODE_INVALID');
});

test('변경 요청 검증 — 목표 DoS · 목표재고 · 단가 · MOQ · 포장단위 · 최소주문금액을 비워두면 변경하지 않는다(null)', () => {
  const result = validateRequestItemPolicyChange({
    itemId: 'ITEM001',
    targetDosDays: '',
    allocationMode: 'AUTO',
    targetStockQty: '',
    unitPrice: '',
    moq: '',
    packSize: '',
    minOrderAmount: '',
    reason: '배정 방식만 변경',
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.targetDosDays, null);
  assert.equal(result.value.targetStockQty, null);
  assert.equal(result.value.unitPrice, null);
  assert.equal(result.value.moq, null);
  assert.equal(result.value.packSize, null);
  assert.equal(result.value.minOrderAmount, null);
});

test('변경 요청 검증 — 목표 DoS는 0 이하면 거절(양수만 허용)', () => {
  const result = validateRequestItemPolicyChange({
    itemId: 'ITEM001',
    targetDosDays: '0',
    allocationMode: 'AUTO',
    targetStockQty: '',
    unitPrice: '',
    moq: '',
    packSize: '',
    minOrderAmount: '',
    reason: '사유',
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reasonCode, 'TARGET_DOS_DAYS_INVALID');
});

test('변경 요청 검증 — MOQ는 0 이하면 거절(양수만 허용, null은 허용)', () => {
  const zero = validateRequestItemPolicyChange({
    itemId: 'ITEM001', targetDosDays: '', allocationMode: 'AUTO', targetStockQty: '', unitPrice: '',
    moq: '0', packSize: '', minOrderAmount: '', reason: '사유',
  });
  assert.equal(zero.ok, false);
  if (!zero.ok) assert.equal(zero.reasonCode, 'MOQ_INVALID');

  const negative = validateRequestItemPolicyChange({
    itemId: 'ITEM001', targetDosDays: '', allocationMode: 'AUTO', targetStockQty: '', unitPrice: '',
    moq: '-5', packSize: '', minOrderAmount: '', reason: '사유',
  });
  assert.equal(negative.ok, false);
});

test('변경 요청 검증 — 목표재고 · 단가 · 최소주문금액은 0을 허용한다(0 이상)', () => {
  const result = validateRequestItemPolicyChange({
    itemId: 'ITEM001', targetDosDays: '', allocationMode: 'AUTO', targetStockQty: '0', unitPrice: '0',
    moq: '', packSize: '', minOrderAmount: '0', reason: '사유',
  });
  assert.equal(result.ok, true);
});

test('변경 요청 검증 — 숫자가 아닌 값은 거절', () => {
  const result = validateRequestItemPolicyChange({
    itemId: 'ITEM001', targetDosDays: 'abc', allocationMode: 'AUTO', targetStockQty: '', unitPrice: '',
    moq: '', packSize: '', minOrderAmount: '', reason: '사유',
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reasonCode, 'TARGET_DOS_DAYS_INVALID');
});

test('변경 요청 검증 — 변경 사유가 없으면 거절(승인 화면에서 근거로 쓰인다)', () => {
  const result = validateRequestItemPolicyChange({
    itemId: 'ITEM001', targetDosDays: '30', allocationMode: 'AUTO', targetStockQty: '', unitPrice: '',
    moq: '', packSize: '', minOrderAmount: '', reason: '   ',
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reasonCode, 'REASON_REQUIRED');
});

// ══ normalizeItemPolicy — analytics.v_item_policy(target_dos_approved 확장) ══════

test('품목 정책 행 정규화 — target_dos_approved를 그대로 옮긴다', () => {
  const approved = normalizeItemPolicy({
    item_id: 'ITEM001', target_dos_days: 30, allocation_mode: 'AUTO', target_stock_qty: 500,
    unit_price: 1000, unit_price_basis: null, moq: 50, effective_moq: 50, pack_size: null, min_order_amount: null,
    order_blocked: false, reason_code: null, target_dos_approved: true, updated_at: '2026-05-01T00:00:00Z',
  });
  assert.equal(approved.targetDosApproved, true);

  const unapproved = normalizeItemPolicy({
    item_id: 'ITEM002', target_dos_days: null, allocation_mode: 'AUTO', target_stock_qty: null,
    unit_price: null, unit_price_basis: null, moq: null, effective_moq: 1, pack_size: null, min_order_amount: null,
    order_blocked: true, reason_code: 'TARGET_DOS_UNSET', target_dos_approved: false, updated_at: null,
  });
  assert.equal(unapproved.targetDosApproved, false);
  assert.equal(unapproved.reasonCode, 'TARGET_DOS_UNSET');
});

test('품목 정책 행 정규화 — target_dos_approved가 없는 행(구형 뷰)은 false로 본다(임의로 승인됨을 만들지 않는다)', () => {
  const row = normalizeItemPolicy({
    item_id: 'ITEM001', target_dos_days: 30, allocation_mode: 'AUTO', target_stock_qty: null,
    unit_price: null, unit_price_basis: null, moq: null, effective_moq: 1, pack_size: null, min_order_amount: null,
    order_blocked: false, reason_code: null, updated_at: null,
  });
  assert.equal(row.targetDosApproved, false);
});

// ══ normalizeItemPolicyRevisionRow — analytics.v_item_policy_revision ══════════

test('변경 이력 행 정규화 — 제안값과 기존값을 함께 옮긴다', () => {
  const row = normalizeItemPolicyRevisionRow({
    revision_id: 'r-1', item_id: 'ITEM001', item_name: '테스트 품목',
    proposed_target_dos_days: 30, proposed_allocation_mode: 'MANUAL', proposed_target_stock_qty: 500,
    proposed_unit_price: 1200, proposed_moq: 50, proposed_pack_size: 10, proposed_min_order_amount: 100000,
    previous_target_dos_days: null, previous_allocation_mode: 'AUTO', previous_target_stock_qty: null,
    previous_unit_price: null, previous_moq: null, previous_pack_size: null, previous_min_order_amount: null,
    reason: 'MOQ 조정', requested_by: 'u-1', requester_name: 'SCM품목담당1', requested_at: '2026-05-01T00:00:00Z',
    approval_id: 'a-1', status: 'PENDING', decided_by: null, decider_name: null, decided_at: null, decision_comment: null,
  });
  assert.equal(row.revisionId, 'r-1');
  assert.equal(row.itemId, 'ITEM001');
  assert.equal(row.proposedAllocationMode, 'MANUAL');
  assert.equal(row.previousAllocationMode, 'AUTO');
  assert.equal(row.previousTargetDosDays, null);
  assert.equal(row.status, 'PENDING');
  assert.equal(row.deciderName, null);
});

test('변경 이력 행 정규화 — 알 수 없는 status는 PENDING으로 보지 않고 그대로 지나가지 않는다(기본 PENDING으로 방어)', () => {
  const row = normalizeItemPolicyRevisionRow({
    revision_id: 'r-2', item_id: 'ITEM001', item_name: null,
    proposed_target_dos_days: null, proposed_allocation_mode: 'AUTO', proposed_target_stock_qty: null,
    proposed_unit_price: null, proposed_moq: null, proposed_pack_size: null, proposed_min_order_amount: null,
    previous_target_dos_days: null, previous_allocation_mode: null, previous_target_stock_qty: null,
    previous_unit_price: null, previous_moq: null, previous_pack_size: null, previous_min_order_amount: null,
    reason: '사유', requested_by: 'u-1', requester_name: '요청자', requested_at: '2026-05-01T00:00:00Z',
    approval_id: null, status: 'UNKNOWN_STATUS', decided_by: null, decider_name: null, decided_at: null, decision_comment: null,
  });
  assert.equal(row.status, 'PENDING');
});
