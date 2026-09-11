// 입고 차이 집계 표 — Task 10b
//
// ★ 평균 · 합계는 analytics.v_receipt_gap_*에 이미 계산돼 저장된 값이다(AGENTS.md 2번 — 화면은 계산하지 않는다).
//   실제 입고일이 없는 행은 평균 · 합계에서 빠졌다는 사실을 n_actual_unset으로 함께 보여준다.

import DataTable, { type Column } from '@/components/ui/data-table';
import type { ReceiptGapEntityRow, ReceiptGapItemRow, ReceiptGapMonthRow } from '@/lib/schedule/model';

function gapCell(value: number | null, suffix = '일') {
  if (value === null) return <span className="muted">—</span>;
  const rounded = Math.round(value * 10) / 10;
  return <span className={value > 0 ? 'text-danger' : value < 0 ? 'text-good' : 'muted'}>{value > 0 ? '+' : ''}{rounded}{suffix}</span>;
}

function unsetCell(nActualUnset: number, nTotal: number) {
  return nActualUnset === 0 ? <span className="muted">0</span> : <span className="tag amber">{nActualUnset} / {nTotal}</span>;
}

const entityColumns: Column<ReceiptGapEntityRow>[] = [
  { key: 'entityId', label: '해외법인', render: (row) => <>{row.entityName ?? row.entityId} <span className="muted">({row.entityId})</span></> },
  { key: 'nTotal', label: '전체', align: 'right', render: (row) => String(row.nTotal) },
  { key: 'nActualUnset', label: '실제 입고일 미입력', align: 'right', render: (row) => unsetCell(row.nActualUnset, row.nTotal) },
  { key: 'avgGapDays', label: '평균 차이', align: 'right', render: (row) => gapCell(row.avgGapDays) },
  { key: 'sumGapDays', label: '합계 차이', align: 'right', render: (row) => gapCell(row.sumGapDays, '') },
];

const itemColumns: Column<ReceiptGapItemRow>[] = [
  { key: 'itemId', label: '품목', render: (row) => <>{row.itemId} <span className="muted">{row.itemName ?? ''}</span></> },
  { key: 'nTotal', label: '전체', align: 'right', render: (row) => String(row.nTotal) },
  { key: 'nActualUnset', label: '실제 입고일 미입력', align: 'right', render: (row) => unsetCell(row.nActualUnset, row.nTotal) },
  { key: 'avgGapDays', label: '평균 차이', align: 'right', render: (row) => gapCell(row.avgGapDays) },
  { key: 'sumGapDays', label: '합계 차이', align: 'right', render: (row) => gapCell(row.sumGapDays, '') },
];

const monthColumns: Column<ReceiptGapMonthRow>[] = [
  { key: 'targetMonth', label: '월(확정 계획 입고일 기준)', render: (row) => row.targetMonth.slice(0, 7) },
  { key: 'nTotal', label: '전체', align: 'right', render: (row) => String(row.nTotal) },
  { key: 'nActualUnset', label: '실제 입고일 미입력', align: 'right', render: (row) => unsetCell(row.nActualUnset, row.nTotal) },
  { key: 'avgGapDays', label: '평균 차이', align: 'right', render: (row) => gapCell(row.avgGapDays) },
  { key: 'sumGapDays', label: '합계 차이', align: 'right', render: (row) => gapCell(row.sumGapDays, '') },
];

export function ReceiptGapEntityTable({ rows }: { rows: ReceiptGapEntityRow[] }) {
  return <DataTable columns={entityColumns} rows={rows} rowKey={(row) => row.entityId} empty="법인별 입고 차이 데이터가 없습니다." />;
}

export function ReceiptGapItemTable({ rows }: { rows: ReceiptGapItemRow[] }) {
  return <DataTable columns={itemColumns} rows={rows} rowKey={(row) => row.itemId} empty="품목별 입고 차이 데이터가 없습니다." />;
}

export function ReceiptGapMonthTable({ rows }: { rows: ReceiptGapMonthRow[] }) {
  return <DataTable columns={monthColumns} rows={rows} rowKey={(row) => row.targetMonth} empty="월별 입고 차이 데이터가 없습니다." />;
}
