// ★ error.md #13 — SOURCE_STATUSES는 런타임 값이라 node --test가 확장자 없는 상대 경로를 해석하지
//   못한다. 명시적으로 .ts를 붙인다(allowImportingTsExtensions로 Next.js 타입 검사도 허용된다).
import { SOURCE_STATUSES, type SourceStatus } from './procurement/model.ts';

export type { SourceStatus };

export type LeadtimeGap = {
  supplier: string;
  country: string;
  masterLeadTime: number | null;
  sampleCount: number;
  actualAverage: number | null;
  p80: number | null;
  gap: number | null;
};

export type StockoutRisk = {
  itemId: string;
  itemName: string;
  supplierId: string;
  currentStock: number | null;
  inboundQty: number | null;
  availableQty: number | null;
  dailyUsageAvg: number | null;
  cv: number | null;
  plannedLeadTime: number | null;
  stockoutDays: number | null;
  stockoutDate: string | null;
  riskStatus: 'SAFE' | 'CRITICAL' | 'UNKNOWN';
  reason: 'NO_USAGE' | 'NO_LEADTIME' | null;
};

export type StockoutKpi = {
  itemCount: number;
  criticalCount: number;
  safeCount: number;
  unknownCount: number;
  within30DaysCount: number;
  averageStockoutDays: number | null;
};

/**
 * 실데이터 수요 프로파일 — analytics.v_item_demand_profile 한 행.
 *
 * ★ 5회차 더미(v_sku_demand_profile)와 다른 점 — 실데이터에는 계절성 · 추세 기울기 ·
 *   최근 변화율이 없습니다. 없는 값을 화면 필드로 남겨 두면 언젠가 0 으로 채우게 되므로
 *   아예 두지 않습니다. 대신 관측 창(first_ym ~ last_ym)과 품목 구분이 들어옵니다.
 */
export type ItemDemandProfile = {
  itemCode: string;
  description: string;
  family: string | null;
  /** MACHINE · PART 등 품목 구분 */
  itemType: string | null;
  /** 데이터 기준월 (YYYY-MM) */
  dataAsOf: string | null;
  firstYm: string | null;
  lastYm: string | null;
  /** 관측 창 개월 수 */
  nPeriods: number;
  /** 출고가 있었던 달 수 */
  nNonzero: number;
  meanNonzeroQty: number | null;
  adi: number | null;
  zeroDemandRate: number | null;
  cvSquared: number | null;
  demandType: 'SMOOTH' | 'INTERMITTENT' | 'ERRATIC' | 'LUMPY' | null;
  /** INSUFFICIENT_HISTORY · INSUFFICIENT_SAMPLE · NO_POSITIVE_DEMAND */
  reasonCode: string | null;
};

/** 품목 구분별 수요 유형 분포 — analytics.v_item_demand_kpi */
export type ItemDemandKpi = {
  itemType: string;
  nItems: number;
  nSmooth: number;
  nErratic: number;
  nIntermittent: number;
  nLumpy: number;
  nUnknown: number;
  nCrostonCandidate: number;
};

/** 출고 추이 — analytics.v_shipment_trend */
export type ShipmentTrend = {
  itemCode: string;
  description: string;
  family: string | null;
  itemType: string | null;
  dataAsOf: string | null;
  nMonths: number;
  firstYm: string | null;
  lastYm: string | null;
  monthsSinceLast: number | null;
  totalQty: number | null;
  latestQty: number | null;
  avg3m: number | null;
  avg6m: number | null;
  avg12m: number | null;
  /** 최근 3개월 ÷ 12개월 평균. 1.0 이면 변화 없음 */
  trend3mVs12m: number | null;
  reasonCode: string | null;
};

/** OL 예측 정확도 (기종 × 회계연도) — analytics.v_ol_accuracy */
export type OlAccuracy = {
  modelBase: string;
  fySheet: string;
  biz: string | null;
  nRows: number;
  firstYm: string | null;
  lastYm: string | null;
  totalAct: number | null;
  nScoredSales: number;
  salesWape: number | null;
  salesBias: number | null;
  nScoredScm: number;
  scmWape: number | null;
  scmBias: number | null;
  reasonCode: string | null;
};

/** OL 예측 정확도 (회계연도 합) — analytics.v_ol_accuracy_fy */
export type OlAccuracyFy = {
  fySheet: string;
  nRows: number;
  nScored: number;
  salesWape: number | null;
  scmWape: number | null;
  salesBias: number | null;
  scmBias: number | null;
};

/** BOM 소요 — analytics.v_bom_requirement_x */
export type BomRequirement = {
  modelBase: string;
  modelKey: string | null;
  /** CAP · NEUTRAL · MUST_OPTION · SCC · BOM */
  partRole: string;
  itemCode: string;
  description: string;
  qty: number | null;
  bomGroup: string | null;
  nModels: number | null;
  commonFlag: string | null;
  commonNote: string | null;
};

export type ForecastModelConfig = {
  modelId: string;
  modelName: string;
  family: string;
  engine: string;
  version: string;
  enabled: boolean;
  isDefault: boolean;
  applicableDemandType: string[];
  parameters: Record<string, unknown>;
  description: string | null;
  updatedAt: string | null;
};

export type ForecastRun = {
  runId: string;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  granularity: string | null;
  trainStart: string | null;
  trainEnd: string | null;
  horizon: number | null;
  dataSnapshotAt: string | null;
  nModels: number;
  nItems: number;
  nRows: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  triggeredEmail: string | null;
  message: string | null;
  isStale: boolean;
};

function value(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return null;
}

function numberValue(row: Record<string, unknown>, keys: string[]) {
  const raw = value(row, keys);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeLeadtimeGap(row: Record<string, unknown>): LeadtimeGap {
  return {
    supplier: String(value(row, ['supplier_name', 'supplier', '법인', '공급처', '공급업체명']) ?? '미정'),
    country: String(value(row, ['country', '국가']) ?? '미정'),
    masterLeadTime: numberValue(row, ['std_lead_time', 'master_lt', 'master_lead_time', 'planned_lead_time', '표준리드타임', '표준리드타임(일)', '마스터값']),
    sampleCount: numberValue(row, ['n_samples', 'sample_count', 'samples', '표본수']) ?? 0,
    actualAverage: numberValue(row, ['mean_days', 'actual_avg', 'actual_average', 'avg_lead_time', '실적평균']),
    p80: numberValue(row, ['p80_days', 'p80', 'P80']),
    gap: numberValue(row, ['gap_days', 'gap', 'leadtime_gap', '격차']),
  };
}

function riskStatusValue(value: unknown): StockoutRisk['riskStatus'] {
  return value === 'SAFE' || value === 'CRITICAL' ? value : 'UNKNOWN';
}

function reasonValue(value: unknown): StockoutRisk['reason'] {
  return value === 'NO_USAGE' || value === 'NO_LEADTIME' ? value : null;
}

export function normalizeStockoutRisk(row: Record<string, unknown>): StockoutRisk {
  const stockoutDate = value(row, ['stockout_date', '소진예상일']);

  return {
    itemId: String(value(row, ['item_id', 'item_code', '품목코드']) ?? '미정'),
    itemName: String(value(row, ['item_name', 'item_name_ko', '품목명']) ?? '미정'),
    supplierId: String(value(row, ['supplier_id', 'supplier', '공급처코드', '공급업체코드']) ?? '미정'),
    currentStock: numberValue(row, ['current_stock', 'on_hand', '현재고']),
    inboundQty: numberValue(row, ['inbound_qty', 'inbound', '입고예정']),
    availableQty: numberValue(row, ['available_qty', 'available', '가용수량']),
    dailyUsageAvg: numberValue(row, ['daily_usage_avg', 'avg_daily_usage', '일평균사용량']),
    cv: numberValue(row, ['cv', 'coefficient_of_variation', '변동계수']),
    plannedLeadTime: numberValue(row, ['planned_lead_time', 'lead_time', '계획리드타임']),
    stockoutDays: numberValue(row, ['stockout_days', '소진예상일수']),
    stockoutDate: stockoutDate === null ? null : String(stockoutDate),
    riskStatus: riskStatusValue(value(row, ['risk_status', 'status', '위험상태'])),
    reason: reasonValue(value(row, ['reason', '사유'])),
  };
}

export function normalizeStockoutKpi(row: Record<string, unknown>): StockoutKpi {
  return {
    itemCount: numberValue(row, ['n_items', 'item_count', '품목수']) ?? 0,
    criticalCount: numberValue(row, ['n_critical', 'critical_count', '위험품목수']) ?? 0,
    safeCount: numberValue(row, ['n_safe', 'safe_count', '안전품목수']) ?? 0,
    unknownCount: numberValue(row, ['n_unknown', 'unknown_count', '판정불가품목수']) ?? 0,
    within30DaysCount: numberValue(row, ['n_within_30d', 'within_30_days_count', '30일이내소진수']) ?? 0,
    averageStockoutDays: numberValue(row, ['avg_stockout_days', 'average_stockout_days', '평균소진예상일수']),
  };
}

function demandTypeValue(raw: unknown): ItemDemandProfile['demandType'] {
  return raw === 'SMOOTH' || raw === 'INTERMITTENT' || raw === 'ERRATIC' || raw === 'LUMPY' ? raw : null;
}

function text(row: Record<string, unknown>, keys: string[]): string | null {
  const raw = value(row, keys);
  return raw === null ? null : String(raw);
}

export function normalizeItemDemandProfile(row: Record<string, unknown>): ItemDemandProfile {
  return {
    itemCode: String(value(row, ['item_code', 'item_id', '품목코드']) ?? '미정'),
    description: String(value(row, ['description', 'item_name', '품목명']) ?? '미정'),
    family: text(row, ['family']),
    itemType: text(row, ['item_type']),
    dataAsOf: text(row, ['data_as_of', 'max_ym']),
    firstYm: text(row, ['first_ym']),
    lastYm: text(row, ['last_ym']),
    nPeriods: numberValue(row, ['n_periods', 'n_span']) ?? 0,
    nNonzero: numberValue(row, ['n_nonzero', 'n_nonzero_periods']) ?? 0,
    meanNonzeroQty: numberValue(row, ['mean_nonzero_qty']),
    adi: numberValue(row, ['adi']),
    zeroDemandRate: numberValue(row, ['zero_demand_rate']),
    cvSquared: numberValue(row, ['cv_squared']),
    demandType: demandTypeValue(value(row, ['demand_type'])),
    reasonCode: text(row, ['reason_code']),
  };
}

export function normalizeItemDemandKpi(row: Record<string, unknown>): ItemDemandKpi {
  return {
    itemType: String(value(row, ['item_type']) ?? '미정'),
    nItems: numberValue(row, ['n_items']) ?? 0,
    nSmooth: numberValue(row, ['n_smooth']) ?? 0,
    nErratic: numberValue(row, ['n_erratic']) ?? 0,
    nIntermittent: numberValue(row, ['n_intermittent']) ?? 0,
    nLumpy: numberValue(row, ['n_lumpy']) ?? 0,
    nUnknown: numberValue(row, ['n_unknown']) ?? 0,
    nCrostonCandidate: numberValue(row, ['n_croston_candidate']) ?? 0,
  };
}

export function normalizeShipmentTrend(row: Record<string, unknown>): ShipmentTrend {
  return {
    itemCode: String(value(row, ['item_code', 'hoc_item']) ?? '미정'),
    description: String(value(row, ['description', 'item_name']) ?? '미정'),
    family: text(row, ['family']),
    itemType: text(row, ['item_type']),
    dataAsOf: text(row, ['data_as_of', 'max_ym']),
    nMonths: numberValue(row, ['n_months']) ?? 0,
    firstYm: text(row, ['first_ym']),
    lastYm: text(row, ['last_ym']),
    monthsSinceLast: numberValue(row, ['months_since_last']),
    totalQty: numberValue(row, ['total_qty']),
    latestQty: numberValue(row, ['latest_qty']),
    avg3m: numberValue(row, ['avg_3m']),
    avg6m: numberValue(row, ['avg_6m']),
    avg12m: numberValue(row, ['avg_12m']),
    trend3mVs12m: numberValue(row, ['trend_3m_vs_12m']),
    reasonCode: text(row, ['reason_code']),
  };
}

export function normalizeOlAccuracy(row: Record<string, unknown>): OlAccuracy {
  return {
    modelBase: String(value(row, ['model_base']) ?? '(미분류)'),
    fySheet: String(value(row, ['fy_sheet']) ?? '미정'),
    biz: text(row, ['biz']),
    nRows: numberValue(row, ['n_rows']) ?? 0,
    firstYm: text(row, ['first_ym']),
    lastYm: text(row, ['last_ym']),
    totalAct: numberValue(row, ['total_act']),
    nScoredSales: numberValue(row, ['n_scored_sales']) ?? 0,
    salesWape: numberValue(row, ['sales_wape']),
    salesBias: numberValue(row, ['sales_bias']),
    nScoredScm: numberValue(row, ['n_scored_scm']) ?? 0,
    scmWape: numberValue(row, ['scm_wape']),
    scmBias: numberValue(row, ['scm_bias']),
    reasonCode: text(row, ['reason_code']),
  };
}

export function normalizeOlAccuracyFy(row: Record<string, unknown>): OlAccuracyFy {
  return {
    fySheet: String(value(row, ['fy_sheet']) ?? '미정'),
    nRows: numberValue(row, ['n_rows']) ?? 0,
    nScored: numberValue(row, ['n_scored']) ?? 0,
    salesWape: numberValue(row, ['sales_wape']),
    scmWape: numberValue(row, ['scm_wape']),
    salesBias: numberValue(row, ['sales_bias']),
    scmBias: numberValue(row, ['scm_bias']),
  };
}

export function normalizeBomRequirement(row: Record<string, unknown>): BomRequirement {
  return {
    modelBase: String(value(row, ['model_base']) ?? '미정'),
    modelKey: text(row, ['model_key']),
    partRole: String(value(row, ['part_role']) ?? '미정'),
    itemCode: String(value(row, ['item_code']) ?? '미정'),
    description: String(value(row, ['description']) ?? '미정'),
    qty: numberValue(row, ['qty']),
    bomGroup: text(row, ['bom_group']),
    nModels: numberValue(row, ['n_models']),
    commonFlag: text(row, ['common_flag']),
    commonNote: text(row, ['common_note']),
  };
}

export function normalizeForecastModelConfig(row: Record<string, unknown>): ForecastModelConfig {
  const demandTypes = value(row, ['applicable_demand_type']);
  return {
    modelId: String(value(row, ['model_id']) ?? ''), modelName: String(value(row, ['model_name']) ?? ''),
    family: String(value(row, ['family']) ?? ''), engine: String(value(row, ['engine']) ?? ''),
    version: String(value(row, ['version']) ?? ''), enabled: value(row, ['enabled']) === true,
    isDefault: value(row, ['is_default']) === true,
    applicableDemandType: Array.isArray(demandTypes) ? demandTypes.map(String) : [],
    parameters: typeof value(row, ['parameters']) === 'object' && value(row, ['parameters']) !== null ? value(row, ['parameters']) as Record<string, unknown> : {},
    description: value(row, ['description']) === null ? null : String(value(row, ['description'])),
    updatedAt: value(row, ['updated_at']) === null ? null : String(value(row, ['updated_at'])),
  };
}

export function normalizeForecastRun(row: Record<string, unknown>): ForecastRun {
  const status = value(row, ['status']);
  return {
    runId: String(value(row, ['run_id']) ?? ''), status: status === 'RUNNING' || status === 'SUCCESS' || status === 'FAILED' ? status : 'FAILED',
    granularity: value(row, ['granularity']) === null ? null : String(value(row, ['granularity'])),
    trainStart: value(row, ['train_start']) === null ? null : String(value(row, ['train_start'])),
    trainEnd: value(row, ['train_end']) === null ? null : String(value(row, ['train_end'])),
    horizon: numberValue(row, ['horizon']), dataSnapshotAt: value(row, ['data_snapshot_at']) === null ? null : String(value(row, ['data_snapshot_at'])),
    nModels: numberValue(row, ['n_models']) ?? 0, nItems: numberValue(row, ['n_items']) ?? 0, nRows: numberValue(row, ['n_rows']) ?? 0,
    startedAt: value(row, ['started_at']) === null ? null : String(value(row, ['started_at'])),
    finishedAt: value(row, ['finished_at']) === null ? null : String(value(row, ['finished_at'])),
    durationMs: numberValue(row, ['duration_ms']), triggeredEmail: value(row, ['triggered_email']) === null ? null : String(value(row, ['triggered_email'])),
    message: value(row, ['message']) === null ? null : String(value(row, ['message'])), isStale: value(row, ['is_stale']) === true,
  };
}

// Task 15 fix round 2 — STEP 7 Backtest · Champion 화면용 타입. ForecastRun과 같은 규칙(값 없으면 null,
// 여기서 계산하지 않는다)을 따른다. analytics.v_backtest_run · v_model_performance · v_champion_model을 그대로 옮긴다.

export type BacktestRun = {
  backtestRunId: string;
  forecastRunId: string;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  testStart: string | null;
  testEnd: string | null;
  metric: string | null;
  referenceModelId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
};

export function normalizeBacktestRun(row: Record<string, unknown>): BacktestRun {
  const status = value(row, ['status']);
  return {
    backtestRunId: String(value(row, ['backtest_run_id']) ?? ''),
    forecastRunId: String(value(row, ['forecast_run_id']) ?? ''),
    status: status === 'RUNNING' || status === 'SUCCESS' || status === 'FAILED' ? status : 'FAILED',
    testStart: value(row, ['test_start']) === null ? null : String(value(row, ['test_start'])),
    testEnd: value(row, ['test_end']) === null ? null : String(value(row, ['test_end'])),
    metric: value(row, ['metric']) === null ? null : String(value(row, ['metric'])),
    referenceModelId: value(row, ['reference_model_id']) === null ? null : String(value(row, ['reference_model_id'])),
    startedAt: value(row, ['started_at']) === null ? null : String(value(row, ['started_at'])),
    finishedAt: value(row, ['finished_at']) === null ? null : String(value(row, ['finished_at'])),
    message: value(row, ['message']) === null ? null : String(value(row, ['message'])),
  };
}

/**
 * Backtest 실행별 채점 요약 — analytics.v_backtest_performance_summary(fix round 1)를 그대로 옮긴다.
 *
 * ★ fix round 1 리뷰 전에는 이 요약(개수 · WAPE 최솟값·최댓값)을 화면이 core.model_performance
 *   원본 행을 내려받아 직접 집계했다. AGENTS.md 2번의 문언("화면 코드에서 평균이나 분위수를 구하지
 *   마세요")에 걸릴 정도는 아니라고 판단했었지만(평균이 아니라 최솟값·최댓값이었다), 이 저장소에
 *   화면 계층이 행을 훑어 집계한 선례가 없었다(averageStockoutDays조차 SQL이 계산한 열을 읽는다).
 *   선례를 만들지 않는 게 낫다는 리뷰 판정에 따라 집계를 SQL로 내렸다 — 이 타입은 이제 뷰 열을
 *   그대로 옮기기만 한다(다른 정규화 함수와 같은 모양).
 */
export type BacktestPerformanceSummary = {
  backtestRunId: string;
  scoredCount: number;
  unavailableCount: number;
  wapeMin: number | null;
  wapeMax: number | null;
};

export function normalizeBacktestPerformanceSummary(row: Record<string, unknown>): BacktestPerformanceSummary {
  return {
    backtestRunId: String(value(row, ['backtest_run_id']) ?? ''),
    scoredCount: numberValue(row, ['scored_count']) ?? 0,
    unavailableCount: numberValue(row, ['unavailable_count']) ?? 0,
    wapeMin: numberValue(row, ['wape_min']),
    wapeMax: numberValue(row, ['wape_max']),
  };
}

export type ChampionModel = {
  selectionId: string;
  backtestRunId: string;
  itemId: string;
  championModelId: string | null;
  championMetric: string | null;
  championMetricValue: number | null;
  wape: number | null;
  mape: number | null;
  bias: number | null;
  rmse: number | null;
  mae: number | null;
  selectionReason: string | null;
  selectionMethod: 'AUTO' | 'MANUAL' | null;
  selectedAt: string | null;
};

export function normalizeChampionModel(row: Record<string, unknown>): ChampionModel {
  const selectionMethod = value(row, ['selection_method']);
  return {
    selectionId: String(value(row, ['selection_id']) ?? ''),
    backtestRunId: String(value(row, ['backtest_run_id']) ?? ''),
    itemId: String(value(row, ['item_id']) ?? ''),
    championModelId: value(row, ['champion_model_id']) === null ? null : String(value(row, ['champion_model_id'])),
    championMetric: value(row, ['champion_metric']) === null ? null : String(value(row, ['champion_metric'])),
    championMetricValue: numberValue(row, ['champion_metric_value']),
    wape: numberValue(row, ['wape']), mape: numberValue(row, ['mape']), bias: numberValue(row, ['bias']),
    rmse: numberValue(row, ['rmse']), mae: numberValue(row, ['mae']),
    selectionReason: value(row, ['selection_reason']) === null ? null : String(value(row, ['selection_reason'])),
    selectionMethod: selectionMethod === 'AUTO' || selectionMethod === 'MANUAL' ? selectionMethod : null,
    selectedAt: value(row, ['selected_at']) === null ? null : String(value(row, ['selected_at'])),
  };
}

/**
 * Forecast Run 원천 게이트 표시용 — fix round 1.
 *
 * ★ 판정 로직은 core.procurement_forecast_source_status 하나뿐이다(20260911000900). 여기서 다시
 *   구현하지 않는다 — core.forecast_run_source_status_for_admin(uuid[])(20260912000700, admin
 *   전용 읽기 전용 래퍼)이 그 함수를 그대로 호출한 결과를 받아 한글 라벨만 붙인다.
 * ★ SourceStatus 타입은 lib/procurement/model.ts의 것을 그대로 쓴다(파일 위에서 re-export) — 값의
 *   집합을 두 곳에 따로 적으면 언젠가 갈라진다.
 */
export const SOURCE_STATUS_LABELS: Record<SourceStatus, string> = {
  VERIFIED: '검증됨',
  FORECAST_SOURCE_UNVERIFIED: '원천 미검증',
  FORECAST_WINDOW_CHANGED: '학습·검증 기간 변경됨',
  FORECAST_INPUT_UNTRACED: '입력 지문 없음',
  FORECAST_INPUT_CHANGED: '입력 변경됨',
};

export function isSourceStatus(value: unknown): value is SourceStatus {
  return typeof value === 'string' && (SOURCE_STATUSES as readonly string[]).includes(value);
}
