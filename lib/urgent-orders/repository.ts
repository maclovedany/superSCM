// 긴급발주 저장소 — Task 11
//
// ★ 화면 조회는 analytics.v_urgent_order · v_urgent_order_history만, 변경은 core 명령 함수(RPC)만
//   쓴다. raw · core 테이블을 직접 읽거나 쓰지 않는다(AGENTS.md, SCHEMA.md).
// ★ 여기서 권한을 판정하지 않는다. 모든 명령 함수가 로그인 · ALLOC_MANUAL 권한을 스스로 확인한다.
//   이 파일은 DB 결과와 오류 문구를 그대로 돌려준다.

import { createSupabaseServerClient } from '../supabase/server';
import { normalizeUrgentOrderHistoryRow, normalizeUrgentOrderRow, type UrgentOrderHistoryRow, type UrgentOrderRow } from './model';

export type UrgentOrderMutationResult<T> = { data: T | null; error: string | null };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** SCM(STOCK_VIEW_ALL)은 전체, 서비스부(URGENT_ORDER_VIEW)는 소모품만 — analytics.v_urgent_order */
export async function getUrgentOrders(): Promise<{ rows: UrgentOrderRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_urgent_order')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeUrgentOrderRow(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '긴급발주 현황을 조회하지 못했습니다.') };
  }
}

export async function getUrgentOrderHistory(): Promise<{ rows: UrgentOrderHistoryRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_urgent_order_history')
      .select('*')
      .order('at', { ascending: false });
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeUrgentOrderHistoryRow(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '긴급발주 이력을 조회하지 못했습니다.') };
  }
}

async function callCommand<T>(name: string, args: Record<string, unknown>, fallback: string): Promise<UrgentOrderMutationResult<T>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc(name, args);
    if (error) return { data: null, error: error.message };
    return { data: (data ?? null) as T | null, error: null };
  } catch (error) {
    return { data: null, error: errorMessage(error, fallback) };
  }
}

export function createUrgentOrder(input: { itemId: string; qty: number; neededBy: string; reason: string }) {
  return callCommand<string>('create_urgent_order', {
    p_item_id: input.itemId,
    p_qty: input.qty,
    p_needed_by: input.neededBy,
    p_reason: input.reason,
  }, '긴급발주를 등록하지 못했습니다.');
}

export function updateUrgentOrder(input: { urgentOrderId: string; qty: number; neededBy: string; reason: string; changeReason: string }) {
  return callCommand<string>('update_urgent_order', {
    p_urgent_order_id: input.urgentOrderId,
    p_qty: input.qty,
    p_needed_by: input.neededBy,
    p_reason: input.reason,
    p_change_reason: input.changeReason,
  }, '긴급발주를 수정하지 못했습니다.');
}

export function changeUrgentOrderStatus(input: { urgentOrderId: string; status: string; reason: string }) {
  return callCommand<string>('change_urgent_order_status', {
    p_urgent_order_id: input.urgentOrderId,
    p_status: input.status,
    p_reason: input.reason,
  }, '긴급발주 상태를 변경하지 못했습니다.');
}
