// MANUAL 품목 대기 순번 — core.list_manual_allocation_candidates (Task 11)
//
// ★ 순번 · 부족수량을 여기서 계산하지 않는다. DB 함수가 이미 끝낸 값을 그대로 보여준다.
// ★ 이 표에는 배정 버튼이 없다 — 자동 배정이 일어나지 않는다(컨트롤러 판정 3). 실제 확정배정은
//   위 배정 대기열 표의 수동 확정배정 폼으로 한다.

import EmptyValue from '@/components/ui/empty-value';
import { formatOrderDateTime, type ManualAllocationCandidateRow } from '@/lib/orders/model';

export type ManualAllocationQueueGroup = {
  itemId: string;
  itemName: string | null;
  rows: ManualAllocationCandidateRow[];
  error: string | null;
};

export default function ManualAllocationQueue({ groups }: { groups: ManualAllocationQueueGroup[] }) {
  if (groups.length === 0) return null;

  return (
    <div className="section card">
      <div className="card-title">
        <div>
          <h3>MANUAL 품목 대기 순번</h3>
          <span>수동 배정 품목의 대기 순번입니다. 여기서는 조회만 하며 배정은 위 대기열 표에서 처리합니다.</span>
        </div>
      </div>
      {groups.map((group) => (
        <div key={group.itemId} className="manual-allocation-group">
          <div className="manual-allocation-group-head">
            <b>{group.itemId}</b>
            <span className="muted">{group.itemName ?? '품목명 미상'}</span>
          </div>
          {group.error ? (
            <p className="text-danger">조회에 실패했습니다: {group.error}</p>
          ) : group.rows.length === 0 ? (
            <p className="muted">대기 중인 주문이 없습니다.</p>
          ) : (
            <ol className="manual-allocation-list">
              {group.rows.map((row) => (
                <li key={row.lineId}>
                  <span className="tag gray">{row.queueRank ?? '—'}번</span>
                  <b>{row.orderNo}</b>
                  <span className="muted">{row.customerName} · {row.ownerName}</span>
                  <span>
                    부족 {row.shortageQty === null ? <EmptyValue reasonCode="CALCULATION_UNAVAILABLE" /> : row.shortageQty.toLocaleString('ko-KR')}
                  </span>
                  <span className="muted">{formatOrderDateTime(row.firstReviewRequestedAt) ?? '—'}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}
    </div>
  );
}
