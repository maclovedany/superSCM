// 검증 오류 — renew.prd 8.3
//
// 행 번호와 사유를 그대로 보여줍니다. 임의로 보정하지 않습니다.

import { CircleAlert, TriangleAlert } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import Badge from '@/components/ui/badge';
import { ErrorState, EmptyState } from '@/components/ui/state';
import FilterNotice from '@/components/ui/filter-notice';
import { getValidationErrors, type ValidationErrorRow } from '@/lib/import/history';
import { applyFilter, labelOf, readFilter, type FilterSpec, type SearchParams } from '@/lib/filter';

export const dynamic = 'force-dynamic';

const columns: Column<ValidationErrorRow>[] = [
  { key: 'batchId', label: '배치', variant: 'code', render: (row) => row.batchId },
  {
    key: 'filename',
    label: '파일',
    render: (row) => row.filename ?? <span className="text-3">API</span>,
  },
  {
    key: 'rowNumber',
    label: '행',
    align: 'right',
    variant: 'num',
    // 0 은 행이 아니라 파일 전체에 대한 오류입니다
    render: (row) => (row.rowNumber === 0 ? <span className="text-3">파일</span> : row.rowNumber),
  },
  {
    key: 'columnName',
    label: '컬럼',
    variant: 'code',
    render: (row) => row.columnName ?? <span className="text-3">—</span>,
  },
  {
    key: 'severity',
    label: '심각도',
    render: (row) => (
      <Badge tone={row.severity === 'ERROR' ? 'crit' : 'warn'}>
        {row.severity === 'ERROR' ? '오류' : '경고'}
      </Badge>
    ),
  },
  { key: 'code', label: '코드', variant: 'code', render: (row) => row.code },
  { key: 'message', label: '사유', render: (row) => row.message },
  {
    key: 'download',
    label: '내려받기',
    render: (row) => (
      <a className="btn ghost" href={`/api/import/errors/${row.batchId}`}>
        오류 행 CSV
      </a>
    ),
  },
];

export default async function ValidationErrorsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const activeFilter = readFilter(await searchParams);
  const { rows, error } = await getValidationErrors();

  const header = (
    <PageHeader
      title="검증 오류"
      subtitle="업로드에서 걸린 행을 번호와 사유째로 보여줍니다. 오류 행만 CSV 로 내려받아 고친 뒤 다시 올리면 됩니다."
      meta={
        <>
          <MetaChip>PRD 8.3</MetaChip>
          <MetaChip>STEP 4</MetaChip>
        </>
      }
    />
  );

  if (error) {
    return (
      <>
        {header}
        <Panel>
          <ErrorState detail={error} />
        </Panel>
      </>
    );
  }

  if (rows.length === 0) {
    return (
      <>
        {header}
        <Panel>
          <EmptyState
            title="검증 오류가 없습니다"
            desc="아직 올린 파일이 없거나, 올린 파일이 모두 검증을 통과했습니다."
          />
        </Panel>
      </>
    );
  }

  const errorCount = rows.filter((row) => row.severity === 'ERROR').length;
  const warningCount = rows.length - errorCount;
  const byCode = new Map<string, number>();
  for (const row of rows) byCode.set(row.code, (byCode.get(row.code) ?? 0) + 1);
  const topCode = Array.from(byCode.entries()).sort((a, b) => b[1] - a[1])[0];

  // KPI 카드 하나 = 목록 필터 하나 (design.md §6.4)
  const filters: FilterSpec<ValidationErrorRow>[] = [
    { key: 'error', label: '오류', match: (row) => row.severity === 'ERROR' },
    { key: 'warning', label: '경고', match: (row) => row.severity === 'WARNING' },
    {
      key: 'topcode',
      label: topCode ? `${topCode[0]} 유형` : '가장 잦은 유형',
      match: topCode ? (row) => row.code === topCode[0] : null,
    },
  ];
  const visible = applyFilter(rows, filters, activeFilter);
  const filterLabel = labelOf(filters, activeFilter);

  return (
    <>
      {header}

      <div className="grid grid-3">
        <KpiCard
          label="오류"
          value={formatNumber(errorCount)}
          unit="건"
          icon={CircleAlert}
          tone={errorCount > 0 ? 'crit' : 'default'}
          foot="적재되지 않은 행"
          filter={{ key: 'error', active: activeFilter === 'error' }}
        />
        <KpiCard
          label="경고"
          value={formatNumber(warningCount)}
          unit="건"
          icon={TriangleAlert}
          tone={warningCount > 0 ? 'warn' : 'default'}
          foot="적재는 되지만 확인이 필요"
          filter={{ key: 'warning', active: activeFilter === 'warning' }}
        />
        <KpiCard
          label="가장 잦은 유형"
          value={topCode ? topCode[0] : null}
          unit={topCode ? `${topCode[1]}건` : undefined}
          icon={CircleAlert}
          foot="반복되면 원본 양식을 고치는 편이 빠릅니다"
          filter={topCode ? { key: 'topcode', active: activeFilter === 'topcode' } : undefined}
        />
      </div>

      {filterLabel && (
        <FilterNotice label={filterLabel} shown={visible.length} total={rows.length} />
      )}

      <Panel title="오류 목록" actions={<span className="t-label">최근 300건</span>} flush>
        {visible.length === 0 ? (
          <EmptyState
            title={`${filterLabel ?? ''} 에 해당하는 건이 없습니다`}
            desc="위 카드를 다시 눌러 전체 목록으로 돌아갈 수 있습니다."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(row) => String(row.id)}
            caption="core.validation_error — 행 단위 검증 결과"
          />
        )}
      </Panel>
    </>
  );
}
