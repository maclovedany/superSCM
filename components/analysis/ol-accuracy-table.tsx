'use client';

// OL 예측 정확도 표 — analytics.v_ol_accuracy
//
//   WAPE = Σ|OL − 실적| ÷ Σ실적     작을수록 좋다
//   Bias = Σ(OL − 실적) ÷ Σ실적     ★ 양수면 과대예측
//
// ★ 실적이 없는 행은 뷰가 이미 채점에서 뺐습니다. 화면은 그 결과를 그리기만 합니다.

import { useMemo, useState } from 'react';
import DataTable, { type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import type { OlAccuracy } from '@/lib/scm-model';

/** 0.417 → 41.7% */
function percent(value: number | null, reasonCode: string | null) {
  if (value === null) return <EmptyValue reasonCode={reasonCode ?? 'CALCULATION_UNAVAILABLE'} />;
  return <>{(value * 100).toFixed(1)}%</>;
}

/** 과대예측(양수)은 붉게, 과소예측(음수)은 푸르게 */
function bias(value: number | null, reasonCode: string | null) {
  if (value === null) return <EmptyValue reasonCode={reasonCode ?? 'CALCULATION_UNAVAILABLE'} />;
  const tone = value > 0 ? 'text-danger' : 'text-good';
  const sign = value > 0 ? '+' : '';
  return <span className={tone}>{sign}{(value * 100).toFixed(1)}%</span>;
}

const columns: Column<OlAccuracy>[] = [
  { key: 'fySheet', label: '회계연도' },
  {
    key: 'modelBase',
    label: '기종',
    render: (row) => (
      <>
        <b>{row.modelBase}</b>
        {row.biz ? <><br /><span className="muted">{row.biz}</span></> : null}
      </>
    ),
  },
  {
    key: 'totalAct',
    label: '실적 합',
    align: 'right',
    render: (row) =>
      row.totalAct === null ? <EmptyValue reasonCode={row.reasonCode ?? 'NO_ACTUAL'} /> : row.totalAct.toLocaleString('ko-KR'),
  },
  { key: 'salesWape', label: '영업 WAPE', align: 'right', render: (row) => percent(row.salesWape, row.reasonCode) },
  { key: 'scmWape', label: 'SCM WAPE', align: 'right', render: (row) => percent(row.scmWape, row.reasonCode) },
  { key: 'salesBias', label: '영업 Bias', align: 'right', render: (row) => bias(row.salesBias, row.reasonCode) },
  { key: 'scmBias', label: 'SCM Bias', align: 'right', render: (row) => bias(row.scmBias, row.reasonCode) },
  {
    key: 'nScoredSales',
    label: '채점 행수',
    align: 'right',
    render: (row) => <span className="muted">영업 {row.nScoredSales} · SCM {row.nScoredScm}</span>,
  },
];

export default function OlAccuracyTable({ rows }: { rows: OlAccuracy[] }) {
  const [search, setSearch] = useState('');
  const [fy, setFy] = useState('ALL');

  const years = useMemo(() => Array.from(new Set(rows.map((row) => row.fySheet))).sort(), [rows]);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const query = search.trim().toLowerCase();
        const matchesSearch = !query || row.modelBase.toLowerCase().includes(query);
        const matchesFy = fy === 'ALL' || row.fySheet === fy;
        return matchesSearch && matchesFy;
      }),
    [fy, rows, search],
  );

  return (
    <div className="section card">
      <div className="card-title">
        <div>
          <h3>기종별 OL 정확도</h3>
          <span>WAPE 는 작을수록 정확합니다. Bias 가 양수면 과대예측입니다.</span>
        </div>
        <span className="muted">{filteredRows.length.toLocaleString('ko-KR')}건</span>
      </div>
      <div className="button-row demand-profile-filters">
        <input
          className="form-input"
          aria-label="기종 검색"
          placeholder="기종 검색"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select className="table-select" aria-label="회계연도 필터" value={fy} onChange={(event) => setFy(event.target.value)}>
          <option value="ALL">전체 회계연도</option>
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </div>
      <DataTable
        columns={columns}
        rows={filteredRows}
        rowKey={(row, index) => `${row.fySheet}-${row.modelBase}-${index}`}
        empty="조건에 맞는 기종이 없습니다."
      />
    </div>
  );
}
