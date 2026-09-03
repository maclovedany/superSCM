// 승인 · 근거 Snapshot · 결정 이력 조회 — renew.prd 23장 · 31.2 · 32
//
// 계산은 SQL 이 끝냈습니다. 여기서는 조회와 정규화만 합니다 (AGENTS.md 규칙 2).
// 타입 · 사유 코드 · 정규화 함수는 lib/approval-model.ts 에 있습니다.
//
// ★ 클라이언트 컴포넌트는 이 파일을 import 하지 마세요. 서버 전용 Supabase 클라이언트가
//   따라 들어옵니다. 사유 코드가 필요하면 lib/approval-model.ts 에서 직접 가져오세요.
//
// ★ core.approval 에 직접 insert 하지 않습니다. 승인 행은 security definer 함수
//   core.approve_recommendation() 만 넣습니다 — 그래야 근거 Snapshot 이 반드시 함께
//   저장됩니다 (renew.prd 23.2). 이 파일에는 조회만 있습니다.
//
// PostgREST 는 한 번에 1,000행까지 돌려줍니다. 목록 조회는 limit 을 반드시 적습니다 (공통규칙 11).

import { createSupabaseServerClient } from './supabase/server';
import {
  normalizeApproval,
  normalizeApprovalKpi,
  normalizeApprovalSnapshot,
  normalizeDecisionHistory,
  normalizeRecommendationWithApproval,
  type ApprovalKpi,
  type ApprovalRow,
  type ApprovalSnapshot,
  type DecisionHistoryRow,
  type RecommendationWithApproval,
} from './approval-model';

// 코드 체계와 라벨은 모델 파일에 있습니다. 서버 코드가 한 곳에서 가져다 쓰도록 다시 내보냅니다.
export {
  APPROVAL_REASON_CODES,
  DECISIONS,
  DECISION_LABEL,
  DECISION_TONE,
  KIND_LABEL,
  KIND_TONE,
  approvalReasonLabel,
  canUseAsRecommended,
  decisionLabel,
  isApprovalReasonCode,
  isDecision,
  kindLabel,
  requiresApprovalReasonText,
  type ApprovalReasonCode,
  type Decision,
  type DecisionKind,
} from './approval-model';

function failure(error: unknown): string {
  return error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.';
}

/**
 * PostgREST 의 `or=` 문자열에 그대로 넣어도 되는 값인가.
 *
 * `or=(a.eq.X,and(...))` 는 쉼표 · 괄호 · 점으로 구문을 나눕니다. 값에 그 글자가 들어 있으면
 * 필터가 다른 뜻이 되어 엉뚱한 행이 나옵니다. 품목코드 · 공급처코드는 영숫자와 -_ 뿐이라
 * 정상 값은 전부 통과합니다. 통과하지 못하면 or 를 쓰지 않고 eq 만 씁니다.
 */
function isSafeFilterToken(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

/**
 * 결정 목록 — analytics.v_approval.
 *
 * 최근 결정이 위입니다. itemId 를 주면 그 품목만 봅니다.
 * 유효한 행(ACTIVE)과 대체된 행(SUPERSEDED)을 함께 돌려줍니다 — is_active 로 구분합니다.
 * 행을 지우지 않아야 renew.prd 31.2 의 추적성이 성립합니다.
 */
export async function getApprovals(itemId?: string): Promise<{
  rows: ApprovalRow[];
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    let query = supabase.schema('analytics').from('v_approval').select('*');

    if (itemId) query = query.eq('item_id', itemId);

    const { data, error } = await query
      .order('approved_at', { ascending: false, nullsFirst: false })
      .limit(200);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => normalizeApproval(item as Record<string, unknown>));
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/**
 * 결정 한 건 — analytics.v_approval.
 *
 * 근거 재현 화면이 머리글(누가 · 언제 · 무엇을 결정했나)에 씁니다.
 * 없는 approval_id 면 data 가 null 입니다. 화면은 그때 notFound() 를 부릅니다.
 */
export async function getApproval(approvalId: number): Promise<{
  data: ApprovalRow | null;
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_approval')
      .select('*')
      .eq('approval_id', approvalId)
      .maybeSingle();

    if (error) return { data: null, error: error.message };
    if (!data) return { data: null, error: null };

    return { data: normalizeApproval(data as Record<string, unknown>), error: null };
  } catch (error) {
    return { data: null, error: failure(error) };
  }
}

/**
 * 승인 시점의 계산 근거 — analytics.v_approval_snapshot (renew.prd 23.2).
 *
 * 저장된 jsonb 를 그대로 꺼내 옵니다. 이 함수는 다시 계산하지 않습니다 —
 * 지금 값을 조회해 채우면 "그때 무엇을 보고 결정했나" 가 아니게 됩니다 (renew.prd 31.3).
 *
 * Snapshot 한 건이 수십 KB 라 목록에서는 읽지 않고 approval_id 로 한 행만 읽습니다.
 */
export async function getApprovalSnapshot(approvalId: number): Promise<{
  data: ApprovalSnapshot | null;
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_approval_snapshot')
      .select('*')
      .eq('approval_id', approvalId)
      .maybeSingle();

    if (error) return { data: null, error: error.message };
    if (!data) return { data: null, error: null };

    return { data: normalizeApprovalSnapshot(data as Record<string, unknown>), error: null };
  } catch (error) {
    return { data: null, error: failure(error) };
  }
}

/**
 * 통합 결정 이력 — analytics.v_decision_history (renew.prd 31.2).
 *
 * 승인 · 예측 보정 · Champion 수동 지정 · 계획 리드타임 변경을 한 표로 모읍니다.
 * 최근 결정이 위입니다.
 */
export async function getDecisionHistory(limit = 200): Promise<{
  rows: DecisionHistoryRow[];
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_decision_history')
      .select('*')
      .order('at', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) =>
      normalizeDecisionHistory(item as Record<string, unknown>),
    );
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/**
 * 한 품목의 결정 이력. SKU Detail §5 가 씁니다.
 *
 * ★ 리드타임 변경은 품목이 아니라 공급처에 붙어 item_id 가 null 입니다 (sql/19 주석).
 *   그 품목의 공급처를 알면 함께 읽습니다 — 리드타임이 바뀌면 이 품목의 추천도 바뀌므로,
 *   "왜 지난달과 추천이 다른가" 를 이 표 하나에서 볼 수 있어야 합니다.
 */
export async function getItemDecisionHistory(
  itemId: string,
  supplierId: string | null,
  limit = 100,
): Promise<{ rows: DecisionHistoryRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    let query = supabase.schema('analytics').from('v_decision_history').select('*');

    const withSupplier =
      supplierId !== null && isSafeFilterToken(itemId) && isSafeFilterToken(supplierId);

    query = withSupplier
      ? query.or(`item_id.eq.${itemId},and(kind.eq.LEADTIME,supplier_id.eq.${supplierId})`)
      : query.eq('item_id', itemId);

    const { data, error } = await query
      .order('at', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) =>
      normalizeDecisionHistory(item as Record<string, unknown>),
    );
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/** 승인 요약 한 줄 — analytics.v_approval_kpi */
export async function getApprovalKpi(): Promise<{
  data: ApprovalKpi | null;
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_approval_kpi')
      .select('*')
      .maybeSingle();

    if (error) return { data: null, error: error.message };
    if (!data) return { data: null, error: null };

    return { data: normalizeApprovalKpi(data as Record<string, unknown>), error: null };
  } catch (error) {
    return { data: null, error: failure(error) };
  }
}

/**
 * 발주 추천 + 유효한 결정 — analytics.v_purchase_recommendation_with_approval.
 *
 * 발주 추천 화면이 "승인" 열과 "승인 대기" 카드를 그리려고 읽습니다.
 * analytics.v_purchase_recommendation 은 그대로 두고 감싼 뷰라, CSV 라우트와
 * 다른 단계가 읽는 이름은 바뀌지 않습니다.
 *
 * 정렬은 lib/recommendation.ts 의 getPurchaseRecommendations 와 같습니다 —
 * 발주 권고일이 이른 순, 없는 품목은 맨 뒤입니다 (design.md §8.2).
 */
export async function getRecommendationsWithApproval(): Promise<{
  rows: RecommendationWithApproval[];
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_purchase_recommendation_with_approval')
      .select('*')
      .order('required_order_date', { ascending: true, nullsFirst: false })
      .limit(500);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) =>
      normalizeRecommendationWithApproval(item as Record<string, unknown>),
    );
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}
