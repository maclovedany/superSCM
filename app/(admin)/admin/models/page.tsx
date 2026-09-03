// 예측 모델 — renew.prd 11.3 · 11.4
//
// 모델을 미리 배제하지 않습니다. 후보에 넣고 성능이 낮으면 Champion 에 선정되지 않을 뿐입니다.
// 여기서 켜고 끄면 코드 수정 없이 다음 실행에 반영됩니다.

import { Boxes, Cpu, Power, Layers } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { type Column } from '@/components/ui/data-table';
import Badge from '@/components/ui/badge';
import FilterNotice from '@/components/ui/filter-notice';
import InsightBanner from '@/components/ui/insight-banner';
import { ErrorState, EmptyState } from '@/components/ui/state';
import { getModelConfigs, type ModelConfig } from '@/lib/forecast';
import {
  getServiceHealth,
  SERVICE_STATE_LABEL,
  SERVICE_STATE_TONE,
  type ServiceHealth,
} from '@/lib/forecast-service';
import { DEMAND_TYPE_LABEL } from '@/lib/demand-profile';
import { applyFilter, labelOf, readFilter, type FilterSpec, type SearchParams } from '@/lib/filter';
import ModelRowForm from './model-row-form';

export const dynamic = 'force-dynamic';

const FAMILY_LABEL: Record<string, string> = {
  BASELINE: '기준선',
  TIMESERIES: '시계열',
  INTERMITTENT: '간헐수요',
  ML: '머신러닝',
};

/** KPI 카드 하나 = 목록 필터 하나 (design.md §6.4) */
const FILTERS: FilterSpec<ModelConfig>[] = [
  { key: 'all', label: '전체 모델', match: null },
  { key: 'enabled', label: '사용 중', match: (row) => row.enabled },
  { key: 'sql', label: 'SQL 실행', match: (row) => row.engine === 'SQL' },
  { key: 'python', label: 'Python 실행', match: (row) => row.engine === 'PYTHON' },
];

/**
 * PYTHON 모델은 예측 서비스가 있어야 실행됩니다.
 * 서비스 상태를 모델 행에 그대로 보여줍니다 (renew.prd 31.4 — 상태를 숨기지 않습니다).
 */
function buildColumns(service: ServiceHealth): Column<ModelConfig>[] {
  return [
    { key: 'modelId', label: '모델 ID', variant: 'code', render: (row) => row.modelId },
    { key: 'modelName', label: '이름', variant: 'strong', render: (row) => row.modelName },
    {
      key: 'family',
      label: '계열',
      render: (row) => <Badge tone="plain">{FAMILY_LABEL[row.family] ?? row.family}</Badge>,
    },
    {
      key: 'engine',
      label: '실행',
      render: (row) => {
        if (row.engine === 'SQL') return <Badge tone="info">SQL</Badge>;
        return (
          <span style={{ display: 'inline-flex', gap: 'var(--s-2)', alignItems: 'center' }}>
            <Badge tone={SERVICE_STATE_TONE[service.state]}>Python</Badge>
            <span className="t-sm text-2">{pythonNote(service, row)}</span>
          </span>
        );
      },
    },
    {
      key: 'applicable',
      label: '적용 수요유형',
      render: (row) =>
        row.applicableDemandType === null ? (
          <span className="text-3">전체</span>
        ) : (
          <span style={{ display: 'inline-flex', gap: 'var(--s-1)', flexWrap: 'wrap' }}>
            {row.applicableDemandType.map((type) => (
              <Badge key={type} tone="plain">
                {DEMAND_TYPE_LABEL[type] ?? type}
              </Badge>
            ))}
          </span>
        ),
    },
    {
      key: 'enabled',
      label: '상태',
      render: (row) => (
        <Badge tone={row.enabled ? 'safe' : 'unknown'}>{row.enabled ? '사용' : '중지'}</Badge>
      ),
    },
    { key: 'edit', label: '변경', render: (row) => <ModelRowForm model={row} /> },
  ];
}

/** PYTHON 모델 한 줄에 붙일 실행 가능 여부 문구 */
function pythonNote(service: ServiceHealth, row: ModelConfig): string {
  if (!service.configured) return '서비스 미설정 · 실행되지 않습니다';
  if (service.state === 'UNREACHABLE') return '서비스 응답 없음 · 실행되지 않습니다';
  if (!service.db) return '서비스가 DB 에 접속하지 못했습니다';
  if (!service.models.includes(row.modelId)) return '서비스에 없는 모델입니다';
  return '서비스 연결됨';
}

export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const activeFilter = readFilter(await searchParams);
  const [{ rows, error }, service] = await Promise.all([
    getModelConfigs(),
    // 서비스가 없어도 화면은 그대로 돕니다. 이 호출은 throw 하지 않습니다 (renew.prd 31.4)
    getServiceHealth(),
  ]);
  const columns = buildColumns(service);

  const header = (
    <PageHeader
      title="예측 모델"
      subtitle="모델을 미리 배제하지 않습니다. 후보에 넣어두고 성능이 낮으면 Champion 으로 뽑히지 않을 뿐입니다. 여기서 켜고 끄면 코드 수정 없이 다음 실행에 반영됩니다."
      meta={
        <>
          <MetaChip>PRD 11</MetaChip>
          <MetaChip>STEP 8</MetaChip>
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

  if (rows.length === 0) {
    return (
      <>
        {header}
        <Panel>
          <EmptyState
            title="등록된 모델이 없습니다"
            desc="sql/11-forecast-engine.sql 을 Supabase SQL Editor 에서 실행해주세요."
          />
        </Panel>
      </>
    );
  }

  const enabled = rows.filter((row) => row.enabled).length;
  const sql = rows.filter((row) => row.engine === 'SQL').length;
  const python = rows.filter((row) => row.engine === 'PYTHON').length;
  const visible = applyFilter(rows, FILTERS, activeFilter);
  const filterLabel = labelOf(FILTERS, activeFilter);

  return (
    <>
      {header}

      <div className="grid grid-kpi">
        <KpiCard
          label="전체 모델"
          value={rows.length}
          unit="종"
          icon={Layers}
          foot="후보 전체"
          filter={{ key: 'all', active: activeFilter === 'all' }}
        />
        <KpiCard
          label="사용 중"
          value={enabled}
          unit={`/ ${rows.length}`}
          icon={Power}
          foot="다음 실행에 포함됩니다"
          filter={{ key: 'enabled', active: activeFilter === 'enabled' }}
        />
        <KpiCard
          label="SQL 실행"
          value={sql}
          unit="종"
          icon={Boxes}
          foot="지금 바로 돌아갑니다"
          filter={{ key: 'sql', active: activeFilter === 'sql' }}
        />
        <KpiCard
          label="Python 실행"
          value={python}
          unit="종"
          icon={Cpu}
          tone={python > 0 && service.state !== 'CONFIGURED' ? 'warn' : 'default'}
          foot={
            service.state === 'CONFIGURED'
              ? '예측 서비스가 실행합니다'
              : '예측 서비스가 있어야 실행됩니다'
          }
          filter={{ key: 'python', active: activeFilter === 'python' }}
        />
      </div>

      <InsightBanner eyebrow="MODEL REGISTRY">
        <span className="t-code">applicable_demand_type</span> 이 STEP 5 의 수요 분류와 맞물립니다. 간헐 계열
        품목에는 <b>Croston · SBA · TSB</b> 만 후보로 올라가고, 기준선·시계열 모델은 평활·불규칙 품목에만
        적용됩니다. <b>SQL 모델은 DB 안에서</b>, <b>Python 모델은 예측 서비스에서</b> 돌지만 결과는 같은
        실행 ID 에 함께 쌓이므로 백테스트가 둘을 <b>같은 조건에서 채점</b>합니다.
      </InsightBanner>

      {filterLabel && <FilterNotice label={filterLabel} shown={visible.length} total={rows.length} />}

      <Panel
        title="모델 목록"
        actions={<span className="t-label">파라미터는 JSON 으로 입력합니다</span>}
        flush
      >
        {visible.length === 0 ? (
          <EmptyState
            title={`${filterLabel ?? ''} 에 해당하는 모델이 없습니다`}
            desc="위 카드를 다시 눌러 전체 목록으로 돌아갈 수 있습니다."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(row) => row.modelId}
            caption="core.model_config — 모델 레지스트리"
          />
        )}
      </Panel>
    </>
  );
}
