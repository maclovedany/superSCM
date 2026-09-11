// 확정 수요 구성 화면 표 — Task 8
//
// ★ 합계는 analytics.v_approved_demand_monthly가 계산한 값을 그대로 보여준다(TS에서 다시 더하지 않는다).
// ★ 상세 표는 counted = false인 행도 그대로 보여주고 제외 사유를 함께 표시한다(stage1.md §5).

import DataTable, { type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import type { ApprovedDemandDetailRow, ApprovedDemandMonthlyRow } from '@/lib/demand/approved-model';

function formatQty(value: number | null): string {
  if (value === null) return '—';
  return value.toLocaleString('ko-KR');
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

const monthlyColumns: Column<ApprovedDemandMonthlyRow>[] = [
  {
    key: 'planMonth',
    label: '대상월',
    render: (row) => row.planMonth?.slice(0, 7) ?? <EmptyValue />,
  },
  {
    key: 'itemId',
    label: '품목',
    render: (row) => (
      <>
        <b>{row.itemId ?? <EmptyValue />}</b>
        <br />
        <span className="muted">{row.itemName ?? '—'}</span>
      </>
    ),
  },
  { key: 'approvedQty', label: '승인 수요 합계', align: 'right', render: (row) => <b>{formatQty(row.approvedQty)}</b> },
  { key: 'confirmedOrderQty', label: '수주 확정', align: 'right', render: (row) => formatQty(row.confirmedOrderQty) },
  { key: 'supplyMeetingQty', label: '수급회의 승인', align: 'right', render: (row) => formatQty(row.supplyMeetingQty) },
  { key: 'eventDemandQty', label: '이벤트 승인', align: 'right', render: (row) => formatQty(row.eventDemandQty) },
];

/** 발주 계산에 들어가는 값 — analytics.v_approved_demand_monthly 그대로 */
export function ApprovedDemandMonthlyTable({ rows }: { rows: ApprovedDemandMonthlyRow[] }) {
  return (
    <DataTable
      columns={monthlyColumns}
      rows={rows}
      rowKey={(row, index) => `${row.planMonth ?? ''}:${row.itemId ?? ''}:${index}`}
      empty="확정된 수요가 없습니다."
    />
  );
}

const detailColumns: Column<ApprovedDemandDetailRow>[] = [
  {
    key: 'sourceLabel',
    label: '원천',
    render: (row) => <span className={`tag ${row.counted ? 'green' : 'gray'}`}>{row.sourceLabel}</span>,
  },
  {
    key: 'planMonth',
    label: '대상월',
    render: (row) => row.planMonth?.slice(0, 7) ?? <EmptyValue />,
  },
  {
    key: 'itemId',
    label: '품목',
    render: (row) => (
      <>
        <b>{row.itemId ?? <EmptyValue />}</b>
        <br />
        <span className="muted">{row.itemName ?? '—'}</span>
      </>
    ),
  },
  { key: 'customerName', label: '고객', render: (row) => row.customerName ?? <span className="muted">—</span> },
  { key: 'qty', label: '수량', align: 'right', render: (row) => formatQty(row.qty) },
  {
    key: 'counted',
    label: '반영 여부',
    render: (row) =>
      row.counted ? (
        <span className="tag green">반영</span>
      ) : (
        <span className="tag amber" title={row.exclusionReason ?? undefined}>{row.exclusionLabel ?? '제외'}</span>
      ),
  },
  {
    key: 'referenceLabel',
    label: '근거',
    render: (row) => row.referenceLabel ?? row.referenceId ?? <span className="muted">—</span>,
  },
  {
    key: 'enteredByName',
    label: '입력·확정',
    render: (row) => (
      <>
        {row.enteredByName ?? <span className="muted">—</span>}
        <br />
        <span className="muted">{formatDateTime(row.enteredAt)}</span>
      </>
    ),
  },
];

/** 원천별 상세 — counted = false인 행도 제외 사유와 함께 그대로 보여준다 */
export function ApprovedDemandDetailTable({ rows }: { rows: ApprovedDemandDetailRow[] }) {
  return (
    <DataTable
      columns={detailColumns}
      rows={rows}
      rowKey={(row, index) => `${row.sourceCode ?? ''}:${row.referenceId ?? ''}:${index}`}
      empty="상세 내역이 없습니다."
    />
  );
}
