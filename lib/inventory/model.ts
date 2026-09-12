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
  /** 참고 열. available_qty 에 더하지 않습니다. 출처(batch_id) 미확인이거나 원본 텍스트를
   *  숫자로 바꿀 수 없는 행이 하나라도 있으면 null입니다(2026-09-12 보정 — 사유는 열이 아니라
   *  analytics.v_stock_reference_source_status + StockReferenceStatusBanner가 화면
   *  수준에서 한 번 안내합니다) */
  openPoQty: number | null;
  /** 참고 열. available_qty 에 더하지 않습니다. raw.shipment_log.batch_id를 채우는 적재
   *  경로가 아직 없어 지금은 항상 null입니다(같은 배너가 안내합니다) */
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
    inTransitQty: numberValue(row, ['in_transit_qty', '이동중수량']),
    reasonCode: text(row, ['reason_code', '사유코드']),
  };
}

/**
 * analytics.v_stock_reference_source_status 한 행 — Open PO · 이동 중(참고) 두 열의 계산이
 * 지금 출처 미확인 또는 파싱 불가 데이터에 걸려 있는지 화면 수준에서 한 번 안내하기 위한 상태
 * (품목별이 아니라 화면 전체 요약 한 줄).
 *
 * ★ 2026-09-12 보정 — 사유를 analytics.v_available_stock에 열로 더하지 않습니다(그 뷰를
 *   넓히면 "전체를 파일명 순서로 다시 적용"하는 표준 복구 절차가 cannot drop columns from
 *   view로 멈춥니다 — docs/stage1-판정기록.md Task 16 판정). 대신 별도 뷰 + 배너 컴포넌트로,
 *   이 저장소가 이미 practice-banner에 쓰는 것과 같은 패턴으로 한 번만 안내합니다.
 * ★ openPoReasonCode: 'OPEN_PO_SOURCE_UNVERIFIED'(출처 없는 행이 기여 — 파싱 사유보다 우선)
 *   | 'OPEN_PO_QTY_UNPARSEABLE'(출처는 있으나 파싱 불가) | null(정상).
 * ★ 2026-09-12 리뷰 라운드 3 보정 — inTransitReasonCode를 구조 조건과 데이터 조건으로
 *   나눕니다. 이 프로젝트의 주제가 "말할 수 없는 것을 말하지 않기"인데, 라벨이 자기가 알 수
 *   없는 것을 주장하면 그 주제를 정면으로 어깁니다:
 *   - inTransitHasImportPath: core.import_target_table이 'shipment' 종류의 적재 경로를
 *     아는지(구조 조건, 데이터와 무관하게 항상 같은 값).
 *   - 'IN_TRANSIT_NO_IMPORT_PATH' — 적재 경로 자체가 없음(!inTransitHasImportPath).
 *   - 'IN_TRANSIT_SOURCE_UNVERIFIED' — 적재 경로는 있으나 raw.shipment_log.batch_id가 없는
 *     (출처 미확인) 행이 기여함(inTransitHasImportPath && unsourced_rows > 0).
 *   - null(정상).
 */
export type StockReferenceSourceStatus = {
  openPoSourcedRows: number;
  openPoUnsourcedRows: number;
  openPoUnparseableItems: number;
  openPoReasonCode: string | null;
  inTransitSourcedRows: number;
  inTransitUnsourcedRows: number;
  inTransitHasImportPath: boolean;
  inTransitReasonCode: string | null;
};

export function normalizeStockReferenceSourceStatus(row: Record<string, unknown> | null): StockReferenceSourceStatus | null {
  if (!row) return null;
  return {
    openPoSourcedRows: numberValue(row, ['open_po_sourced_rows']) ?? 0,
    openPoUnsourcedRows: numberValue(row, ['open_po_unsourced_rows']) ?? 0,
    openPoUnparseableItems: numberValue(row, ['open_po_unparseable_items']) ?? 0,
    openPoReasonCode: text(row, ['open_po_reason_code']),
    inTransitSourcedRows: numberValue(row, ['in_transit_sourced_rows']) ?? 0,
    inTransitUnsourcedRows: numberValue(row, ['in_transit_unsourced_rows']) ?? 0,
    inTransitHasImportPath: value(row, ['in_transit_has_import_path']) === true,
    inTransitReasonCode: text(row, ['in_transit_reason_code']),
  };
}

export const STOCK_REFERENCE_STATUS_BANNER_TITLE = '참고 열(Open PO·이동 중) 안내';

function openPoMessage(reasonCode: string): string {
  return reasonCode === 'OPEN_PO_QTY_UNPARSEABLE'
    ? '일부 발주·입고 데이터를 숫자로 읽을 수 없어 Open PO 참고 열이 비어 있습니다. 원본 데이터를 확인해 주세요.'
    : '출처가 확인되지 않은(정식 업로드 경로를 거치지 않은) 발주·입고 데이터가 있어 Open PO 참고 열이 비어 있습니다 — 지어낸 숫자를 보여주지 않기 위해서입니다. 정식 업로드로 발주 데이터가 들어오면 채워집니다.';
}

// ★ 리뷰 라운드 3 — 구조 조건(적재 경로 자체가 없음)과 데이터 조건(경로는 있지만 아직 출처
//   있는 데이터가 없음)을 반드시 다른 문구로 말한다. 하나로 합치면, 경로가 생긴 뒤에도
//   "경로가 없다"는 이제 거짓인 문장을 계속 보여주게 된다.
function inTransitMessage(reasonCode: string): string {
  return reasonCode === 'IN_TRANSIT_NO_IMPORT_PATH'
    ? '이동 중(참고) 열은 아직 시스템에 선적 데이터를 IMPORT하는 방법이 없어 표시할 수 없습니다.'
    : '출처가 확인되지 않은(정식 업로드 경로를 거치지 않은) 선적 데이터가 있어 이동 중(참고) 열이 비어 있습니다 — 지어낸 숫자를 보여주지 않기 위해서입니다. 정식 업로드로 선적 데이터가 들어오면 채워집니다.';
}

export function stockReferenceStatusBannerMessage(status: StockReferenceSourceStatus): string {
  const { openPoReasonCode, inTransitReasonCode } = status;
  if (openPoReasonCode !== null && inTransitReasonCode !== null) {
    return `${openPoMessage(openPoReasonCode)} ${inTransitMessage(inTransitReasonCode)}`;
  }
  if (openPoReasonCode !== null) return openPoMessage(openPoReasonCode);
  if (inTransitReasonCode !== null) return inTransitMessage(inTransitReasonCode);
  return '';
}
