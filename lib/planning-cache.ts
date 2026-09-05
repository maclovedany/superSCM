// 계획 뷰 캐시 새로 계산 — sql/37 (error.md #36)
//
// 안전재고 · 발주 추천 · 재고 전개 · 대시보드가 읽는 층은 materialized view 입니다.
// 보정 · 승인 · 정책 저장처럼 그 계산에 들어가는 값을 바꾼 Server Action 은 저장 뒤에
// 이 함수를 한 번 부릅니다. 예측 실행 뒤에는 DB 쪽 finalize_run_storage 가 스스로 부릅니다.
//
// 실패해도 저장은 이미 끝난 뒤이므로 오류를 던지지 않습니다. 다음 실행 · 다음 저장 · (pg_cron 이
// 있으면) 다음 정시에 다시 계산됩니다. 결과는 로그로만 남깁니다.

import { after } from 'next/server';
import { createSupabaseServerClient } from './supabase/server';

export type PlanningCacheScope = 'PLANNING' | 'ALL';

export type PlanningCacheRefresh = { ok: true; refreshed: number; durationMs: number } | { ok: false; detail: string };

export async function refreshPlanningCache(scope: PlanningCacheScope = 'PLANNING'): Promise<PlanningCacheRefresh> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('refresh_planning_cache', { p_scope: scope });
    if (error) {
      console.warn('[planning-cache] 새로 계산 실패:', error.message);
      return { ok: false, detail: error.message };
    }
    const row = (Array.isArray(data) ? data[0] : data) as { refreshed?: number; duration_ms?: number } | null;
    return { ok: true, refreshed: Number(row?.refreshed ?? 0), durationMs: Number(row?.duration_ms ?? 0) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn('[planning-cache] 새로 계산 실패:', detail);
    return { ok: false, detail };
  }
}

/**
 * 응답을 보낸 **뒤에** 새로 계산합니다 (next/server after).
 *
 * PLANNING 범위도 이 인스턴스에서 15~20초라, 저장 버튼이 그만큼 기다리게 할 수 없습니다.
 * 저장 자체(Override · 승인 · 정책)는 이미 끝났고, Consensus 표처럼 원본을 읽는 자리는 바로 바뀝니다.
 * 안전재고 · 추천 · 전개 · 대시보드는 계산이 끝나는 대로(수십 초) 바뀝니다 — 화면의 "기준 시각" 이
 * analytics.v_planning_cache 입니다.
 */
export function refreshPlanningCacheAfterResponse(scope: PlanningCacheScope = 'PLANNING'): void {
  after(async () => {
    await refreshPlanningCache(scope);
  });
}
