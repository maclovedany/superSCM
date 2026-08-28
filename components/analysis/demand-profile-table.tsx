'use client';

import { useMemo, useState } from 'react';
import Badge from '@/components/ui/badge';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import type { DemandProfile } from '@/lib/scm-model';

const demandTypeStatus = { SMOOTH: 'SAFE', INTERMITTENT: 'WARNING', ERRATIC: 'WARNING', LUMPY: 'CRITICAL' } as const;

function valueOrEmpty(value: number | null, reasonCode: string | null, suffix = '') {
  return value === null ? <EmptyValue reasonCode={reasonCode ?? 'CALCULATION_UNAVAILABLE'} /> : formatNumber(value, suffix);
}

const columns: Column<DemandProfile>[] = [
  { key: 'itemId', label: 'SKU' },
  { key: 'itemName', label: '품목명' },
  { key: 'adi', label: 'ADI', align: 'right', render: (row) => valueOrEmpty(row.adi, row.reasonCode) },
  { key: 'cvSquared', label: 'CV²', align: 'right', render: (row) => valueOrEmpty(row.cvSquared, row.reasonCode) },
  { key: 'zeroDemandRate', label: 'Zero-demand Rate', align: 'right', render: (row) => valueOrEmpty(row.zeroDemandRate, row.reasonCode, '%') },
  { key: 'trend', label: 'Trend', align: 'right', render: (row) => valueOrEmpty(row.trend, row.reasonCode) },
  { key: 'demandType', label: 'Demand Type', render: (row) => row.demandType ? <Badge status={demandTypeStatus[row.demandType]}>{row.demandType}</Badge> : <EmptyValue reasonCode={row.reasonCode ?? 'CALCULATION_UNAVAILABLE'} /> },
  { key: 'seasonality', label: 'Seasonality', render: (row) => row.seasonality === null ? <EmptyValue reasonCode={row.reasonCode ?? 'INSUFFICIENT_PERIODS'} /> : row.seasonality ? 'SEASONAL' : 'NON_SEASONAL' },
  { key: 'reasonCode', label: 'Reason', render: (row) => row.reasonCode ?? '—' },
];

export default function DemandProfileTable({ rows }: { rows: DemandProfile[] }) {
  const [search, setSearch] = useState('');
  const [demandType, setDemandType] = useState('ALL');
  const [availability, setAvailability] = useState('ALL');
  const filteredRows = useMemo(() => rows.filter((row) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || row.itemId.toLowerCase().includes(query) || row.itemName.toLowerCase().includes(query);
    const matchesType = demandType === 'ALL' || row.demandType === demandType;
    const available = row.demandType !== null;
    const matchesAvailability = availability === 'ALL' || (availability === 'AVAILABLE' && available) || (availability === 'UNAVAILABLE' && !available);
    return matchesSearch && matchesType && matchesAvailability;
  }), [availability, demandType, rows, search]);

  return <div className="section card">
    <div className="card-title"><div><h3>SKU 수요 특성</h3><span>학습 구간의 저장된 분석 결과만 필터링합니다.</span></div></div>
    <div className="button-row demand-profile-filters">
      <input className="form-input" aria-label="SKU 검색" placeholder="SKU 또는 품목명 검색" value={search} onChange={(event) => setSearch(event.target.value)} />
      <select className="table-select" aria-label="수요 유형 필터" value={demandType} onChange={(event) => setDemandType(event.target.value)}><option value="ALL">전체 수요 유형</option><option value="SMOOTH">SMOOTH</option><option value="INTERMITTENT">INTERMITTENT</option><option value="ERRATIC">ERRATIC</option><option value="LUMPY">LUMPY</option></select>
      <select className="table-select" aria-label="계산 가능 여부 필터" value={availability} onChange={(event) => setAvailability(event.target.value)}><option value="ALL">전체 계산 상태</option><option value="AVAILABLE">계산 가능</option><option value="UNAVAILABLE">계산 불가</option></select>
    </div>
    <DataTable columns={columns} rows={filteredRows} rowKey={(row) => row.itemId} empty="조건에 맞는 SKU가 없습니다." />
  </div>;
}
