'use server';

// 발주 일정 · 입고 차이 서버 액션 — Task 10b
//
// ★ 첫 줄에서 업무 권한을 다시 검사한다(메뉴 숨김은 1차 방어일 뿐이다). 그다음 입력 형식만 검증하고,
//   승인 여부 · 계산 가능 여부는 DB 함수가 판정한 결과를 그대로 돌려준다.

import { revalidatePath } from 'next/cache';
import { requirePermission } from '../auth';
import { validateBuildScheduleInput, validateRecordActualReceiptInput } from './model';
import { buildProcurementSchedule, recordActualReceiptDate } from './repository';

export type ScheduleActionState = { error: string | null; success: string | null };

const initialState: ScheduleActionState = { error: null, success: null };
export { initialState as scheduleActionInitialState };

function revalidateScheduleScreens() {
  revalidatePath('/procurement-plans/schedule');
  revalidatePath('/analysis/receipt-gap');
}

/** SCM 품목담당자 — 승인된 계획의 발주 일정을 만든다(재실행해도 안전) */
export async function buildProcurementScheduleAction(
  _previousState: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  await requirePermission('PLAN_CONFIRM');
  const validation = validateBuildScheduleInput({ planId: formData.get('planId') });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await buildProcurementSchedule(validation.value.planId);
  if (result.error || !result.data) {
    return { error: result.error ?? '발주 일정을 만들지 못했습니다.', success: null };
  }
  revalidateScheduleScreens();
  const nScheduled = result.data.filter((row) => row.calculationStatus === 'SCHEDULED').length;
  const nExcluded = result.data.length - nScheduled;
  return {
    error: null,
    success: `발주 일정을 만들었습니다 — 계산됨 ${nScheduled}건, 제외 ${nExcluded}건.`,
  };
}

/** SCM 품목담당자 — 실제 입고일 입력 · 수정. 빈 값이면 지운다 */
export async function recordActualReceiptDateAction(
  _previousState: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  await requirePermission('PLAN_CONFIRM');
  const validation = validateRecordActualReceiptInput({
    scheduleId: formData.get('scheduleId'),
    actualReceiptDate: formData.get('actualReceiptDate'),
    note: formData.get('note'),
  });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await recordActualReceiptDate(validation.value);
  if (result.error) return { error: result.error, success: null };

  revalidateScheduleScreens();
  return { error: null, success: '실제 입고일을 저장했습니다.' };
}
