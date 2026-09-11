import type { ImportType } from './types.ts';

export type FieldRule = { field: string; required?: boolean; kind?: 'number' | 'date' | 'month'; reference?: 'item' | 'supplier' | 'inventory_status'; quantity?: boolean; enumValues?: readonly string[] };
export type ImportSchema = { fields: FieldRule[]; aliases: Record<string, string[]> };

const common = { item_id: ['item_id', 'item code', '품목코드'], supplier_id: ['supplier_id', 'supplier code', '공급업체코드'], source_record_id: ['source_record_id', 'id', '번호'] };
export const IMPORT_SCHEMAS: Record<ImportType, ImportSchema> = {
  usage_history: { fields: [{ field: 'item_id', required: true, reference: 'item' }, { field: 'use_date', required: true, kind: 'date' }, { field: 'qty', required: true, kind: 'number', quantity: true }], aliases: { ...common, use_date: ['use_date', 'usage date', '출고일', '사용일'], qty: ['qty', 'quantity', '출고수량', '사용수량'] } },
  // Task 4 — 정상 창고재고 분류에 필요한 재고상태 · 창고 · 스냅샷 시각을 필수값으로 둔다.
  // 운영 값 누락은 ERROR로 막고, 등록되지 않은 임의 상태 텍스트는 UNKNOWN_INVENTORY_STATUS로 거절한다.
  inventory: { fields: [{ field: 'item_id', required: true, reference: 'item' }, { field: 'current_stock', required: true, kind: 'number', quantity: true }, { field: 'inventory_status', required: true, reference: 'inventory_status' }, { field: 'warehouse_code', required: true }, { field: 'snapshot_at', required: true, kind: 'date' }], aliases: { ...common, current_stock: ['current_stock', 'stock', '현재고'], reference_date: ['reference_date', '기준일자'], inventory_status: ['inventory_status', 'status', '재고상태'], warehouse_code: ['warehouse_code', 'warehouse', '창고', '창고코드'], snapshot_at: ['snapshot_at', 'snapshot_date', '스냅샷일자', '스냅샷시각'] } },
  item_master: { fields: [{ field: 'item_id', required: true }], aliases: { ...common, item_name: ['item_name', '품목명'], item_type: ['item_type', '품목구분'] } },
  supplier_master: { fields: [{ field: 'supplier_id', required: true }], aliases: { ...common, supplier_name: ['supplier_name', '공급업체명'] } },
  purchase_order: { fields: [{ field: 'item_id', required: true, reference: 'item' }, { field: 'supplier_id', reference: 'supplier' }, { field: 'order_date', required: true, kind: 'date' }, { field: 'qty', required: true, kind: 'number', quantity: true }], aliases: { ...common, order_date: ['order_date', '발주일'], qty: ['qty', 'quantity', '발주수량'] } },
  // Task 4 fix round 1 — 입고 완료 상태가 있어야 core.v_open_po_qty가 Open PO 참고 수량에서
  // 그 건을 뺀다. 값이 없거나 등록된 두 상태(COMPLETED/PENDING) 밖이면 ERROR로 막는다.
  goods_receipt: { fields: [{ field: 'item_id', required: true, reference: 'item' }, { field: 'receipt_date', required: true, kind: 'date' }, { field: 'qty', required: true, kind: 'number', quantity: true }, { field: 'receipt_status', required: true, enumValues: ['COMPLETED', 'PENDING'] }], aliases: { ...common, receipt_date: ['receipt_date', '입고일'], qty: ['qty', 'quantity', '입고수량'], receipt_status: ['receipt_status', 'status', '입고상태', '완료상태'] } },
  sales_order: { fields: [{ field: 'item_id', required: true, reference: 'item' }, { field: 'order_date', required: true, kind: 'date' }, { field: 'quantity', required: true, kind: 'number', quantity: true }], aliases: { ...common, order_date: ['order_date', '주문일'], quantity: ['quantity', 'qty', '주문수량'] } },
  business_event: { fields: [{ field: 'event_date', required: true, kind: 'date' }, { field: 'event_type', required: true }], aliases: { ...common, event_date: ['event_date', '발생일'], event_type: ['event_type', '이벤트유형'], quantity: ['quantity', 'qty', '수량'] } },
  // Task 7 — 부서 월간 수요 제출 한 줄. STEP 4와 같은 품목코드 정규화·검증(reference: 'item')을 그대로 쓴다.
  // 필요월은 날짜가 아니라 월 단위(YYYY-MM)라 전용 kind: 'month'로 검사한다.
  demand_line: { fields: [{ field: 'item_id', required: true, reference: 'item' }, { field: 'qty', required: true, kind: 'number', quantity: true }, { field: 'need_month', required: true, kind: 'month' }], aliases: { ...common, qty: ['qty', 'quantity', '수량'], need_month: ['need_month', 'month', '필요월'] } },
};

function key(value: string) { return value.trim().toLowerCase().replace(/[\s_\-]/g, ''); }
export function suggestColumnMapping(type: ImportType, columns: string[]) {
  const schema = IMPORT_SCHEMAS[type];
  return Object.fromEntries(Object.entries(schema.aliases).map(([field, aliases]) => [field, columns.find((column) => aliases.some((alias) => key(alias) === key(column))) ?? null]));
}
