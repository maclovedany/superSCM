'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { decideApprovalAction } from '@/app/(user)/approvals/actions';
import { formatApprovalPayload, type ApprovalRow } from '@/lib/approvals/model';

const initialState = { error: null, success: null };

function DecisionButtons() {
  const { pending } = useFormStatus();
  return (
    <div className="button-row approval-buttons">
      <button className="button primary" type="submit" name="decision" value="APPROVED" disabled={pending}>
        {pending ? '처리 중' : '승인'}
      </button>
      <button className="button approval-reject" type="submit" name="decision" value="REJECTED" disabled={pending}>
        반려
      </button>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '—';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
}

export default function ApprovalTable({ rows }: { rows: ApprovalRow[] }) {
  const [state, formAction] = useActionState(decideApprovalAction, initialState);

  return (
    <>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state.success ? <p className="form-success" role="status">{state.success}</p> : null}
      <div className="analysis-table-wrap approval-table-wrap">
        <table className="analysis-table approval-table">
          <thead>
            <tr>
              <th>승인 유형</th>
              <th>대상</th>
              <th>요청 내용</th>
              <th>요청자 · 시각</th>
              <th>결정</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.approvalId}>
                <td><span className="tag amber">{row.approvalTypeLabel}</span></td>
                <td><b>{row.targetId}</b><br /><span className="muted">{row.targetType}</span></td>
                <td>
                  <div className="approval-reason">{row.reasonText ?? <span className="muted">요청 사유 없음</span>}</div>
                  <details className="approval-payload">
                    <summary>상세 내용</summary>
                    <p>{formatApprovalPayload(row.payload)}</p>
                  </details>
                  {row.approvalType === 'EVENT_ORDER' ? (
                    // Task 8 fix round 1 — 확정 수요 화면 전용 메뉴는 두지 않고, 팀장이 승인 전
                    // 문맥(원천별 상세·월간 합계)을 확인할 최소 동선만 여기서 연결한다(읽기 전용).
                    <Link href="/demand-submissions/consolidation" className="muted">확정 수요 현황 보기</Link>
                  ) : null}
                </td>
                <td>
                  <b>{row.requesterName || row.requestedBy}</b><br />
                  <span className="muted">{formatDate(row.requestedAt)}</span>
                </td>
                <td>
                  <form action={formAction} className="approval-decision-form">
                    <input type="hidden" name="approvalId" value={row.approvalId} />
                    <label>
                      <span>처리 의견 <small>반려 시 필수</small></span>
                      <textarea className="form-input" name="decisionComment" rows={2} placeholder="결정 근거를 입력하세요" />
                    </label>
                    <DecisionButtons />
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
