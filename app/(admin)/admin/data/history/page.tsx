// 적재 이력 — renew.prd 8.5

import { Database, FileCheck2, RotateCcw } from 'lucide-react';
import { kstMinute } from '@/lib/time';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import Badge from '@/components/ui/badge';
import { ErrorState, EmptyState } from '@/components/ui/state';
import FilterNotice from '@/components/ui/filter-notice';
import { getImportHistory, type ImportBatch } from '@/lib/import/history';
import { getStaleSummary } from '@/lib/admin-ops';
import { applyFilter, labelOf, readFilter, type FilterSpec, type SearchParams } from '@/lib/filter';
import RollbackForm from './rollback-form';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, { label: string; tone: 'safe' | 'warn' | 'crit' | 'unknown' | 'info' }> = {
  PENDING: { label: '확인 대기', tone: 'info' },
  IMPORTED: { label: '적재됨', tone: 'safe' },
  CANCELLED: { label: '취소됨', tone: 'unknown' },
  ROLLED_BACK: { label: '되돌림', tone: 'warn' },
  FAILED: { label: '실패', tone: 'crit' },
};

const MODE: Record<string, string> = {
  append: '추가',
  upsert: '갱신',
  replace: '기간 교체',
};

/**
 * 표 정의를 함수로 둔 이유 — "영향: 예측 재실행 필요" 배지가 화면 밖 값을 봅니다.
 *
 * 배지를 다는 기준은 하나입니다. 그 배치가 올라온 시각이 **화면이 쓰는 예측의
 * 데이터 기준 시각보다 뒤**이면, 그 예측은 이 배치를 보지 못한 것입니다.
 * 판정 자체(is_stale)는 SQL 이 합니다 (analytics.v_stale_summary). 여기서는
 * 어느 배치가 그 원인인지 두 시각을 견주기만 합니다.
 */
function columnsFor(dataSnapshotAt: string | null, isStale: boolean): Column<ImportBatch>[] {
  return [
  { key: 'batchId', label: '배치', variant: 'code', render: (row) => row.batchId },
  {
    key: 'filename',
    label: '파일',
    variant: 'strong',
    render: (row) => row.filename ?? <span className="text-3">API</span>,
  },
  { key: 'dataType', label: '종류', render: (row) => row.dataType },
  { key: 'sourceType', label: '출처', variant: 'code', render: (row) => row.sourceType },
  { key: 'mode', label: '방식', render: (row) => MODE[row.mode] ?? row.mode },
  { key: 'total', label: '전체', align: 'right', variant: 'num', render: (row) => formatNumber(row.totalRows) },
  {
    key: 'imported',
    label: '적재',
    align: 'right',
    variant: 'num',
    render: (row) => formatNumber(row.importedRows),
  },
  {
    key: 'errors',
    label: '오류',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.errorRows === 0 ? (
        <span className="text-3">0</span>
      ) : (
        <span style={{ color: 'var(--crit-fg)', fontWeight: 500 }}>{formatNumber(row.errorRows)}</span>
      ),
  },
  {
    key: 'status',
    label: '상태',
    render: (row) => {
      const status = STATUS[row.status] ?? { label: row.status, tone: 'unknown' as const };
      const affects =
        isStale &&
        row.status === 'IMPORTED' &&
        row.uploadedAt !== null &&
        (dataSnapshotAt === null || row.uploadedAt > dataSnapshotAt);
      return (
        <span style={{ display: 'inline-flex', gap: 'var(--s-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <Badge tone={status.tone}>{status.label}</Badge>
          {affects && <Badge tone="warn">영향: 예측 재실행 필요</Badge>}
        </span>
      );
    },
  },
  {
    key: 'uploadedAt',
    label: '올린 시각',
    align: 'right',
    variant: 'num',
    render: (row) => (row.uploadedAt ? kstMinute(row.uploadedAt) : '—'),
  },
  {
    key: 'rollback',
    label: '되돌리기',
    render: (row) => <RollbackForm batchId={row.batchId} available={row.rollbackAvailable} />,
  },
  ];
}

/**
 * KPI 카드 하나 = 목록 필터 하나 (design.md §6.4).
 *
 * "적재된 행" 은 배치 합계라 목록으로 좁혀지지 않으므로,
 * 카드를 "적재 완료 배치" 로 바꿔 뜻과 필터를 맞췄습니다.
 */
const FILTERS: FilterSpec<ImportBatch>[] = [
  { key: 'all', label: '전체 배치', match: null },
  { key: 'imported', label: '적재 완료', match: (row) => row.status === 'IMPORTED' },
  { key: 'haserror', label: '검증 오류 있음', match: (row) => row.errorRows > 0 },
];

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const activeFilter = readFilter(await searchParams);
  const [{ rows, error }, { data: stale }] = await Promise.all([
    getImportHistory(),
    getStaleSummary(),
  ]);
  const columns = columnsFor(stale?.dataSnapshotAt ?? null, stale?.isStale === true);

  const header = (
    <PageHeader
      title="적재 이력"
      subtitle="언제 무엇이 들어왔는지 배치 단위로 남습니다. 추가 방식으로 적재한 배치는 되돌릴 수 있습니다."
      meta={
        <>
          <MetaChip>PRD 8.5</MetaChip>
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
            title="아직 올린 파일이 없습니다"
            desc="파일 업로드 화면에서 CSV · Excel · JSON 을 올리면 검증부터 시작합니다."
          />
        </Panel>
      </>
    );
  }

  const imported = rows.filter((row) => row.status === 'IMPORTED');
  const importedRows = imported.reduce((sum, row) => sum + row.importedRows, 0);
  const errorBatches = rows.filter((row) => row.errorRows > 0);
  const errorRows = errorBatches.reduce((sum, row) => sum + row.errorRows, 0);
  const visible = applyFilter(rows, FILTERS, activeFilter);
  const filterLabel = labelOf(FILTERS, activeFilter);

  return (
    <>
      {header}

      <div className="grid grid-3">
        <KpiCard
          label="전체 배치"
          value={rows.length}
          unit="건"
          icon={Database}
          foot="최근 100건"
          filter={{ key: 'all', active: activeFilter === 'all' }}
        />
        <KpiCard
          label="적재 완료"
          value={imported.length}
          unit="건"
          icon={FileCheck2}
          foot={`${formatNumber(importedRows)}행 적재됨`}
          filter={{ key: 'imported', active: activeFilter === 'imported' }}
        />
        <KpiCard
          label="검증 오류 있음"
          value={errorBatches.length}
          unit="건"
          icon={RotateCcw}
          tone={errorBatches.length > 0 ? 'warn' : 'default'}
          foot={`오류 ${formatNumber(errorRows)}행 · 고쳐서 다시 올려야 합니다`}
          filter={{ key: 'haserror', active: activeFilter === 'haserror' }}
        />
      </div>

      {filterLabel && (
        <FilterNotice label={filterLabel} shown={visible.length} total={rows.length} />
      )}

      <Panel
        title="배치 목록"
        actions={<span className="t-label">기간 교체는 되돌릴 수 없습니다</span>}
        flush
      >
        {visible.length === 0 ? (
          <EmptyState
            title={`${filterLabel ?? ''} 에 해당하는 배치가 없습니다`}
            desc="위 카드를 다시 눌러 전체 목록으로 돌아갈 수 있습니다."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(row) => row.batchId}
            caption="core.upload_batch — 업로드 단위 이력"
          />
        )}
      </Panel>
    </>
  );
}
