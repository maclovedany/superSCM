// 영업 주문 · 재고 배정 저장소 — Task 5
//
// ★ 화면 조회는 analytics 뷰만, 변경은 core 명령 함수(RPC)만 씁니다. raw · core 테이블을 직접 읽거나
//   쓰지 않습니다.
// ★ 여기서 배정을 계산하거나 권한을 판정하지 않습니다. 모든 명령 함수가 스스로 로그인 · 업무 권한 ·
//   재고 행 잠금을 확인합니다. 이 파일은 DB 결과와 오류 문구를 그대로 돌려줍니다.

import { createSupabaseServerClient } from '../supabase/server';
import {
  normalizeAllocationQueueRow,
  normalizeSalesOrderRow,
  type AllocationChoice,
  type AllocationQueueRow,
  type SalesOrder,
} from './model';

export type OrderMutationResult<T> = { data: T | null; error: string | null };

const ORDER_LIST_COLUMNS = [
  'order_id', 'order_no', 'customer_id', 'customer_name', 'owner_name', 'status', 'requested_at',
  'first_review_requested_at', 'temporary_expires_at', 'allocation_choice', 'allocation_priority',
  'confirmed_order_no', 'replaces_order_id', 'replaces_order_no', 'replaced_by_order_id', 'replaced_by_order_no',
  'line_count', 'requested_qty', 'temporary_allocated_qty', 'firm_allocated_qty', 'approval_hold_qty', 'shortage_qty',
].join(', ');

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** 로그인한 영업담당자 본인의 주문 목록 — analytics.v_my_sales_order */
export async function getMySalesOrders(): Promise<{ rows: SalesOrder[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_my_sales_order')
      .select(ORDER_LIST_COLUMNS)
      .order('requested_at', { ascending: false });
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeSalesOrderRow(row as unknown as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '주문 목록을 조회하지 못했습니다.') };
  }
}

/** 주문 한 건과 품목 · 이력. 본인 주문이 아니면 RLS가 행을 돌려주지 않아 null입니다 */
export async function getMySalesOrder(orderId: string): Promise<{ order: SalesOrder | null; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_my_sales_order')
      .select('*')
      .eq('order_id', orderId)
      .maybeSingle();
    if (error) return { order: null, error: error.message };
    return { order: data ? normalizeSalesOrderRow(data as Record<string, unknown>) : null, error: null };
  } catch (error) {
    return { order: null, error: errorMessage(error, '주문을 조회하지 못했습니다.') };
  }
}

/** SCM · 사업강화부용 진행 중 주문 품목과 대기 순번 — analytics.v_allocation_queue */
export async function getAllocationQueue(): Promise<{ rows: AllocationQueueRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_allocation_queue')
      .select('*')
      .order('item_id')
      .order('queue_rank', { ascending: true, nullsFirst: false })
      .order('order_seq');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeAllocationQueueRow(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '배정 대기열을 조회하지 못했습니다.') };
  }
}

async function callCommand<T>(name: string, args: Record<string, unknown>, fallback: string): Promise<OrderMutationResult<T>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc(name, args);
    if (error) return { data: null, error: error.message };
    return { data: (data ?? null) as T | null, error: null };
  } catch (error) {
    return { data: null, error: errorMessage(error, fallback) };
  }
}

export function createSalesOrder(input: {
  customerId: string | null;
  customerName: string;
  note: string | null;
  lines: Array<{ itemId: string; qty: number }>;
}) {
  return callCommand<string>('create_sales_order', {
    p_customer_id: input.customerId,
    p_customer_name: input.customerName,
    p_lines: input.lines.map((line) => ({ item_id: line.itemId, qty: line.qty })),
    p_note: input.note,
  }, '주문을 등록하지 못했습니다.');
}

export function requestOrderReview(input: { orderId: string; choice: AllocationChoice }) {
  return callCommand<Record<string, unknown>>('request_order_review', {
    p_order_id: input.orderId,
    p_choice: input.choice,
  }, '검토 요청을 등록하지 못했습니다.');
}

export function confirmSalesOrder(input: { orderId: string; confirmedOrderNo: string }) {
  return callCommand<string>('confirm_sales_order', {
    p_order_id: input.orderId,
    p_confirmed_order_no: input.confirmedOrderNo,
  }, '수주를 확정하지 못했습니다.');
}

export function changeAllocationPriority(input: { orderId: string; priority: number; reason: string }) {
  return callCommand<string>('change_allocation_priority', {
    p_order_id: input.orderId,
    p_priority: input.priority,
    p_reason: input.reason,
  }, '우선순위를 변경하지 못했습니다.');
}

export function requestManualAllocation(input: { orderId: string; itemId: string; qty: number; reason: string | null }) {
  return callCommand<Record<string, unknown>>('request_manual_allocation', {
    p_order_id: input.orderId,
    p_item_id: input.itemId,
    p_qty: input.qty,
    p_reason: input.reason,
  }, '수동 배정을 처리하지 못했습니다.');
}

export function cancelFirmAllocation(input: { allocationId: string; reason: string }) {
  return callCommand<string>('cancel_firm_allocation', {
    p_allocation_id: input.allocationId,
    p_reason: input.reason,
  }, '확정배정을 취소하지 못했습니다.');
}

export function copyCancelledOrder(input: { orderId: string }) {
  return callCommand<string>('copy_cancelled_order', { p_order_id: input.orderId }, '주문을 재등록하지 못했습니다.');
}

export function cancelSalesOrder(input: { orderId: string; reason: string }) {
  return callCommand<string>('cancel_sales_order', {
    p_order_id: input.orderId,
    p_reason: input.reason,
  }, '주문을 취소하지 못했습니다.');
}
