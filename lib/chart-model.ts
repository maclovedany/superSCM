// 차트 정규화 — spec §3.4
//
// 뷰 행 → 차트 데이터. 모양만 바꿉니다. 합계 · 평균 · 순위는 만들지 않습니다 —
// 그것은 sql/31-chart-views.sql 과 앞 파일의 뷰가 이미 냈습니다 (AGENTS.md 규칙 2).
// 이 파일은 순수합니다. 서버 전용 모듈을 import 하지 않아 클라이언트 차트도 타입을 가져갈 수 있습니다.

import { count, num, text, type AccuracyRankingRow } from './dashboard-model.ts';

// ── 대시보드 ① 수요 추이 ────────────────────────────────────────

export type DemandTrendPoint = {
  /** YYYY-MM */
  period: string;
  actual: number | null;
  forecast: number | null;
  nItems: number | null;
};

/**
 * ACTUAL / FORECAST 행을 기간별 한 행으로 피벗합니다.
 * ★ 마지막 실적 값을 예측 시리즈의 시작점으로도 넣습니다 (components/chart/sparkline.tsx 와 같은 이유).
 *   실선과 파선이 한 점을 공유해야 "예측이 다른 높이에서 갑자기 시작" 한 것처럼 보이지 않습니다.
 */
export function normalizeDemandTrend(rows: Record<string, unknown>[]): DemandTrendPoint[] {
  const byPeriod = new Map<string, DemandTrendPoint>();
  for (const row of rows) {
    const period = (text(row.period) ?? '').slice(0, 7);
    if (period === '') continue;
    let point = byPeriod.get(period);
    if (point === undefined) {
      point = { period, actual: null, forecast: null, nItems: null };
      byPeriod.set(period, point);
    }
    const qty = num(row.qty);
    if (text(row.kind) === 'ACTUAL') point.actual = qty;
    else point.forecast = qty;
    point.nItems = count(row.n_items) ?? point.nItems;
  }
  // target es5 라 Map 이터레이터 spread 는 TS2802 입니다 (error.md #21). Array.from 을 씁니다.
  const points = Array.from(byPeriod.values()).sort((a, b) => a.period.localeCompare(b.period));
  const lastActual = points.reduce((found, p, i) => (p.actual === null ? found : i), -1);
  if (lastActual >= 0 && points[lastActual].forecast === null) {
    points[lastActual] = { ...points[lastActual], forecast: points[lastActual].actual };
  }
  return points;
}

// ── 대시보드 ② 결품 위험 분포 ──────────────────────────────────

export type RiskMixKey = 'CRITICAL' | 'WARNING' | 'SAFE' | 'UNKNOWN';
export type RiskMixSlice = { key: RiskMixKey; label: string; n: number };

export const RISK_MIX_LABEL: Record<RiskMixKey, string> = {
  CRITICAL: '위험',
  WARNING: '주의',
  SAFE: '안전',
  UNKNOWN: '미판정',
};

/** v_stockout_kpi 의 네 건수를 순서대로 놓습니다. 더하지 않습니다 */
export function riskMixFromKpi(kpi: {
  criticalCount: number;
  warningCount: number;
  safeCount: number;
  unknownCount: number;
}): RiskMixSlice[] {
  return [
    { key: 'CRITICAL', label: RISK_MIX_LABEL.CRITICAL, n: kpi.criticalCount },
    { key: 'WARNING', label: RISK_MIX_LABEL.WARNING, n: kpi.warningCount },
    { key: 'SAFE', label: RISK_MIX_LABEL.SAFE, n: kpi.safeCount },
    { key: 'UNKNOWN', label: RISK_MIX_LABEL.UNKNOWN, n: kpi.unknownCount },
  ];
}

// ── 대시보드 ③ 공급처별 추천 금액 ──────────────────────────────

export type SupplierAmountRow = {
  supplierId: string;
  supplierName: string | null;
  nItems: number;
  nUrgent: number;
  totalQty: number | null;
  /** 단가가 있는 품목만의 합. 없으면 null — 0원이 아닙니다 */
  totalAmount: number | null;
  nMissingPrice: number | null;
};

export function normalizeSupplierAmount(row: Record<string, unknown>): SupplierAmountRow {
  return {
    supplierId: text(row.supplier_id) ?? '',
    supplierName: text(row.supplier_name),
    nItems: count(row.n_items) ?? 0,
    nUrgent: count(row.n_urgent) ?? 0,
    totalQty: num(row.total_qty),
    totalAmount: num(row.total_amount),
    nMissingPrice: count(row.n_missing_price),
  };
}

// ── 대시보드 ⑤ 알림 유형 × 심각도 ─────────────────────────────

export type AlertSeverity = 'CRITICAL' | 'WARNING' | 'INFO';
export type AlertTypeMixRow = {
  type: string;
  typeLabel: string;
  severity: AlertSeverity;
  nOpen: number;
  nUnacknowledged: number;
};

function toSeverity(value: unknown): AlertSeverity {
  return value === 'CRITICAL' || value === 'WARNING' ? value : 'INFO';
}

export function normalizeAlertTypeMix(row: Record<string, unknown>): AlertTypeMixRow {
  const type = text(row.type) ?? '';
  return {
    type,
    typeLabel: text(row.type_label) ?? type,
    severity: toSeverity(row.severity),
    nOpen: count(row.n_open) ?? 0,
    nUnacknowledged: count(row.n_unacknowledged) ?? 0,
  };
}

export type AlertTypeStack = {
  type: string;
  typeLabel: string;
  CRITICAL: number;
  WARNING: number;
  INFO: number;
  total: number;
};

/** 유형별 한 행. 심각도가 열이 됩니다. total 은 뷰가 준 건수를 옮겨 담은 것입니다 */
export function pivotAlertTypeMix(rows: AlertTypeMixRow[]): AlertTypeStack[] {
  const byType = new Map<string, AlertTypeStack>();
  for (const row of rows) {
    let stack = byType.get(row.type);
    if (stack === undefined) {
      stack = { type: row.type, typeLabel: row.typeLabel, CRITICAL: 0, WARNING: 0, INFO: 0, total: 0 };
      byType.set(row.type, stack);
    }
    stack[row.severity] = row.nOpen;
    stack.total = stack.CRITICAL + stack.WARNING + stack.INFO;
  }
  return Array.from(byType.values()).sort((a, b) => b.total - a.total || a.type.localeCompare(b.type));
}

// ── 대시보드 ⑥ 월별 결정 ───────────────────────────────────────

export type ApprovalDecision = 'APPROVED' | 'ADJUSTED' | 'REJECTED' | 'DEFERRED';
export const APPROVAL_DECISIONS: ApprovalDecision[] = ['APPROVED', 'ADJUSTED', 'REJECTED', 'DEFERRED'];
export const APPROVAL_DECISION_LABEL: Record<ApprovalDecision, string> = {
  APPROVED: '추천대로 승인',
  ADJUSTED: '수량 조정 승인',
  REJECTED: '반려',
  DEFERRED: '보류',
};

export type ApprovalMonthlyRow = { month: string; decision: ApprovalDecision; n: number };

function toDecision(value: unknown): ApprovalDecision {
  return value === 'ADJUSTED' || value === 'REJECTED' || value === 'DEFERRED' ? value : 'APPROVED';
}

export function normalizeApprovalMonthly(row: Record<string, unknown>): ApprovalMonthlyRow {
  return {
    month: (text(row.month) ?? '').slice(0, 7),
    decision: toDecision(row.decision),
    n: count(row.n) ?? 0,
  };
}

export type ApprovalMonthStack = { month: string } & Record<ApprovalDecision, number>;

export function pivotApprovalMonthly(rows: ApprovalMonthlyRow[]): ApprovalMonthStack[] {
  const byMonth = new Map<string, ApprovalMonthStack>();
  for (const row of rows) {
    let stack = byMonth.get(row.month);
    if (stack === undefined) {
      stack = { month: row.month, APPROVED: 0, ADJUSTED: 0, REJECTED: 0, DEFERRED: 0 };
      byMonth.set(row.month, stack);
    }
    stack[row.decision] = row.n;
  }
  return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
}

// ── 대시보드 ④ 정확도 랭킹 ─────────────────────────────────────

export type AccuracyBar = {
  itemId: string;
  label: string;
  modelName: string | null;
  wape: number | null;
  side: 'best' | 'worst';
  rank: number;
};

/** 뷰가 매긴 rank_best · rank_worst 로 양쪽 5개씩 고르기만 합니다 */
export function toAccuracyBars(rows: AccuracyRankingRow[]): AccuracyBar[] {
  const best = rows
    .filter((r) => r.rankBest !== null && r.rankBest <= 5)
    .sort((a, b) => (a.rankBest ?? 0) - (b.rankBest ?? 0))
    .map((r): AccuracyBar => ({
      itemId: r.itemId, label: r.itemName ?? r.itemId, modelName: r.modelName, wape: r.wape,
      side: 'best', rank: r.rankBest ?? 0,
    }));
  const worst = rows
    .filter((r) => r.rankWorst !== null && r.rankWorst <= 5)
    .sort((a, b) => (a.rankWorst ?? 0) - (b.rankWorst ?? 0))
    .map((r): AccuracyBar => ({
      itemId: r.itemId, label: r.itemName ?? r.itemId, modelName: r.modelName, wape: r.wape,
      side: 'worst', rank: r.rankWorst ?? 0,
    }));
  return [...best, ...worst];
}
