'use server';

// 발주계획 서버 액션 — Task 9b
//
// ★ 첫 줄에서 업무 권한을 다시 검사한다(메뉴 숨김은 1차 방어일 뿐이다). 그다음 입력 형식만 검증하고, 계산 ·
//   확정 가능 여부 · 요청자 ≠ 승인자는 DB 함수가 판정한 결과를 그대로 돌려준다.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '../auth';
import { decideApproval } from '../approvals/repository';
import { validateBuildPlanInput, validatePlanDecision, validatePlanId, type PlanConfirmBlocker } from './model';
import { approveProcurementPlan, buildProcurementPlan, confirmProcurementPlan } from './repository';

export type ProcurementActionState = {
  error: string | null;
  success: string | null;
  blockingReasons: PlanConfirmBlocker[];
};

function revalidatePlanScreens(planId?: string) {
  revalidatePath('/procurement-plans');
  if (planId) revalidatePath(`/procurement-plans/${planId}`);
  revalidatePath('/approvals');
}

/** SCM 품목담당자 — 기준월 발주계획 새 버전 계산 후 상세 화면으로 이동 */
export async function buildProcurementPlanAction(
  _previousState: ProcurementActionState,
  formData: FormData,
): Promise<ProcurementActionState> {
  await requirePermission('PLAN_CONFIRM');
  const validation = validateBuildPlanInput({ planMonth: formData.get('planMonth'), forecastRunId: formData.get('forecastRunId') });
  if (!validation.ok) return { error: validation.message, success: null, blockingReasons: [] };

  const result = await buildProcurementPlan(validation.value);
  if (result.error || !result.data) {
    return { error: result.error ?? '발주계획을 계산하지 못했습니다.', success: null, blockingReasons: [] };
  }
  revalidatePlanScreens(result.data);
  redirect(`/procurement-plans/${result.data}`);
}

/** SCM 품목담당자 — 확정 · 팀장 승인 요청. 막히면 차단 사유 목록을 돌려준다 */
export async function confirmProcurementPlanAction(
  _previousState: ProcurementActionState,
  formData: FormData,
): Promise<ProcurementActionState> {
  await requirePermission('PLAN_CONFIRM');
  const validation = validatePlanId(formData.get('planId'));
  if (!validation.ok) return { error: validation.message, success: null, blockingReasons: [] };

  const result = await confirmProcurementPlan(validation.value);
  if (result.error || !result.data) {
    return { error: result.error ?? '발주계획을 확정하지 못했습니다.', success: null, blockingReasons: [] };
  }
  revalidatePlanScreens(validation.value);
  if (result.data.status === 'BLOCKED') {
    return {
      error: '확정할 수 없습니다. 아래 사유를 해결한 뒤 새 버전을 계산하세요(확정 차단 이력은 남았습니다).',
      success: null,
      blockingReasons: result.data.blockingReasons,
    };
  }
  return { error: null, success: 'SCM팀장에게 승인을 요청했습니다. 승인 전까지는 최종 발주량이 아닙니다.', blockingReasons: [] };
}

/** SCM팀장 — 승인 또는 반려(의견 필수) */
export async function decideProcurementPlanAction(
  _previousState: ProcurementActionState,
  formData: FormData,
): Promise<ProcurementActionState> {
  await requirePermission('PLAN_APPROVE');
  const validation = validatePlanDecision({
    planId: formData.get('planId'),
    approvalId: formData.get('approvalId'),
    decision: formData.get('decision'),
    comment: formData.get('comment'),
  });
  if (!validation.ok) return { error: validation.message, success: null, blockingReasons: [] };

  const { planId, approvalId, decision, comment } = validation.value;
  const error = decision === 'APPROVED'
    ? (await approveProcurementPlan({ planId, approvalId, comment })).error
    : (await decideApproval({ approvalId, decision: 'REJECTED', decisionComment: comment })).error;
  if (error) return { error, success: null, blockingReasons: [] };

  revalidatePlanScreens(planId);
  return {
    error: null,
    success: decision === 'APPROVED' ? '승인했습니다. 이 계획이 최종 발주계획입니다.' : '반려했습니다. 계획은 미확정으로 돌아갑니다.',
    blockingReasons: [],
  };
}
