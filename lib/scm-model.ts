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

export type DemandProfile = {
  itemId: string;
  itemName: string;
  nPeriods: number;
  nNonzeroPeriods: number;
  adi: number | null;
  cv: number | null;
  cvSquared: number | null;
  zeroDemandRate: number | null;
  trend: number | null;
  recentChangeRate: number | null;
  peakPeriod: string | null;
  demandType: 'SMOOTH' | 'INTERMITTENT' | 'ERRATIC' | 'LUMPY' | null;
  seasonality: boolean | null;
  reasonCode: string | null;
  stability: string | null;
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

function demandTypeValue(raw: unknown): DemandProfile['demandType'] {
  return raw === 'SMOOTH' || raw === 'INTERMITTENT' || raw === 'ERRATIC' || raw === 'LUMPY' ? raw : null;
}

export function normalizeDemandProfile(row: Record<string, unknown>): DemandProfile {
  const seasonality = value(row, ['seasonality']);
  return {
    itemId: String(value(row, ['item_id', 'item_code', '품목코드']) ?? '미정'),
    itemName: String(value(row, ['item_name', 'item_name_ko', '품목명']) ?? '미정'),
    nPeriods: numberValue(row, ['n_periods']) ?? 0,
    nNonzeroPeriods: numberValue(row, ['n_nonzero_periods']) ?? 0,
    adi: numberValue(row, ['adi']),
    cv: numberValue(row, ['cv']),
    cvSquared: numberValue(row, ['cv_squared']),
    zeroDemandRate: numberValue(row, ['zero_demand_rate']),
    trend: numberValue(row, ['trend', 'trend_per_period']),
    recentChangeRate: numberValue(row, ['recent_change_rate']),
    peakPeriod: value(row, ['peak_period']) === null ? null : String(value(row, ['peak_period'])),
    demandType: demandTypeValue(value(row, ['demand_type'])),
    seasonality: seasonality === true || seasonality === false ? seasonality : null,
    reasonCode: value(row, ['reason_code']) === null ? null : String(value(row, ['reason_code'])),
    stability: value(row, ['stability']) === null ? null : String(value(row, ['stability'])),
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
