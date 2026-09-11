'use client';

// 영업(ATP_VIEW) 전용 — analytics.v_order_available_stock 표
//
// ★ 재고 상세(배정 내역 · Open PO · 이동 중 · 스냅샷 시각)는 담지 않습니다. 영업은
//   실제 주문 가능 수량만 봅니다 (stage1 §2, fix round 1).
// ★ 값이 null이면 빈칸이 아니라 사유 코드를 보입니다. 0으로 채우지 않습니다.

import { useMemo, useState } from 'react';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import type { OrderAvailableStockRow } from '@/lib/inventory/model';

const columns: Column<OrderAvailableStockRow>[] = [
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
    key: 'availableQty',
    label: '주문 가능 수량',
    align: 'right',
    render: (row) =>
      row.availableQty === null ? (
        <EmptyValue reasonCode={row.reasonCode ?? 'CALCULATION_UNAVAILABLE'} />
      ) : (
        <b>{formatNumber(row.availableQty, ' EA')}</b>
      ),
  },
];

export default function OrderAvailableTable({ rows }: { rows: OrderAvailableStockRow[] }) {
  const [search, setSearch] = useState('');

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const query = search.trim().toLowerCase();
        return !query || row.itemId.toLowerCase().includes(query) || row.itemName.toLowerCase().includes(query);
      }),
    [rows, search],
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
      </div>
      <DataTable columns={columns} rows={filteredRows} rowKey={(row) => row.itemId} empty="조건에 맞는 품목이 없습니다." />
    </>
  );
}
