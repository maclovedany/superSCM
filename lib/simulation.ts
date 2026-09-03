// 가상 운영 결과 조회 — renew.prd 13.2
//
// 계산은 SQL 이 끝냈습니다. 여기서는 조회와 정규화만 합니다 (AGENTS.md 규칙 2).
// 타입과 정규화 함수는 lib/simulation-model.ts 에 있습니다 (테스트가 그쪽만 봅니다).

import { createSupabaseServerClient } from './supabase/server';
import {
  normalizeSimulationItem,
  normalizeSimulationRun,
  normalizeSimulationSeries,
  normalizeSimulationTotals,
  type SimulationItem,
  type SimulationRun,
  type SimulationSeries,
  type SimulationTotals,
} from './simulation-model';

export type {
  SimulationItem,
  SimulationRun,
  SimulationSeries,
  SimulationTotals,
} from './simulation-model';

/** 실행 이력. 최근 순 */
export async function getSimulationRuns(
  limit = 20,
): Promise<{ rows: SimulationRun[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_simulation_run')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeSimulationRun(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return {
      rows: [],
      error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.',
    };
  }
}

/** 가장 최근에 성공한 시뮬레이션. 화면의 기준입니다 */
export async function getLatestSimulation(): Promise<{
  data: SimulationRun | null;
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_simulation_run')
      .select('*')
      .eq('status', 'SUCCESS')
      .order('started_at', { ascending: false })
      .limit(1);

    if (error) return { data: null, error: error.message };

    const row = (data ?? [])[0];
    return {
      data: row ? normalizeSimulationRun(row as Record<string, unknown>) : null,
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.',
    };
  }
}

/** 품목별 실제 vs 시뮬 요약 */
export async function getSimulationItems(
  simulationId: string,
): Promise<{ rows: SimulationItem[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_simulation_item')
      .select('*')
      .eq('simulation_id', simulationId)
      .order('item_id')
      .limit(500);

    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeSimulationItem(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return {
      rows: [],
      error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.',
    };
  }
}

/** 한 품목의 기간별 추이. 품목을 지정하지 않으면 빈 배열입니다 */
export async function getSimulationSeries(
  simulationId: string,
  itemId: string,
): Promise<{ rows: SimulationSeries[]; error: string | null }> {
  if (!itemId) return { rows: [], error: null };
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_simulation_series')
      .select('*')
      .eq('simulation_id', simulationId)
      .eq('item_id', itemId)
      .order('period')
      .limit(120);

    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeSimulationSeries(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return {
      rows: [],
      error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.',
    };
  }
}

/** 전 품목 합 재고 추이. 상단 비교 차트가 씁니다 */
export async function getSimulationTotals(
  simulationId: string,
): Promise<{ rows: SimulationTotals[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_simulation_totals')
      .select('*')
      .eq('simulation_id', simulationId)
      .order('period')
      .limit(120);

    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeSimulationTotals(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return {
      rows: [],
      error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.',
    };
  }
}
