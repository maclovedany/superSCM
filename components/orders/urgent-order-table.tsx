'use client';

// 긴급발주 표 — analytics.v_urgent_order (Task 11)
//
// ★ 여기서 배정이나 재고를 계산하지 않는다. 모두 뷰가 계산한 값이다.
// ★ canManage(ALLOC_MANUAL, SCM 품목담당자)만 등록 · 수정 · 상태 변경 폼을 본다. 서비스부
//   (URGENT_ORDER_VIEW)는 조회만 한다 — 화면에 폼이 보여도 실제 허용 여부는 서버 액션과 DB
//   함수가 다시 판정한다.

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { formatOrderDateTime } from '@/lib/orders/model';
import {
  changeUrgentOrderStatusAction,
  createUrgentOrderAction,
  updateUrgentOrderAction,
} from '@/lib/urgent-orders/actions';
import {
  TERMINAL_URGENT_ORDER_STATUSES,
  URGENT_ORDER_STATUSES,
  URGENT_ORDER_STATUS_LABELS,
  urgentOrderStatusTone,
  type UrgentOrderActionState,
  type UrgentOrderRow,
} from '@/lib/urgent-orders/model';

const initialState: UrgentOrderActionState = { error: null, success: null };

function FormMessage({ state }: { state: UrgentOrderActionState }) {
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

export function CreateUrgentOrderForm() {
  const [state, formAction] = useActionState(createUrgentOrderAction, initialState);
  return (
    <form action={formAction} className="order-action-form">
      <label>
        <span>품목코드 <small>필수</small></span>
        <input className="form-input" name="itemId" required maxLength={64} />
      </label>
      <label>
        <span>수량 <small>필수 · 0보다 큰 숫자</small></span>
        <input className="form-input" name="qty" inputMode="decimal" required />
      </label>
      <label>
        <span>필요일 <small>필수</small></span>
        <input className="form-input" type="date" name="neededBy" required />
      </label>
      <label>
        <span>사유 <small>필수</small></span>
        <input className="form-input" name="reason" maxLength={500} required />
      </label>
      <FormMessage state={state} />
      <div className="button-row"><SubmitButton label="긴급발주 등록" /></div>
    </form>
  );
}

function UpdateForm({ row }: { row: UrgentOrderRow }) {
  const [state, formAction] = useActionState(updateUrgentOrderAction, initialState);
  return (
    <form action={formAction} className="allocation-inline-form">
      <input type="hidden" name="urgentOrderId" value={row.urgentOrderId} />
      <label>
        <span>수량</span>
        <input className="form-input" name="qty" inputMode="decimal" defaultValue={row.qty ?? ''} required />
      </label>
      <label>
        <span>필요일</span>
        <input className="form-input" type="date" name="neededBy" defaultValue={row.neededBy ?? ''} required />
      </label>
      <label>
        <span>사유</span>
        <input className="form-input" name="reason" defaultValue={row.reason} maxLength={500} required />
      </label>
      <label>
        <span>변경 사유 <small>필수</small></span>
        <input className="form-input" name="changeReason" maxLength={500} required />
      </label>
      <FormMessage state={state} />
      <SubmitButton label="내용 수정" />
    </form>
  );
}

function StatusForm({ row }: { row: UrgentOrderRow }) {
  const [state, formAction] = useActionState(changeUrgentOrderStatusAction, initialState);
  const nextStatuses = URGENT_ORDER_STATUSES.filter((status) => status !== row.status);
  return (
    <form action={formAction} className="allocation-inline-form">
      <input type="hidden" name="urgentOrderId" value={row.urgentOrderId} />
      <label>
        <span>다음 상태</span>
        <select className="table-select" name="status" defaultValue={nextStatuses[0]}>
          {nextStatuses.map((status) => (
            <option key={status} value={status}>{URGENT_ORDER_STATUS_LABELS[status]}</option>
          ))}
        </select>
      </label>
      <label>
        <span>사유 <small>필수</small></span>
        <input className="form-input" name="reason" maxLength={500} required />
      </label>
      <FormMessage state={state} />
      <SubmitButton label="상태 변경" className="button" />
    </form>
  );
}

export default function UrgentOrderTable({ rows, canManage }: { rows: UrgentOrderRow[]; canManage: boolean }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const isTerminal = (row: UrgentOrderRow) => row.status !== null && (TERMINAL_URGENT_ORDER_STATUSES as readonly string[]).includes(row.status);

  return (
    <div className="analysis-table-wrap">
      <table className="analysis-table">
        <thead>
          <tr>
            <th>품목</th>
            <th className="num">수량</th>
            <th>필요일</th>
            <th>사유</th>
            <th>상태</th>
            <th>담당자</th>
            <th>등록일시</th>
            {canManage ? <th>처리</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.urgentOrderId}>
              <td><b>{row.itemId}</b><br /><span className="muted">{row.itemName ?? '품목명 미상'}</span></td>
              <td className="num">{row.qty === null ? <span className="muted">—</span> : row.qty.toLocaleString('ko-KR')}</td>
              <td>{row.neededBy ?? <span className="muted">—</span>}</td>
              <td>{row.reason}</td>
              <td><span className={`tag ${urgentOrderStatusTone(row.status)}`}>{row.statusLabel}</span></td>
              <td>{row.ownerName}</td>
              <td>{formatOrderDateTime(row.createdAt) ?? <span className="muted">—</span>}</td>
              {canManage ? (
                <td>
                  {isTerminal(row) ? (
                    <span className="muted">종료됨</span>
                  ) : expandedId === row.urgentOrderId ? (
                    <div className="urgent-order-actions">
                      <UpdateForm row={row} />
                      <StatusForm row={row} />
                      <button className="button ghost" type="button" onClick={() => setExpandedId(null)}>닫기</button>
                    </div>
                  ) : (
                    <button className="button" type="button" onClick={() => setExpandedId(row.urgentOrderId)}>수정 · 상태 변경</button>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
