// 대시보드의 타입과 정규화 — renew.prd 28장
//
// 계산은 SQL 이 끝냈습니다 (sql/21-dashboard.sql). 여기서는 뷰 한 줄을 화면이 쓰는
// 모양으로 바꾸기만 합니다 (AGENTS.md 규칙 2). 합계도 평균도 내지 않습니다.
//
// 조회 함수는 lib/dashboard.ts 에 있습니다. 파일을 나눈 이유는 lib/alerts-model.ts 와 같습니다.
//   ① 순수 함수만 모아 두면 Supabase 클라이언트 없이 테스트할 수 있습니다
//   ② 클라이언트 컴포넌트가 타입을 import 해도 서버 전용 모듈이 번들로 끌려오지 않습니다
//
// 상대 import 에는 .ts 를 붙입니다. npm test 는 node --test 로 이 파일을 그대로
// 실행하므로 확장자를 보완해 주지 않습니다 (error.md #17).

import { toReasonCode, toRiskStatus, type ReasonCode, type RiskStatus } from './status.ts';

export function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * 개수 전용. 뷰가 count 로 만든 값이라 없을 수 없지만, 조회가 실패해 빈 객체가 오면
 * 0 이 아니라 null 이어야 합니다 — "0건" 과 "못 읽었다" 는 다릅니다 (renew.prd 31.5).
 */
export function count(value: unknown): number | null {
  const parsed = num(value);
  if (parsed === null) return null;
  return Math.trunc(parsed);
}

/** 3상태. null 을 false 로 접지 않습니다 */
export function bool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

/** analytics.v_dashboard_kpi 한 줄 — renew.prd 28.1 의 12종 + 보조 값 */
export type DashboardKpi = {
  /** 비율입니다. 0.87 이 87% — 화면에서 100 을 한 번만 곱합니다 */
  forecastAccuracy: number | null;
  avgWape: number | null;
  /** Champion 이 몇 개인지. 0 이면 아직 백테스트 전이라 정확도가 null 입니다 */
  nChampions: number | null;
  /** 부호 있는 평균 Bias. + 는 과대예측 · − 는 과소예측입니다 (sql/13 §5) */
  forecastBias: number | null;
  nBiasItems: number | null;

  nRiskItems: number | null;
  nCriticalItems: number | null;
  nWarningItems: number | null;
  nStockout30d: number | null;
  nStockout60d: number | null;
  nItems: number | null;
  nExcessInventory: number | null;
  nDelayedOpenPo: number | null;

  nRecommendations: number | null;
  nUrgentOrders: number | null;
  totalRecommendedQty: number | null;
  totalRecommendedAmount: number | null;
  /** 단가가 없어 금액 합계에서 빠진 품목 수 */
  nMissingPrice: number | null;
  nPendingApproval: number | null;

  nOpenAlerts: number | null;
  nUnacknowledgedAlerts: number | null;
  lastScanAt: string | null;
  forecastRunId: string | null;
  lastForecastRunAt: string | null;
  forecastIsStale: boolean | null;
  dataEnd: string | null;
};

/** analytics.v_dashboard_purchase_priority 한 줄 */
export type PurchasePriorityRow = {
  itemId: string;
  itemName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  risk: RiskStatus;
  reasonCode: ReasonCode | null;
  requiredOrderDate: string | null;
  isUrgent: boolean | null;
  stockoutDate: string | null;
  finalRecommendedQty: number | null;
  unitPrice: number | null;
  recommendedAmount: number | null;
};

/** analytics.v_dashboard_accuracy_ranking 한 줄 */
export type AccuracyRankingRow = {
  itemId: string;
  itemName: string | null;
  championModelId: string | null;
  modelName: string | null;
  /** 비율입니다 (0.12 = 12%) */
  wape: number | null;
  bias: number | null;
  selectionMethod: string | null;
  rankBest: number | null;
  rankWorst: number | null;
  nRanked: number | null;
  /** 막대 폭 0–100. SQL 이 가장 나쁜 품목을 100 으로 두고 나눈 값입니다 */
  barPct: number | null;
};

/** analytics.v_dashboard_open_po_risk 한 줄 */
export type OpenPoRiskRow = {
  itemId: string;
  itemName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  nShipments: number | null;
  earliestDueDate: string | null;
  /** 양수면 지난 일수, 음수면 남은 일수 */
  daysLate: number | null;
  openQty: number | null;
  isLate: boolean | null;
};

/** analytics.v_dashboard_recent_approvals 한 줄 */
export type RecentApprovalRow = {
  approvalId: number;
  itemId: string;
  itemName: string | null;
  decision: string | null;
  reasonCode: string | null;
  reasonText: string | null;
  recommendedQty: number | null;
  approvedQty: number | null;
  adjustment: number | null;
  approvedEmail: string | null;
  approvedAt: string | null;
  status: string | null;
  isActive: boolean | null;
};

export type SparklineKind = 'ACTUAL' | 'FORECAST';

/** analytics.v_dashboard_sparkline 한 줄 */
export type SparklinePoint = {
  itemId: string;
  period: string;
  kind: SparklineKind;
  qty: number | null;
};

export function toSparklineKind(value: unknown): SparklineKind {
  return value === 'FORECAST' ? 'FORECAST' : 'ACTUAL';
}

export function normalizeDashboardKpi(row: Record<string, unknown>): DashboardKpi {
  return {
    forecastAccuracy: num(row.forecast_accuracy),
    avgWape: num(row.avg_wape),
    nChampions: count(row.n_champions),
    forecastBias: num(row.forecast_bias),
    nBiasItems: count(row.n_bias_items),

    nRiskItems: count(row.n_risk_items),
    nCriticalItems: count(row.n_critical_items),
    nWarningItems: count(row.n_warning_items),
    nStockout30d: count(row.n_stockout_30d),
    nStockout60d: count(row.n_stockout_60d),
    nItems: count(row.n_items),
    nExcessInventory: count(row.n_excess_inventory),
    nDelayedOpenPo: count(row.n_delayed_open_po),

    nRecommendations: count(row.n_recommendations),
    nUrgentOrders: count(row.n_urgent_orders),
    totalRecommendedQty: num(row.total_recommended_qty),
    totalRecommendedAmount: num(row.total_recommended_amount),
    nMissingPrice: count(row.n_missing_price),
    nPendingApproval: count(row.n_pending_approval),

    nOpenAlerts: count(row.n_open_alerts),
    nUnacknowledgedAlerts: count(row.n_unacknowledged_alerts),
    lastScanAt: text(row.last_scan_at),
    forecastRunId: text(row.forecast_run_id),
    lastForecastRunAt: text(row.last_forecast_run_at),
    forecastIsStale: bool(row.forecast_is_stale),
    dataEnd: text(row.data_end),
  };
}

export function normalizePurchasePriority(row: Record<string, unknown>): PurchasePriorityRow {
  return {
    itemId: String(row.item_id ?? ''),
    itemName: text(row.item_name),
    supplierId: text(row.supplier_id),
    supplierName: text(row.supplier_name),
    risk: toRiskStatus(row.risk),
    reasonCode: toReasonCode(row.reason_code),
    requiredOrderDate: text(row.required_order_date),
    isUrgent: bool(row.is_urgent),
    stockoutDate: text(row.stockout_date),
    finalRecommendedQty: num(row.final_recommended_qty),
    unitPrice: num(row.unit_price),
    recommendedAmount: num(row.recommended_amount),
  };
}

export function normalizeAccuracyRanking(row: Record<string, unknown>): AccuracyRankingRow {
  return {
    itemId: String(row.item_id ?? ''),
    itemName: text(row.item_name),
    championModelId: text(row.champion_model_id),
    modelName: text(row.model_name),
    wape: num(row.wape),
    bias: num(row.bias),
    selectionMethod: text(row.selection_method),
    rankBest: count(row.rank_best),
    rankWorst: count(row.rank_worst),
    nRanked: count(row.n_ranked),
    barPct: num(row.bar_pct),
  };
}

export function normalizeOpenPoRisk(row: Record<string, unknown>): OpenPoRiskRow {
  return {
    itemId: String(row.item_id ?? ''),
    itemName: text(row.item_name),
    supplierId: text(row.supplier_id),
    supplierName: text(row.supplier_name),
    nShipments: count(row.n_shipments),
    earliestDueDate: text(row.earliest_due_date),
    daysLate: num(row.days_late),
    openQty: num(row.open_qty),
    isLate: bool(row.is_late),
  };
}

export function normalizeRecentApproval(row: Record<string, unknown>): RecentApprovalRow {
  return {
    approvalId: num(row.approval_id) ?? 0,
    itemId: String(row.item_id ?? ''),
    itemName: text(row.item_name),
    decision: text(row.decision),
    reasonCode: text(row.reason_code),
    reasonText: text(row.reason_text),
    recommendedQty: num(row.recommended_qty),
    approvedQty: num(row.approved_qty),
    adjustment: num(row.adjustment),
    approvedEmail: text(row.approved_email),
    approvedAt: text(row.approved_at),
    status: text(row.status),
    isActive: bool(row.is_active),
  };
}

export function normalizeSparklinePoint(row: Record<string, unknown>): SparklinePoint {
  return {
    itemId: String(row.item_id ?? ''),
    period: String(row.period ?? ''),
    kind: toSparklineKind(row.kind),
    qty: num(row.qty),
  };
}

/**
 * `YYYY-MM-DD` → `YYYY-MM`.
 *
 * 스파크라인의 x축 라벨입니다. 자르기만 하고 시간대 변환을 하지 않습니다 —
 * `new Date('2025-01-01')` 은 UTC 자정으로 읽혀 한국 시간대에서 한 달 앞으로 밀립니다.
 */
export function monthLabel(period: string): string {
  return period.length >= 7 ? period.slice(0, 7) : period;
}

/**
 * 비율을 백분율 문구로. 계산이 아니라 표시 형식입니다 (0.873 → '87.3%').
 *
 * 값이 없으면 '0%' 를 지어내지 않고 null 을 돌려줍니다. 화면이 EmptyValue 를 그립니다
 * (design.md §8.2).
 */
export function percentText(ratio: number | null, digits = 1): string | null {
  if (ratio === null) return null;
  return `${(ratio * 100).toFixed(digits)}%`;
}

/**
 * 부호를 살린 백분율 — Bias 전용. + 는 과대예측 · − 는 과소예측입니다.
 *
 * bias = Σ(예측−실적) / Σ실적 이므로(sql/13 §5) 예측이 실적보다 크면 양수입니다.
 * 모델 평가 · 모델 비교 · SKU Detail 화면이 모두 같은 문구를 씁니다.
 *
 * `toFixed` 는 음수에 이미 `-` 를 붙이므로 양수에만 `+` 를 답니다.
 * 부호를 지우면 "치우쳐 있다" 는 사실만 남고 어느 쪽인지가 사라집니다.
 */
export function signedPercentText(ratio: number | null, digits = 1): string | null {
  if (ratio === null) return null;
  const pct = ratio * 100;
  const body = pct.toFixed(digits);
  return pct > 0 ? `+${body}` : body;
}

/**
 * 대시보드 우측 레일의 정적 인사이트 — renew.prd 31.4.
 *
 * ★ LLM 을 부르지 않습니다. STEP 16 의 AI Agent 가 없어도, 있어도 응답하지 못해도
 *   이 문장은 나옵니다. 뷰가 낸 숫자를 문장 골격에 끼우기만 합니다.
 *
 * ★ 여기서 숫자를 만들지 않습니다. 인자로 받은 값만 씁니다. 값이 없는 문장은
 *   지어내지 않고 통째로 빼므로, 재료가 하나도 없으면 빈 배열입니다.
 */
export function railSentences(input: {
  urgentItemName: string | null;
  urgentOrderDate: string | null;
  nUrgentOrders: number | null;
  nPendingApproval: number | null;
}): string[] {
  const lines: string[] = [];

  if (input.urgentItemName !== null) {
    const when = input.urgentOrderDate === null ? '권고일 미산출' : `${input.urgentOrderDate} 권고`;
    lines.push(`지금 가장 급한 품목은 ${input.urgentItemName} 입니다 (${when}).`);
  } else if (input.nUrgentOrders !== null && input.nUrgentOrders === 0) {
    lines.push('발주 권고일이 지난 품목은 없습니다.');
  }

  if (input.nPendingApproval !== null) {
    lines.push(
      input.nPendingApproval === 0
        ? '결정을 기다리는 발주 추천은 없습니다.'
        : `발주 추천 ${input.nPendingApproval.toLocaleString()}건이 결정을 기다립니다.`,
    );
  }

  return lines;
}
