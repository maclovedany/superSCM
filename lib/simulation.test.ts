import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bool,
  count,
  deltaDirection,
  monthOf,
  normalizeSimulationItem,
  normalizeSimulationRun,
  normalizeSimulationSeries,
  normalizeSimulationTotals,
  num,
  text,
} from './simulation-model.ts';

// 여기서 검사하는 것은 "뷰 한 줄 → 화면이 쓰는 모양" 뿐입니다.
// 시뮬레이션 계산은 전부 core.run_virtual_operation() 이 끝냈습니다 (AGENTS.md 규칙 2).
//
// 이 파일이 지키는 계약은 둘입니다.
//   1  뷰가 null 을 준 자리에 0 이 들어가면 안 됩니다 (AGENTS.md 규칙 5 · design.md §8.2)
//   2  세는 값(count)은 행이 없어도 0 입니다 — "결품 0회" 와 "모른다" 는 다릅니다

// ── num · text · count · bool ─────────────────────────────────

test('num 은 빈 값과 숫자가 아닌 값을 null 로 둔다', () => {
  assert.equal(num(null), null);
  assert.equal(num(undefined), null);
  assert.equal(num(''), null);
  assert.equal(num('abc'), null);
  assert.equal(num(0), 0);
  // PostgREST 는 numeric 을 문자열로 내려 줍니다
  assert.equal(num('1284.5'), 1284.5);
  assert.equal(num('-12.3'), -12.3);
});

test('text 는 빈 문자열을 null 로 둔다', () => {
  assert.equal(text(''), null);
  assert.equal(text(null), null);
  assert.equal(text('sim_20250101120000_001'), 'sim_20250101120000_001');
});

test('count 는 값이 없으면 0 이다 — 세는 값의 0 은 진짜 0 이다', () => {
  assert.equal(count(null), 0);
  assert.equal(count('4'), 4);
  assert.equal(count(0), 0);
});

test('bool 은 모르는 값을 true 로 만들지 않는다', () => {
  assert.equal(bool(true), true);
  assert.equal(bool('t'), true);
  assert.equal(bool(null), false);
  assert.equal(bool('아니오'), false);
});

// ── 실행 한 줄 ────────────────────────────────────────────────

test('실행 한 줄의 KPI 를 뷰 컬럼명 그대로 읽는다', () => {
  const run = normalizeSimulationRun({
    simulation_id: 'sim_20260101090000_123',
    forecast_run_id: 'run_20251231235959_001',
    backtest_run_id: 'bt_20251231235959_002',
    sim_start: '2025-01-01',
    sim_end: '2025-12-01',
    status: 'SUCCESS',
    n_items: 18,
    actual_stockout_months: 4,
    sim_stockout_months: 1,
    prevented: 3,
    actual_avg_inventory: '1284.5',
    sim_avg_inventory: '1091.8',
    inventory_change_pct: '-15.0',
    actual_orders: 24,
    sim_orders: 19,
    excess_orders_actual: 5,
    excess_orders_sim: 1,
    actual_turnover: '3.42',
    sim_turnover: '4.03',
    skipped_items: 2,
    opening_clamped_items: 1,
    window_truncated: 6,
    pipeline_seed_rows: 11,
    pipeline_seed_unmatched: 2,
    sentence: 'AI 추천대로 발주했다면 2025-01 ~ 2025-12 실제 결품 4회 중 3회를 막을 수 있었고, 평균 재고는 15.0% 낮게 유지됐을 것이다.',
    started_at: '2026-01-01T09:00:00Z',
    duration_ms: 4210,
    triggered_email: 'admin@example.com',
  });

  assert.equal(run.simulationId, 'sim_20260101090000_123');
  assert.equal(run.status, 'SUCCESS');
  assert.equal(run.nItems, 18);
  assert.equal(run.actualStockoutMonths, 4);
  assert.equal(run.simStockoutMonths, 1);
  assert.equal(run.prevented, 3);
  assert.equal(run.inventoryChangePct, -15);
  assert.equal(run.actualTurnover, 3.42);
  assert.equal(run.simTurnover, 4.03);
  assert.equal(run.skippedItems, 2);
  assert.equal(run.openingClampedItems, 1);
  // 발주 건수는 양쪽 모두 "발주가 있었던 품목-월" 입니다 (같은 단위여야 나란히 놓을 수 있습니다).
  assert.equal(run.actualOrders, 24);
  assert.equal(run.simOrders, 19);
  // 창이 예측 밖으로 넘어간 품목-월과, 시뮬 파이프라인 시드 건수를 숨기지 않습니다.
  assert.equal(run.windowTruncated, 6);
  assert.equal(run.pipelineSeedRows, 11);
  assert.equal(run.pipelineSeedUnmatched, 2);
  assert.match(run.sentence ?? '', /^AI 추천대로 발주했다면/);
});

test('모르는 상태 문자열을 SUCCESS 로 만들지 않는다', () => {
  assert.equal(normalizeSimulationRun({ status: 'WHATEVER' }).status, 'FAILED');
  assert.equal(normalizeSimulationRun({ status: 'RUNNING' }).status, 'RUNNING');
});

test('비교할 수 없는 KPI 는 0 이 아니라 null 로 남는다', () => {
  // 평균 재고가 0 이면 증감률도 회전율도 낼 수 없습니다. SQL 이 null 을 내려줍니다.
  const run = normalizeSimulationRun({
    simulation_id: 'sim_x',
    status: 'SUCCESS',
    n_items: 0,
    inventory_change_pct: null,
    actual_turnover: null,
    sim_turnover: null,
    sentence: '비교할 데이터가 없습니다',
  });

  assert.equal(run.inventoryChangePct, null);
  assert.equal(run.actualTurnover, null);
  assert.equal(run.simTurnover, null);
  assert.equal(run.windowTruncated, null);
  assert.equal(run.pipelineSeedRows, null);
  assert.equal(run.nItems, 0);
  assert.equal(run.sentence, '비교할 데이터가 없습니다');
});

// ── 품목 · 기간 ───────────────────────────────────────────────

test('품목 한 줄은 실제와 시뮬을 나란히 담는다', () => {
  const item = normalizeSimulationItem({
    simulation_id: 'sim_x',
    item_id: 'ITEM012',
    item_name: '드럼 유닛',
    actual_stockouts: 2,
    sim_stockouts: 0,
    actual_avg_inv: '820.4',
    sim_avg_inv: '640.1',
    actual_orders: 3,
    sim_orders: 2,
    actual_order_lines: 5,
    actual_excess_orders: 1,
    sim_excess_orders: 0,
    demand: '4820',
  });

  assert.equal(item.itemId, 'ITEM012');
  assert.equal(item.actualStockouts, 2);
  assert.equal(item.simStockouts, 0);
  assert.equal(item.actualAvgInv, 820.4);
  assert.equal(item.simAvgInv, 640.1);
  // 발주는 품목-월 수, 라인 수는 따로입니다. 표는 품목-월만 씁니다.
  assert.equal(item.actualOrders, 3);
  assert.equal(item.actualOrderLines, 5);
  assert.equal(item.simExcessOrders, 0);
});

test('품목명이 없어도 지어내지 않는다', () => {
  assert.equal(normalizeSimulationItem({ item_id: 'ITEM099' }).itemName, null);
});

test('기간 한 줄의 결품 표시는 boolean 이다', () => {
  const row = normalizeSimulationSeries({
    item_id: 'ITEM012',
    period: '2025-03-01',
    actual_closing: '0',
    sim_closing: '312',
    actual_receipt: '0',
    sim_receipt: '600',
    demand: '410',
    actual_stockout: true,
    sim_stockout: false,
    sim_order_qty: '600',
    sim_safety_stock: '180',
    sim_forecast_window: '840',
  });

  assert.equal(row.period, '2025-03-01');
  assert.equal(row.actualStockout, true);
  assert.equal(row.simStockout, false);
  assert.equal(row.actualClosing, 0);
  assert.equal(row.simSafetyStock, 180);
});

test('전 품목 합은 기간마다 실제와 시뮬 두 값을 낸다', () => {
  const row = normalizeSimulationTotals({
    period: '2025-05-01',
    actual_total_inventory: '12840',
    sim_total_inventory: '10920',
    actual_stockout_items: 2,
    sim_stockout_items: 0,
    demand: '4210',
  });

  assert.equal(row.actualTotalInventory, 12840);
  assert.equal(row.simTotalInventory, 10920);
  assert.equal(row.actualStockoutItems, 2);
  assert.equal(row.simStockoutItems, 0);
});

test('합계가 비어 있으면 null 로 두고 0 으로 채우지 않는다', () => {
  const row = normalizeSimulationTotals({ period: '2025-05-01' });
  assert.equal(row.actualTotalInventory, null);
  assert.equal(row.simTotalInventory, null);
  // 세는 값만 0 입니다
  assert.equal(row.actualStockoutItems, 0);
});

// ── 표시 보조 ─────────────────────────────────────────────────

test('기간은 YYYY-MM 으로 줄여 쓴다', () => {
  assert.equal(monthOf('2025-01-01'), '2025-01');
  assert.equal(monthOf(''), '');
});

test('증감 방향은 값이 하나라도 없으면 flat 이다', () => {
  assert.equal(deltaDirection(3, 5), 'down');
  assert.equal(deltaDirection(5, 3), 'up');
  assert.equal(deltaDirection(4, 4), 'flat');
  assert.equal(deltaDirection(null, 4), 'flat');
  assert.equal(deltaDirection(4, null), 'flat');
});
