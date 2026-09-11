'use client';

// 확정 수요 입력 폼 — Task 8
//
// ★ 여기서 승인 여부·반영 여부를 판정하지 않는다. 그대로 서버 액션에 넘기고, 실제 반영 결과는
//   analytics.v_approved_demand_detail · v_approved_demand_monthly를 다시 불러와 확인한다.

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  requestEventDemandAction,
  setSupplyMeetingResultAction,
  type DemandActionState,
} from '@/lib/demand/actions';

const initialState: DemandActionState = { error: null, success: null };

function FormMessage({ state }: { state: DemandActionState }) {
  return (
    <>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state.success ? <p className="form-success" role="status">{state.success}</p> : null}
    </>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="button primary" type="submit" disabled={pending}>
      {pending ? '처리 중' : label}
    </button>
  );
}

/** SCM 품목담당자(SUPPLY_MEETING_INPUT) — 수급회의 결과 대리 입력. 팀장 승인 절차가 없다(stage1.md §5) */
export function SupplyMeetingResultForm() {
  const [state, formAction] = useActionState(setSupplyMeetingResultAction, initialState);
  return (
    <form action={formAction} className="order-action-form">
      <label>
        <span>계획월 <small>필수</small></span>
        <input className="form-input" name="planMonth" type="month" required />
      </label>
      <label>
        <span>품목코드 <small>필수</small></span>
        <input className="form-input" name="itemId" required />
      </label>
      <label>
        <span>수량 <small>필수 · 0 이상</small></span>
        <input className="form-input" name="qty" inputMode="decimal" required />
      </label>
      <fieldset className="order-choice">
        <legend>승인 여부</legend>
        <label>
          <input name="approved" type="checkbox" value="true" />
          <span>회의에서 승인됨</span>
        </label>
      </fieldset>
      <label>
        <span>근거 제출 항목 ID <small>선택 · 부서 합의(AGREED) 항목만</small></span>
        <input className="form-input" name="basisSubmissionLineId" />
      </label>
      <label>
        <span>메모 <small>선택</small></span>
        <input className="form-input" name="reason" maxLength={500} />
      </label>
      <p className="muted">
        이미 같은 계획월·품목 결과가 있으면 이전 값을 이력에 남기고 갱신합니다. 체크 해제 상태로 저장하면
        승인 수요에 반영되지 않습니다.
      </p>
      <FormMessage state={state} />
      <div className="button-row"><SubmitButton label="수급회의 결과 저장" /></div>
    </form>
  );
}

/** SCM 취합 담당(DEMAND_CONSOLIDATE) — 이벤트 추가 수요 등록. 저장과 동시에 SCM팀장에게 승인을 요청한다 */
export function EventDemandRequestForm() {
  const [state, formAction] = useActionState(requestEventDemandAction, initialState);
  return (
    <form action={formAction} className="order-action-form">
      <label>
        <span>대상월 <small>필수</small></span>
        <input className="form-input" name="planMonth" type="month" required />
      </label>
      <label>
        <span>기종(품목코드) <small>필수</small></span>
        <input className="form-input" name="itemId" required />
      </label>
      <label>
        <span>고객 <small>필수</small></span>
        <input className="form-input" name="customerName" required />
      </label>
      <label>
        <span>수량 <small>필수 · 0보다 커야 함</small></span>
        <input className="form-input" name="qty" inputMode="decimal" required />
      </label>
      <label>
        <span>승인 요청 사유 <small>필수 · 고객·기종·수량을 포함하세요</small></span>
        <input className="form-input" name="reason" maxLength={500} required />
      </label>
      <p className="muted">승인 전까지는 0건으로 표시됩니다. SCM팀장이 승인해야 발주 수요에 전량 반영됩니다.</p>
      <FormMessage state={state} />
      <div className="button-row"><SubmitButton label="이벤트 추가 수요 등록·승인 요청" /></div>
    </form>
  );
}
