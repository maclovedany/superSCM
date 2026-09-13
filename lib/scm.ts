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
// ── 1,000행 상한을 다루는 규칙 (정합성 라운드, 2026-09-13) ──────────────────────
//
// PostgREST 는 응답 행 수에 상한이 있습니다. v_item_demand_profile · v_shipment_trend 는
// 2026-09-13 실측으로 각각 10,198행, v_bom_requirement_x 는 7,546행(기종 23개 중 2개가
// 1,000행 초과 — MDL227 3,285 · MDL213 1,978)이라 **필터 없이 부르면 조용히 잘립니다.**
//
// 그래서 이 파일의 큰 뷰 조회는 셋을 지킵니다.
//
//   ① 품목 하나를 묻는 경로는 `.eq()` 로 **DB 에서** 거릅니다. 잘린 배열을 훑지 않습니다
//      (getShipmentMonthlyByItem 의 선례와 같은 모양). 그래야 "목록에 없다" 가
//      "존재하지 않는다" 를 뜻하게 됩니다.
//   ② 목록 경로는 `count: 'exact'` 로 **전수**를 따로 받습니다. 반환 행이 잘려도 total 은
//      참입니다 — 전수는 반환 행 수와 다른 질문이기 때문입니다.
//   ③ count 를 받지 못하면 total 은 `rows.length` 가 아니라 **null** 입니다. 모르는 수를
//      반환 행 수로 채우면 그 순간 거짓이 사실 채널로 들어갑니다 (AGENTS.md 규칙 5).

/** 표가 한 번에 받는 최대 행 수 — 상한을 서버 기본값에 맡기지 않고 여기서 못박습니다.
 *  전량을 받으려면 가상화가 함께 와야 합니다(components/ui/data-table.tsx 는 전 행을 DOM 에
 *  그립니다). 가상화가 없는 동안에는 이 상한이 화면을 지킵니다. */
const TABLE_FETCH_LIMIT = 1000;

/** 목록 조회 결과 — total 은 잘림과 무관한 전수이고, 알 수 없으면 null 입니다 */
export type ListResult<T> = { rows: T[]; total: number | null; error: string | null };

import { createSupabaseServerClient } from './supabase';
import {
  isSourceStatus,
  normalizeBacktestPerformanceSummary,
  normalizeBacktestRun,
  normalizeBomRequirement,
  normalizeChampionModel,
  normalizeForecastModelConfig,
  normalizeForecastRun,
  normalizeItemDemandKpi,
  normalizeItemDemandProfile,
  normalizeOlAccuracy,
  normalizeOlAccuracyFy,
  normalizeShipmentTrend,
  type BacktestPerformanceSummary,
  type BacktestRun,
  type BomRequirement,
  type ChampionModel,
  type ForecastModelConfig,
  type ForecastRun,
  type ItemDemandKpi,
  type ItemDemandProfile,
  type OlAccuracy,
  type OlAccuracyFy,
  type ShipmentTrend,
  type SourceStatus,
} from './scm-model';

/**
 * 수요 성격 — Syntetos-Boylan 분류. 6개월 미만은 유형 null + reason_code.
 *
 * ★ 10,198행(2026-09-13 실측)이라 반환 행은 TABLE_FETCH_LIMIT 에서 잘립니다. total 은
 *   잘림과 무관한 전수입니다 — 화면은 이 둘을 구분해 보여야 합니다.
 * ★ 품목 하나를 찾을 때 이 함수를 부른 뒤 배열을 훑지 마세요. getItemDemandProfileByItem 을
 *   씁니다(잘린 배열에는 90% 의 품목이 없습니다).
 */
export async function getItemDemandProfiles(): Promise<ListResult<ItemDemandProfile>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error, count } = await supabase
      .schema('analytics')
      .from('v_item_demand_profile')
      .select('*', { count: 'exact' })
      .order('item_code')
      .limit(TABLE_FETCH_LIMIT);
    if (error) return { rows: [], total: null, error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeItemDemandProfile(row as Record<string, unknown>)),
      total: count ?? null,
      error: null,
    };
  } catch (error) {
    return { rows: [], total: null, error: error instanceof Error ? error.message : '수요 프로파일을 조회하지 못했습니다.' };
  }
}

/**
 * 품목 하나의 수요 성격 — analytics.v_item_demand_profile.
 *
 * ★ itemCode 는 선택 인자가 아닙니다. 거르기를 DB 에서 하기 때문에 0행은 "잘려서 안 보인다"
 *   가 아니라 **"이 뷰에 그 품목이 없다"** 를 뜻합니다 — 부르는 쪽이 UNKNOWN_ITEM 을
 *   사실로 말할 수 있는 유일한 모양입니다 (getShipmentMonthlyByItem 과 같은 이유).
 * ★ 품목당 1행이라 `rows.length` 도 오늘은 맞지만, 그것은 **우연한 정확성**입니다 — 방금
 *   고친 결함과 정확히 같은 모양이라 여기서도 count 로 셉니다. 뷰가 품목당 여러 행을 내는
 *   날이 와도 이 함수는 틀리지 않습니다.
 */
export async function getItemDemandProfileByItem(itemCode: string): Promise<ListResult<ItemDemandProfile>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error, count } = await supabase
      .schema('analytics')
      .from('v_item_demand_profile')
      .select('*', { count: 'exact' })
      .eq('item_code', itemCode)
      .order('item_code');
    if (error) return { rows: [], total: null, error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeItemDemandProfile(row as Record<string, unknown>)),
      total: count ?? null,
      error: null,
    };
  } catch (error) {
    return { rows: [], total: null, error: error instanceof Error ? error.message : '수요 프로파일을 조회하지 못했습니다.' };
  }
}

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

/**
 * 출고 추이 — XCN 합산 기준. 이동평균은 0인 달을 포함해 계산된 값입니다.
 *
 * ★ 10,198행(2026-09-13 실측)이라 반환 행은 출고량 상위 TABLE_FETCH_LIMIT 건에서 잘립니다.
 *   total 은 잘림과 무관한 전수입니다.
 * ★ 품목 하나를 찾을 때는 getShipmentTrendByItem 을 씁니다.
 */
export async function getShipmentTrends(): Promise<ListResult<ShipmentTrend>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error, count } = await supabase
      .schema('analytics')
      .from('v_shipment_trend')
      .select('*', { count: 'exact' })
      .order('total_qty', { ascending: false, nullsFirst: false })
      .limit(TABLE_FETCH_LIMIT);
    if (error) return { rows: [], total: null, error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeShipmentTrend(row as Record<string, unknown>)),
      total: count ?? null,
      error: null,
    };
  } catch (error) {
    return { rows: [], total: null, error: error instanceof Error ? error.message : '출고 추이를 조회하지 못했습니다.' };
  }
}

/**
 * 품목 하나의 출고 추이 — analytics.v_shipment_trend.
 *
 * ★ 거르기를 DB 에서 합니다. 출고량 상위 1,000건 밖의 품목(실측 9,198개, 90.2%)은 목록
 *   조회로는 영영 보이지 않습니다 — 예: 589K39896 은 출고량 7.0 이라 상위 1,000건 밖입니다
 *   (7.0 동률이 229품목이라 순위는 4,894~5,122 구간이고 한 값으로 말할 수 없습니다).
 * ★ 품목당 1행이라 `rows.length` 도 오늘은 맞지만 그것은 **우연한 정확성**입니다 —
 *   getItemDemandProfileByItem 과 같은 이유로 여기서도 count 로 셉니다.
 */
export async function getShipmentTrendByItem(itemCode: string): Promise<ListResult<ShipmentTrend>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error, count } = await supabase
      .schema('analytics')
      .from('v_shipment_trend')
      .select('*', { count: 'exact' })
      .eq('item_code', itemCode)
      .order('total_qty', { ascending: false, nullsFirst: false });
    if (error) return { rows: [], total: null, error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeShipmentTrend(row as Record<string, unknown>)),
      total: count ?? null,
      error: null,
    };
  } catch (error) {
    return { rows: [], total: null, error: error instanceof Error ? error.message : '출고 추이를 조회하지 못했습니다.' };
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

/**
 * BOM 소요 — 기종 1대를 팔려면 무엇이 몇 개 필요한가.
 *
 * ★ 이미 model_base 로 거르지만 그것만으로는 부족합니다 — 기종 23개 중 2개가 1,000행을
 *   넘습니다(2026-09-13 실측: MDL227 3,285 · MDL213 1,978). 그 둘에서는 반환 행이 잘리므로
 *   total 을 `rows.length` 로 세면 틀립니다. count 로 따로 받습니다.
 */
export async function getBomRequirements(modelBase: string): Promise<ListResult<BomRequirement>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error, count } = await supabase
      .schema('analytics')
      .from('v_bom_requirement_x')
      .select('*', { count: 'exact' })
      .eq('model_base', modelBase)
      .order('part_role')
      .order('item_code')
      .limit(TABLE_FETCH_LIMIT);
    if (error) return { rows: [], total: null, error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeBomRequirement(row as Record<string, unknown>)),
      total: count ?? null,
      error: null,
    };
  } catch (error) {
    return { rows: [], total: null, error: error instanceof Error ? error.message : 'BOM 소요를 조회하지 못했습니다.' };
  }
}

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
