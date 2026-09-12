import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INVENTORY_VISIBILITY_SCOPES,
  isInventoryVisibilityScope,
  itemMasterStatusBannerMessage,
  normalizeAvailableStockRow,
  normalizeItemMasterSourceStatus,
  normalizeOrderAvailableStockRow,
  normalizeStockReferenceSourceStatus,
  stockReferenceStatusBannerMessage,
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

test('보정(2026-09-12) — Open PO 참고 열이 null이어도 별도 사유 열을 만들지 않는다(화면 배너가 안내한다)', () => {
  // docs/stage1-판정기록.md Task 16 판정 — analytics.v_available_stock에 사유 열을 더하지
  // 않는다. open_po_qty가 null이면 그냥 null로 옮긴다(reasonCode와 섞지 않는다).
  const row = normalizeAvailableStockRow({
    item_id: 'ITEM007',
    item_name: '출처 미확인 발주수량 품목',
    normal_warehouse_qty: 20,
    available_qty: 20,
    open_po_qty: null,
    reason_code: null,
  });

  assert.equal(row.openPoQty, null);
  assert.equal(row.reasonCode, null);
  assert.equal(row.normalWarehouseQty, 20);
  assert.ok(!('openPoReasonCode' in row));
});

test('analytics.v_stock_reference_source_status 행을 배너 상태로 옮긴다', () => {
  assert.deepEqual(
    normalizeStockReferenceSourceStatus({
      open_po_sourced_rows: 0,
      open_po_unsourced_rows: 92,
      open_po_unparseable_items: 0,
      open_po_reason_code: 'OPEN_PO_SOURCE_UNVERIFIED',
      in_transit_sourced_rows: 0,
      in_transit_unsourced_rows: 2864,
      in_transit_has_import_path: false,
      in_transit_reason_code: 'IN_TRANSIT_NO_IMPORT_PATH',
    }),
    {
      openPoSourcedRows: 0,
      openPoUnsourcedRows: 92,
      openPoUnparseableItems: 0,
      openPoReasonCode: 'OPEN_PO_SOURCE_UNVERIFIED',
      inTransitSourcedRows: 0,
      inTransitUnsourcedRows: 2864,
      inTransitHasImportPath: false,
      inTransitReasonCode: 'IN_TRANSIT_NO_IMPORT_PATH',
    },
  );
  assert.equal(normalizeStockReferenceSourceStatus(null), null);
});

test('리뷰 라운드 3 — 이동 중 사유는 구조 조건(적재 경로 없음)과 데이터 조건(출처 미확인)을 별개로 옮긴다', () => {
  const noPath = normalizeStockReferenceSourceStatus({
    in_transit_sourced_rows: 0,
    in_transit_unsourced_rows: 2864,
    in_transit_has_import_path: false,
    in_transit_reason_code: 'IN_TRANSIT_NO_IMPORT_PATH',
  })!;
  assert.equal(noPath.inTransitHasImportPath, false);
  assert.equal(noPath.inTransitReasonCode, 'IN_TRANSIT_NO_IMPORT_PATH');

  const unverified = normalizeStockReferenceSourceStatus({
    in_transit_sourced_rows: 3,
    in_transit_unsourced_rows: 5,
    in_transit_has_import_path: true,
    in_transit_reason_code: 'IN_TRANSIT_SOURCE_UNVERIFIED',
  })!;
  assert.equal(unverified.inTransitHasImportPath, true);
  assert.equal(unverified.inTransitReasonCode, 'IN_TRANSIT_SOURCE_UNVERIFIED');
});

test('참고 열 배너 문구는 Open PO 출처 미확인·파싱 불가·이동 중 적재 경로 없음·이동 중 출처 미확인을 구분해서 안내한다', () => {
  const openPoUnverified = {
    openPoSourcedRows: 0, openPoUnsourcedRows: 92, openPoUnparseableItems: 0, openPoReasonCode: 'OPEN_PO_SOURCE_UNVERIFIED',
    inTransitSourcedRows: 10, inTransitUnsourcedRows: 0, inTransitHasImportPath: true, inTransitReasonCode: null,
  };
  assert.match(stockReferenceStatusBannerMessage(openPoUnverified), /출처가 확인되지 않은/);

  const openPoUnparseable = {
    openPoSourcedRows: 10, openPoUnsourcedRows: 0, openPoUnparseableItems: 1, openPoReasonCode: 'OPEN_PO_QTY_UNPARSEABLE',
    inTransitSourcedRows: 10, inTransitUnsourcedRows: 0, inTransitHasImportPath: true, inTransitReasonCode: null,
  };
  assert.match(stockReferenceStatusBannerMessage(openPoUnparseable), /숫자로 읽을 수 없어/);

  const inTransitNoPath = {
    openPoSourcedRows: 10, openPoUnsourcedRows: 0, openPoUnparseableItems: 0, openPoReasonCode: null,
    inTransitSourcedRows: 0, inTransitUnsourcedRows: 2864, inTransitHasImportPath: false, inTransitReasonCode: 'IN_TRANSIT_NO_IMPORT_PATH',
  };
  assert.match(stockReferenceStatusBannerMessage(inTransitNoPath), /IMPORT하는 방법이 없어/);

  const inTransitUnverified = {
    openPoSourcedRows: 10, openPoUnsourcedRows: 0, openPoUnparseableItems: 0, openPoReasonCode: null,
    inTransitSourcedRows: 3, inTransitUnsourcedRows: 5, inTransitHasImportPath: true, inTransitReasonCode: 'IN_TRANSIT_SOURCE_UNVERIFIED',
  };
  const unverifiedMessage = stockReferenceStatusBannerMessage(inTransitUnverified);
  assert.match(unverifiedMessage, /출처가 확인되지 않은/);
  assert.doesNotMatch(unverifiedMessage, /IMPORT하는 방법이 없어/);

  const both = {
    openPoSourcedRows: 0, openPoUnsourcedRows: 92, openPoUnparseableItems: 0, openPoReasonCode: 'OPEN_PO_SOURCE_UNVERIFIED',
    inTransitSourcedRows: 0, inTransitUnsourcedRows: 2864, inTransitHasImportPath: false, inTransitReasonCode: 'IN_TRANSIT_NO_IMPORT_PATH',
  };
  const bothMessage = stockReferenceStatusBannerMessage(both);
  assert.match(bothMessage, /출처가 확인되지 않은/);
  assert.match(bothMessage, /IMPORT하는 방법이 없어/);
});

test('analytics.v_item_master_source_status 행을 배너 상태로 옮긴다 — 품목 단위(Task 17, 리뷰 fix round 1)', () => {
  // ★ 리뷰 fix round 1 — 상태 뷰가 raw.item_master 행 수가 아니라 화면 목록과 같은 품목
  //   단위로 센다(34행/23행이 아니라 32품목/21품목). 필드 이름도 …Items로 맞췄다.
  assert.deepEqual(
    normalizeItemMasterSourceStatus({
      item_master_sourced_items: 11,
      item_master_unsourced_items: 21,
      item_master_reason_code: 'ITEM_MASTER_SOURCE_UNVERIFIED',
    }),
    {
      itemMasterSourcedItems: 11,
      itemMasterUnsourcedItems: 21,
      itemMasterReasonCode: 'ITEM_MASTER_SOURCE_UNVERIFIED',
    },
  );
  assert.equal(normalizeItemMasterSourceStatus(null), null);

  const clean = normalizeItemMasterSourceStatus({
    item_master_sourced_items: 11,
    item_master_unsourced_items: 0,
    item_master_reason_code: null,
  })!;
  assert.equal(clean.itemMasterReasonCode, null);
});

test('품목 마스터 출처 배너 문구는 걸러진 품목 수를 포함하고, 사유가 없으면 빈 문자열이다(Task 17, 리뷰 fix round 1)', () => {
  const unverified = { itemMasterSourcedItems: 11, itemMasterUnsourcedItems: 21, itemMasterReasonCode: 'ITEM_MASTER_SOURCE_UNVERIFIED' };
  const message = itemMasterStatusBannerMessage(unverified);
  assert.match(message, /출처가 확인되지 않은/);
  assert.match(message, /21개/);
  // ★ 리뷰 8-b — "실습 등록으로 들어오면 표시됩니다"는 측정으로 반증된 주장이라 문구에서 뺐다.
  assert.doesNotMatch(message, /실습 등록/);

  const clean = { itemMasterSourcedItems: 11, itemMasterUnsourcedItems: 0, itemMasterReasonCode: null };
  assert.equal(itemMasterStatusBannerMessage(clean), '');
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

test('analytics.v_order_available_stock 행은 주문 가능 수량 네 열만 옮긴다 — 재고 상세는 없다', () => {
  const row = normalizeOrderAvailableStockRow({
    item_id: 'ITEM001',
    item_name: '카드리더기 A형',
    available_qty: 15,
    reason_code: null,
  });

  assert.deepEqual(row, {
    itemId: 'ITEM001',
    itemName: '카드리더기 A형',
    availableQty: 15,
    reasonCode: null,
  });
});

test('분류할 수 없는 품목의 주문 가능 수량도 0이 아니라 null과 사유 코드를 유지한다', () => {
  const row = normalizeOrderAvailableStockRow({
    item_id: 'ITEM020',
    item_name: '표기 미정 품목',
    available_qty: null,
    reason_code: 'INVENTORY_SCOPE_UNCLASSIFIED',
  });

  assert.equal(row.availableQty, null);
  assert.equal(row.reasonCode, 'INVENTORY_SCOPE_UNCLASSIFIED');
});
