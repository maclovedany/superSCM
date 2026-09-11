// 월말 재고 성과 표 — analytics.v_inventory_performance (Task 12)
//
// ★ 여기서 계산하지 않는다. 실제 수량 · 금액 · 목표재고 · 차이는 모두 DB 뷰가 만든 값이다.
// ★ 값이 null이면 빈칸이 아니라 사유 코드를 보인다 — 0으로 채우지 않는다(AGENTS.md 5번).

import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import type { InventoryPerformanceRow } from '@/lib/kpi/model';

function qtyOrEmpty(value: number | null, reasonCode: string | null, suffix = '') {
  return value === null ? <EmptyValue reasonCode={reasonCode ?? 'CALCULATION_UNAVAILABLE'} /> : formatNumber(value, suffix);
}

function valueOrEmpty(value: number | null, reasonCode: string | null) {
  return value === null ? (
    <EmptyValue reasonCode={reasonCode ?? 'CALCULATION_UNAVAILABLE'} />
  ) : (
    `${value.toLocaleString('ko-KR')}원`
  );
}

const columns: Column<InventoryPerformanceRow>[] = [
  {
    key: 'itemId',
    label: '품목',
    render: (row) => (
      <>
        <b>{row.itemId}</b>
        <br />
        <span className="muted">{row.itemName ?? '미정'}</span>
      </>
    ),
  },
  {
    key: 'actualQty',
    label: '월말 재고수량',
    align: 'right',
    render: (row) => qtyOrEmpty(row.actualQty, row.qtyReasonCode, ' EA'),
  },
  {
    key: 'unitPrice',
    label: '승인 단가',
    align: 'right',
    render: (row) => (row.unitPrice === null ? <EmptyValue reasonCode="UNIT_PRICE_UNSET" /> : `${row.unitPrice.toLocaleString('ko-KR')}원`),
  },
  {
    key: 'actualValue',
    label: '월말 재고금액',
    align: 'right',
    render: (row) => <b>{valueOrEmpty(row.actualValue, row.valueReasonCode)}</b>,
  },
  {
    key: 'targetStockQty',
    label: '목표재고',
    align: 'right',
    render: (row) => qtyOrEmpty(row.targetStockQty, row.targetStockReasonCode, ' EA'),
  },
  {
    key: 'diffQty',
    label: '실제 − 목표',
    align: 'right',
    render: (row) => {
      if (row.diffQty === null) return <EmptyValue reasonCode={row.diffReasonCode ?? 'CALCULATION_UNAVAILABLE'} />;
      const tone = row.diffQty < 0 ? 'text-danger' : 'text-good';
      return <span className={tone}>{formatNumber(row.diffQty, ' EA')}</span>;
    },
  },
  {
    key: 'snapshotAt',
    label: '스냅샷 시각',
    render: (row) => row.snapshotAt ?? <span className="muted">—</span>,
  },
];

export default function InventoryPerformanceTable({ rows }: { rows: InventoryPerformanceRow[] }) {
  return <DataTable columns={columns} rows={rows} rowKey={(row) => row.itemId} empty="이 기준월에 표시할 품목이 없습니다." />;
}
