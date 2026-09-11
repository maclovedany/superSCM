'use client';

// 품목 정책 변경 요청 폼 — Task 9a
//
// ★ 여기서 승인 여부를 판정하지 않는다. 제출과 동시에 core.request_item_policy_change가
//   SCM팀장에게 승인을 요청하고, 실제 운영값 반영은 승인함(/approvals)에서 처리된 결과를
//   analytics.v_item_policy를 다시 불러와 확인한다.
// ★ 값을 비워두면 그 항목은 바꾸지 않는다(model.ts validateRequestItemPolicyChange 참고).

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { requestItemPolicyChangeAction, type ItemPolicyActionState } from '@/lib/item-policy/actions';

const initialState: ItemPolicyActionState = { error: null, success: null };

function FormMessage({ state }: { state: ItemPolicyActionState }) {
  return (
    <>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state.success ? <p className="form-success" role="status">{state.success}</p> : null}
    </>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="button primary" type="submit" disabled={pending}>
      {pending ? '처리 중' : '변경안 제출·승인 요청'}
    </button>
  );
}

/** SCM 품목담당자(ITEM_POLICY_EDIT) — 품목 정책 변경안 제출. 제출과 동시에 SCM팀장에게 승인을 요청한다 */
export default function ItemPolicyChangeForm() {
  const [state, formAction] = useActionState(requestItemPolicyChangeAction, initialState);
  return (
    <form action={formAction} className="order-action-form">
      <label>
        <span>품목코드 <small>필수</small></span>
        <input className="form-input" name="itemId" required />
      </label>
      <label>
        <span>목표 DoS 일수 <small>비워두면 변경하지 않음 · 0보다 커야 함</small></span>
        <input className="form-input" name="targetDosDays" inputMode="decimal" />
      </label>
      <fieldset className="order-choice">
        <legend>배정 방식 <small>필수</small></legend>
        <label>
          <input name="allocationMode" type="radio" value="AUTO" defaultChecked />
          <span>자동 배정</span>
        </label>
        <label>
          <input name="allocationMode" type="radio" value="MANUAL" />
          <span>수동 배정</span>
        </label>
      </fieldset>
      <label>
        <span>목표 재고 <small>비워두면 변경하지 않음</small></span>
        <input className="form-input" name="targetStockQty" inputMode="decimal" />
      </label>
      <label>
        <span>단가 <small>비워두면 변경하지 않음</small></span>
        <input className="form-input" name="unitPrice" inputMode="decimal" />
      </label>
      <label>
        <span>최소주문수량(MOQ) <small>비워두면 변경하지 않음 · 미설정 시 계산에서 1로 적용</small></span>
        <input className="form-input" name="moq" inputMode="decimal" />
      </label>
      <label>
        <span>포장단위 <small>저장 · 표시만 합니다 — 현재 계산에는 적용하지 않습니다</small></span>
        <input className="form-input" name="packSize" inputMode="decimal" />
      </label>
      <label>
        <span>최소주문금액 <small>저장 · 표시만 합니다 — 현재 계산에는 적용하지 않습니다</small></span>
        <input className="form-input" name="minOrderAmount" inputMode="decimal" />
      </label>
      <label>
        <span>변경 사유 <small>필수</small></span>
        <input className="form-input" name="reason" maxLength={500} required />
      </label>
      <p className="muted">
        SCM팀장이 승인해야 운영값에 반영됩니다. 반려되면 기존 운영값이 그대로 유지되고 사유만 이력에 남습니다.
        품목당 대기 중인 변경안은 한 건만 둘 수 있습니다.
      </p>
      <FormMessage state={state} />
      <div className="button-row"><SubmitButton /></div>
    </form>
  );
}
