import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INVENTORY_VISIBILITY_SCOPES,
  isInventoryVisibilityScope,
  normalizeAvailableStockRow,
} from './model.ts';

test('조회 범위는 세 가지 업무 코드만 허용하고, 그 외 값은 GENERAL로 취급한다', () => {
  assert.deepEqual(INVENTORY_VISIBILITY_SCOPES, ['PAPER_CARD_READER', 'CONSUMABLE', 'GENERAL']);
  for (const scope of INVENTORY_VISIBILITY_SCOPES) assert.equal(isInventoryVisibilityScope(scope), true);
  assert.equal(isInventoryVisibilityScope('OFFICE_SUPPLY'), false);
  assert.equal(isInventoryVisibilityScope(null), false);
});

test('analytics.v_available_stock 행을 화면 모델로 옮긴다 — 정상 분류된 행', () => {
  const row = normalizeAvailableStockRow({
    item_id: 'ITEM001',
    item_name: '카드리더기 A형',
    item_type: '카드리더기',
    visibility_scope: 'PAPER_CARD_READER',
    normal_warehouse_qty: 20,
    snapshot_at: '2026-09-10T00:00:00Z',
    temporary_allocated_qty: 3,
    firm_allocated_qty: 2,
    approval_hold_qty: 0,
    available_qty: 15,
    open_po_qty: 5,
    in_transit_qty: 8,
    reason_code: null,
  });

  assert.deepEqual(row, {
    itemId: 'ITEM001',
    itemName: '카드리더기 A형',
    itemType: '카드리더기',
    visibilityScope: 'PAPER_CARD_READER',
    normalWarehouseQty: 20,
    snapshotAt: '2026-09-10T00:00:00Z',
    temporaryAllocatedQty: 3,
    firmAllocatedQty: 2,
    approvalHoldQty: 0,
    availableQty: 15,
    openPoQty: 5,
    inTransitQty: 8,
    reasonCode: null,
  });
});

test('분류할 수 없는 행은 0이 아니라 null과 사유 코드를 유지한다', () => {
  const row = normalizeAvailableStockRow({
    item_id: 'ITEM020',
    item_name: '표기 미정 품목',
    item_type: null,
    visibility_scope: null,
    normal_warehouse_qty: null,
    snapshot_at: null,
    temporary_allocated_qty: null,
    firm_allocated_qty: null,
    approval_hold_qty: null,
    available_qty: null,
    open_po_qty: null,
    in_transit_qty: null,
    reason_code: 'INVENTORY_SCOPE_UNCLASSIFIED',
  });

  assert.equal(row.normalWarehouseQty, null);
  assert.equal(row.availableQty, null);
  assert.equal(row.reasonCode, 'INVENTORY_SCOPE_UNCLASSIFIED');
  // 배정 수량은 아직 배정 이력이 없다는 확정된 사실이므로 0이 맞습니다 — null이 아닙니다.
  assert.equal(row.temporaryAllocatedQty, 0);
  assert.equal(row.firmAllocatedQty, 0);
  assert.equal(row.approvalHoldQty, 0);
  assert.equal(row.visibilityScope, 'GENERAL');
});

test('숫자 컬럼이 문자열(Supabase numeric)로 와도 숫자로 변환한다', () => {
  const row = normalizeAvailableStockRow({
    item_id: 'ITEM002',
    item_name: '복사용지 A4',
    normal_warehouse_qty: '20',
    available_qty: '15.5',
  });

  assert.equal(row.normalWarehouseQty, 20);
  assert.equal(row.availableQty, 15.5);
});

test('한국어 컬럼 별칭도 읽는다', () => {
  const row = normalizeAvailableStockRow({
    품목코드: 'ITEM003',
    품목명: '토너 카트리지',
    품목구분: '소모품',
    조회범위: 'CONSUMABLE',
    정상창고재고: 12,
    가용재고: 12,
    사유코드: null,
  });

  assert.equal(row.itemId, 'ITEM003');
  assert.equal(row.itemName, '토너 카트리지');
  assert.equal(row.itemType, '소모품');
  assert.equal(row.visibilityScope, 'CONSUMABLE');
  assert.equal(row.normalWarehouseQty, 12);
  assert.equal(row.availableQty, 12);
});
