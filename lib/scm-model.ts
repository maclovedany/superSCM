import { toReasonCode, toRiskStatus, type ReasonCode, type RiskStatus } from './status.ts';

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
  riskStatus: RiskStatus;
  reason: ReasonCode | null;
  // ── STEP 9 · 재고 전개 기반 재작성으로 늘어난 값 (renew.prd 19장) ──
  /** 판정에 쓴 예측 실행 */
  runId: string | null;
  /** CHAMPION | DEFAULT — 어느 모델로 전개했는가 */
  forecastSource: string | null;
  dataSnapshotAt: string | null;
  /** 기말 재고가 처음 음수가 되는 기간 */
  firstNegativePeriod: string | null;
  daysOfSupply: number | null;
  /** 전개에서 여유가 확인된 개월 수 */
  monthsOfSupply: number | null;
  /** 리드타임 + 검토 주기 동안 커버해야 하는 누적 수요 (renew.prd 19.3) */
  leadtimeDemandQty: number | null;
  requiredQty: number | null;
};

export type StockoutKpi = {
  itemCount: number;
  criticalCount: number;
  warningCount: number;
  safeCount: number;
  unknownCount: number;
  within30DaysCount: number;
  within60DaysCount: number;
  averageStockoutDays: number | null;
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

export function normalizeStockoutRisk(row: Record<string, unknown>): StockoutRisk {
  const stockoutDate = value(row, ['stockout_date', '소진예상일']);
  const firstNegative = value(row, ['first_negative_period', '최초음수기간']);
  const snapshotAt = value(row, ['data_snapshot_at', '기준시각']);
  const runId = value(row, ['run_id', '실행ID']);
  const forecastSource = value(row, ['forecast_source', '예측기준']);

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
    riskStatus: toRiskStatus(value(row, ['risk_status', 'status', '위험상태'])),
    reason: toReasonCode(value(row, ['reason', '사유'])),
    runId: runId === null ? null : String(runId),
    forecastSource: forecastSource === null ? null : String(forecastSource),
    dataSnapshotAt: snapshotAt === null ? null : String(snapshotAt),
    firstNegativePeriod: firstNegative === null ? null : String(firstNegative),
    daysOfSupply: numberValue(row, ['days_of_supply', '소진까지일수']),
    monthsOfSupply: numberValue(row, ['months_of_supply', '커버개월수']),
    leadtimeDemandQty: numberValue(row, ['leadtime_demand_qty', '리드타임누적수요']),
    requiredQty: numberValue(row, ['required_qty', '필요량']),
  };
}

export function normalizeStockoutKpi(row: Record<string, unknown>): StockoutKpi {
  return {
    itemCount: numberValue(row, ['n_items', 'item_count', '품목수']) ?? 0,
    criticalCount: numberValue(row, ['n_critical', 'critical_count', '위험품목수']) ?? 0,
    warningCount: numberValue(row, ['n_warning', 'warning_count', '주의품목수']) ?? 0,
    safeCount: numberValue(row, ['n_safe', 'safe_count', '안전품목수']) ?? 0,
    unknownCount: numberValue(row, ['n_unknown', 'unknown_count', '판정불가품목수']) ?? 0,
    within30DaysCount: numberValue(row, ['n_within_30d', 'within_30_days_count', '30일이내소진수']) ?? 0,
    within60DaysCount: numberValue(row, ['n_within_60d', 'within_60_days_count', '60일이내소진수']) ?? 0,
    averageStockoutDays: numberValue(row, ['avg_stockout_days', 'average_stockout_days', '평균소진예상일수']),
  };
}
