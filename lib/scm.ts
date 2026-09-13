// 화면과 Agent 툴이 쓰는 조회 함수 모음.
//
// ★ 여기 있는 모든 함수는 analytics 스키마의 뷰만 읽습니다. raw · core 를 직접 읽지
//   않습니다. 뷰가 업무 규칙을 이미 한 번 적용해 두었기 때문입니다.
// ★ 예외를 던지지 않습니다. { rows, error } 로 돌려주고 화면이 error 를 그립니다.
//
// 2026-09-10 실데이터 이관 — 5회차 더미 뷰(v_sku_demand_profile · v_stockout_risk ·
// v_leadtime_gap)는 더 이상 읽지 않습니다. 실데이터에는 재고와 리드타임이 없고,
// 수요 프로파일은 v_item_demand_profile 이 대신합니다 (07-deprecate-and-agent.sql).
//
// ★ 1,000행 상한을 다루는 규칙(잘림 · count · 상한 명시)은 lib/scm-big-views.ts 머리에
//   있습니다. 그 규칙이 적용되는 다섯 조회가 그 파일에 살기 때문입니다 — 규칙을 코드에서
//   떼어 두 곳에 적어 두면 한쪽만 낡습니다.

import { createSupabaseServerClient } from './supabase';

// 1,000행 상한에 걸리는 큰 뷰 다섯 조회는 lib/scm-big-views.ts 에 있습니다.
//
// ★ 왜 따로 있나 — 그 파일은 supabase 를 **정적으로** 부르지 않아 node --test 가 import 할 수
//   있고, 가짜 클라이언트를 끼워 "질의가 정말 count 를 요청하는가 · total 이 정말 그 count
//   에서 오는가" 를 시험할 수 있습니다. 이 파일은 아래에서 './inventory/repository' 를 다시
//   내보내는데 그 끝에 'next/headers' 가 있어(node --test 에서 해석 불가) 시험이 못 읽습니다.
// ★ 부르는 쪽은 예전 그대로 lib/scm.ts 에서 가져다 씁니다.
export {
  getBomRequirements,
  getItemDemandProfileByItem,
  getItemDemandProfiles,
  getShipmentTrendByItem,
  getShipmentTrends,
  type ListResult,
} from './scm-big-views';
import {
  isSourceStatus,
  normalizeBacktestPerformanceSummary,
  normalizeBacktestRun,
  normalizeChampionModel,
  normalizeForecastModelConfig,
  normalizeForecastRun,
  normalizeItemDemandKpi,
  normalizeOlAccuracy,
  normalizeOlAccuracyFy,
  type BacktestPerformanceSummary,
  type BacktestRun,
  type ChampionModel,
  type ForecastModelConfig,
  type ForecastRun,
  type ItemDemandKpi,
  type OlAccuracy,
  type OlAccuracyFy,
  type SourceStatus,
} from './scm-model';

/** 품목 구분별 수요 유형 분포 */
export async function getItemDemandKpi(): Promise<{ rows: ItemDemandKpi[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('analytics').from('v_item_demand_kpi').select('*').order('item_type');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeItemDemandKpi(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : '수요 유형 요약을 조회하지 못했습니다.' };
  }
}

/** OL 예측 정확도 — 기종 × 회계연도 */
export async function getOlAccuracy(): Promise<{ rows: OlAccuracy[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_ol_accuracy')
      .select('*')
      .order('fy_sheet')
      .order('model_base');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeOlAccuracy(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'OL 정확도를 조회하지 못했습니다.' };
  }
}

/** OL 예측 정확도 — 회계연도 합 */
export async function getOlAccuracyFy(): Promise<{ rows: OlAccuracyFy[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('analytics').from('v_ol_accuracy_fy').select('*').order('fy_sheet');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeOlAccuracyFy(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'OL 정확도 요약을 조회하지 못했습니다.' };
  }
}

// Task 4 — 정상 창고재고와 가용재고. 실제 구현은 lib/inventory/repository.ts에 있습니다.
// 화면과 (앞으로 추가될) Agent 툴이 같은 조회 함수를 쓰도록 여기서도 다시 내보냅니다.
export { getAvailableStock, getOrderAvailableStock } from './inventory/repository';

// Task 15 fix round 2 — STEP 6·7 실행 이력 화면(admin/forecast-runs · backtest-runs · champion-models ·
// forecast-models). 6회차 실데이터 전용 Forecast 엔진은 없지만, STEP 6 SQL Baseline · STEP 7 Backtest
// 파이프라인이 실제로 만든 실행 이력은 있다 — 그 이력을 그대로 보여준다.

/** Forecast 실행 이력 — analytics.v_forecast_run. 최신 실행이 먼저 온다 */
export async function getForecastRuns(): Promise<{ rows: ForecastRun[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_forecast_run')
      .select('*')
      .order('started_at', { ascending: false });
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeForecastRun(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Forecast 실행 이력을 조회하지 못했습니다.' };
  }
}

/** 예측 모델 registry — analytics.v_model_config. 실습 데이터와 무관하게 항상 채워진다 */
export async function getForecastModelConfigs(): Promise<{ rows: ForecastModelConfig[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('analytics').from('v_model_config').select('*').order('model_id');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeForecastModelConfig(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : '예측 모델 registry를 조회하지 못했습니다.' };
  }
}

/** Backtest 실행 이력 — analytics.v_backtest_run. 최신 실행이 먼저 온다 */
export async function getBacktestRuns(): Promise<{ rows: BacktestRun[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_backtest_run')
      .select('*')
      .order('started_at', { ascending: false });
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeBacktestRun(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Backtest 실행 이력을 조회하지 못했습니다.' };
  }
}

/**
 * Backtest 실행별 채점 요약 — analytics.v_backtest_performance_summary(fix round 1,
 * 20260912000700). 개수 · WAPE 최솟값·최댓값을 SQL이 이미 집계해 둔 열을 그대로 옮긴다 — 화면도
 * 이 함수도 원본 행을 훑어 다시 계산하지 않는다.
 */
export async function getBacktestPerformanceSummaries(backtestRunIds: string[]): Promise<{ rows: BacktestPerformanceSummary[]; error: string | null }> {
  if (backtestRunIds.length === 0) return { rows: [], error: null };
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_backtest_performance_summary')
      .select('*')
      .in('backtest_run_id', backtestRunIds);
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeBacktestPerformanceSummary(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Backtest 채점 요약을 조회하지 못했습니다.' };
  }
}

/**
 * Forecast Run별 원천 게이트 판정 — fix round 1(20260912000700). core.procurement_forecast_source_status는
 * 발주계획 생성 로직 내부 전용이라 authenticated에도 EXECUTE가 없다. 대신 core.is_admin()으로 막은
 * 읽기 전용 래퍼 core.forecast_run_source_status_for_admin(uuid[])를 부른다 — 판정 로직은 원본 함수가
 * 그대로 하고, 이 함수는 결과를 한 번에 받아오기만 한다.
 *
 * ★ 이 마이그레이션이 아직 적용되지 않은 환경(함수가 없음)이면 RPC가 42883으로 실패한다 — 그 경우
 *   화면은 빈 Map을 받고 각 행에 EmptyValue를 그대로 보여준다(화면이 깨지지 않는다).
 */
export async function getForecastRunSourceStatuses(runIds: string[]): Promise<{ statuses: Map<string, SourceStatus>; error: string | null }> {
  const statuses = new Map<string, SourceStatus>();
  if (runIds.length === 0) return { statuses, error: null };
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('forecast_run_source_status_for_admin', { p_run_ids: runIds });
    if (error) return { statuses, error: error.message };
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const runId = row.run_id === null || row.run_id === undefined ? null : String(row.run_id);
      if (runId && isSourceStatus(row.source_status)) statuses.set(runId, row.source_status);
    }
    return { statuses, error: null };
  } catch (error) {
    return { statuses, error: error instanceof Error ? error.message : '원천 게이트 판정을 조회하지 못했습니다.' };
  }
}

/** 품목별 현재 Champion 모델 — analytics.v_champion_model(품목당 최신 선정 1행) */
export async function getChampionModels(): Promise<{ rows: ChampionModel[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('analytics').from('v_champion_model').select('*').order('item_id');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeChampionModel(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Champion 모델을 조회하지 못했습니다.' };
  }
}
