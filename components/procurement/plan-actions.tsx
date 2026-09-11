'use client';

// 발주계획 폼 — Task 9b
//
// ★ 여기서 수량이나 확정 가능 여부를 판정하지 않는다. 버튼은 서버 액션을 부르고, DB 함수가 돌려준 결과(차단 사유
//   포함)를 그대로 보여준다.

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  buildProcurementPlanAction,
  confirmProcurementPlanAction,
  decideProcurementPlanAction,
  type ProcurementActionState,
} from '@/lib/procurement/actions';
import { planReasonLabel, type ForecastRunOption } from '@/lib/procurement/model';

const initialState: ProcurementActionState = { error: null, success: null, blockingReasons: [] };

function FormMessage({ state }: { state: ProcurementActionState }) {
  return (
    <>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state.blockingReasons.length > 0 ? (
        <ul className="order-history">
          {state.blockingReasons.map((reason) => (
            <li key={reason.reasonCode}>
              <div className="order-history-head">
                <span className="tag red">{reason.reasonCode}</span>
                <b>{planReasonLabel(reason.reasonCode)}</b>
              </div>
              <p>품목 {reason.itemCount}개 · 라인 {reason.lineCount}개</p>
            </li>
          ))}
        </ul>
      ) : null}
      {state.success ? <p className="form-success" role="status">{state.success}</p> : null}
    </>
  );
}

function SubmitButton({ label, name, value, primary = true }: { label: string; name?: string; value?: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className={primary ? 'button primary' : 'button'} type="submit" name={name} value={value} disabled={pending}>
      {pending ? '처리 중' : label}
    </button>
  );
}

/** SCM 품목담당자 — 기준월 발주계획 새 버전 계산 */
export function BuildPlanForm({ runs }: { runs: ForecastRunOption[] }) {
  const [state, formAction] = useActionState(buildProcurementPlanAction, initialState);
  return (
    <form action={formAction} className="order-action-form">
      <label>
        <span>기준월 <small>필수 · 1개월차가 됩니다</small></span>
        <input className="form-input" type="month" name="planMonth" required />
      </label>
      <label>
        <span>Forecast Run <small>비워 두면 최신 성공 실행</small></span>
        <select className="form-input" name="forecastRunId" defaultValue="">
          <option value="">최신 성공 실행</option>
          {runs.map((run) => (
            <option key={run.runId} value={run.runId}>
              학습 {run.trainStart ?? '미상'} ~ {run.trainEnd ?? '미상'} · 완료 {run.finishedAt ?? '미상'}{run.isStale ? ' · stale' : ''}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">
        같은 기준월을 다시 계산하면 새 버전이 만들어지고, 작업 중인 이전 버전은 대체됩니다(승인 대기였다면 승인 요청이 취소됩니다).
        승인된 계획은 바뀌지 않습니다. 학습 데이터가 검증된 적재 배치에서 오지 않았으면 모든 라인이 계산 불가로 저장됩니다.
      </p>
      <FormMessage state={state} />
      <div className="button-row"><SubmitButton label="계산 · 새 버전 만들기" /></div>
    </form>
  );
}

/** SCM 품목담당자 — 확정 · SCM팀장 승인 요청 */
export function ConfirmPlanForm({ planId }: { planId: string }) {
  const [state, formAction] = useActionState(confirmProcurementPlanAction, initialState);
  return (
    <form action={formAction} className="order-action-form">
      <input type="hidden" name="planId" value={planId} />
      <p className="muted">계산 불가 라인이나 목표 DoS 미승인 품목이 있으면 확정되지 않고 사유가 표시됩니다.</p>
      <FormMessage state={state} />
      <div className="button-row"><SubmitButton label="확정 · 팀장 승인 요청" /></div>
    </form>
  );
}

/** SCM팀장 — 승인 또는 반려(의견 필수). 확정한 본인은 DB가 거절한다 */
export function PlanDecisionForm({ planId, approvalId }: { planId: string; approvalId: string }) {
  const [state, formAction] = useActionState(decideProcurementPlanAction, initialState);
  return (
    <form action={formAction} className="order-action-form">
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="approvalId" value={approvalId} />
      <label>
        <span>의견 <small>반려 시 필수</small></span>
        <input className="form-input" name="comment" maxLength={500} />
      </label>
      <FormMessage state={state} />
      <div className="button-row">
        <SubmitButton label="승인 · 최종본 확정" name="decision" value="APPROVED" />
        <SubmitButton label="반려" name="decision" value="REJECTED" primary={false} />
      </div>
    </form>
  );
}
