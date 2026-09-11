'use client';

// 품목 정책 변경 이력 표 — Task 9a (fix round 1: 요청자 본인 취소 추가)
//
// ★ 승인·반려는 이 표에 두지 않는다 — 공통 승인함(/approvals)이 처리한다. 여기서는 대기(PENDING)
//   중인 자신의 변경안만 취소할 수 있다(core.cancel_item_policy_change).

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import EmptyValue from '@/components/ui/empty-value';
import Badge from '@/components/ui/badge';
import { cancelItemPolicyChangeAction, type ItemPolicyActionState } from '@/lib/item-policy/actions';
import type { ItemPolicyAllocationMode, ItemPolicyRevision } from '@/lib/item-policy/model';

const initialState: ItemPolicyActionState = { error: null, success: null };

function formatQty(value: number | null): string | null {
  return value === null ? null : value.toLocaleString('ko-KR');
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function allocationModeLabel(mode: ItemPolicyAllocationMode | null): string {
  if (mode === 'MANUAL') return '수동';
  if (mode === 'AUTO') return '자동';
  return '—';
}

function StatusBadge({ status }: { status: ItemPolicyRevision['status'] }) {
  if (status === 'PENDING') return <Badge status="WARNING">승인 대기</Badge>;
  if (status === 'APPROVED') return <Badge status="SAFE">승인됨</Badge>;
  if (status === 'REJECTED') return <Badge status="CRITICAL">반려됨</Badge>;
  return <Badge status="CALCULATION_UNAVAILABLE">취소됨</Badge>;
}

function CancelButton() {
  const { pending } = useFormStatus();
  return (
    <button className="button approval-reject" type="submit" disabled={pending}>
      {pending ? '처리 중' : '변경안 취소'}
    </button>
  );
}

/** 자신이 요청한 PENDING 변경안 한 줄에 들어가는 인라인 취소 폼 */
function CancelForm({ revisionId }: { revisionId: string }) {
  const [state, formAction] = useActionState(cancelItemPolicyChangeAction, initialState);
  return (
    <form action={formAction} className="approval-decision-form">
      <input type="hidden" name="revisionId" value={revisionId} />
      <label>
        <span>취소 사유 <small>필수</small></span>
        <textarea className="form-input" name="reason" rows={2} placeholder="예: 오타로 잘못 제출했습니다" required />
      </label>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state.success ? <p className="form-success" role="status">{state.success}</p> : null}
      <div className="button-row"><CancelButton /></div>
    </form>
  );
}

export default function ItemPolicyRevisionTable({
  rows,
  currentUserId,
}: {
  rows: ItemPolicyRevision[];
  currentUserId: string;
}) {
  if (rows.length === 0) return <p className="muted">변경 요청 이력이 없습니다.</p>;

  return (
    <div className="analysis-table-wrap">
      <table className="analysis-table">
        <thead>
          <tr>
            <th>품목</th>
            <th>상태</th>
            <th style={{ textAlign: 'right' }}>목표 DoS 제안</th>
            <th style={{ textAlign: 'center' }}>배정 방식 제안</th>
            <th>변경 사유</th>
            <th>요청</th>
            <th>처리</th>
            <th>취소</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const canCancel = row.status === 'PENDING' && row.requestedBy === currentUserId;
            return (
              <tr key={row.revisionId}>
                <td><b>{row.itemId}</b><br /><span className="muted">{row.itemName ?? '—'}</span></td>
                <td><StatusBadge status={row.status} /></td>
                <td style={{ textAlign: 'right' }}>
                  {formatQty(row.proposedTargetDosDays) ?? '변경 없음'}
                  <br /><span className="muted">(기존 {formatQty(row.previousTargetDosDays) ?? '—'})</span>
                </td>
                <td style={{ textAlign: 'center' }}>
                  {allocationModeLabel(row.proposedAllocationMode)}
                  <br /><span className="muted">(기존 {allocationModeLabel(row.previousAllocationMode)})</span>
                </td>
                <td>{row.reason}</td>
                <td>{row.requesterName}<br /><span className="muted">{formatDateTime(row.requestedAt)}</span></td>
                <td>
                  {row.deciderName
                    ? <>{row.deciderName}<br /><span className="muted">{formatDateTime(row.decidedAt)}</span></>
                    : <span className="muted">대기 중</span>}
                </td>
                <td>
                  {canCancel ? <CancelForm revisionId={row.revisionId} /> : (row.status === 'PENDING' ? <EmptyValue reasonCode="NOT_REQUESTER" /> : <span className="muted">—</span>)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
