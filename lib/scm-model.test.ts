import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLeadtimeGap, normalizeStockoutKpi, normalizeStockoutRisk } from './scm-model.ts';

test('normalizes analytics leadtime rows into the screen model', () => {
  const result = normalizeLeadtimeGap({
    supplier_name: 'Fujifilm BI India',
    country: 'India',
    master_lt: 32,
    sample_count: 159,
    actual_avg: 37.6,
    p80: 44,
    gap: 12,
  });

  assert.deepEqual(result, {
    supplier: 'Fujifilm BI India',
    country: 'India',
    masterLeadTime: 32,
    sampleCount: 159,
    actualAverage: 37.6,
    p80: 44,
    gap: 12,
  });
});

test('uses Korean view aliases and safe defaults', () => {
  const result = normalizeLeadtimeGap({ 법인: 'Japan', 국가: 'Japan', 표준리드타임: 7, 표본수: 278, 실적평균: 14.5, P80: 18, 격차: 11 });
  assert.equal(result.supplier, 'Japan');
  assert.equal(result.masterLeadTime, 7);
  assert.equal(result.p80, 18);
  assert.equal(result.gap, 11);
});

test('reads the real analytics.v_leadtime_gap column names', () => {
  const result = normalizeLeadtimeGap({
    supplier_name: 'Fujifilm BI China',
    country: 'China',
    std_lead_time: 25,
    n_samples: 210,
    mean_days: 28.4,
    p80_days: 33,
    gap_days: 8,
  });

  assert.deepEqual(result, {
    supplier: 'Fujifilm BI China',
    country: 'China',
    masterLeadTime: 25,
    sampleCount: 210,
    actualAverage: 28.4,
    p80: 33,
    gap: 8,
  });
});

test('normalizes analytics stockout risk rows into the screen model', () => {
  const result = normalizeStockoutRisk({
    item_id: 'ITEM012',
    item_name: 'Transfer Belt',
    supplier_id: 'SUP003',
    current_stock: 723,
    inbound_qty: 361,
    available_qty: 1084,
    daily_usage_avg: 60.22,
    cv: 0.34,
    planned_lead_time: 18,
    stockout_days: 18,
    stockout_date: '2026-09-14',
    risk_status: 'CRITICAL',
    reason: null,
    run_id: 'fc_20260901120000',
    forecast_source: 'CHAMPION',
    data_snapshot_at: '2026-09-01T03:00:00+00:00',
    first_negative_period: '2026-09-01',
    days_of_supply: 18,
    months_of_supply: 0,
    leadtime_demand_qty: 2890.5,
    required_qty: 1806.5,
  });

  assert.deepEqual(result, {
    itemId: 'ITEM012',
    itemName: 'Transfer Belt',
    supplierId: 'SUP003',
    currentStock: 723,
    inboundQty: 361,
    availableQty: 1084,
    dailyUsageAvg: 60.22,
    cv: 0.34,
    plannedLeadTime: 18,
    stockoutDays: 18,
    stockoutDate: '2026-09-14',
    riskStatus: 'CRITICAL',
    reason: null,
    runId: 'fc_20260901120000',
    forecastSource: 'CHAMPION',
    dataSnapshotAt: '2026-09-01T03:00:00+00:00',
    firstNegativePeriod: '2026-09-01',
    daysOfSupply: 18,
    monthsOfSupply: 0,
    leadtimeDemandQty: 2890.5,
    requiredQty: 1806.5,
  });
});

// STEP 9 — analytics.v_inventory_projection 기반 재작성으로 늘어난 컬럼.
// 실제 뷰 컬럼명으로 한 건 확인합니다 (error.md #2 의 재발 방지).
test('reads the STEP 9 projection columns of analytics.v_stockout_risk', () => {
  const result = normalizeStockoutRisk({
    item_id: 'ITEM007',
    item_name: 'Fuser Unit',
    supplier_id: 'SUP001',
    current_stock: 400,
    inbound_qty: 0,
    available_qty: 400,
    planned_lead_time: 42,
    stockout_days: 51,
    stockout_date: '2026-10-24',
    risk_status: 'WARNING',
    reason: null,
    run_id: 'fc_20260901120000',
    forecast_source: 'DEFAULT',
    first_negative_period: '2026-10-01',
    days_of_supply: 51,
    months_of_supply: 1,
    leadtime_demand_qty: 980,
    required_qty: 580,
  });

  assert.equal(result.riskStatus, 'WARNING');
  assert.equal(result.forecastSource, 'DEFAULT');
  assert.equal(result.firstNegativePeriod, '2026-10-01');
  assert.equal(result.monthsOfSupply, 1);
  assert.equal(result.leadtimeDemandQty, 980);
  assert.equal(result.requiredQty, 580);
});

// 여유가 남아 전개 끝까지 음수가 없으면 결품일이 없습니다.
// 그 자리를 0 이나 999 로 채우지 않습니다 (AGENTS.md 규칙 5).
test('keeps a fully covered item null instead of inventing a stockout date', () => {
  const result = normalizeStockoutRisk({
    item_id: 'ITEM003',
    risk_status: 'SAFE',
    reason: null,
    stockout_days: null,
    stockout_date: null,
    first_negative_period: null,
    days_of_supply: null,
    months_of_supply: 6,
    required_qty: 0,
  });

  assert.equal(result.riskStatus, 'SAFE');
  assert.equal(result.stockoutDate, null);
  assert.equal(result.daysOfSupply, null);
  assert.equal(result.monthsOfSupply, 6);
  assert.equal(result.requiredQty, 0);
});

// STEP 9 에서 늘어난 사유 코드. 예측이 아예 없으면 판정하지 않습니다.
test('maps NO_FORECAST to the calculation-unavailable state', () => {
  const result = normalizeStockoutRisk({
    item_id: 'ITEM018',
    risk_status: 'CALCULATION_UNAVAILABLE',
    reason: 'NO_FORECAST',
    stockout_days: null,
    stockout_date: null,
  });

  assert.equal(result.riskStatus, 'CALCULATION_UNAVAILABLE');
  assert.equal(result.reason, 'NO_FORECAST');
  assert.equal(result.stockoutDays, null);
});

test('preserves stockout calculation-unavailable reasons as null values', () => {
  const result = normalizeStockoutRisk({
    item_id: 'ITEM020',
    item_name: 'Unknown Part',
    supplier_id: 'SUP013',
    available_qty: 42,
    daily_usage_avg: null,
    planned_lead_time: null,
    stockout_days: null,
    stockout_date: null,
    risk_status: 'UNKNOWN',
    reason: 'NO_USAGE',
  });

  assert.equal(result.itemId, 'ITEM020');
  assert.equal(result.currentStock, null);
  assert.equal(result.stockoutDays, null);
  // 뷰는 UNKNOWN / NO_USAGE 를 돌려주지만, 화면 모델은 renew.prd 20.2 의 코드로 정규화합니다.
  assert.equal(result.riskStatus, 'CALCULATION_UNAVAILABLE');
  assert.equal(result.reason, 'NO_USAGE_HISTORY');
});

test('maps the new renew.prd reason codes as-is', () => {
  const result = normalizeStockoutRisk({
    item_id: 'ITEM021',
    risk_status: 'WARNING',
    reason: 'INSUFFICIENT_SAMPLE',
  });

  assert.equal(result.riskStatus, 'WARNING');
  assert.equal(result.reason, 'INSUFFICIENT_SAMPLE');
});

test('normalizes the stockout KPI summary row', () => {
  const result = normalizeStockoutKpi({
    n_items: 20,
    n_critical: 4,
    n_warning: 5,
    n_safe: 8,
    n_unknown: 3,
    n_within_30d: 6,
    n_within_60d: 9,
    avg_stockout_days: 74.5,
  });

  assert.deepEqual(result, {
    itemCount: 20,
    criticalCount: 4,
    warningCount: 5,
    safeCount: 8,
    unknownCount: 3,
    within30DaysCount: 6,
    within60DaysCount: 9,
    averageStockoutDays: 74.5,
  });
});

// 옛 뷰에는 n_warning · n_within_60d 가 없습니다. 없으면 0 이지 null 이 아닙니다.
test('falls back to zero when the KPI view has no warning columns yet', () => {
  const result = normalizeStockoutKpi({ n_items: 20, n_critical: 4, n_safe: 13, n_unknown: 3 });

  assert.equal(result.warningCount, 0);
  assert.equal(result.within60DaysCount, 0);
  assert.equal(result.averageStockoutDays, null);
});
