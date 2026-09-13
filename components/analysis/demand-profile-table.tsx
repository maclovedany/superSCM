'use client';

// 실데이터 수요 프로파일 표 — analytics.v_item_demand_profile
//
// ★ 여기서 계산하지 않습니다. ADI · CV² · 수요유형은 전부 뷰가 만든 값입니다.
// ★ 값이 null 이면 빈칸으로 두고 사유 코드를 보입니다. 0 으로 채우지 않습니다.

import { useMemo, useState } from 'react';
import Badge from '@/components/ui/badge';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import type { ItemDemandProfile } from '@/lib/scm-model';

const demandTypeStatus = {
  SMOOTH: 'SAFE',
  INTERMITTENT: 'WARNING',
  ERRATIC: 'WARNING',
  LUMPY: 'CRITICAL',
} as const;

function valueOrEmpty(value: number | null, reasonCode: string | null, suffix = '') {
  return value === null ? <EmptyValue reasonCode={reasonCode ?? 'CALCULATION_UNAVAILABLE'} /> : formatNumber(value, suffix);
}

const columns: Column<ItemDemandProfile>[] = [
  {
    key: 'itemCode',
    label: '품목',
    render: (row) => (
      <>
        <b>{row.itemCode}</b>
        <br />
        <span className="muted">{row.description}</span>
      </>
    ),
  },
  { key: 'itemType', label: '구분', render: (row) => row.itemType ?? <span className="muted">—</span> },
  {
    key: 'lastYm',
    label: '관측 기간',
    render: (row) => (
      <span className="muted">
        {row.firstYm ?? '—'} ~ {row.lastYm ?? '—'} ({row.nPeriods}개월 중 {row.nNonzero}개월)
      </span>
    ),
  },
  { key: 'adi', label: 'ADI', align: 'right', render: (row) => valueOrEmpty(row.adi, row.reasonCode) },
  { key: 'cvSquared', label: 'CV²', align: 'right', render: (row) => valueOrEmpty(row.cvSquared, row.reasonCode) },
  {
    key: 'zeroDemandRate',
    label: '무수요 비율',
    align: 'right',
    render: (row) => valueOrEmpty(row.zeroDemandRate, row.reasonCode),
  },
  {
    key: 'meanNonzeroQty',
    label: '평균 출고량',
    align: 'right',
    render: (row) => valueOrEmpty(row.meanNonzeroQty, row.reasonCode, ' EA'),
  },
  {
    key: 'demandType',
    label: '수요 유형',
    render: (row) =>
      row.demandType ? (
        <Badge status={demandTypeStatus[row.demandType]}>{row.demandType}</Badge>
      ) : (
        <EmptyValue reasonCode={row.reasonCode ?? 'CALCULATION_UNAVAILABLE'} />
      ),
  },
  { key: 'reasonCode', label: '사유', render: (row) => row.reasonCode ?? <span className="muted">—</span> },
];

/**
 * total 은 뷰의 전수이고 rows 는 받아 온 행입니다 — 둘은 다릅니다.
 *
 * ★ 검색·필터를 브라우저에서 하므로 받아 오지 못한 행은 검색해도 나오지 않습니다. 그 사실을
 *   숨기지 않고 카드 머리에 적습니다 — 잘린 표를 전량처럼 보이게 두지 않습니다.
 *   전량을 받으려면 가상화가 함께 와야 합니다(data-table.tsx 는 전 행을 DOM 에 그립니다).
 */
export default function DemandProfileTable({ rows, total }: { rows: ItemDemandProfile[]; total: number | null }) {
  const [search, setSearch] = useState('');
  const [demandType, setDemandType] = useState('ALL');
  const [itemType, setItemType] = useState('ALL');

  const itemTypes = useMemo(() => {
    const found = new Set<string>();
    for (const row of rows) if (row.itemType) found.add(row.itemType);
    return Array.from(found).sort();
  }, [rows]);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const query = search.trim().toLowerCase();
        const matchesSearch =
          !query || row.itemCode.toLowerCase().includes(query) || row.description.toLowerCase().includes(query);
        const matchesType = demandType === 'ALL' || row.demandType === demandType;
        const matchesItemType = itemType === 'ALL' || row.itemType === itemType;
        return matchesSearch && matchesType && matchesItemType;
      }),
    [demandType, itemType, rows, search],
  );

  return (
    <div className="section card">
      <div className="card-title">
        <div>
          <h3>품목별 수요 성격</h3>
          <span>Syntetos–Boylan 분류. 관측 6개월 미만은 유형을 추정하지 않습니다.</span>
        </div>
        <span className="muted">
          {filteredRows.length.toLocaleString('ko-KR')}건
          {total !== null && total > rows.length
            ? ` · 전체 ${total.toLocaleString('ko-KR')}건 중 ${rows.length.toLocaleString('ko-KR')}건만 받았습니다`
            : ''}
        </span>
      </div>
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
          aria-label="수요 유형 필터"
          value={demandType}
          onChange={(event) => setDemandType(event.target.value)}
        >
          <option value="ALL">전체 수요 유형</option>
          <option value="SMOOTH">SMOOTH</option>
          <option value="INTERMITTENT">INTERMITTENT</option>
          <option value="ERRATIC">ERRATIC</option>
          <option value="LUMPY">LUMPY</option>
        </select>
        <select
          className="table-select"
          aria-label="품목 구분 필터"
          value={itemType}
          onChange={(event) => setItemType(event.target.value)}
        >
          <option value="ALL">전체 구분</option>
          {itemTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>
      <DataTable
        columns={columns}
        rows={filteredRows}
        rowKey={(row) => row.itemCode}
        empty="조건에 맞는 품목이 없습니다."
      />
    </div>
  );
}
