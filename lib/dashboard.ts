// 대시보드 조회 — renew.prd 28장
//
// 계산은 SQL 이 끝냈습니다 (sql/21-dashboard.sql). 여기서는 조회와 정규화만 합니다.
// 타입 · 정규화 · 문구 조립은 lib/dashboard-model.ts 에 있습니다.
//
// ★ 클라이언트 컴포넌트는 이 파일을 import 하지 마세요. 서버 전용 Supabase 클라이언트가
//   따라 들어옵니다. 타입이나 문구가 필요하면 lib/dashboard-model.ts 에서 가져오세요.
//
// PostgREST 는 한 번에 1,000행까지 돌려줍니다. 목록 조회는 limit 을 반드시 적습니다
// (공통규칙 §3-11). 뷰가 이미 자른 것도 한 번 더 적어 둡니다 — 뷰의 limit 이 바뀌어도
// 화면이 조용히 1,000행을 받지 않습니다.

import { createSupabaseServerClient } from './supabase/server';
import {
  normalizeAccuracyRanking,
  normalizeDashboardKpi,
  normalizeOpenPoRisk,
  normalizePurchasePriority,
  normalizeRecentApproval,
  normalizeSparklinePoint,
  type AccuracyRankingRow,
  type DashboardKpi,
  type OpenPoRiskRow,
  type PurchasePriorityRow,
  type RecentApprovalRow,
  type SparklinePoint,
} from './dashboard-model';

// 화면이 한 곳에서 가져다 쓰도록 순수 함수와 타입을 다시 내보냅니다.
export {
  monthLabel,
  percentText,
  railSentences,
  signedPercentText,
  type AccuracyRankingRow,
  type DashboardKpi,
  type OpenPoRiskRow,
  type PurchasePriorityRow,
  type RecentApprovalRow,
  type SparklineKind,
  type SparklinePoint,
} from './dashboard-model';

function failure(error: unknown): string {
  return error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.';
}

/**
 * 상단 KPI 12종 — renew.prd 28.1.
 *
 * 뷰는 항상 1행입니다. `data` 가 null 이면 조회에 실패했거나 sql/21 을 아직 실행하지
 * 않은 것입니다. 그때 화면은 카드마다 0 을 그리지 않고 EmptyValue 를 그립니다.
 */
export async function getDashboardKpi(): Promise<{
  data: DashboardKpi | null;
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_dashboard_kpi')
      .select('*')
      .maybeSingle();

    if (error) return { data: null, error: error.message };
    if (!data) return { data: null, error: null };
    return { data: normalizeDashboardKpi(data as Record<string, unknown>), error: null };
  } catch (error) {
    return { data: null, error: failure(error) };
  }
}

/** 발주 우선순위 상위 10 — 뷰가 발주 권고일 순으로 이미 잘라 둡니다 */
export async function getDashboardPurchasePriority(limit = 10): Promise<{
  rows: PurchasePriorityRow[];
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_dashboard_purchase_priority')
      .select('*')
      .limit(limit);

    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizePurchasePriority(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/**
 * 예측 정확도 랭킹 — 양 끝 다섯 개씩만.
 *
 * ★ 자르기를 DB 에서 합니다. 앞에서 200건을 받아 화면에서 거르면, Champion 이 200개를 넘는
 *   순간 "부정확한 5"(rank_worst 1~5) 가 통째로 잘려 나가 패널이 조용히 빕니다 —
 *   순위가 가장 나쁜 품목은 rank_best 순 목록의 맨 뒤에 있기 때문입니다.
 *
 * 순위는 뷰가 매겼습니다. 화면은 `rankBest <= 5` · `rankWorst <= 5` 로 두 열로 나누기만 합니다.
 * Champion 이 10개 미만이면 양쪽에 같은 품목이 들어오는데, 그건 뷰의 n_ranked 가 알려 줍니다.
 */
export async function getDashboardAccuracyRanking(limit = 20): Promise<{
  rows: AccuracyRankingRow[];
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_dashboard_accuracy_ranking')
      .select('*')
      .or('rank_best.lte.5,rank_worst.lte.5')
      .order('rank_best', { ascending: true })
      .limit(limit);

    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeAccuracyRanking(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/** Open PO 위험 — 예정일 경과 또는 7일 이내. 뷰가 지연이 큰 순으로 20건까지 자릅니다 */
export async function getDashboardOpenPoRisk(limit = 20): Promise<{
  rows: OpenPoRiskRow[];
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_dashboard_open_po_risk')
      .select('*')
      .limit(limit);

    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeOpenPoRisk(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/** 최근 결정 10건 */
export async function getDashboardRecentApprovals(limit = 10): Promise<{
  rows: RecentApprovalRow[];
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_dashboard_recent_approvals')
      .select('*')
      .limit(limit);

    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeRecentApproval(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/**
 * 스파크라인 재료 — 품목별 최근 12개월 실적 + 향후 3개월 Consensus.
 *
 * 발주 우선순위 표에 들어갈 품목만 받아옵니다. 전 품목을 받으면 20개 품목 × 15기간이
 * 300행이라 지금은 괜찮지만, 품목이 늘면 한 화면이 1,000행 상한에 닿습니다.
 *
 * 품목 목록이 비면 조회하지 않습니다 — `in()` 에 빈 배열을 주면 PostgREST 가
 * `in.()` 를 만들어 문법 오류로 돌아옵니다.
 */
export async function getDashboardSparklines(itemIds: string[]): Promise<{
  rows: SparklinePoint[];
  error: string | null;
}> {
  if (itemIds.length === 0) return { rows: [], error: null };
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_dashboard_sparkline')
      .select('*')
      .in('item_id', itemIds)
      .order('item_id', { ascending: true })
      .order('period', { ascending: true })
      .limit(1000);

    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeSparklinePoint(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}
