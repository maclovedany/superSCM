// 차트 집계 조회 — sql/31-chart-views.sql
//
// ★ 클라이언트 컴포넌트는 이 파일을 import 하지 마세요. 서버 전용 Supabase 클라이언트가 따라 들어옵니다.
//   타입은 lib/chart-model.ts 에서 가져오세요.
// 모든 조회에 limit 을 적습니다 (PostgREST 1,000행 상한).

import { createSupabaseServerClient } from './supabase/server';
import {
  normalizeAlertTypeMix,
  normalizeApprovalMonthly,
  normalizeDemandTrend,
  normalizeSupplierAmount,
  type AlertTypeMixRow,
  type ApprovalMonthlyRow,
  type DemandTrendPoint,
  type SupplierAmountRow,
} from './chart-model';

function failure(error: unknown): string {
  return error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.';
}

/** 대시보드 ① — 기간별 실적 · Consensus 합계 (15행) */
export async function getDemandTrend(): Promise<{ rows: DemandTrendPoint[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_chart_demand_trend')
      .select('*')
      .order('period', { ascending: true })
      .limit(100);
    if (error) return { rows: [], error: error.message };
    return { rows: normalizeDemandTrend((data ?? []) as Record<string, unknown>[]), error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/** 대시보드 ③ · 발주 추천 — 공급처별 추천, 금액 내림차순 (뷰가 정렬) */
export async function getRecommendationBySupplier(
  limit = 8,
): Promise<{ rows: SupplierAmountRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_chart_recommendation_by_supplier')
      .select('*')
      .limit(limit);
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeSupplierAmount(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/** 대시보드 ⑤ · 알림 — 열린 알림 유형 × 심각도 */
export async function getAlertTypeMix(): Promise<{ rows: AlertTypeMixRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_chart_alert_by_type')
      .select('*')
      .limit(100);
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeAlertTypeMix(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/** 대시보드 ⑥ · 결정 이력 — 최근 6개월 월별 결정 (달 × 결정 4 = 24행) */
export async function getApprovalMonthly(): Promise<{ rows: ApprovalMonthlyRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_chart_approval_monthly')
      .select('*')
      .order('month', { ascending: true })
      .limit(30);
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeApprovalMonthly(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}
