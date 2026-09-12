// 정상 창고재고 · 가용재고 — Task 4
//
// ★ 여기서 계산하지 않습니다. 정상 창고재고 분류와 가용재고 뺄셈은 모두
//   analytics.v_available_stock 이 SQL로 이미 계산해 둔 값입니다. 이 파일은 그 행을
//   화면 타입으로 옮기기만 합니다.
// ★ 분류할 수 없는 값은 0으로 채우지 않습니다. null 과 reason_code 를 그대로 유지합니다
//   (AGENTS.md 5번 규칙).

export const INVENTORY_VISIBILITY_SCOPES = ['PAPER_CARD_READER', 'CONSUMABLE', 'GENERAL'] as const;
export type InventoryVisibilityScope = (typeof INVENTORY_VISIBILITY_SCOPES)[number];

export type AvailableStockRow = {
  itemId: string;
  itemName: string;
  /** 원본 품목구분 텍스트. 표시용이며 조회 범위 판정에는 visibilityScope 를 씁니다 */
  itemType: string | null;
  visibilityScope: InventoryVisibilityScope;
  /** 정상 창고재고. 분류 불가 시 null (reasonCode 동반) */
  normalWarehouseQty: number | null;
  snapshotAt: string | null;
  /** 배정 이력이 없으면 0이 맞는 값입니다 — 아직 배정된 적이 없다는 확정된 사실이기 때문입니다 */
  temporaryAllocatedQty: number;
  firmAllocatedQty: number;
  approvalHoldQty: number;
  /** normalWarehouseQty - temporaryAllocatedQty - firmAllocatedQty - approvalHoldQty */
  availableQty: number | null;
  /** 참고 열. available_qty 에 더하지 않습니다 */
  openPoQty: number | null;
  /** openPoQty가 null인 이유. 정상 창고재고 분류 사유(reasonCode)와는 별개입니다 —
   *  예: 발주수량·입고수량 원본 텍스트가 숫자로 파싱되지 않는 행이 있으면
   *  'OPEN_PO_QTY_UNPARSEABLE' (2026-09-12 보정) */
  openPoReasonCode: string | null;
  /** 참고 열. available_qty 에 더하지 않습니다 */
  inTransitQty: number | null;
  reasonCode: string | null;
};

function value(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null) return row[key];
  return undefined;
}

function text(row: Record<string, unknown>, keys: string[]): string | null {
  const raw = value(row, keys);
  return raw === undefined || raw === null || raw === '' ? null : String(raw);
}

function numberValue(row: Record<string, unknown>, keys: string[]): number | null {
  const raw = value(row, keys);
  if (raw === undefined || raw === null || raw === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isInventoryVisibilityScope(input: unknown): input is InventoryVisibilityScope {
  return typeof input === 'string' && (INVENTORY_VISIBILITY_SCOPES as readonly string[]).includes(input);
}

/**
 * 영업(ATP_VIEW) 전용 — analytics.v_order_available_stock 한 행.
 *
 * ★ 재고 상세(배정 내역 · Open PO · 이동 중 · 스냅샷 시각)는 담지 않습니다. 영업은
 *   실제 주문 가능 수량만 봐야 합니다 (stage1 §2, fix round 1).
 */
export type OrderAvailableStockRow = {
  itemId: string;
  itemName: string;
  availableQty: number | null;
  reasonCode: string | null;
};

export function normalizeOrderAvailableStockRow(row: Record<string, unknown>): OrderAvailableStockRow {
  return {
    itemId: String(value(row, ['item_id', '품목코드']) ?? '미정'),
    itemName: String(value(row, ['item_name', '품목명']) ?? '미정'),
    availableQty: numberValue(row, ['available_qty', '가용재고']),
    reasonCode: text(row, ['reason_code', '사유코드']),
  };
}

export function normalizeAvailableStockRow(row: Record<string, unknown>): AvailableStockRow {
  const rawScope = value(row, ['visibility_scope', '조회범위']);

  return {
    itemId: String(value(row, ['item_id', '품목코드']) ?? '미정'),
    itemName: String(value(row, ['item_name', '품목명']) ?? '미정'),
    itemType: text(row, ['item_type', '품목구분']),
    visibilityScope: isInventoryVisibilityScope(rawScope) ? rawScope : 'GENERAL',
    normalWarehouseQty: numberValue(row, ['normal_warehouse_qty', '정상창고재고']),
    snapshotAt: text(row, ['snapshot_at', '스냅샷시각']),
    temporaryAllocatedQty: numberValue(row, ['temporary_allocated_qty', '임시배정수량']) ?? 0,
    firmAllocatedQty: numberValue(row, ['firm_allocated_qty', '확정배정수량']) ?? 0,
    approvalHoldQty: numberValue(row, ['approval_hold_qty', '승인대기확보수량']) ?? 0,
    availableQty: numberValue(row, ['available_qty', '가용재고']),
    openPoQty: numberValue(row, ['open_po_qty', 'openpo수량']),
    openPoReasonCode: text(row, ['open_po_reason_code']),
    inTransitQty: numberValue(row, ['in_transit_qty', '이동중수량']),
    reasonCode: text(row, ['reason_code', '사유코드']),
  };
}
