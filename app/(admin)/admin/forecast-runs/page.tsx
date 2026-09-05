// 예측 실행 — renew.prd 12.2
//
// "run_id 와 model_version 으로 재현성을 확보한다.
//  같은 스냅샷과 같은 버전으로 재실행하면 동일한 결과가 나와야 한다."

import Link from 'next/link';
import { kstMinute } from '@/lib/time';
import { AlertTriangle, CheckCircle2, ChevronRight, PlayCircle, Timer } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import Badge from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import FilterNotice from '@/components/ui/filter-notice';
import InsightBanner from '@/components/ui/insight-banner';
import { ErrorState, EmptyState } from '@/components/ui/state';
import { getForecastRunKpi, getForecastRuns, getModelConfigs, type ForecastRun } from '@/lib/forecast';
import {
  getServiceHealth,
  getRunningPipeline,
  SERVICE_STATE_LABEL,
  type ServiceHealth,
} from '@/lib/forecast-service';
import { applyFilter, labelOf, readFilter, type FilterSpec, type SearchParams } from '@/lib/filter';
import { getStaleSummary, RUN_MODE_LABEL } from '@/lib/admin-ops';
import StaleBanner from '@/components/ui/stale-banner';
import RunForm from './run-form';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, { label: string; tone: 'safe' | 'warn' | 'crit' | 'info' }> = {
  RUNNING: { label: '실행 중', tone: 'info' },
  SUCCESS: { label: '성공', tone: 'safe' },
  FAILED: { label: '실패', tone: 'crit' },
};

/** KPI 카드 하나 = 목록 필터 하나 (design.md §6.4) */
const FILTERS: FilterSpec<ForecastRun>[] = [
  { key: 'all', label: '전체 실행', match: null },
  { key: 'success', label: '성공', match: (row) => row.status === 'SUCCESS' },
  { key: 'failed', label: '실패', match: (row) => row.status === 'FAILED' },
  { key: 'stale', label: '재실행 필요', match: (row) => row.isStale && row.status === 'SUCCESS' },
];
// kpi-filter: 모드(검증/운영)로 좁히는 카드는 두지 않았습니다. KPI 줄이 4칸 고정이고
// (styles/shell.css .grid-kpi), 모드는 목록의 배지로 이미 한눈에 보입니다.

const columns: Column<ForecastRun>[] = [
  {
    key: 'runId',
    label: '실행 ID',
    variant: 'code',
    // 행을 눌러 상세로 갑니다. 표 전체를 링크로 감싸지 않는 이유는 표 안에 폼이 있는
    // 다른 화면과 조작이 달라지기 때문입니다.
    render: (row) => (
      <Link href={`/admin/forecast-runs/${row.runId}`} style={{ color: 'var(--info-fg)' }}>
        {row.runId}
      </Link>
    ),
  },
  {
    key: 'mode',
    label: '모드',
    render: (row) =>
      row.mode === null ? (
        <span className="text-3">—</span>
      ) : (
        <Badge tone={row.mode === 'PRODUCTION' ? 'info' : 'plain'}>{RUN_MODE_LABEL[row.mode]}</Badge>
      ),
  },
  {
    key: 'status',
    label: '상태',
    render: (row) => {
      const status = STATUS[row.status] ?? { label: row.status, tone: 'info' as const };
      return (
        <span style={{ display: 'inline-flex', gap: 'var(--s-2)', alignItems: 'center' }}>
          <Badge tone={status.tone}>{status.label}</Badge>
          {row.isStale && row.status === 'SUCCESS' && <Badge tone="warn">재실행 필요</Badge>}
        </span>
      );
    },
  },
  {
    key: 'train',
    label: '학습 구간',
    variant: 'num',
    render: (row) => `${row.trainStart ?? '—'} ~ ${row.trainEnd ?? '—'}`,
  },
  { key: 'horizon', label: '예측', align: 'right', variant: 'num', render: (row) => `${row.horizon}개월` },
  { key: 'nModels', label: '모델', align: 'right', variant: 'num', render: (row) => row.nModels },
  { key: 'nItems', label: '품목', align: 'right', variant: 'num', render: (row) => row.nItems },
  {
    key: 'nRows',
    label: '결과 행',
    align: 'right',
    variant: 'num',
    render: (row) => formatNumber(row.resultRows),
  },
  {
    key: 'duration',
    label: '소요',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.durationMs === null ? (
        <EmptyValue align="right" showLabel={false} />
      ) : (
        `${(row.durationMs / 1000).toFixed(1)}초`
      ),
  },
  {
    key: 'startedAt',
    label: '실행 시각',
    align: 'right',
    variant: 'num',
    render: (row) => (row.startedAt ? kstMinute(row.startedAt) : '—'),
  },
  {
    key: 'triggeredEmail',
    label: '실행자',
    render: (row) => row.triggeredEmail?.split('@')[0] ?? <span className="text-3">—</span>,
  },
  {
    key: 'detail',
    label: '',
    render: (row) => (
      <Link
        href={`/admin/forecast-runs/${row.runId}`}
        className="btn ghost"
        aria-label={`${row.runId} 상세`}
      >
        상세
        <ChevronRight size={13} aria-hidden />
      </Link>
    ),
  },
];

export default async function ForecastRunsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const activeFilter = readFilter(await searchParams);
  const [{ rows, error }, { data: kpi }, { rows: models }, service, { data: stale }, running] =
    await Promise.all([
      getForecastRuns(),
      getForecastRunKpi(),
      getModelConfigs(),
      // 서비스가 없어도 화면은 그대로 돕니다. 이 호출은 throw 하지 않습니다 (renew.prd 31.4)
      getServiceHealth(),
      getStaleSummary(),
      getRunningPipeline(),
    ]);

  const enabledModels = kpi?.enabledModels ?? models.filter((m) => m.enabled).length;
  const enabledPython = models.filter((m) => m.engine === 'PYTHON' && m.enabled).length;

  const header = (
    <PageHeader
      title="예측 실행"
      subtitle="켜져 있는 모델을 한 번에 돌려 미래 수요를 계산합니다. 계산은 DB 안에서 끝나므로 학습 데이터가 앱으로 나오지 않습니다."
      meta={
        <>
          <MetaChip>PRD 12.2</MetaChip>
          <MetaChip>STEP 6</MetaChip>
          <MetaChip>{`예측 서비스 ${SERVICE_STATE_LABEL[service.state]}`}</MetaChip>
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

  const success = kpi?.success ?? rows.filter((row) => row.status === 'SUCCESS').length;
  const failed = kpi?.failed ?? rows.filter((row) => row.status === 'FAILED').length;
  const staleRuns = kpi?.stale ?? rows.filter((row) => row.isStale && row.status === 'SUCCESS').length;
  const visible = applyFilter(rows, FILTERS, activeFilter);
  const filterLabel = labelOf(FILTERS, activeFilter);

  return (
    <>
      {header}

      <StaleBanner />

      <div className="grid grid-kpi">
        <KpiCard
          label="전체 실행"
          value={rows.length}
          unit="회"
          icon={PlayCircle}
          foot="최근 50건"
          filter={{ key: 'all', active: activeFilter === 'all' }}
        />
        <KpiCard
          label="성공"
          value={success}
          unit="회"
          icon={CheckCircle2}
          foot="결과가 저장되었습니다"
          filter={{ key: 'success', active: activeFilter === 'success' }}
        />
        <KpiCard
          label="실패"
          value={failed}
          unit="회"
          icon={AlertTriangle}
          tone={failed > 0 ? 'crit' : 'default'}
          foot="사유는 목록에서 확인합니다"
          filter={{ key: 'failed', active: activeFilter === 'failed' }}
        />
        <KpiCard
          label="재실행 필요"
          value={staleRuns}
          unit="회"
          icon={Timer}
          tone={staleRuns > 0 ? 'warn' : 'default'}
          foot="실행 뒤 데이터가 바뀌었습니다"
          filter={{ key: 'stale', active: activeFilter === 'stale' }}
        />
      </div>

      <InsightBanner eyebrow="REPRODUCIBILITY">
        실행할 때마다 <span className="t-code">run_id</span> 와 그 시점의{' '}
        <span className="t-code">model_version</span>, 데이터 기준 시각을 함께 남깁니다. 같은 스냅샷과 같은
        버전이면 <b>다시 돌려도 같은 숫자가 나옵니다.</b> 실행 뒤 원본 데이터가 바뀌면 목록에{' '}
        <span className="hl-warn">재실행 필요</span> 로 표시됩니다.
      </InsightBanner>

      <Panel title="새로 실행">
        <RunForm
          enabledModels={enabledModels}
          productionTrainEnd={stale?.productionTrainEnd ?? null}
          runningPipelineId={running.pipelineId}
        />
        <ServiceNote service={service} enabledPython={enabledPython} />
      </Panel>

      {filterLabel && <FilterNotice label={filterLabel} shown={visible.length} total={rows.length} />}

      <Panel title="실행 이력" actions={<span className="t-label">최근 50건</span>} flush>
        {rows.length === 0 ? (
          <EmptyState
            title="아직 실행한 적이 없습니다"
            desc="위에서 예측 실행을 누르면 켜져 있는 모델로 계산을 시작합니다."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={`${filterLabel ?? ''} 에 해당하는 실행이 없습니다`}
            desc="위 카드를 다시 눌러 전체 목록으로 돌아갈 수 있습니다."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(row) => row.runId}
            caption="core.forecast_run — 실행 이력"
          />
        )}
      </Panel>
    </>
  );
}

/**
 * 예측 서비스 안내. SQL 모델만 돌아가는 상태를 화면에서 숨기지 않습니다.
 * (renew.prd 31.4 — 서비스가 없어도 화면과 SQL 예측은 정상 동작합니다)
 */
function ServiceNote({ service, enabledPython }: { service: ServiceHealth; enabledPython: number }) {
  if (enabledPython === 0) return null;

  if (!service.configured) {
    return (
      <p className="t-sm text-2">
        Python 모델 {enabledPython}종이 켜져 있지만 <span className="t-code">FORECAST_SERVICE_URL</span> 이
        비어 있어 <span className="hl-warn">실행되지 않습니다.</span> SQL 모델만 돌아갑니다.
      </p>
    );
  }

  if (service.state === 'UNREACHABLE') {
    return (
      <p className="t-sm text-2">
        예측 서비스가 <span className="hl-crit">응답하지 않습니다.</span> SQL 모델은 그대로 실행되고 Python
        모델만 빠집니다. 사유: {service.error ?? '알 수 없음'}
      </p>
    );
  }

  return (
    <p className="t-sm text-2">
      예측 서비스가 연결되어 있습니다. SQL 모델을 실행한 뒤 같은 실행 ID 에 Python 모델
      {service.models.length > 0 ? ` ${service.models.length}종` : ''} 을 이어 붙입니다.
      {service.db ? '' : ' 다만 서비스가 DB 에 접속하지 못하고 있습니다.'}
    </p>
  );
}
