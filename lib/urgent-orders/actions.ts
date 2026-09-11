'use server';

// 긴급발주 서버 액션 — Task 11
//
// ★ 모든 액션은 첫 줄에서 ALLOC_MANUAL 권한을 다시 검사한다(메뉴 숨김은 1차 방어일 뿐이다). 그다음
//   입력 형식만 검증하고, 실제 허용 여부와 이력 기록은 DB 명령 함수가 판정한 결과를 그대로 돌려준다.

import { revalidatePath } from 'next/cache';
import { requirePermission } from '../auth';
import {
  validateCreateUrgentOrder,
  validateUpdateUrgentOrder,
  validateUrgentOrderStatusChange,
  type UrgentOrderActionState,
} from './model';
import { changeUrgentOrderStatus, createUrgentOrder, updateUrgentOrder } from './repository';

function revalidateUrgentOrderScreens() {
  revalidatePath('/urgent-orders');
}

export async function createUrgentOrderAction(_previous: UrgentOrderActionState, formData: FormData): Promise<UrgentOrderActionState> {
  await requirePermission('ALLOC_MANUAL');
  const validation = validateCreateUrgentOrder({
    itemId: formData.get('itemId'),
    qty: formData.get('qty'),
    neededBy: formData.get('neededBy'),
    reason: formData.get('reason'),
  });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await createUrgentOrder(validation.value);
  if (result.error) return { error: result.error, success: null };
  revalidateUrgentOrderScreens();
  return { error: null, success: '긴급발주를 등록했습니다.' };
}

export async function updateUrgentOrderAction(_previous: UrgentOrderActionState, formData: FormData): Promise<UrgentOrderActionState> {
  await requirePermission('ALLOC_MANUAL');
  const validation = validateUpdateUrgentOrder({
    urgentOrderId: formData.get('urgentOrderId'),
    qty: formData.get('qty'),
    neededBy: formData.get('neededBy'),
    reason: formData.get('reason'),
    changeReason: formData.get('changeReason'),
  });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await updateUrgentOrder(validation.value);
  if (result.error) return { error: result.error, success: null };
  revalidateUrgentOrderScreens();
  return { error: null, success: '긴급발주 내용을 수정했습니다.' };
}

export async function changeUrgentOrderStatusAction(_previous: UrgentOrderActionState, formData: FormData): Promise<UrgentOrderActionState> {
  await requirePermission('ALLOC_MANUAL');
  const validation = validateUrgentOrderStatusChange({
    urgentOrderId: formData.get('urgentOrderId'),
    status: formData.get('status'),
    reason: formData.get('reason'),
  });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await changeUrgentOrderStatus(validation.value);
  if (result.error) return { error: result.error, success: null };
  revalidateUrgentOrderScreens();
  return { error: null, success: '긴급발주 상태를 변경했습니다.' };
}
