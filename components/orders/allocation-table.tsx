'use client';

// 배정 대기열 표 — analytics.v_allocation_queue (Task 5)
//
// ★ 여기서 순번 · 가용재고 · 부족수량을 계산하지 않습니다. 모두 뷰가 계산한 값입니다.
// ★ SCM 모드는 수동 확정배정과 확정배정 취소, PRIORITY 모드는 사업강화부 우선순위 변경만 보입니다.
//   화면에 버튼이 보여도 실제 허용 여부는 서버 액션과 DB 함수가 다시 판정합니다.

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { formatNumber } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import {
  cancelFirmAllocationAction,
  changeAllocationPriorityAction,
  requestManualAllocationAction,
} from '@/lib/orders/actions';
import {
  ALLOCATION_CHOICE_LABELS,
  ALLOCATION_PRIORITY_DEFAULT,
  ALLOCATION_PRIORITY_MAX,
  ALLOCATION_PRIORITY_MIN,
  allocationStatusTone,
  formatOrderDateTime,
  orderStatusTone,
  type ActiveAllocation,
  type AllocationQueueRow,
  type OrderActionState,
} from '@/lib/orders/model';

const initialState: OrderActionState = { error: null, success: null };

const PRIORITY_OPTIONS = Array.from(
  { length: ALLOCATION_PRIORITY_MAX - ALLOCATION_PRIORITY_MIN + 1 },
  (_, index) => ALLOCATION_PRIORITY_MIN + index,
);

function quantity(value: number | null, reasonCode?: string | null) {
  return value === null ? <EmptyValue reasonCode={reasonCode ?? 'CALCULATION_UNAVAILABLE'} /> : formatNumber(value);
}

function dateText(value: string | null) {
  return formatOrderDateTime(value) ?? <span className="muted">—</span>;
}

function FormMessage({ state }: { state: OrderActionState }) {
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

function ManualAllocationForm({ row }: { row: AllocationQueueRow }) {
  const [state, formAction] = useActionState(requestManualAllocationAction, initialState);
  return (
    <form action={formAction} className="allocation-inline-form">
      <input type="hidden" name="orderId" value={row.orderId} />
      <input type="hidden" name="itemId" value={row.itemId} />
      <label>
        <span>수동 확정배정 수량</span>
        <input className="form-input" name="qty" inputMode="decimal" required />
      </label>
      <label>
        <span>우선 배정 사유 <small>앞선 대기 주문이 있으면 필수 · 팀장 승인</small></span>
        <input className="form-input" name="reason" maxLength={500} />
      </label>
      <FormMessage state={state} />
      <SubmitButton label="확정배정" />
    </form>
  );
}

function FirmCancelForm({ allocation }: { allocation: ActiveAllocation }) {
  const [state, formAction] = useActionState(cancelFirmAllocationAction, initialState);
  return (
    <form action={formAction} className="allocation-inline-form">
      <input type="hidden" name="allocationId" value={allocation.allocationId} />
      <label>
        <span>취소 사유 <small>필수 · 주문도 함께 취소됩니다</small></span>
        <input className="form-input" name="reason" required maxLength={500} />
      </label>
      <FormMessage state={state} />
      <SubmitButton label="확정배정 취소" className="button approval-reject" />
    </form>
  );
}

function PriorityForm({ row }: { row: AllocationQueueRow }) {
  const [state, formAction] = useActionState(changeAllocationPriorityAction, initialState);
  return (
    <form action={formAction} className="allocation-inline-form">
      <input type="hidden" name="orderId" value={row.orderId} />
      <label>
        <span>우선순위 <small>1 최우선 · 9 최후순</small></span>
        <select className="table-select" name="priority" defaultValue={String(row.allocationPriority ?? ALLOCATION_PRIORITY_DEFAULT)}>
          {PRIORITY_OPTIONS.map((priority) => (
            <option key={priority} value={priority}>
              {priority}{priority === ALLOCATION_PRIORITY_DEFAULT ? ' (기본)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>변경 사유 <small>필수</small></span>
        <input className="form-input" name="reason" required maxLength={500} />
      </label>
      <FormMessage state={state} />
      <SubmitButton label="우선순위 변경" />
    </form>
  );
}

export default function AllocationTable({
  rows,
  mode,
  canManual = false,
  canCancelFirm = false,
}: {
  rows: AllocationQueueRow[];
  mode: 'SCM' | 'PRIORITY';
  canManual?: boolean;
  canCancelFirm?: boolean;
}) {
  const [search, setSearch] = useState('');

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => [row.itemId, row.itemName ?? '', row.orderNo, row.customerName, row.ownerName]
      .some((value) => value.toLowerCase().includes(query)));
  }, [rows, search]);

  const showActions = mode === 'PRIORITY' || canManual;

  return (
    <>
      <div className="button-row demand-profile-filters">
        <input
          className="form-input"
          aria-label="배정 대기열 검색"
          placeholder="품목코드 · 품명 · 주문번호 · 고객 · 영업담당자 검색"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {filteredRows.length === 0 ? (
        <p className="muted">조건에 맞는 주문 품목이 없습니다.</p>
      ) : (
        <div className="analysis-table-wrap">
          <table className="analysis-table allocation-table">
            <thead>
              <tr>
                <th>품목 · 가용재고</th>
                <th className="num">대기 순번</th>
                <th>주문</th>
                <th className="num">요청</th>
                <th className="num">임시</th>
                <th className="num">확정</th>
                <th className="num">승인대기</th>
                <th className="num">부족</th>
                <th className="num">우선순위</th>
                <th>최초 검토 요청 · 임시배정 만료</th>
                <th>활성 배정</th>
                {showActions ? <th>처리</th> : null}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.lineId}>
                  <td>
                    <b>{row.itemId}</b>
                    <br />
                    <span className="muted">{row.itemName ?? '품목명 미상'}</span>
                    <div className="allocation-cell-meta">
                      {row.allocationMode === 'MANUAL' ? <span className="tag amber">수동 배정 품목</span>
                        : row.allocationMode === 'AUTO' ? <span className="tag blue">자동 배정 품목</span>
                          : <span className="tag gray">배정 방식 미설정</span>}
                      <span>가용 {quantity(row.itemAvailableQty, row.reasonCode)}</span>
                    </div>
                  </td>
                  <td className="num">{row.queueRank === null ? <span className="muted">부족 없음</span> : `${row.queueRank}번`}</td>
                  <td>
                    <b>{row.orderNo}</b> <span className={`tag ${orderStatusTone(row.orderStatus)}`}>{row.orderStatusLabel}</span>
                    <br />
                    <span className="muted">
                      {row.customerName} · {row.ownerName}
                      {row.allocationChoice ? ` · ${ALLOCATION_CHOICE_LABELS[row.allocationChoice]}` : ''}
                    </span>
                  </td>
                  <td className="num">{quantity(row.requestedQty)}</td>
                  <td className="num">{quantity(row.temporaryAllocatedQty)}</td>
                  <td className="num">{quantity(row.firmAllocatedQty)}</td>
                  <td className="num">{quantity(row.approvalHoldQty)}</td>
                  <td className="num"><b>{quantity(row.shortageQty)}</b></td>
                  <td className="num">{quantity(row.allocationPriority)}</td>
                  <td>
                    {dateText(row.firstReviewRequestedAt)}
                    <br />
                    <span className="muted">만료 {dateText(row.temporaryExpiresAt)}</span>
                  </td>
                  <td>
                    {row.activeAllocations.length === 0 ? <span className="muted">없음</span> : (
                      <div className="allocation-chip-list">
                        {row.activeAllocations.map((allocation) => (
                          <div className="allocation-chip" key={allocation.allocationId}>
                            <span className={`tag ${allocationStatusTone(allocation.status)}`}>{allocation.statusLabel}</span>{' '}
                            <b>{quantity(allocation.qty)}</b>
                            {allocation.reason ? <span className="muted"> · {allocation.reason}</span> : null}
                            {mode === 'SCM' && canCancelFirm && allocation.status === 'FIRM'
                              ? <FirmCancelForm allocation={allocation} />
                              : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  {showActions ? (
                    <td>
                      {mode === 'PRIORITY'
                        ? <PriorityForm row={row} />
                        : row.shortageQty !== null && row.shortageQty > 0
                          ? <ManualAllocationForm row={row} />
                          : <span className="muted">부족 수량 없음</span>}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
