import type { ImportType } from './types.ts';

export type FieldRule = { field: string; required?: boolean; kind?: 'number' | 'date'; reference?: 'item' | 'supplier'; quantity?: boolean };
export type ImportSchema = { fields: FieldRule[]; aliases: Record<string, string[]> };

const common = { item_id: ['item_id', 'item code', '품목코드'], supplier_id: ['supplier_id', 'supplier code', '공급업체코드'], source_record_id: ['source_record_id', 'id', '번호'] };
export const IMPORT_SCHEMAS: Record<ImportType, ImportSchema> = {
  usage_history: { fields: [{ field: 'item_id', required: true, reference: 'item' }, { field: 'use_date', required: true, kind: 'date' }, { field: 'qty', required: true, kind: 'number', quantity: true }], aliases: { ...common, use_date: ['use_date', 'usage date', '출고일', '사용일'], qty: ['qty', 'quantity', '출고수량', '사용수량'] } },
  inventory: { fields: [{ field: 'item_id', required: true, reference: 'item' }, { field: 'current_stock', required: true, kind: 'number', quantity: true }], aliases: { ...common, current_stock: ['current_stock', 'stock', '현재고'], reference_date: ['reference_date', '기준일자'] } },
  item_master: { fields: [{ field: 'item_id', required: true }], aliases: { ...common, item_name: ['item_name', '품목명'], item_type: ['item_type', '품목구분'] } },
  supplier_master: { fields: [{ field: 'supplier_id', required: true }], aliases: { ...common, supplier_name: ['supplier_name', '공급업체명'] } },
  purchase_order: { fields: [{ field: 'item_id', required: true, reference: 'item' }, { field: 'supplier_id', reference: 'supplier' }, { field: 'order_date', required: true, kind: 'date' }, { field: 'qty', required: true, kind: 'number', quantity: true }], aliases: { ...common, order_date: ['order_date', '발주일'], qty: ['qty', 'quantity', '발주수량'] } },
  goods_receipt: { fields: [{ field: 'item_id', required: true, reference: 'item' }, { field: 'receipt_date', required: true, kind: 'date' }, { field: 'qty', required: true, kind: 'number', quantity: true }], aliases: { ...common, receipt_date: ['receipt_date', '입고일'], qty: ['qty', 'quantity', '입고수량'] } },
  sales_order: { fields: [{ field: 'item_id', required: true, reference: 'item' }, { field: 'order_date', required: true, kind: 'date' }, { field: 'quantity', required: true, kind: 'number', quantity: true }], aliases: { ...common, order_date: ['order_date', '주문일'], quantity: ['quantity', 'qty', '주문수량'] } },
  business_event: { fields: [{ field: 'event_date', required: true, kind: 'date' }, { field: 'event_type', required: true }], aliases: { ...common, event_date: ['event_date', '발생일'], event_type: ['event_type', '이벤트유형'], quantity: ['quantity', 'qty', '수량'] } },
};

function key(value: string) { return value.trim().toLowerCase().replace(/[\s_\-]/g, ''); }
export function suggestColumnMapping(type: ImportType, columns: string[]) {
  const schema = IMPORT_SCHEMAS[type];
  return Object.fromEntries(Object.entries(schema.aliases).map(([field, aliases]) => [field, columns.find((column) => aliases.some((alias) => key(alias) === key(column))) ?? null]));
}
