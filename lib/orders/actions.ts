'use server';

// 영업 주문 · 재고 배정 서버 액션 — Task 5
//
// ★ 모든 액션은 첫 줄에서 업무 권한을 다시 검사합니다(메뉴 숨김은 1차 방어일 뿐입니다). 그다음 입력
//   형식만 검증하고, 실제 허용 여부 · 배정 계산 · 잠금은 DB 명령 함수가 판정한 결과를 그대로 돌려줍니다.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '../auth';
import {
  describeManualAllocationResult,
  describeReviewResult,
  validateCancelOrder,
  validateConfirmOrder,
  validateCopyOrder,
  validateCreateOrder,
  validateFirmCancel,
  validateManualAllocation,
  validatePriorityChange,
  validateReviewRequest,
  type OrderActionState,
} from './model';
import {
  cancelFirmAllocation,
  cancelSalesOrder,
  changeAllocationPriority,
  confirmSalesOrder,
  copyCancelledOrder,
  createSalesOrder,
  requestManualAllocation,
  requestOrderReview,
} from './repository';

function revalidateOrderScreens(orderId?: string) {
  revalidatePath('/orders');
  if (orderId) revalidatePath(`/orders/${orderId}`);
  revalidatePath('/allocations');
  revalidatePath('/allocations/priorities');
  revalidatePath('/inventory');
}

export async function createSalesOrderAction(_previous: OrderActionState, formData: FormData): Promise<OrderActionState> {
  await requirePermission('ORDER_CREATE');
  const validation = validateCreateOrder({
    customerId: formData.get('customerId'),
    customerName: formData.get('customerName'),
    note: formData.get('note'),
    itemIds: formData.getAll('itemId'),
    quantities: formData.getAll('qty'),
  });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await createSalesOrder(validation.value);
  if (result.error || !result.data) return { error: result.error ?? '등록된 주문 ID를 받지 못했습니다.', success: null };
  revalidateOrderScreens();
  redirect(`/orders/${result.data}`);
}

export async function requestOrderReviewAction(_previous: OrderActionState, formData: FormData): Promise<OrderActionState> {
  await requirePermission('ORDER_REVIEW_REQUEST');
  const validation = validateReviewRequest({ orderId: formData.get('orderId'), choice: formData.get('choice') });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await requestOrderReview(validation.value);
  if (result.error) return { error: result.error, success: null };
  revalidateOrderScreens(validation.value.orderId);
  return { error: null, success: describeReviewResult(result.data) };
}

export async function confirmSalesOrderAction(_previous: OrderActionState, formData: FormData): Promise<OrderActionState> {
  await requirePermission('ORDER_CREATE');
  const validation = validateConfirmOrder({
    orderId: formData.get('orderId'),
    confirmedOrderNo: formData.get('confirmedOrderNo'),
  });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await confirmSalesOrder(validation.value);
  if (result.error) return { error: result.error, success: null };
  revalidateOrderScreens(validation.value.orderId);
  return { error: null, success: '수주를 확정했습니다. 임시배정은 확정배정으로 전환되었습니다.' };
}

export async function copyCancelledOrderAction(_previous: OrderActionState, formData: FormData): Promise<OrderActionState> {
  await requirePermission('ORDER_CREATE');
  const validation = validateCopyOrder({ orderId: formData.get('orderId') });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await copyCancelledOrder(validation.value);
  if (result.error || !result.data) return { error: result.error ?? '재등록된 주문 ID를 받지 못했습니다.', success: null };
  revalidateOrderScreens(validation.value.orderId);
  redirect(`/orders/${result.data}`);
}

export async function cancelSalesOrderAction(_previous: OrderActionState, formData: FormData): Promise<OrderActionState> {
  await requirePermission('ORDER_CREATE');
  const validation = validateCancelOrder({ orderId: formData.get('orderId'), reason: formData.get('reason') });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await cancelSalesOrder(validation.value);
  if (result.error) return { error: result.error, success: null };
  revalidateOrderScreens(validation.value.orderId);
  return { error: null, success: '주문을 취소했습니다. 임시배정 · 승인대기 확보는 가용재고로 돌아갔습니다.' };
}

export async function requestManualAllocationAction(_previous: OrderActionState, formData: FormData): Promise<OrderActionState> {
  await requirePermission('ALLOC_MANUAL');
  const validation = validateManualAllocation({
    orderId: formData.get('orderId'),
    itemId: formData.get('itemId'),
    qty: formData.get('qty'),
    reason: formData.get('reason'),
  });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await requestManualAllocation(validation.value);
  if (result.error) return { error: result.error, success: null };
  revalidateOrderScreens(validation.value.orderId);
  return { error: null, success: describeManualAllocationResult(result.data) };
}

export async function cancelFirmAllocationAction(_previous: OrderActionState, formData: FormData): Promise<OrderActionState> {
  await requirePermission('ALLOC_FIRM_CANCEL');
  const validation = validateFirmCancel({ allocationId: formData.get('allocationId'), reason: formData.get('reason') });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await cancelFirmAllocation(validation.value);
  if (result.error) return { error: result.error, success: null };
  revalidateOrderScreens(result.data ?? undefined);
  return { error: null, success: '확정배정을 취소했습니다. 주문도 함께 취소되고 배정 수량은 가용재고로 돌아갔습니다.' };
}

export async function changeAllocationPriorityAction(_previous: OrderActionState, formData: FormData): Promise<OrderActionState> {
  await requirePermission('ALLOC_PRIORITY_EDIT');
  const validation = validatePriorityChange({
    orderId: formData.get('orderId'),
    priority: formData.get('priority'),
    reason: formData.get('reason'),
  });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await changeAllocationPriority(validation.value);
  if (result.error) return { error: result.error, success: null };
  revalidateOrderScreens(validation.value.orderId);
  return { error: null, success: '우선순위를 변경했습니다. 신규 입고 배정과 수동배정 순서 판정에 바로 적용됩니다.' };
}
