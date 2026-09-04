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

// ══ Plan B — 분석 · 예측 화면 ═══════════════════════════════════
//
// 여기서도 모양만 바꿉니다. 정렬 · 걸러내기 · 피벗까지가 허용 범위입니다.

import type { DemandProfileKpi, SkuDemandProfile } from './demand-profile.ts';
import type { ChampionModel, ModelPerformance } from './backtest.ts';
import type { LeadtimeGap, StockoutRisk } from './scm-model.ts';
import type { ValueAddByReason, ValueAddRow } from './override-model.ts';
import type { RiskStatus } from './status.ts';

// ── 수요 프로파일 — CV² × ADI 사분면 ───────────────────────────

export type QuadrantPoint = {
  itemId: string;
  label: string;
  adi: number;
  cv2: number;
  demandType: string | null;
};

/** Syntetos-Boylan 경계. ADI 1.32 · CV² 0.49 (renew.prd 10장) */
export const QUADRANT_ADI = 1.32;
export const QUADRANT_CV2 = 0.49;

/** ADI · CV² 가 둘 다 있는 품목만 점이 됩니다 */
export function toQuadrantPoints(rows: SkuDemandProfile[]): QuadrantPoint[] {
  const points: QuadrantPoint[] = [];
  for (const row of rows) {
    if (row.adi === null || row.cvSquared === null) continue;
    points.push({
      itemId: row.itemId,
      label: row.itemName ?? row.itemId,
      adi: row.adi,
      cv2: row.cvSquared,
      demandType: row.demandType,
    });
  }
  return points;
}

export type DemandTypeKey = 'SMOOTH' | 'INTERMITTENT' | 'ERRATIC' | 'LUMPY' | 'NO_DEMAND' | 'UNCLASSIFIED';
export type DemandTypeSlice = { key: DemandTypeKey; label: string; n: number };

export const DEMAND_TYPE_MIX_LABEL: Record<DemandTypeKey, string> = {
  SMOOTH: '평활',
  INTERMITTENT: '간헐',
  ERRATIC: '불규칙',
  LUMPY: '덩어리',
  NO_DEMAND: '수요 없음',
  UNCLASSIFIED: '판정 불가',
};

/** v_demand_profile_kpi 의 여섯 건수를 순서대로 놓습니다 */
export function demandTypeMixFromKpi(kpi: DemandProfileKpi): DemandTypeSlice[] {
  return [
    { key: 'SMOOTH', label: DEMAND_TYPE_MIX_LABEL.SMOOTH, n: kpi.smooth },
    { key: 'INTERMITTENT', label: DEMAND_TYPE_MIX_LABEL.INTERMITTENT, n: kpi.intermittent },
    { key: 'ERRATIC', label: DEMAND_TYPE_MIX_LABEL.ERRATIC, n: kpi.erratic },
    { key: 'LUMPY', label: DEMAND_TYPE_MIX_LABEL.LUMPY, n: kpi.lumpy },
    { key: 'NO_DEMAND', label: DEMAND_TYPE_MIX_LABEL.NO_DEMAND, n: kpi.noDemand },
    { key: 'UNCLASSIFIED', label: DEMAND_TYPE_MIX_LABEL.UNCLASSIFIED, n: kpi.unclassified },
  ];
}

// ── 수요 프로파일 — 품목 × 월 히트맵 ───────────────────────────

export type HeatmapCell = { itemId: string; itemName: string | null; period: string; qty: number | null };

export function normalizeHeatmapCell(row: Record<string, unknown>): HeatmapCell {
  return {
    itemId: text(row.item_id) ?? '',
    itemName: text(row.item_name),
    period: (text(row.period) ?? '').slice(0, 7),
    qty: num(row.qty),
  };
}

export type HeatmapRow = {
  itemId: string;
  label: string;
  cells: { period: string; qty: number | null }[];
  /** 그 품목의 최댓값. 칸 색의 진하기를 고르는 데만 씁니다 — 숫자가 아니라 명도입니다 */
  max: number | null;
};

/** 품목별 한 행, 기간이 열. 기간이 없는 칸은 null 입니다 */
export function pivotHeatmap(cells: HeatmapCell[]): { periods: string[]; rows: HeatmapRow[] } {
  const periodSet = new Set<string>();
  const byItem = new Map<string, { label: string; values: Map<string, number | null> }>();
  for (const cell of cells) {
    if (cell.period === '') continue;
    periodSet.add(cell.period);
    let item = byItem.get(cell.itemId);
    if (item === undefined) {
      item = { label: cell.itemName ?? cell.itemId, values: new Map() };
      byItem.set(cell.itemId, item);
    }
    item.values.set(cell.period, cell.qty);
  }
  const periods = Array.from(periodSet).sort();
  const rows: HeatmapRow[] = [];
  byItem.forEach((item, itemId) => {
    const rowCells = periods.map((period) => ({ period, qty: item.values.get(period) ?? null }));
    let max: number | null = null;
    for (const c of rowCells) if (c.qty !== null && (max === null || c.qty > max)) max = c.qty;
    rows.push({ itemId, label: item.label, cells: rowCells, max });
  });
  return { periods, rows };
}

// ── 리드타임 ─────────────────────────────────────────────────────

export type LeadtimeBar = {
  supplier: string;
  master: number | null;
  p80: number | null;
  avg: number | null;
  gap: number | null;
  /** 표본 30건 미만 (renew.prd 18.2) */
  lowSample: boolean;
};

export function toLeadtimeBars(rows: LeadtimeGap[]): LeadtimeBar[] {
  return rows.map((row) => ({
    supplier: row.supplier,
    master: row.masterLeadTime,
    p80: row.p80,
    avg: row.actualAverage,
    gap: row.gap,
    lowSample: row.sampleCount < 30,
  }));
}

// ── 결품 위험 ────────────────────────────────────────────────────

export type StockoutBar = {
  itemId: string;
  label: string;
  days: number | null;
  leadTime: number | null;
  status: RiskStatus;
};

/** 일수가 있는 품목을 뷰 순서(소진 임박 순)대로 limit 까지. null 은 뒤로 보냅니다 */
export function toStockoutBars(rows: StockoutRisk[], limit = 20): StockoutBar[] {
  const withDays = rows.filter((r) => r.stockoutDays !== null);
  const without = rows.filter((r) => r.stockoutDays === null);
  return [...withDays, ...without].slice(0, limit).map((row) => ({
    itemId: row.itemId,
    label: row.itemName ?? row.itemId,
    days: row.stockoutDays,
    leadTime: row.plannedLeadTime,
    status: row.riskStatus,
  }));
}

// ── 모델 평가 ────────────────────────────────────────────────────

export type WapeBar = {
  itemId: string;
  label: string;
  wape: number | null;
  improvement: number | null;
  manual: boolean;
  modelName: string | null;
};

/** WAPE 내림차순(부정확한 품목이 위). null 은 뒤 */
export function toWapeBars(rows: ChampionModel[]): WapeBar[] {
  return rows
    .map((row): WapeBar => ({
      itemId: row.itemId,
      label: row.itemName ?? row.itemId,
      wape: row.wape,
      improvement: row.baselineImprovement,
      manual: row.selectionMethod === 'MANUAL',
      modelName: row.modelName,
    }))
    .sort((a, b) => {
      if (a.wape === null) return b.wape === null ? 0 : 1;
      if (b.wape === null) return -1;
      return b.wape - a.wape;
    });
}

export type ImprovementBar = { itemId: string; label: string; improvement: number };

/** 개선율이 있는 품목만, 뷰 순서 그대로 */
export function toImprovementBars(rows: ChampionModel[]): ImprovementBar[] {
  const bars: ImprovementBar[] = [];
  for (const row of rows) {
    if (row.baselineImprovement === null) continue;
    bars.push({ itemId: row.itemId, label: row.itemName ?? row.itemId, improvement: row.baselineImprovement });
  }
  return bars;
}

export type ChampionShareRow = {
  modelId: string;
  modelName: string | null;
  nItems: number;
  nManual: number;
  avgWape: number | null;
};

export function normalizeChampionShare(row: Record<string, unknown>): ChampionShareRow {
  return {
    modelId: text(row.model_id) ?? '',
    modelName: text(row.model_name),
    nItems: count(row.n_items) ?? 0,
    nManual: count(row.n_manual) ?? 0,
    avgWape: num(row.avg_wape),
  };
}

// ── 모델 비교 ────────────────────────────────────────────────────

export type MetricBar = {
  modelId: string;
  label: string;
  wape: number | null;
  bias: number | null;
  isChampion: boolean;
};

export function toMetricBars(rows: ModelPerformance[]): MetricBar[] {
  return rows.map((row) => ({
    modelId: row.modelId,
    label: row.modelName ?? row.modelId,
    wape: row.wape,
    bias: row.bias,
    isChampion: row.isChampion,
  }));
}

// ── 예측 보정 ────────────────────────────────────────────────────

export type ReasonBar = {
  reasonCode: string;
  label: string;
  n: number;
  aiWape: number | null;
  consensusWape: number | null;
};

export function toReasonBars(
  rows: ValueAddByReason[],
  labelOf: (code: string) => string,
): ReasonBar[] {
  return rows.map((row) => ({
    reasonCode: row.reasonCode ?? 'NONE',
    label: row.reasonCode === null ? '사유 없음' : labelOf(row.reasonCode),
    n: row.n,
    aiWape: row.aiWape,
    consensusWape: row.consensusWape,
  }));
}

export type ErrorPoint = {
  itemId: string;
  period: string;
  aiError: number;
  consensusError: number;
  improved: boolean | null;
};

/** 두 오차가 다 있는 (품목 × 기간) 만 점이 됩니다 */
export function toErrorPoints(rows: ValueAddRow[]): ErrorPoint[] {
  const points: ErrorPoint[] = [];
  for (const row of rows) {
    if (row.aiAbsError === null || row.consensusAbsError === null) continue;
    points.push({
      itemId: row.itemId,
      period: row.period.slice(0, 7),
      aiError: row.aiAbsError,
      consensusError: row.consensusAbsError,
      improved: row.improved,
    });
  }
  return points;
}
