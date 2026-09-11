'use client';

// 정상 창고재고 · 가용재고 표 — analytics.v_available_stock
//
// ★ 여기서 계산하지 않습니다. 정상 창고재고 분류와 가용재고 뺄셈은 모두 뷰가 만든 값입니다.
// ★ 값이 null이면 빈칸이 아니라 사유 코드를 보입니다. 0으로 채우지 않습니다.

import { useMemo, useState } from 'react';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import type { AvailableStockRow } from '@/lib/inventory/model';

const VISIBILITY_LABELS: Record<AvailableStockRow['visibilityScope'], string> = {
  PAPER_CARD_READER: '용지·카드리더기',
  CONSUMABLE: '소모품',
  GENERAL: '일반',
};

function valueOrEmpty(value: number | null, reasonCode: string | null, suffix = '') {
  return value === null ? <EmptyValue reasonCode={reasonCode ?? 'CALCULATION_UNAVAILABLE'} /> : formatNumber(value, suffix);
}

const columns: Column<AvailableStockRow>[] = [
  {
    key: 'itemId',
    label: '품목',
    render: (row) => (
      <>
        <b>{row.itemId}</b>
        <br />
        <span className="muted">{row.itemName}</span>
      </>
    ),
  },
  {
    key: 'visibilityScope',
    label: '조회 범위',
    render: (row) => <span className="tag gray">{VISIBILITY_LABELS[row.visibilityScope]}</span>,
  },
  {
    key: 'normalWarehouseQty',
    label: '정상 창고재고',
    align: 'right',
    render: (row) => valueOrEmpty(row.normalWarehouseQty, row.reasonCode, ' EA'),
  },
  { key: 'temporaryAllocatedQty', label: '임시배정', align: 'right', render: (row) => formatNumber(row.temporaryAllocatedQty, ' EA') },
  { key: 'firmAllocatedQty', label: '확정배정', align: 'right', render: (row) => formatNumber(row.firmAllocatedQty, ' EA') },
  { key: 'approvalHoldQty', label: '승인대기 확보', align: 'right', render: (row) => formatNumber(row.approvalHoldQty, ' EA') },
  {
    key: 'availableQty',
    label: '가용재고',
    align: 'right',
    render: (row) => <b>{valueOrEmpty(row.availableQty, row.reasonCode, ' EA')}</b>,
  },
  {
    key: 'openPoQty',
    label: 'Open PO (참고)',
    align: 'right',
    render: (row) => (row.openPoQty === null ? <span className="muted">—</span> : formatNumber(row.openPoQty, ' EA')),
  },
  {
    key: 'inTransitQty',
    label: '이동 중 (참고)',
    align: 'right',
    render: (row) => (row.inTransitQty === null ? <span className="muted">—</span> : formatNumber(row.inTransitQty, ' EA')),
  },
  { key: 'snapshotAt', label: '스냅샷 시각', render: (row) => row.snapshotAt ?? <span className="muted">—</span> },
];

export default function StockTable({ rows }: { rows: AvailableStockRow[] }) {
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'ALL' | AvailableStockRow['visibilityScope']>('ALL');

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const query = search.trim().toLowerCase();
        const matchesSearch =
          !query || row.itemId.toLowerCase().includes(query) || row.itemName.toLowerCase().includes(query);
        const matchesScope = scope === 'ALL' || row.visibilityScope === scope;
        return matchesSearch && matchesScope;
      }),
    [rows, scope, search],
  );

  return (
    <>
      <div className="button-row demand-profile-filters">
        <input
          className="form-input"
          aria-label="품목 검색"
          placeholder="품목코드 또는 품명 검색"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className="table-select"
          aria-label="조회 범위 필터"
          value={scope}
          onChange={(event) => setScope(event.target.value as typeof scope)}
        >
          <option value="ALL">전체 범위</option>
          <option value="PAPER_CARD_READER">용지·카드리더기</option>
          <option value="CONSUMABLE">소모품</option>
          <option value="GENERAL">일반</option>
        </select>
      </div>
      <DataTable columns={columns} rows={filteredRows} rowKey={(row) => row.itemId} empty="조건에 맞는 품목이 없습니다." />
    </>
  );
}
