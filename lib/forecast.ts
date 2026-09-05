// 예측 모델과 실행 이력 조회 — renew.prd 11장 · 12장

import { createSupabaseServerClient } from './supabase/server';
import type { SupabaseServerClient } from './supabase/service';
import type { DemandType } from './demand-profile';
import { toRunMode, type RunMode } from './admin-ops-model';

export type { RunMode } from './admin-ops-model';

export type ModelConfig = {
  modelId: string;
  modelName: string;
  family: 'BASELINE' | 'TIMESERIES' | 'INTERMITTENT' | 'ML';
  engine: 'SQL' | 'PYTHON';
  version: string;
  enabled: boolean;
  isDefault: boolean;
  /** null 이면 모든 수요 유형에 적용합니다 */
  applicableDemandType: DemandType[] | null;
  parameters: Record<string, unknown>;
  description: string | null;
  updatedAt: string | null;
  versionCount: number;
};

export type ForecastRun = {
  runId: string;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  /**
   * 실행 모드 — sql/27-admin-ops.sql 이 더한 컬럼.
   *   VALIDATION  train_end 까지 학습 → 검증 구간 예측 (백테스트가 채점)
   *   PRODUCTION  production_train_end 까지 학습 → 오늘 이후 예측 (화면이 씁니다)
   * sql/27 을 아직 적용하지 않은 DB 에서는 null 입니다. 그때 화면은 배지를 그리지 않습니다 —
   * 모르는 것을 '검증' 으로 단정하지 않습니다.
   */
  mode: RunMode | null;
  granularity: string;
  trainStart: string | null;
  trainEnd: string | null;
  horizon: number;
  dataSnapshotAt: string | null;
  nModels: number;
  nItems: number;
  nRows: number;
  resultRows: number;
  startedAt: string | null;
  durationMs: number | null;
  triggeredEmail: string | null;
  note: string | null;
  message: string | null;
  /** 실행 이후 원본 데이터가 바뀌었는가 (renew.prd 8.6) */
  isStale: boolean;
};

export type ForecastRunKpi = {
  runs: number;
  success: number;
  failed: number;
  enabledModels: number;
  models: number;
  lastRunAt: string | null;
  stale: number;
};

/** analytics.v_forecast_run 한 줄. 조회 함수 둘이 같은 모양을 내도록 한 곳에 둡니다 */
function normalizeForecastRun(row: Record<string, unknown>): ForecastRun {
  return {
    runId: String(row.run_id ?? ''),
    status: (row.status as ForecastRun['status']) ?? 'FAILED',
    mode: toRunMode(row.mode),
    granularity: String(row.granularity ?? 'MONTH'),
    trainStart: (row.train_start as string | null) ?? null,
    trainEnd: (row.train_end as string | null) ?? null,
    horizon: num(row.horizon) ?? 0,
    dataSnapshotAt: (row.data_snapshot_at as string | null) ?? null,
    nModels: num(row.n_models) ?? 0,
    nItems: num(row.n_items) ?? 0,
    nRows: num(row.n_rows) ?? 0,
    resultRows: num(row.result_rows) ?? 0,
    startedAt: (row.started_at as string | null) ?? null,
    durationMs: num(row.duration_ms),
    triggeredEmail: (row.triggered_email as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    message: (row.message as string | null) ?? null,
    isStale: row.is_stale === true,
  };
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getModelConfigs(): Promise<{ rows: ModelConfig[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_model_config')
      .select('*')
      .order('family')
      .order('model_id');

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => {
      const row = item as Record<string, unknown>;
      return {
        modelId: String(row.model_id ?? ''),
        modelName: String(row.model_name ?? ''),
        family: (row.family as ModelConfig['family']) ?? 'BASELINE',
        engine: row.engine === 'PYTHON' ? ('PYTHON' as const) : ('SQL' as const),
        version: String(row.version ?? 'v1'),
        enabled: row.enabled === true,
        isDefault: row.is_default === true,
        applicableDemandType: Array.isArray(row.applicable_demand_type)
          ? (row.applicable_demand_type as DemandType[])
          : null,
        parameters: (row.parameters as Record<string, unknown>) ?? {},
        description: (row.description as string | null) ?? null,
        updatedAt: (row.updated_at as string | null) ?? null,
        versionCount: num(row.version_count) ?? 0,
      };
    });
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}

export async function getForecastRuns(
  client?: SupabaseServerClient,
): Promise<{ rows: ForecastRun[]; error: string | null }> {
  try {
    const supabase = client ?? (await createSupabaseServerClient());
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_forecast_run')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(50);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => normalizeForecastRun(item as Record<string, unknown>));
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}

export async function getForecastRunKpi(): Promise<{
  data: ForecastRunKpi | null;
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_forecast_run_kpi')
      .select('*')
      .maybeSingle();

    if (error) return { data: null, error: error.message };
    if (!data) return { data: null, error: null };

    const row = data as Record<string, unknown>;
    return {
      data: {
        runs: num(row.n_runs) ?? 0,
        success: num(row.n_success) ?? 0,
        failed: num(row.n_failed) ?? 0,
        enabledModels: num(row.n_enabled_models) ?? 0,
        models: num(row.n_models) ?? 0,
        lastRunAt: (row.last_run_at as string | null) ?? null,
        stale: num(row.n_stale) ?? 0,
      },
      error: null,
    };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}

// ── 예측 결과 조회 ────────────────────────────────────────────

export type RunModel = {
  runId: string;
  modelId: string;
  modelName: string | null;
  family: string | null;
  rows: number;
  items: number;
  totalQty: number | null;
};

export type ForecastSummary = {
  modelId: string;
  itemId: string;
  itemName: string | null;
  periods: number;
  firstPeriod: string | null;
  lastPeriod: string | null;
  totalQty: number | null;
  avgQty: number | null;
  sigma: number | null;
  p80Margin: number | null;
};

export type ForecastPoint = {
  modelId: string;
  period: string;
  predictedQty: number | null;
  p50: number | null;
  p80: number | null;
  p90: number | null;
};

/**
 * 화면이 쓰는 실행 하나.
 *
 * ★ 고르는 규칙은 core.v_ai_forecast(최종 정의는 sql/27-admin-ops.sql §4)와 같습니다 —
 *   운영(PRODUCTION) 성공 실행이 있으면 그중 가장 최근 것, 없으면 가장 최근 성공 실행.
 *   여기서 다르게 고르면 화면 머리의 실행 ID 와 화면 숫자가 서로 다른 실행을 가리킵니다
 *   (검증 실행을 운영 실행 뒤에 한 번 더 돌리면 바로 그렇게 됩니다).
 *
 * ★ 목록을 받아 와 고르지 않고 **DB 에 두 번 묻습니다** (STEP 20 수정 라운드 1).
 *   getForecastRuns() 는 최근 50건만 가져오므로, 마지막 운영 실행 이후 실행이 50건 넘게
 *   쌓이면 그 목록에 운영 실행이 없어 화면이 검증 실행으로 조용히 내려앉습니다.
 *   정렬은 DB 가 합니다 — 앱은 순서를 다시 매기지 않습니다 (AGENTS.md 규칙 1).
 *   첫 질의가 비면(운영 실행이 아직 없으면) 두 번째가 답합니다.
 */
export async function getLatestSuccessfulRun(): Promise<ForecastRun | null> {
  const production = await pickRun({ mode: 'PRODUCTION' });
  if (production) return production;
  return pickRun({});
}

/**
 * 최근 성공한 **검증(VALIDATION)** 실행 — 모델 전부가 남아 있는 실행입니다.
 * 운영 실행은 저장 다이어트로 Champion · 기본 모델 행만 남으므로(sql/35 §2b), 모델을 나란히
 * 비교하는 화면(모델 비교 · 기종 예측)은 이 실행을 읽습니다.
 */
export async function getLatestValidationRun(): Promise<ForecastRun | null> {
  return pickRun({ mode: 'VALIDATION' });
}

/** 성공한 실행 중 가장 최근 한 건. mode 를 주면 그 모드 안에서 고릅니다 */
async function pickRun(filter: { mode?: RunMode }): Promise<ForecastRun | null> {
  try {
    const supabase = await createSupabaseServerClient();
    let query = supabase
      .schema('analytics')
      .from('v_forecast_run')
      .select('*')
      .eq('status', 'SUCCESS');

    if (filter.mode) query = query.eq('mode', filter.mode);

    const { data, error } = await query.order('started_at', { ascending: false }).limit(1);
    if (error) return null;

    const row = (data ?? [])[0] as Record<string, unknown> | undefined;
    return row ? normalizeForecastRun(row) : null;
  } catch {
    return null;
  }
}

export async function getRunModels(runId: string): Promise<{ rows: RunModel[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_forecast_run_model')
      .select('*')
      .eq('run_id', runId)
      .order('model_id');

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => {
      const row = item as Record<string, unknown>;
      return {
        runId: String(row.run_id ?? ''),
        modelId: String(row.model_id ?? ''),
        modelName: (row.model_name as string | null) ?? null,
        family: (row.family as string | null) ?? null,
        rows: num(row.n_rows) ?? 0,
        items: num(row.n_items) ?? 0,
        totalQty: num(row.total_qty),
      };
    });
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}

export async function getForecastSummary(
  runId: string,
  modelId: string,
  options: { q?: string | null; limit?: number } = {},
): Promise<{ rows: ForecastSummary[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    // 품목 11,000개 — 목록은 상한을 두고(기본 200) 검색어(q)로 좁힙니다. PostgREST 1,000행 상한 안입니다.
    const limit = options.limit ?? 200;
    let query = supabase
      .schema('analytics')
      .from('v_forecast_summary')
      .select('*')
      .eq('run_id', runId)
      .eq('model_id', modelId);
    const q = options.q?.trim();
    if (q && q.length >= 2) {
      const code = q.toUpperCase().replace(/[\s\-_]/g, '');
      query = query.or(`item_id.ilike.%${code}%,item_name.ilike.%${q}%`);
    }
    const { data, error } = await query
      .order('total_qty', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => {
      const row = item as Record<string, unknown>;
      return {
        modelId: String(row.model_id ?? ''),
        itemId: String(row.item_id ?? ''),
        itemName: (row.item_name as string | null) ?? null,
        periods: num(row.n_periods) ?? 0,
        firstPeriod: (row.first_period as string | null) ?? null,
        lastPeriod: (row.last_period as string | null) ?? null,
        totalQty: num(row.total_qty),
        avgQty: num(row.avg_qty),
        sigma: num(row.sigma),
        p80Margin: num(row.p80_margin),
      };
    });
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}

/** 한 품목의 기간별 예측. 모델을 모두 함께 가져와 나란히 비교합니다 */
export async function getForecastDetail(
  runId: string,
  itemId: string,
  client?: SupabaseServerClient,
): Promise<{ rows: ForecastPoint[]; error: string | null }> {
  try {
    const supabase = client ?? (await createSupabaseServerClient());
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_forecast_result')
      .select('model_id, period, predicted_qty, p50, p80, p90')
      .eq('run_id', runId)
      .eq('item_id', itemId)
      .order('period');

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => {
      const row = item as Record<string, unknown>;
      return {
        modelId: String(row.model_id ?? ''),
        period: String(row.period ?? ''),
        predictedQty: num(row.predicted_qty),
        p50: num(row.p50),
        p80: num(row.p80),
        p90: num(row.p90),
      };
    });
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}
