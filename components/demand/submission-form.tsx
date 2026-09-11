'use client';

// 부서별 월간 수요 제출 폼 — Task 7
//
// ★ 여기서 검증·저장을 계산하지 않는다. 파일 업로드·직접 입력 모두 그대로 서버 액션에 넘기고,
//   최종 오류 건수는 저장 뒤 다시 불러온 analytics.v_demand_submission_line에서 본다.

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  agreeDemandSubmissionAction,
  closePlanningCycleAction,
  openPlanningCycleAction,
  saveDemandLinesAction,
  startDemandSubmissionAction,
  submitDemandSubmissionAction,
  uploadDemandLinesAction,
  withdrawDemandSubmissionAction,
  type DemandActionState,
} from '@/lib/demand/actions';
import type { PlanningCycle } from '@/lib/demand/repository';

const initialState: DemandActionState = { error: null, success: null };

function FormMessage({ state }: { state: DemandActionState }) {
  return (
    <>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state.success ? <p className="form-success" role="status">{state.success}</p> : null}
    </>
  );
}

function SubmitButton({ label, className = 'button primary' }: { label: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending}>
      {pending ? '처리 중' : label}
    </button>
  );
}

/** SCM 품목담당자·ADMIN — 대상월 취합 주기를 연다 */
export function OpenPlanningCycleForm() {
  const [state, formAction] = useActionState(openPlanningCycleAction, initialState);
  return (
    <form action={formAction} className="order-action-form">
      <label>
        <span>대상월 <small>필수 · YYYY-MM</small></span>
        <input className="form-input" name="planMonth" type="month" required />
      </label>
      <p className="muted">
        제출 마감일은 대상월 전월 말일의 하루 전으로 자동 계산됩니다. 이미 열린 달은 다시 열 수 없습니다.
      </p>
      <FormMessage state={state} />
      <div className="button-row"><SubmitButton label="취합 주기 열기" /></div>
    </form>
  );
}

export function ClosePlanningCycleForm({ cycleId, planMonth }: { cycleId: string; planMonth: string }) {
  const [state, formAction] = useActionState(closePlanningCycleAction, initialState);
  return (
    <form action={formAction} className="button-row">
      <input type="hidden" name="cycleId" value={cycleId} />
      <SubmitButton label={`${planMonth} 주기 닫기`} className="button" />
      <FormMessage state={state} />
    </form>
  );
}

/** DEMAND_SUBMIT — 대상월 작성을 시작(또는 이어서 작성)한다 */
export function StartSubmissionForm({ cycles }: { cycles: PlanningCycle[] }) {
  const [state, formAction] = useActionState(startDemandSubmissionAction, initialState);
  if (cycles.length === 0) {
    return <p className="muted">아직 열린 취합 주기가 없습니다. SCM팀에 문의하세요.</p>;
  }
  return (
    <form action={formAction} className="order-action-form">
      <label>
        <span>대상월</span>
        <select className="table-select" name="planMonth" defaultValue={cycles[0]?.planMonth.slice(0, 7)}>
          {cycles.map((cycle) => (
            <option key={cycle.cycleId} value={cycle.planMonth.slice(0, 7)}>
              {cycle.planMonth.slice(0, 7)} · 마감 {cycle.submissionDeadline}
            </option>
          ))}
        </select>
      </label>
      <FormMessage state={state} />
      <div className="button-row"><SubmitButton label="작성 시작 · 이어서 작성" /></div>
    </form>
  );
}

/** DEMAND_SUBMIT — 파일 업로드. 서버에서 파싱 후 STEP 4와 같은 검증을 거쳐 저장한다 */
export function UploadLinesForm({ submissionId }: { submissionId: string }) {
  const [state, formAction] = useActionState(uploadDemandLinesAction, initialState);
  return (
    <form action={formAction} className="order-action-form">
      <input type="hidden" name="submissionId" value={submissionId} />
      <label>
        <span>파일 업로드 <small>CSV 또는 XLSX · 품목코드 · 수량 · 필요월(YYYY-MM) 열</small></span>
        <input className="form-input" name="file" type="file" accept=".csv,.xlsx" required />
      </label>
      <p className="muted">불러온 내용은 기존에 저장된 항목을 전부 대체합니다.</p>
      <FormMessage state={state} />
      <div className="button-row"><SubmitButton label="업로드하여 저장" /></div>
    </form>
  );
}

type LineDraft = { key: number; itemId: string; qty: string; needMonth: string };

/** DEMAND_SUBMIT — 직접 입력. 업로드와 같은 서버측 검증(lib/import)을 거쳐 저장한다 */
export function DirectEntryLinesForm({ submissionId }: { submissionId: string }) {
  const [state, formAction] = useActionState(saveDemandLinesAction, initialState);
  const [lines, setLines] = useState<LineDraft[]>([{ key: 1, itemId: '', qty: '', needMonth: '' }]);
  const [nextKey, setNextKey] = useState(2);

  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }
  function addLine() {
    setLines((current) => [...current, { key: nextKey, itemId: '', qty: '', needMonth: '' }]);
    setNextKey((current) => current + 1);
  }
  function removeLine(key: number) {
    setLines((current) => (current.length === 1 ? current : current.filter((line) => line.key !== key)));
  }

  return (
    <form action={formAction} className="order-form">
      <input type="hidden" name="submissionId" value={submissionId} />
      <fieldset className="order-lines">
        <legend>직접 입력</legend>
        {lines.map((line) => (
          <div className="demand-line-row" key={line.key}>
            <label>
              <span>품목코드</span>
              <input
                className="form-input"
                name="itemId"
                value={line.itemId}
                onChange={(event) => updateLine(line.key, { itemId: event.target.value })}
              />
            </label>
            <label>
              <span>수량</span>
              <input
                className="form-input"
                name="qty"
                inputMode="decimal"
                value={line.qty}
                onChange={(event) => updateLine(line.key, { qty: event.target.value })}
              />
            </label>
            <label>
              <span>필요월</span>
              <input
                className="form-input"
                name="needMonth"
                type="month"
                value={line.needMonth}
                onChange={(event) => updateLine(line.key, { needMonth: event.target.value })}
              />
            </label>
            <button className="button" type="button" onClick={() => removeLine(line.key)} disabled={lines.length === 1}>
              삭제
            </button>
          </div>
        ))}
        <div className="button-row">
          <button className="button ghost" type="button" onClick={addLine}>줄 추가</button>
        </div>
      </fieldset>
      <p className="muted">저장하면 기존에 저장된 항목을 전부 대체합니다. 품목코드·수량·필요월이 없거나 잘못되면 행 오류로 남습니다.</p>
      <FormMessage state={state} />
      <div className="button-row"><SubmitButton label="저장" /></div>
    </form>
  );
}

export function SubmitSubmissionForm({ submissionId }: { submissionId: string }) {
  const [state, formAction] = useActionState(submitDemandSubmissionAction, initialState);
  return (
    <form action={formAction} className="order-action-form">
      <input type="hidden" name="submissionId" value={submissionId} />
      <p className="muted">오류 행이 하나라도 있으면 제출할 수 없습니다.</p>
      <FormMessage state={state} />
      <div className="button-row"><SubmitButton label="제출" /></div>
    </form>
  );
}

export function WithdrawSubmissionForm({ submissionId }: { submissionId: string }) {
  const [state, formAction] = useActionState(withdrawDemandSubmissionAction, initialState);
  return (
    <form action={formAction} className="order-action-form">
      <input type="hidden" name="submissionId" value={submissionId} />
      <label>
        <span>회수 사유 <small>필수</small></span>
        <input className="form-input" name="reason" required maxLength={500} />
      </label>
      <p className="muted">마감일이 지난 뒤 회수하면 미제출 반복 알림이 즉시 다시 시작됩니다.</p>
      <FormMessage state={state} />
      <div className="button-row"><SubmitButton label="회수" className="button approval-reject" /></div>
    </form>
  );
}

/** SCM 품목담당자·ADMIN — 제출완료 상태를 합의완료로 확정한다(부서 편집 잠금) */
export function AgreeSubmissionForm({ submissionId }: { submissionId: string }) {
  const [state, formAction] = useActionState(agreeDemandSubmissionAction, initialState);
  return (
    <form action={formAction} className="order-action-form">
      <input type="hidden" name="submissionId" value={submissionId} />
      <p className="muted">합의를 확정하면 해당 부서는 더 이상 이 제출본을 수정할 수 없습니다.</p>
      <FormMessage state={state} />
      <div className="button-row"><SubmitButton label="합의 확정" /></div>
    </form>
  );
}
