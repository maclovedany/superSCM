'use server';

// 품목 정책 변경 요청 서버 액션 — Task 9a
//
// ★ 메뉴 숨김은 1차 방어일 뿐이다. 첫 줄에서 ITEM_POLICY_EDIT 권한을 다시 검사한다. 실제 승인
//   가능 여부(요청자 ≠ 승인자 포함)는 core.request_item_policy_change · core.decide_approval이
//   DB에서 다시 판정한다.
// ★ 승인·반려는 이 파일에 두지 않는다 — 공통 승인함(/approvals, lib/approvals/actions.ts)이
//   core.decide_approval(ITEM_POLICY)을 그대로 처리한다.

import { revalidatePath } from 'next/cache';
import { requirePermission } from '../auth';
import { validateRequestItemPolicyChange } from './model';
import { requestItemPolicyChange } from './repository';

export type ItemPolicyActionState = { error: string | null; success: string | null };

function revalidateItemPolicyScreens() {
  revalidatePath('/procurement-plans/item-policies');
  revalidatePath('/admin/master');
  revalidatePath('/approvals');
}

export async function requestItemPolicyChangeAction(
  _previousState: ItemPolicyActionState,
  formData: FormData,
): Promise<ItemPolicyActionState> {
  await requirePermission('ITEM_POLICY_EDIT');
  const validation = validateRequestItemPolicyChange({
    itemId: formData.get('itemId'),
    targetDosDays: formData.get('targetDosDays'),
    allocationMode: formData.get('allocationMode'),
    targetStockQty: formData.get('targetStockQty'),
    unitPrice: formData.get('unitPrice'),
    moq: formData.get('moq'),
    packSize: formData.get('packSize'),
    minOrderAmount: formData.get('minOrderAmount'),
    reason: formData.get('reason'),
  });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await requestItemPolicyChange(validation.value);
  if (result.error) return { error: result.error, success: null };

  revalidateItemPolicyScreens();
  return {
    error: null,
    success: 'SCM팀장에게 승인을 요청했습니다. 승인 전까지 운영값은 바뀌지 않고, 반려되면 사유만 이력에 남습니다.',
  };
}
