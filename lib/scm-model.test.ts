import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBacktestRun,
  normalizeChampionModel,
  normalizeForecastModelConfig,
  normalizeForecastRun,
  normalizeLeadtimeGap,
  normalizeModelPerformanceRow,
  normalizeStockoutKpi,
  normalizeStockoutRisk,
  summarizeModelPerformance,
} from './scm-model.ts';

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
  });
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
  assert.equal(result.riskStatus, 'UNKNOWN');
  assert.equal(result.reason, 'NO_USAGE');
});

test('normalizes the stockout KPI summary row', () => {
  const result = normalizeStockoutKpi({
    n_items: 20,
    n_critical: 4,
    n_safe: 13,
    n_unknown: 3,
    n_within_30d: 6,
    avg_stockout_days: 74.5,
  });

  assert.deepEqual(result, {
    itemCount: 20,
    criticalCount: 4,
    safeCount: 13,
    unknownCount: 3,
    within30DaysCount: 6,
    averageStockoutDays: 74.5,
  });
});

// Task 15 fix round 2 — admin/forecast-runs · backtest-runs · champion-models · forecast-models

test('normalizes a v_forecast_run row, including is_stale and RUNNING/FAILED fallback', () => {
  const result = normalizeForecastRun({
    run_id: 'r1', status: 'SUCCESS', granularity: 'MONTH', train_start: '2026-01-01', train_end: '2026-06-30',
    horizon: 3, data_snapshot_at: '2026-07-01T00:00:00Z', n_models: 5, n_items: 20, n_rows: 300,
    started_at: '2026-09-12T06:10:00Z', finished_at: '2026-09-12T06:11:00Z', duration_ms: 60000,
    triggered_email: 'admin@example.com', message: 'SQL Baseline Forecast 실행 완료', is_stale: true,
  });
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.isStale, true);
  assert.equal(result.nItems, 20);

  const unknownStatus = normalizeForecastRun({ run_id: 'r2', status: 'BOGUS' });
  assert.equal(unknownStatus.status, 'FAILED');
  assert.equal(unknownStatus.isStale, false);
});

test('normalizes a v_backtest_run row', () => {
  const result = normalizeBacktestRun({
    backtest_run_id: 'b1', forecast_run_id: 'r1', status: 'SUCCESS',
    test_start: '2026-07-01', test_end: '2026-08-31', metric: 'WAPE', reference_model_id: 'WMA_3M',
    started_at: '2026-09-12T06:20:00Z', finished_at: '2026-09-12T06:21:00Z', message: 'Backtest scoring 완료',
  });
  assert.deepEqual(result, {
    backtestRunId: 'b1', forecastRunId: 'r1', status: 'SUCCESS',
    testStart: '2026-07-01', testEnd: '2026-08-31', metric: 'WAPE', referenceModelId: 'WMA_3M',
    startedAt: '2026-09-12T06:20:00Z', finishedAt: '2026-09-12T06:21:00Z', message: 'Backtest scoring 완료',
  });
});

test('normalizes a v_model_performance row used to build the backtest-runs summary', () => {
  const result = normalizeModelPerformanceRow({
    backtest_run_id: 'b1', model_id: 'WMA_3M', item_id: 'ITEM001', wape: 0.234, calculation_status: 'SUCCESS',
  });
  assert.deepEqual(result, { backtestRunId: 'b1', modelId: 'WMA_3M', itemId: 'ITEM001', wape: 0.234, calculationStatus: 'SUCCESS' });
});

test('summarizeModelPerformance counts scored rows and takes the wape min/max, not an average', () => {
  const rows = [
    { calculationStatus: 'SUCCESS', wape: 0.1 },
    { calculationStatus: 'SUCCESS', wape: 0.5 },
    { calculationStatus: 'SUCCESS', wape: 0.3 },
    { calculationStatus: 'UNAVAILABLE', wape: null },
  ];
  const result = summarizeModelPerformance('b1', rows);
  assert.deepEqual(result, { backtestRunId: 'b1', scoredCount: 3, unavailableCount: 1, wapeMin: 0.1, wapeMax: 0.5 });
});

test('summarizeModelPerformance returns null range when no row was scored', () => {
  const result = summarizeModelPerformance('b2', [{ calculationStatus: 'UNAVAILABLE', wape: null }]);
  assert.deepEqual(result, { backtestRunId: 'b2', scoredCount: 0, unavailableCount: 1, wapeMin: null, wapeMax: null });
});

test('normalizes a v_champion_model row, including the AUTO/MANUAL selection method', () => {
  const result = normalizeChampionModel({
    selection_id: 's1', backtest_run_id: 'b1', item_id: 'ITEM001', champion_model_id: 'WMA_3M',
    champion_metric: 'WAPE', champion_metric_value: 0.21, wape: 0.21, mape: 0.3, bias: -1.2, rmse: 4.1, mae: 3.2,
    selection_reason: 'LOWEST_WAPE_THEN_ABS_BIAS_RMSE_MODEL_ID', selection_method: 'AUTO', selected_at: '2026-09-12T06:30:00Z',
  });
  assert.equal(result.championModelId, 'WMA_3M');
  assert.equal(result.selectionMethod, 'AUTO');
  assert.equal(result.wape, 0.21);

  const noCandidate = normalizeChampionModel({
    selection_id: 's2', backtest_run_id: 'b1', item_id: 'ITEM002', champion_model_id: null,
    selection_reason: 'NO_VALID_CANDIDATE', selection_method: 'AUTO', selected_at: '2026-09-12T06:30:00Z',
  });
  assert.equal(noCandidate.championModelId, null);
  assert.equal(noCandidate.wape, null);
});

test('normalizes a v_model_config row, including updated_at', () => {
  const result = normalizeForecastModelConfig({
    model_id: 'WMA_3M', model_name: '3개월 가중이동평균', family: 'WEIGHTED_MOVING_AVERAGE', engine: 'SQL', version: '1.0.0',
    enabled: true, is_default: true, applicable_demand_type: ['SMOOTH', 'ERRATIC'], parameters: { window: 3, weights: [3, 2, 1] },
    description: '최근순 3:2:1 가중치', updated_at: '2026-08-28T00:05:00Z',
  });
  assert.equal(result.modelId, 'WMA_3M');
  assert.equal(result.isDefault, true);
  assert.deepEqual(result.applicableDemandType, ['SMOOTH', 'ERRATIC']);
  assert.equal(result.updatedAt, '2026-08-28T00:05:00Z');
});
