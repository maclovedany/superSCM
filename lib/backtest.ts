// 백테스트와 Champion 조회 — renew.prd 13장 · 14장

import { createSupabaseServerClient } from './supabase/server';

export type ModelPerformance = {
  modelId: string;
  modelName: string | null;
  itemId: string;
  itemName: string | null;
  periods: number;
  actualSum: number | null;
  wape: number | null;
  mape: number | null;
  bias: number | null;
  rmse: number | null;
  mae: number | null;
  baselineImprovement: number | null;
  metricValue: number | null;
  rank: number | null;
  reason: string | null;
  isChampion: boolean;
};

export type ChampionModel = {
  itemId: string;
  itemName: string | null;
  championModelId: string | null;
  modelName: string | null;
  championMetric: string | null;
  metricValue: number | null;
  wape: number | null;
  bias: number | null;
  rmse: number | null;
  baselineImprovement: number | null;
  selectionMethod: 'AUTO' | 'MANUAL';
  reason: string | null;
  selectedAt: string | null;
  demandType: string | null;
  candidateCount: number;
};

export type BacktestKpi = {
  champions: number;
  manual: number;
  avgWape: number | null;
  avgAbsBias: number | null;
  betterThanBaseline: number;
  runs: number;
  lastRunAt: string | null;
};

export type SeriesRow = { itemId: string; period: string; quantity: number | null; segment: 'TRAIN' | 'TEST' };

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getChampions(): Promise<{ rows: ChampionModel[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_champion_model')
      .select('*')
      .order('metric_value', { ascending: true, nullsFirst: false });

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => {
      const row = item as Record<string, unknown>;
      const candidates = Array.isArray(row.candidates) ? row.candidates : [];
      return {
        itemId: String(row.item_id ?? ''),
        itemName: (row.item_name as string | null) ?? null,
        championModelId: (row.champion_model_id as string | null) ?? null,
        modelName: (row.model_name as string | null) ?? null,
        championMetric: (row.champion_metric as string | null) ?? null,
        metricValue: num(row.metric_value),
        wape: num(row.wape),
        bias: num(row.bias),
        rmse: num(row.rmse),
        baselineImprovement: num(row.baseline_improvement),
        selectionMethod: row.selection_method === 'MANUAL' ? ('MANUAL' as const) : ('AUTO' as const),
        reason: (row.reason as string | null) ?? null,
        selectedAt: (row.selected_at as string | null) ?? null,
        demandType: (row.demand_type as string | null) ?? null,
        candidateCount: candidates.length,
      };
    });
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}

export async function getBacktestKpi(): Promise<{ data: BacktestKpi | null; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_backtest_kpi')
      .select('*')
      .maybeSingle();

    if (error) return { data: null, error: error.message };
    if (!data) return { data: null, error: null };

    const row = data as Record<string, unknown>;
    return {
      data: {
        champions: num(row.n_champions) ?? 0,
        manual: num(row.n_manual) ?? 0,
        avgWape: num(row.avg_wape),
        avgAbsBias: num(row.avg_abs_bias),
        betterThanBaseline: num(row.n_better_than_baseline) ?? 0,
        runs: num(row.n_runs) ?? 0,
        lastRunAt: (row.last_run_at as string | null) ?? null,
      },
      error: null,
    };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}

/** 한 품목의 모델별 성능. Model Comparison 의 비교표가 씁니다 */
export async function getItemPerformance(
  itemId: string,
): Promise<{ rows: ModelPerformance[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_model_performance')
      .select('*')
      .eq('item_id', itemId)
      .order('rank', { ascending: true, nullsFirst: false });

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => {
      const row = item as Record<string, unknown>;
      return {
        modelId: String(row.model_id ?? ''),
        modelName: (row.model_name as string | null) ?? null,
        itemId: String(row.item_id ?? ''),
        itemName: (row.item_name as string | null) ?? null,
        periods: num(row.n_periods) ?? 0,
        actualSum: num(row.actual_sum),
        wape: num(row.wape),
        mape: num(row.mape),
        bias: num(row.bias),
        rmse: num(row.rmse),
        mae: num(row.mae),
        baselineImprovement: num(row.baseline_improvement),
        metricValue: num(row.metric_value),
        rank: num(row.rank),
        reason: (row.reason as string | null) ?? null,
        isChampion: row.is_champion === true,
      };
    });
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}

/** 한 품목의 실적 시계열 (학습 + 검증) */
export async function getItemSeries(
  itemId: string,
): Promise<{ rows: SeriesRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_item_series')
      .select('*')
      .eq('item_id', itemId)
      .order('period');

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => {
      const row = item as Record<string, unknown>;
      return {
        itemId: String(row.item_id ?? ''),
        period: String(row.period ?? ''),
        quantity: num(row.quantity),
        segment: row.segment === 'TEST' ? ('TEST' as const) : ('TRAIN' as const),
      };
    });
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}
