// 가상 운영 결과 — 타입과 정규화 (순수 함수) — renew.prd 13.2
//
// 계산은 SQL 이 끝냈습니다. 여기서는 뷰 한 줄을 화면이 쓰는 모양으로 바꾸기만 합니다
// (AGENTS.md 규칙 2).
//
// ★ 조회 파일(lib/simulation.ts)과 나눠 둔 이유는 테스트 때문입니다.
//   npm test 는 node --test 로 TypeScript 를 그대로 실행하므로 Supabase 클라이언트를
//   import 하는 파일에는 닿을 수 없습니다 (error.md #17).
//   그래서 상대 import 에 .ts 를 붙입니다.

/** analytics.v_simulation_run — 실행 한 줄 (kpis 를 컬럼으로 펼친 것) */
export type SimulationRun = {
  simulationId: string;
  forecastRunId: string | null;
  backtestRunId: string | null;
  simStart: string | null;
  simEnd: string | null;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  nItems: number;
  actualStockoutMonths: number | null;
  simStockoutMonths: number | null;
  prevented: number | null;
  /** 전 품목 합계 재고의 기간 평균 (차트의 total_inventory 와 같은 단위) */
  actualAvgInventory: number | null;
  simAvgInventory: number | null;
  /** 실제 대비 평균 재고 증감률(%). 음수면 재고가 줄어듭니다 */
  inventoryChangePct: number | null;
  /** 발주가 있었던 품목-월 수. 양쪽이 같은 단위입니다 */
  actualOrders: number | null;
  simOrders: number | null;
  excessOrdersActual: number | null;
  excessOrdersSim: number | null;
  actualTurnover: number | null;
  simTurnover: number | null;
  /** 근거가 없어 시뮬레이션에서 제외한 품목 수 */
  skippedItems: number | null;
  /** 기초 재고 역산이 음수여서 0 에서 시작한 품목 수 */
  openingClampedItems: number | null;
  /** 발주 판단 창이 예측이 있는 마지막 달을 넘어간 품목-월 수 */
  windowTruncated: number | null;
  /** sim_start 이전 발주로 시뮬 파이프라인을 채운 입고 건수 */
  pipelineSeedRows: number | null;
  /** 발주와 잇지 못해 시드에서 뺀 입고 건수 */
  pipelineSeedUnmatched: number | null;
  /** renew.prd 13.2 의 산출 문장. SQL 이 만들었습니다 */
  sentence: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  triggeredEmail: string | null;
  note: string | null;
  message: string | null;
};

/** analytics.v_simulation_item — 품목별 실제 vs 시뮬 */
export type SimulationItem = {
  simulationId: string;
  itemId: string;
  itemName: string | null;
  actualStockouts: number;
  simStockouts: number;
  /** 품목 하나당 평균 재고 (실행 KPI 의 평균 재고는 전 품목 합계 기준입니다) */
  actualAvgInv: number | null;
  simAvgInv: number | null;
  /** 발주가 있었던 품목-월 수 */
  actualOrders: number;
  simOrders: number;
  /** 실제 발주 라인 수 (단위가 달라 표에는 쓰지 않습니다) */
  actualOrderLines: number;
  actualExcessOrders: number;
  simExcessOrders: number;
  demand: number | null;
};

/** analytics.v_simulation_series — 한 품목의 기간별 추이 */
export type SimulationSeries = {
  itemId: string;
  itemName: string | null;
  /** YYYY-MM-DD (월 초) */
  period: string;
  actualClosing: number | null;
  simClosing: number | null;
  actualReceipt: number | null;
  simReceipt: number | null;
  demand: number | null;
  actualStockout: boolean;
  simStockout: boolean;
  simOrderQty: number | null;
  simSafetyStock: number | null;
  simForecastWindow: number | null;
};

/** analytics.v_simulation_totals — 전 품목 합 (차트용) */
export type SimulationTotals = {
  period: string;
  actualTotalInventory: number | null;
  simTotalInventory: number | null;
  actualStockoutItems: number;
  simStockoutItems: number;
  demand: number | null;
};

/** 값이 없으면 null 입니다. 0 으로 채우지 않습니다 (AGENTS.md 규칙 5) */
export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value);
  return trimmed === '' ? null : trimmed;
}

/** 세는 값은 0 이 진짜 0 입니다. count(*) 는 행이 없어도 0 을 냅니다 */
export function count(value: unknown): number {
  return num(value) ?? 0;
}

/** 모르는 값을 false 로 접지 않습니다. PostgREST 는 boolean 을 true/false 로 내려 줍니다 */
export function bool(value: unknown): boolean {
  return value === true || value === 'true' || value === 't';
}

function statusOf(value: unknown): SimulationRun['status'] {
  switch (value) {
    case 'RUNNING':
    case 'SUCCESS':
    case 'FAILED':
      return value;
    default:
      return 'FAILED';
  }
}

export function normalizeSimulationRun(row: Record<string, unknown>): SimulationRun {
  return {
    simulationId: String(row.simulation_id ?? ''),
    forecastRunId: text(row.forecast_run_id),
    backtestRunId: text(row.backtest_run_id),
    simStart: text(row.sim_start),
    simEnd: text(row.sim_end),
    status: statusOf(row.status),
    nItems: count(row.n_items),
    actualStockoutMonths: num(row.actual_stockout_months),
    simStockoutMonths: num(row.sim_stockout_months),
    prevented: num(row.prevented),
    actualAvgInventory: num(row.actual_avg_inventory),
    simAvgInventory: num(row.sim_avg_inventory),
    inventoryChangePct: num(row.inventory_change_pct),
    actualOrders: num(row.actual_orders),
    simOrders: num(row.sim_orders),
    excessOrdersActual: num(row.excess_orders_actual),
    excessOrdersSim: num(row.excess_orders_sim),
    actualTurnover: num(row.actual_turnover),
    simTurnover: num(row.sim_turnover),
    skippedItems: num(row.skipped_items),
    openingClampedItems: num(row.opening_clamped_items),
    windowTruncated: num(row.window_truncated),
    pipelineSeedRows: num(row.pipeline_seed_rows),
    pipelineSeedUnmatched: num(row.pipeline_seed_unmatched),
    sentence: text(row.sentence),
    startedAt: text(row.started_at),
    finishedAt: text(row.finished_at),
    durationMs: num(row.duration_ms),
    triggeredEmail: text(row.triggered_email),
    note: text(row.note),
    message: text(row.message),
  };
}

export function normalizeSimulationItem(row: Record<string, unknown>): SimulationItem {
  return {
    simulationId: String(row.simulation_id ?? ''),
    itemId: String(row.item_id ?? ''),
    itemName: text(row.item_name),
    actualStockouts: count(row.actual_stockouts),
    simStockouts: count(row.sim_stockouts),
    actualAvgInv: num(row.actual_avg_inv),
    simAvgInv: num(row.sim_avg_inv),
    actualOrders: count(row.actual_orders),
    simOrders: count(row.sim_orders),
    actualOrderLines: count(row.actual_order_lines),
    actualExcessOrders: count(row.actual_excess_orders),
    simExcessOrders: count(row.sim_excess_orders),
    demand: num(row.demand),
  };
}

export function normalizeSimulationSeries(row: Record<string, unknown>): SimulationSeries {
  return {
    itemId: String(row.item_id ?? ''),
    itemName: text(row.item_name),
    period: String(row.period ?? ''),
    actualClosing: num(row.actual_closing),
    simClosing: num(row.sim_closing),
    actualReceipt: num(row.actual_receipt),
    simReceipt: num(row.sim_receipt),
    demand: num(row.demand),
    actualStockout: bool(row.actual_stockout),
    simStockout: bool(row.sim_stockout),
    simOrderQty: num(row.sim_order_qty),
    simSafetyStock: num(row.sim_safety_stock),
    simForecastWindow: num(row.sim_forecast_window),
  };
}

export function normalizeSimulationTotals(row: Record<string, unknown>): SimulationTotals {
  return {
    period: String(row.period ?? ''),
    actualTotalInventory: num(row.actual_total_inventory),
    simTotalInventory: num(row.sim_total_inventory),
    actualStockoutItems: count(row.actual_stockout_items),
    simStockoutItems: count(row.sim_stockout_items),
    demand: num(row.demand),
  };
}

/** 2025-01-01 → 2025-01. 차트 x축과 표에 같은 표기를 씁니다 */
export function monthOf(period: string): string {
  return period.slice(0, 7);
}

/**
 * 실제 대비 증감 방향. KPI 카드의 delta 가 씁니다 (design.md §6.4).
 *
 * "좋아졌는가" 가 아니라 "늘었는가 줄었는가" 만 말합니다.
 * 결품은 줄어야 좋고 회전율은 늘어야 좋으므로, 해석은 화면이 문구로 합니다.
 */
export function deltaDirection(sim: number | null, actual: number | null): 'up' | 'down' | 'flat' {
  if (sim === null || actual === null) return 'flat';
  if (sim > actual) return 'up';
  if (sim < actual) return 'down';
  return 'flat';
}
