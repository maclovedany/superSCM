'use client';

// 발주 일정 폼 — Task 10b
//
// ★ 여기서 날짜를 계산하거나 확정 가능 여부를 판정하지 않는다. 버튼은 서버 액션을 부르고, DB 함수가
//   돌려준 결과를 그대로 보여준다.

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  buildProcurementScheduleAction,
  recordActualReceiptDateAction,
  scheduleActionInitialState,
  type ScheduleActionState,
} from '@/lib/schedule/actions';
import type { ApprovedPlanOption } from '@/lib/schedule/repository';

function FormMessage({ state }: { state: ScheduleActionState }) {
  return (
    <>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state.success ? <p className="form-success" role="status">{state.success}</p> : null}
    </>
  );
}

function SubmitButton({ label, primary = true }: { label: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className={primary ? 'button primary' : 'button'} type="submit" disabled={pending}>
      {pending ? '처리 중' : label}
    </button>
  );
}

/** SCM 품목담당자 — 승인된 계획을 골라 발주 일정을 만든다(재실행해도 안전) */
export function BuildScheduleForm({ plans }: { plans: ApprovedPlanOption[] }) {
  const [state, formAction] = useActionState(buildProcurementScheduleAction, scheduleActionInitialState);
  return (
    <form action={formAction} className="order-action-form">
      <label>
        <span>승인된 발주계획 <small>월별 최신 승인본만 선택할 수 있습니다</small></span>
        <select className="form-input" name="planId" required defaultValue="">
          <option value="" disabled>선택</option>
          {plans.map((plan) => (
            <option key={plan.planId} value={plan.planId}>{plan.planMonth.slice(0, 7)} · v{plan.version}</option>
          ))}
        </select>
      </label>
      <p className="muted">
        1개월차 · 최종 발주량이 있는 품목마다 공급처 출항일 · 발주일 · 입고일을 계산합니다. 다시 만들어도
        행이 늘지 않고, 이미 입력한 실제 입고일은 그대로 남습니다.
      </p>
      <FormMessage state={state} />
      <div className="button-row"><SubmitButton label="발주 일정 만들기" /></div>
    </form>
  );
}

/** SCM 품목담당자 — 실제 입고일 입력 · 수정. 비우고 제출하면 지운다 */
export function RecordActualReceiptForm({ scheduleId, actualReceiptDate }: { scheduleId: string; actualReceiptDate: string | null }) {
  const [state, formAction] = useActionState(recordActualReceiptDateAction, scheduleActionInitialState);
  return (
    <form action={formAction} className="allocation-inline-form">
      <input type="hidden" name="scheduleId" value={scheduleId} />
      <label>
        <span>실제 입고일 <small>비우고 제출하면 지웁니다</small></span>
        <input className="form-input" type="date" name="actualReceiptDate" defaultValue={actualReceiptDate ?? ''} />
      </label>
      <label>
        <span>메모 <small>선택</small></span>
        <input className="form-input" name="note" maxLength={200} />
      </label>
      <SubmitButton label={actualReceiptDate ? '수정' : '입력'} />
      <FormMessage state={state} />
    </form>
  );
}
