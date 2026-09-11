import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRows } from './validate.ts';

const references = {
  itemIds: new Set(['ITEM001']),
  supplierIds: new Set(['SUP001']),
  inventoryStatuses: new Set(['정상', '검사대기', '이동중', '불량', '서비스센터', '파트너']),
};

test('usage history의 잘못된 품목, 날짜, 필수 수량을 오류 행으로 보존한다', () => {
  const result = validateRows('usage_history', [
    { item_id: 'UNKNOWN', use_date: 'bad-date', qty: null },
  ], references);

  assert.equal(result.summary.errorRows, 1);
  assert.deepEqual(result.issues.map((issue) => issue.code), ['UNKNOWN_ITEM', 'INVALID_DATE', 'REQUIRED_VALUE']);
  assert.equal(result.rows[0].data.qty, null);
});

test('같은 source record와 비정상 음수 수량을 별도 reason code로 검출한다', () => {
  const result = validateRows('sales_order', [
    { source_record_id: 'SO-1', item_id: 'ITEM001', order_date: '2026-01-10', quantity: -1 },
    { source_record_id: 'SO-1', item_id: 'ITEM001', order_date: '2026-01-10', quantity: 2 },
  ], references);

  assert.ok(result.issues.some((issue) => issue.code === 'NEGATIVE_QUANTITY'));
  assert.ok(result.issues.some((issue) => issue.code === 'DUPLICATE_RECORD'));
});

test('재고 스냅샷은 재고상태·창고·스냅샷일자가 모두 있어야 하며 등록되지 않은 상태는 거절한다', () => {
  const result = validateRows('inventory', [
    { item_id: 'ITEM001', current_stock: 20, inventory_status: '정상', warehouse_code: 'MAIN', snapshot_at: '2026-09-01' },
    { item_id: 'ITEM001', current_stock: 5, inventory_status: '알수없음', warehouse_code: 'MAIN', snapshot_at: '2026-09-01' },
    { item_id: 'ITEM001', current_stock: 5, inventory_status: null, warehouse_code: null, snapshot_at: null },
  ], references);

  assert.equal(result.summary.successRows, 1);
  assert.ok(result.issues.some((issue) => issue.code === 'UNKNOWN_INVENTORY_STATUS' && issue.fieldName === 'inventory_status'));
  assert.ok(result.issues.some((issue) => issue.code === 'REQUIRED_VALUE' && issue.fieldName === 'warehouse_code'));
  assert.ok(result.issues.some((issue) => issue.code === 'REQUIRED_VALUE' && issue.fieldName === 'snapshot_at'));
});

test('입고는 완료 상태가 필수이며 등록된 두 값(COMPLETED/PENDING) 밖은 거절한다', () => {
  const result = validateRows('goods_receipt', [
    { item_id: 'ITEM001', receipt_date: '2026-09-01', qty: 10, receipt_status: 'COMPLETED' },
    { item_id: 'ITEM001', receipt_date: '2026-09-01', qty: 10, receipt_status: '완료' },
    { item_id: 'ITEM001', receipt_date: '2026-09-01', qty: 10, receipt_status: null },
  ], references);

  assert.equal(result.summary.successRows, 1);
  assert.ok(result.issues.some((issue) => issue.code === 'UNKNOWN_RECEIPT_STATUS' && issue.fieldName === 'receipt_status'));
  assert.ok(result.issues.some((issue) => issue.code === 'REQUIRED_VALUE' && issue.fieldName === 'receipt_status'));
});

test('오류와 경고 행만 원본 값과 함께 CSV로 내보낸다', async () => {
  const { errorRowsToCsv } = await import('./error-csv.ts');
  const csv = errorRowsToCsv([{ rowNumber: 2, data: { item_id: 'UNKNOWN', qty: null }, issues: [{ rowNumber: 2, fieldName: 'item_id', code: 'UNKNOWN_ITEM', message: '품목 마스터에 없습니다.', severity: 'ERROR', originalValue: 'UNKNOWN' }] }]);
  assert.match(csv, /row_number,error_code,error_message,severity,item_id,qty/);
  assert.match(csv, /UNKNOWN_ITEM/);
  assert.match(csv, /UNKNOWN/);
});
