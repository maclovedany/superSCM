// 품목 정책 변경 요청 저장소 — Task 9a
//
// ★ 조회는 analytics 뷰만, 변경은 core.request_item_policy_change · core.cancel_item_policy_change
//   (RPC) 만 쓴다. 승인·반려는 이 도메인에서 만들지 않는다 — 공통 승인함(lib/approvals ·
//   core.decide_approval)을 그대로 쓴다.
// ★ 여기서 권한·검증을 판정하지 않는다. DB 명령 함수가 로그인 · ITEM_POLICY_EDIT 권한 · 요청자
//   본인 여부 · 상태(PENDING)를 스스로 확인한다. 이 파일은 DB 결과와 오류 문구를 그대로 돌려준다.

import { createSupabaseServerClient } from '../supabase/server';
import {
  normalizeItemPolicy,
  normalizeItemPolicyRevisionRow,
  type ItemPolicy,
  type ItemPolicyAllocationMode,
  type ItemPolicyRevision,
} from './model';

export type ItemPolicyMutationResult<T> = { data: T | null; error: string | null };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** 현재 운영값 — analytics.v_item_policy(target_dos_approved 포함) */
export async function getItemPolicies(): Promise<{ rows: ItemPolicy[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('analytics').from('v_item_policy').select('*').order('item_id');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeItemPolicy(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '품목 정책을 조회하지 못했습니다.') };
  }
}

/** 변경 요청 이력(대기·승인·반려) — analytics.v_item_policy_revision. RLS가 조회 범위를 가른다 */
export async function getItemPolicyRevisions(): Promise<{ rows: ItemPolicyRevision[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_item_policy_revision')
      .select('*')
      .order('requested_at', { ascending: false });
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeItemPolicyRevisionRow(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '품목 정책 변경 이력을 조회하지 못했습니다.') };
  }
}

/** SCM 품목담당자(ITEM_POLICY_EDIT) — 변경안 제출과 동시에 SCM팀장에게 승인을 요청한다 */
export async function requestItemPolicyChange(input: {
  itemId: string;
  targetDosDays: number | null;
  allocationMode: ItemPolicyAllocationMode;
  targetStockQty: number | null;
  unitPrice: number | null;
  moq: number | null;
  packSize: number | null;
  minOrderAmount: number | null;
  reason: string;
}): Promise<ItemPolicyMutationResult<string>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('request_item_policy_change', {
      p_item_id: input.itemId,
      p_target_dos_days: input.targetDosDays,
      p_allocation_mode: input.allocationMode,
      p_target_stock_qty: input.targetStockQty,
      p_unit_price: input.unitPrice,
      p_moq: input.moq,
      p_pack_size: input.packSize,
      p_min_order_amount: input.minOrderAmount,
      p_reason: input.reason,
    });
    if (error) return { data: null, error: error.message };
    return { data: data ? String(data) : null, error: null };
  } catch (error) {
    return { data: null, error: errorMessage(error, '품목 정책 변경 요청을 저장하지 못했습니다.') };
  }
}

/** 요청자 본인(ITEM_POLICY_EDIT) — 대기 중(PENDING)인 자신의 변경안을 취소한다(fix round 1) */
export async function cancelItemPolicyChange(input: {
  revisionId: string;
  reason: string;
}): Promise<ItemPolicyMutationResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.schema('core').rpc('cancel_item_policy_change', {
      p_revision_id: input.revisionId,
      p_reason: input.reason,
    });
    if (error) return { data: null, error: error.message };
    return { data: null, error: null };
  } catch (error) {
    return { data: null, error: errorMessage(error, '품목 정책 변경안을 취소하지 못했습니다.') };
  }
}
