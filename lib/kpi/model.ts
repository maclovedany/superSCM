// 월말 재고 성과 · 운영 기준월 모델 — Task 12 (stage1.md §10, 컨트롤러 판정)
//
// ★ 이 파일의 사유 코드 순서 함수(inventoryQtyReasonCode 등)는
//   supabase/migrations/20260911001150_stage1_inventory_kpi.sql의
//   analytics.v_inventory_performance CASE 식을 그대로 옮긴 거울이다. 화면은 이 함수로 다시
//   계산하지 않고 DB가 이미 계산해 둔 reason_code 열을 그대로 보여준다 — 여기 있는 목적은
//   그 우선순위를 단위 테스트로 고정해 두 곳(SQL · 화면 표시 문구)의 규칙이 갈라지지 않게
//   하는 것뿐이다(lib/procurement/model.ts와 같은 방식).
// ★ 계산 불가를 0으로 채우지 않는다 — null과 사유 코드를 그대로 유지한다(AGENTS.md 5번).

export const INVENTORY_KPI_REASON_CODES = [
  'INVENTORY_SCOPE_UNCLASSIFIED',
  'MONTH_END_SNAPSHOT_MISSING',
  'UNIT_PRICE_UNSET',
  'TARGET_STOCK_UNSET',
  'PLANNING_CYCLE_NOT_OPEN',
] as const;
export type InventoryKpiReasonCode = (typeof INVENTORY_KPI_REASON_CODES)[number];

export const INVENTORY_KPI_REASON_LABELS: Record<InventoryKpiReasonCode, string> = {
  INVENTORY_SCOPE_UNCLASSIFIED: '재고 분류가 확정되지 않았습니다',
  MONTH_END_SNAPSHOT_MISSING: '이 달의 월말 재고 스냅샷이 없습니다',
  UNIT_PRICE_UNSET: '승인된 단가가 없습니다',
  TARGET_STOCK_UNSET: '승인된 목표재고가 없습니다',
  PLANNING_CYCLE_NOT_OPEN: '진행 중인 취합 주기가 없습니다',
};

export function inventoryKpiReasonLabel(code: string | null): string | null {
  if (code === null) return null;
  return (INVENTORY_KPI_REASON_LABELS as Record<string, string>)[code] ?? code;
}

// ══ 기준월 표시 ═══════════════════════════════════════════════════

const PLAN_MONTH_PATTERN = /^(\d{4})-(\d{2})-\d{2}$/;

/** "2026-09-01" → "2026.09" — 상단바 · 대시보드 카드가 쓰는 짧은 형식 */
export function formatBaseMonthDotted(planMonth: string | null): string | null {
  if (planMonth === null) return null;
  const match = PLAN_MONTH_PATTERN.exec(planMonth);
  if (!match) return planMonth;
  return `${match[1]}.${match[2]}`;
}

/** "2026-09-01" → "2026년 09월" — 사이드바 하단이 쓰는 한국어 형식 */
export function formatBaseMonthKorean(planMonth: string | null): string | null {
  if (planMonth === null) return null;
  const match = PLAN_MONTH_PATTERN.exec(planMonth);
  if (!match) return planMonth;
  return `${match[1]}년 ${match[2]}월`;
}

// ══ 사유 코드 순서(마이그레이션 CASE 식의 거울) ═══════════════════

/** 실제 수량 사유 — 품목이 분류된 적 없으면 분류 불가가, 그다음은 이 달 스냅샷 없음이 이긴다 */
export function inventoryQtyReasonCode(input: { hasStockBalance: boolean; actualQty: number | null }): InventoryKpiReasonCode | null {
  if (!input.hasStockBalance) return 'INVENTORY_SCOPE_UNCLASSIFIED';
  if (input.actualQty === null) return 'MONTH_END_SNAPSHOT_MISSING';
  return null;
}

/** 금액 사유 — 수량 사유가 없을 때만 승인 단가 미설정을 본다 */
export function inventoryValueReasonCode(input: {
  hasStockBalance: boolean;
  actualQty: number | null;
  unitPrice: number | null;
}): InventoryKpiReasonCode | null {
  const qtyReason = inventoryQtyReasonCode(input);
  if (qtyReason !== null) return qtyReason;
  if (input.unitPrice === null) return 'UNIT_PRICE_UNSET';
  return null;
}

/** 차이(diff) 사유 — 수량 사유가 없을 때만 승인 목표재고 미설정을 본다 */
export function inventoryDiffReasonCode(input: {
  hasStockBalance: boolean;
  actualQty: number | null;
  targetStockQty: number | null;
}): InventoryKpiReasonCode | null {
  const qtyReason = inventoryQtyReasonCode(input);
  if (qtyReason !== null) return qtyReason;
  if (input.targetStockQty === null) return 'TARGET_STOCK_UNSET';
  return null;
}

/** 차이 = 실제 − 목표(컨트롤러 판정 2). 둘 중 하나라도 없으면 null */
export function diffQty(actualQty: number | null, targetStockQty: number | null): number | null {
  if (actualQty === null || targetStockQty === null) return null;
  return actualQty - targetStockQty;
}

// ══ 조회 행 정규화 ════════════════════════════════════════════════

function value(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (row[key] !== undefined) return row[key];
  return undefined;
}

function text(input: unknown): string | null {
  return input === null || input === undefined || input === '' ? null : String(input);
}

function numberOrNull(input: unknown): number | null {
  if (input === null || input === undefined || input === '') return null;
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : null;
}

export type CurrentPlanningCycle = {
  cycleId: string | null;
  planMonth: string | null;
  status: string | null;
  submissionDeadline: string | null;
  isActive: boolean;
  openedAt: string | null;
  reasonCode: string | null;
};

/** analytics.v_current_planning_cycle 한 행(항상 1행) */
export function normalizeCurrentPlanningCycle(row: Record<string, unknown>): CurrentPlanningCycle {
  return {
    cycleId: text(value(row, ['cycle_id'])),
    planMonth: text(value(row, ['plan_month'])),
    status: text(value(row, ['status'])),
    submissionDeadline: text(value(row, ['submission_deadline'])),
    isActive: value(row, ['is_active']) === true,
    openedAt: text(value(row, ['opened_at'])),
    reasonCode: text(value(row, ['reason_code'])),
  };
}

export type InventoryPerformanceRow = {
  planMonth: string;
  itemId: string;
  itemName: string | null;
  actualQty: number | null;
  snapshotAt: string | null;
  qtyReasonCode: string | null;
  unitPrice: number | null;
  actualValue: number | null;
  valueReasonCode: string | null;
  targetStockQty: number | null;
  targetStockReasonCode: string | null;
  diffQty: number | null;
  diffReasonCode: string | null;
};

/** analytics.v_inventory_performance 한 행 — 값은 그대로 옮기기만 한다(다시 계산하지 않는다) */
export function normalizeInventoryPerformanceRow(row: Record<string, unknown>): InventoryPerformanceRow {
  return {
    planMonth: String(value(row, ['plan_month']) ?? ''),
    itemId: String(value(row, ['item_id']) ?? ''),
    itemName: text(value(row, ['item_name'])),
    actualQty: numberOrNull(value(row, ['actual_qty'])),
    snapshotAt: text(value(row, ['snapshot_at'])),
    qtyReasonCode: text(value(row, ['qty_reason_code'])),
    unitPrice: numberOrNull(value(row, ['unit_price'])),
    actualValue: numberOrNull(value(row, ['actual_value'])),
    valueReasonCode: text(value(row, ['value_reason_code'])),
    targetStockQty: numberOrNull(value(row, ['target_stock_qty'])),
    targetStockReasonCode: text(value(row, ['target_stock_reason_code'])),
    diffQty: numberOrNull(value(row, ['diff_qty'])),
    diffReasonCode: text(value(row, ['diff_reason_code'])),
  };
}

export type InventoryPerformanceKpi = {
  planMonth: string;
  nItems: number;
  nQtyAvailable: number;
  nMonthEndSnapshotMissing: number;
  nInventoryScopeUnclassified: number;
  totalActualQty: number | null;
  nValueAvailable: number;
  nUnitPriceUnset: number;
  totalActualValue: number | null;
  nTargetAvailable: number;
  nTargetStockUnset: number;
  totalTargetStockQty: number | null;
  totalDiffQty: number | null;
  nDiffAvailable: number;
};

/** analytics.v_inventory_performance_kpi 한 행 — 제외 건수 · 사유는 그대로 옮긴다(0으로 메우지 않는다) */
export function normalizeInventoryPerformanceKpiRow(row: Record<string, unknown>): InventoryPerformanceKpi {
  return {
    planMonth: String(value(row, ['plan_month']) ?? ''),
    nItems: numberOrNull(value(row, ['n_items'])) ?? 0,
    nQtyAvailable: numberOrNull(value(row, ['n_qty_available'])) ?? 0,
    nMonthEndSnapshotMissing: numberOrNull(value(row, ['n_month_end_snapshot_missing'])) ?? 0,
    nInventoryScopeUnclassified: numberOrNull(value(row, ['n_inventory_scope_unclassified'])) ?? 0,
    totalActualQty: numberOrNull(value(row, ['total_actual_qty'])),
    nValueAvailable: numberOrNull(value(row, ['n_value_available'])) ?? 0,
    nUnitPriceUnset: numberOrNull(value(row, ['n_unit_price_unset'])) ?? 0,
    totalActualValue: numberOrNull(value(row, ['total_actual_value'])),
    nTargetAvailable: numberOrNull(value(row, ['n_target_available'])) ?? 0,
    nTargetStockUnset: numberOrNull(value(row, ['n_target_stock_unset'])) ?? 0,
    totalTargetStockQty: numberOrNull(value(row, ['total_target_stock_qty'])),
    totalDiffQty: numberOrNull(value(row, ['total_diff_qty'])),
    nDiffAvailable: numberOrNull(value(row, ['n_diff_available'])) ?? 0,
  };
}
