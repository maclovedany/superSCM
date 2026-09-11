'use server';

import { revalidatePath } from 'next/cache';
import { requireAnyPermission } from '@/lib/auth';
import { validateApprovalDecision, type ApprovalActionState } from '@/lib/approvals/model';
import { decideApproval } from '@/lib/approvals/repository';
import { WORK_ROUTE_PERMISSIONS } from '@/lib/permission';

export async function decideApprovalAction(
  _previousState: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/approvals']);
  const validation = validateApprovalDecision({
    approvalId: formData.get('approvalId'),
    decision: formData.get('decision'),
    decisionComment: formData.get('decisionComment'),
  });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await decideApproval(validation.value);
  if (result.error) return { error: result.error, success: null };
  revalidatePath('/approvals');
  return { error: null, success: validation.value.decision === 'APPROVED' ? '승인했습니다.' : '반려했습니다.' };
}
