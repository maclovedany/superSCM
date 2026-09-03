// 관리자 운영 모니터링 조회 — renew.prd 30.1 · 31.1 · 31.2 · 31.5 · 8.6
//
// 계산은 SQL 이 끝냈습니다 (sql/27-admin-ops.sql). 여기서는 조회와 정규화만 합니다.
// 타입 · 정규화 · 라벨은 lib/admin-ops-model.ts 에 있습니다.
//
// ★ 클라이언트 컴포넌트는 이 파일을 import 하지 마세요. 서버 전용 Supabase 클라이언트가
//   따라 들어옵니다. 타입이나 라벨이 필요하면 lib/admin-ops-model.ts 에서 가져오세요.
//
// PostgREST 는 한 번에 1,000행까지 돌려줍니다. 목록 조회는 limit 을 반드시 적습니다
// (공통규칙 §3-11). 뷰가 이미 자른 것도 한 번 더 적어 둡니다.

import { createSupabaseServerClient } from './supabase/server';
import {
  normalizeForecastRunDetail,
  normalizeModelVersion,
  normalizeOutlierExclusion,
  normalizeOutlierRule,
  normalizeStaleSummary,
  normalizeSystemLog,
  type ForecastRunDetailRow,
  type LogKind,
  type ModelVersionRow,
  type OutlierExclusionRow,
  type OutlierRuleRow,
  type StaleSummary,
  type SystemLogRow,
} from './admin-ops-model';

// 화면이 한 곳에서 가져다 쓰도록 순수 함수와 타입을 다시 내보냅니다.
export {
  LOG_KINDS,
  LOG_KIND_LABEL,
  OUTLIER_REASONS,
  OUTLIER_REASON_LABEL,
  RUN_MODES,
  RUN_MODE_DESC,
  RUN_MODE_LABEL,
  detailSummary,
  isIsoDate,
  isOutlierReason,
  logKindLabel,
  outlierReasonLabel,
  parameterSummary,
  runModeLabel,
  staleSentence,
  toLogKind,
  toRunMode,
  type ForecastRunDetailRow,
  type LogKind,
  type ModelVersionRow,
  type OutlierExclusionRow,
  type OutlierReason,
  type OutlierRuleRow,
  type RunMode,
  type StaleSummary,
  type SystemLogRow,
} from './admin-ops-model';

function failure(error: unknown): string {
  return error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.';
}

/**
 * 모델 버전 목록 — renew.prd 31.2.
 *
 * 최근 만든 버전이 위입니다. 버전은 실행할 때마다 `on conflict do nothing` 으로
 * 쌓이므로 모델 수만큼만 늘어납니다.
 */
export async function getModelVersions(limit = 200): Promise<{
  rows: ModelVersionRow[];
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_model_version')
      .select('*')
      .order('created_at', { ascending: false })
      .order('model_id')
      .limit(limit);

    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeModelVersion(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/**
 * 실행 하나의 상세 — 모델 하나가 한 줄입니다.
 *
 * 결과가 한 행도 없는 실패 실행도 한 줄은 나옵니다 (모델 컬럼이 전부 null).
 * 행이 하나도 없으면 그 run_id 가 없는 것입니다.
 */
export async function getForecastRunDetail(runId: string): Promise<{
  rows: ForecastRunDetailRow[];
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_forecast_run_detail')
      .select('*')
      .eq('run_id', runId)
      .order('model_id')
      .limit(50);

    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeForecastRunDetail(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/**
 * 통합 로그 — renew.prd 31.1.
 *
 * 뷰가 이미 최근 1,000건으로 잘라 두었습니다. 갈래 필터와 검색은 그 1,000건 안에서
 * 걸립니다 — 화면에도 그렇게 적습니다. 검색은 뷰가 만든 search_text 한 컬럼을 봅니다
 * (여러 컬럼을 or 로 잇지 않습니다. 조건이 늘 때마다 화면이 SQL 을 흉내내게 됩니다).
 *
 * ★ 관리자에게만 행이 나옵니다. 뷰 안에서 core.is_admin() 으로 막혀 있습니다.
 */
export async function getSystemLogs(
  kind?: LogKind | null,
  q?: string | null,
  limit = 300,
): Promise<{ rows: SystemLogRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    let query = supabase.schema('analytics').from('v_system_log').select('*');

    if (kind) query = query.eq('kind', kind);

    const needle = (q ?? '').trim();
    if (needle !== '') {
      // PostgREST 의 or/ilike 문법에서 쉼표와 괄호는 구분자입니다. 값에 섞이면
      // 필터가 깨지므로 검색어에서 뺍니다 (지우는 편이 조용히 오작동하는 것보다 낫습니다).
      const safe = needle.replace(/[,()*]/g, ' ').trim().toLowerCase();
      if (safe !== '') query = query.ilike('search_text', `%${safe}%`);
    }

    const { data, error } = await query.order('at', { ascending: false }).limit(limit);

    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeSystemLog(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/**
 * stale 요약 — 항상 한 줄입니다 (renew.prd 8.6).
 *
 * `data` 가 null 이면 조회에 실패했거나 sql/27 을 아직 실행하지 않은 것입니다.
 * 그때 배너는 아무것도 그리지 않습니다 — 모르는 것을 경고로 올리지 않습니다.
 */
export async function getStaleSummary(): Promise<{
  data: StaleSummary | null;
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_stale_summary')
      .select('*')
      .maybeSingle();

    if (error) return { data: null, error: error.message };
    if (!data) return { data: null, error: null };
    return { data: normalizeStaleSummary(data as Record<string, unknown>), error: null };
  } catch (error) {
    return { data: null, error: failure(error) };
  }
}

/** 이상치 규칙 — renew.prd 12.3 */
export async function getOutlierRules(limit = 200): Promise<{
  rows: OutlierRuleRow[];
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_outlier_rule')
      .select('*')
      .order('rule_id')
      .limit(limit);

    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeOutlierRule(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/** 학습에서 실제로 뺀 행 — 최근 것이 위입니다 */
export async function getOutlierExclusions(limit = 300): Promise<{
  rows: OutlierExclusionRow[];
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_outlier_exclusion')
      .select('*')
      .order('excluded_at', { ascending: false })
      .limit(limit);

    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeOutlierExclusion(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}
