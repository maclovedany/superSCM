// 모델 버전 — renew.prd 31.2
//
// "모델 코드와 파라미터 버전을 추적한다. 어떤 버전이 어떤 예측을 만들었는지
//  나중에 되짚을 수 있어야 한다."
//
// 예측을 실행할 때마다 그 시점의 모델 정의가 core.model_version 에 스냅샷으로 남고,
// core.forecast_run.models 에 (model_id · version) 이 함께 기록됩니다. 이 화면은
// 그 둘을 이어 "이 버전으로 몇 번 돌렸는가" 를 보여줍니다. 세는 일은 SQL 이 합니다
// (analytics.v_model_version).

import { Boxes, History, Layers, PowerOff } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import Badge from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import FilterNotice from '@/components/ui/filter-notice';
import InsightBanner from '@/components/ui/insight-banner';
import { ErrorState, EmptyState } from '@/components/ui/state';
import { requireAdmin } from '@/lib/auth';
import { getModelVersions, parameterSummary, type ModelVersionRow } from '@/lib/admin-ops';
import { applyFilter, labelOf, readFilter, type FilterSpec, type SearchParams } from '@/lib/filter';

export const dynamic = 'force-dynamic';

/** KPI 카드 하나 = 목록 필터 하나 (design.md §6.4) */
const FILTERS: FilterSpec<ModelVersionRow>[] = [
  { key: 'all', label: '전체 버전', match: null },
  { key: 'current', label: '현재 버전', match: (row) => row.isCurrent === true },
  { key: 'used', label: '실행에 쓰인 버전', match: (row) => (row.runCount ?? 0) > 0 },
  { key: 'unused', label: '아직 안 쓴 버전', match: (row) => (row.runCount ?? 0) === 0 },
];

const columns: Column<ModelVersionRow>[] = [
  {
    key: 'modelId',
    label: '모델',
    render: (row) => (
      <>
        <span className="cell-strong">{row.modelName ?? row.modelId ?? '—'}</span>
        {row.modelId && <div className="t-code text-3">{row.modelId}</div>}
      </>
    ),
  },
  { key: 'family', label: '계열', render: (row) => row.family ?? <span className="text-3">—</span> },
  { key: 'engine', label: '엔진', variant: 'code', render: (row) => row.engine ?? '—' },
  {
    key: 'version',
    label: '버전',
    variant: 'code',
    render: (row) => (
      <span style={{ display: 'inline-flex', gap: 'var(--s-2)', alignItems: 'center' }}>
        {row.version ?? '—'}
        {row.isCurrent === true && <Badge tone="info">현재</Badge>}
        {row.modelEnabled === false && <Badge tone="plain">중지</Badge>}
      </span>
    ),
  },
  {
    key: 'parameters',
    label: '파라미터',
    render: (row) => {
      const summary = parameterSummary(row.parameters);
      return summary === null ? <span className="text-3">파라미터 없음</span> : <span className="t-code">{summary}</span>;
    },
  },
  {
    key: 'runCount',
    label: '사용 실행',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.runCount === null ? (
        <EmptyValue align="right" showLabel={false} />
      ) : (
        formatNumber(row.runCount, '회')
      ),
  },
  {
    key: 'lastUsedAt',
    label: '최근 사용',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.lastUsedAt === null ? (
        <span className="text-3">—</span>
      ) : (
        row.lastUsedAt.slice(0, 16).replace('T', ' ')
      ),
  },
  {
    key: 'createdAt',
    label: '생성',
    align: 'right',
    variant: 'num',
    render: (row) => (row.createdAt ? row.createdAt.slice(0, 10) : '—'),
  },
];

export default async function ModelVersionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();

  const activeFilter = readFilter(await searchParams);
  const { rows, error } = await getModelVersions();

  const header = (
    <PageHeader
      title="모델 버전"
      subtitle="예측을 실행할 때마다 그 시점의 모델 정의를 스냅샷으로 남깁니다. 같은 버전과 같은 데이터 스냅샷이면 다시 돌려도 같은 숫자가 나옵니다."
      meta={
        <>
          <MetaChip>PRD 31.2</MetaChip>
          <MetaChip>STEP 20</MetaChip>
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

  const current = rows.filter((row) => row.isCurrent === true).length;
  const used = rows.filter((row) => (row.runCount ?? 0) > 0).length;
  const unused = rows.filter((row) => (row.runCount ?? 0) === 0).length;
  const visible = applyFilter(rows, FILTERS, activeFilter);
  const filterLabel = labelOf(FILTERS, activeFilter);

  return (
    <>
      {header}

      <div className="grid grid-kpi">
        <KpiCard
          label="전체 버전"
          value={rows.length}
          unit="개"
          icon={Layers}
          foot="core.model_version"
          filter={{ key: 'all', active: activeFilter === 'all' }}
        />
        <KpiCard
          label="현재 버전"
          value={current}
          unit="개"
          icon={Boxes}
          foot="지금 모델 설정에 걸려 있는 버전"
          filter={{ key: 'current', active: activeFilter === 'current' }}
        />
        <KpiCard
          label="실행에 쓰인 버전"
          value={used}
          unit="개"
          icon={History}
          foot="예측 실행 기록에 남아 있습니다"
          filter={{ key: 'used', active: activeFilter === 'used' }}
        />
        <KpiCard
          label="아직 안 쓴 버전"
          value={unused}
          unit="개"
          icon={PowerOff}
          tone={unused > 0 ? 'warn' : 'default'}
          foot="만들어만 두고 실행하지 않았습니다"
          filter={{ key: 'unused', active: activeFilter === 'unused' }}
        />
      </div>

      <InsightBanner eyebrow="REPRODUCIBILITY">
        버전은 지우지 않습니다. 파라미터를 바꾸면 새 버전이 쌓이고, 예전 예측은 그때의 정의를 계속
        가리킵니다. <b>사용 실행</b> 은 <span className="t-code">core.forecast_run.models</span> 를
        되짚어 센 값이라, 실행 기록이 남아 있는 한 줄어들지 않습니다.
      </InsightBanner>

      {filterLabel && <FilterNotice label={filterLabel} shown={visible.length} total={rows.length} />}

      <Panel title="버전 목록" actions={<span className="t-label">최근 생성 순</span>} flush>
        {rows.length === 0 ? (
          <EmptyState
            title="아직 버전이 없습니다"
            desc="예측을 한 번 실행하면 그 시점의 모델 정의가 버전으로 남습니다."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={`${filterLabel ?? ''} 에 해당하는 버전이 없습니다`}
            desc="위 카드를 다시 눌러 전체 목록으로 돌아갈 수 있습니다."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(row) => String(row.id ?? `${row.modelId}-${row.version}`)}
            caption="analytics.v_model_version — 실행 시점의 모델 정의 스냅샷"
          />
        )}
      </Panel>
    </>
  );
}
