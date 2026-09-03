// 데이터 종류별 스키마 — renew.prd 8.1 · 8.2
//
// 컬럼명을 코드에 고정하지 않습니다.
// 논리 필드마다 후보 이름을 여러 개 두고, 실제 테이블 컬럼(analytics.v_raw_schema)과 대조해
// 존재하는 것만 적재합니다. AGENTS.md 의 정규화 함수와 같은 방식입니다.

import type { DataType } from './types';

export type FieldKind = 'text' | 'number' | 'date';

export type FieldSpec = {
  /** 대상 테이블의 컬럼명 */
  target: string;
  kind: FieldKind;
  required: boolean;
  /** 자동 매핑에 쓸 원본 컬럼명 후보 (소문자·공백제거 후 비교) */
  aliases: string[];
  /** 음수를 허용하지 않는 수량 필드 */
  nonNegative?: boolean;
  /** 마스터 존재 여부를 검사할 대상 */
  references?: 'ITEM' | 'SUPPLIER';
};

export type TableSpec = {
  dataType: DataType;
  label: string;
  targetTable: string;
  /** 중복 판정과 upsert 에 쓰는 키 */
  keyFields: string[];
  /** replace 모드가 지울 기간의 기준 컬럼. 없으면 replace 를 막습니다 */
  periodField: string | null;
  fields: FieldSpec[];
};

const ITEM: FieldSpec = {
  target: 'item_id',
  kind: 'text',
  required: true,
  references: 'ITEM',
  aliases: ['item_id', 'itemid', 'item', 'sku', '품번', '품목코드', '제품코드', '자재코드'],
};

const SUPPLIER: FieldSpec = {
  target: 'supplier_id',
  kind: 'text',
  required: true,
  references: 'SUPPLIER',
  aliases: ['supplier_id', 'supplierid', 'supplier', 'vendor', '공급처', '공급처코드', '공급업체코드'],
};

export const TABLE_SPECS: Record<DataType, TableSpec> = {
  DEMAND: {
    dataType: 'DEMAND',
    label: '수요 · 사용 실적',
    targetTable: 'usage_history',
    keyFields: ['item_id', 'use_date'],
    periodField: 'use_date',
    fields: [
      ITEM,
      {
        target: 'use_date',
        kind: 'date',
        required: true,
        aliases: ['use_date', 'usedate', 'date', 'transaction_date', '출고일', '판매일', '사용일', '일자'],
      },
      {
        // nonNegative 를 쓰지 않습니다. 사용 실적의 음수는 반품이며 정상 데이터입니다.
        // 적재는 하되 학습에서만 뺍니다 — core.outlier_rule 의 RETURN 규칙과
        // core.v_train_demand 의 qty > 0 조건이 그 일을 합니다 (renew.prd 12.3).
        target: 'qty',
        kind: 'number',
        required: true,
        aliases: ['qty', 'quantity', 'amount', '수량', '출고수량', '판매량', '사용량'],
      },
      { target: 'note', kind: 'text', required: false, aliases: ['note', 'remark', '비고', '메모'] },
    ],
  },

  INVENTORY: {
    dataType: 'INVENTORY',
    label: '재고',
    targetTable: 'inventory',
    keyFields: ['item_id', 'warehouse', 'snapshot_date'],
    periodField: 'snapshot_date',
    fields: [
      ITEM,
      { target: 'warehouse', kind: 'text', required: false, aliases: ['warehouse', 'wh', '창고', '창고코드'] },
      {
        target: 'snapshot_date',
        kind: 'date',
        required: false,
        aliases: ['snapshot_date', 'date', '기준일', '재고일자'],
      },
      {
        target: 'on_hand_qty',
        kind: 'number',
        required: true,
        nonNegative: true,
        aliases: ['on_hand_qty', 'onhand', 'stock', 'qty', '현재고', '재고수량'],
      },
      {
        target: 'available_qty',
        kind: 'number',
        required: false,
        nonNegative: true,
        aliases: ['available_qty', 'available', '가용재고'],
      },
    ],
  },

  PURCHASE_ORDER: {
    dataType: 'PURCHASE_ORDER',
    label: '발주',
    targetTable: 'purchase_order',
    keyFields: ['po_no'],
    periodField: 'order_date',
    fields: [
      { target: 'po_no', kind: 'text', required: true, aliases: ['po_no', 'pono', 'po', '발주번호'] },
      ITEM,
      { ...SUPPLIER, required: false },
      { target: 'order_date', kind: 'date', required: true, aliases: ['order_date', '발주일', '발주일자'] },
      { target: 'due_date', kind: 'date', required: false, aliases: ['due_date', 'eta', '납기일', '예정일'] },
      {
        target: 'qty',
        kind: 'number',
        required: true,
        nonNegative: true,
        aliases: ['qty', 'quantity', '수량', '발주수량'],
      },
      { target: 'status', kind: 'text', required: false, aliases: ['status', '상태'] },
    ],
  },

  RECEIPT: {
    dataType: 'RECEIPT',
    label: '입고 · 선적',
    targetTable: 'goods_receipt',
    keyFields: ['po_no'],
    periodField: 'warehouse_receipt_date',
    fields: [
      { target: 'po_no', kind: 'text', required: true, aliases: ['po_no', 'pono', 'po', '발주번호'] },
      ITEM,
      {
        target: 'warehouse_receipt_date',
        kind: 'date',
        required: false,
        aliases: ['warehouse_receipt_date', 'receipt_date', '입고일', '창고입고일'],
      },
      {
        target: 'qc_release_date',
        kind: 'date',
        required: false,
        aliases: ['qc_release_date', 'qc_date', '검수완료일'],
      },
      {
        target: 'qty',
        kind: 'number',
        required: false,
        nonNegative: true,
        aliases: ['qty', 'quantity', '수량', '입고수량'],
      },
    ],
  },

  ITEM_MASTER: {
    dataType: 'ITEM_MASTER',
    label: '품목 마스터',
    targetTable: 'item_master',
    keyFields: ['item_id'],
    periodField: null,
    fields: [
      { ...ITEM, references: undefined },
      { target: 'item_name', kind: 'text', required: false, aliases: ['item_name', 'name', '품목명', '자재명'] },
      { ...SUPPLIER, required: false },
    ],
  },

  SUPPLIER_MASTER: {
    dataType: 'SUPPLIER_MASTER',
    label: '공급처 마스터',
    targetTable: 'supplier_master',
    keyFields: ['supplier_id'],
    periodField: null,
    fields: [
      { ...SUPPLIER, references: undefined },
      {
        target: 'supplier_name',
        kind: 'text',
        required: false,
        aliases: ['supplier_name', 'name', '공급처명', '법인명'],
      },
      { target: 'country', kind: 'text', required: false, aliases: ['country', '국가'] },
      {
        target: 'standard_lead_time',
        kind: 'number',
        required: false,
        nonNegative: true,
        aliases: ['standard_lead_time', 'lead_time', '표준리드타임'],
      },
    ],
  },

  EVENT: {
    dataType: 'EVENT',
    label: '비즈니스 이벤트',
    targetTable: 'business_event',
    keyFields: ['event_id'],
    periodField: 'period_start',
    fields: [
      { target: 'event_id', kind: 'text', required: true, aliases: ['event_id', 'id', '이벤트코드'] },
      { ...ITEM, required: false },
      { target: 'period_start', kind: 'date', required: false, aliases: ['period_start', 'start', '시작일'] },
      { target: 'period_end', kind: 'date', required: false, aliases: ['period_end', 'end', '종료일'] },
      { target: 'event_type', kind: 'text', required: false, aliases: ['event_type', 'type', '유형'] },
      {
        target: 'expected_impact',
        kind: 'number',
        required: false,
        aliases: ['expected_impact', 'impact', '예상영향'],
      },
      { target: 'note', kind: 'text', required: false, aliases: ['note', '비고'] },
    ],
  },

  SALES_ORDER: {
    dataType: 'SALES_ORDER',
    label: '확정 수주',
    targetTable: 'sales_order',
    keyFields: ['so_no'],
    periodField: 'due_date',
    fields: [
      { target: 'so_no', kind: 'text', required: true, aliases: ['so_no', 'sono', 'order_no', '수주번호'] },
      ITEM,
      { target: 'customer', kind: 'text', required: false, aliases: ['customer', '고객', '고객명'] },
      { target: 'order_date', kind: 'date', required: false, aliases: ['order_date', '수주일'] },
      { target: 'due_date', kind: 'date', required: false, aliases: ['due_date', '납기일'] },
      {
        target: 'qty',
        kind: 'number',
        required: true,
        nonNegative: true,
        aliases: ['qty', 'quantity', '수량'],
      },
      { target: 'status', kind: 'text', required: false, aliases: ['status', '상태'] },
    ],
  },
};

export const DATA_TYPES = Object.keys(TABLE_SPECS) as DataType[];

/** 비교용으로 컬럼명을 정규화합니다. 대소문자·공백·밑줄을 무시합니다 */
export function normalizeColumnName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_\-.]/g, '');
}

/**
 * 원본 컬럼 → 대상 컬럼 자동 매핑.
 * 사용자가 화면에서 고칠 수 있어야 하므로, 여기서는 제안만 만듭니다 (renew.prd 8.2).
 */
export function autoMap(spec: TableSpec, sourceColumns: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();

  for (const field of spec.fields) {
    const wanted = new Set(field.aliases.map(normalizeColumnName));
    const hit = sourceColumns.find(
      (column) => !used.has(column) && wanted.has(normalizeColumnName(column)),
    );
    if (hit) {
      mapping[hit] = field.target;
      used.add(hit);
    }
  }

  return mapping;
}
