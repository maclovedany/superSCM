// Forecast Override · Consensus · Forecast Value Add 조회 — renew.prd 17장
//
// 계산은 SQL 이 끝냈습니다. 여기서는 조회와 정규화만 합니다 (AGENTS.md 규칙 2).
// 타입 · 사유 코드 · 정규화 함수는 lib/override-model.ts 에 있습니다.
//
// ★ 클라이언트 컴포넌트는 이 파일을 import 하지 마세요. 서버 전용 Supabase 클라이언트가
//   따라 들어옵니다. 사유 코드가 필요하면 lib/override-model.ts 에서 직접 가져오세요.
//
// PostgREST 는 한 번에 1,000행까지 돌려줍니다. 목록 조회는 limit 을 반드시 적습니다 (공통규칙 11).

import { createSupabaseServerClient } from './supabase/server';
import { getConsensusForecast } from './recommendation';
import type { ConsensusRow } from './recommendation-model';
import {
  normalizeOverrideExcess,
  normalizeOverrideRow,
  normalizeValueAddByReason,
  normalizeValueAddRow,
  normalizeValueAddSummary,
  type OverrideExcess,
  type OverrideRow,
  type ValueAddByReason,
  type ValueAddRow,
  type ValueAddSummary,
} from './override-model';

// 사유 코드는 모델 파일에 있습니다. 서버 코드가 한 곳에서 가져다 쓰도록 다시 내보냅니다.
export {
  REASON_CODES,
  isOverrideReasonCode,
  reasonLabel,
  requiresReasonText,
  type OverrideReasonCode,
} from './override-model';

function failure(error: unknown): string {
  return error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.';
}

/**
 * Override 입력 이력 — analytics.v_forecast_override.
 *
 * 최근 입력이 위입니다. itemId 를 주면 그 품목만 봅니다.
 * 유효한 행과 대체된 행을 함께 돌려줍니다 — is_active 로 구분합니다.
 */
export async function getOverrides(itemId?: string): Promise<{
  rows: OverrideRow[];
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    let query = supabase.schema('analytics').from('v_forecast_override').select('*');

    if (itemId) query = query.eq('item_id', itemId);

    const { data, error } = await query
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(200);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => normalizeOverrideRow(item as Record<string, unknown>));
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/**
 * 한 품목의 기간별 Consensus — analytics.v_consensus_forecast.
 *
 * lib/recommendation.ts 의 getConsensusForecast 와 같은 뷰를 같은 순서로 읽습니다.
 * 정규화를 두 벌 두면 컬럼이 바뀔 때 한쪽만 고쳐지므로, 여기서는 그 함수를 그대로 부릅니다.
 */
export async function getConsensus(itemId: string): Promise<{
  rows: ConsensusRow[];
  error: string | null;
}> {
  return getConsensusForecast(itemId);
}

/** Forecast Value Add — 실적이 확정된 기간의 AI 오차 vs Consensus 오차 (renew.prd 17.3) */
export async function getValueAdd(): Promise<{ rows: ValueAddRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_forecast_value_add')
      .select('*')
      .order('period', { ascending: false })
      .order('item_id', { ascending: true })
      .limit(500);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => normalizeValueAddRow(item as Record<string, unknown>));
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/** Forecast Value Add 요약 한 줄 — analytics.v_forecast_value_add_summary */
export async function getValueAddSummary(): Promise<{
  data: ValueAddSummary | null;
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_forecast_value_add_summary')
      .select('*')
      .maybeSingle();

    if (error) return { data: null, error: error.message };
    if (!data) return { data: null, error: null };

    return { data: normalizeValueAddSummary(data as Record<string, unknown>), error: null };
  } catch (error) {
    return { data: null, error: failure(error) };
  }
}

/** 사유 코드별 개선률 — analytics.v_forecast_value_add_by_reason */
export async function getValueAddByReason(): Promise<{
  rows: ValueAddByReason[];
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_forecast_value_add_by_reason')
      .select('*')
      .order('n', { ascending: false })
      .limit(50);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) =>
      normalizeValueAddByReason(item as Record<string, unknown>),
    );
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/**
 * 보정이 반복되는 품목 — analytics.v_override_excess.
 *
 * renew.prd 17.3 — "특정 품목에서 보정이 반복되면 모델 개선 신호로 활용한다."
 * STEP 14 의 Excessive Override 룰도 같은 뷰를 읽습니다.
 */
export async function getOverrideExcess(limit = 100): Promise<{
  rows: OverrideExcess[];
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_override_excess')
      .select('*')
      .order('n_recent_90d', { ascending: false })
      .order('n_active', { ascending: false })
      .limit(limit);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) =>
      normalizeOverrideExcess(item as Record<string, unknown>),
    );
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}
