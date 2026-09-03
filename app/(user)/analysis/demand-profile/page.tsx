// 수요 패턴 — renew.prd 10장
//
// 이 화면의 결론은 "어떤 품목에 Croston 계열이 필요한가" 입니다.
// 그 답이 STEP 6 의 모델 선택으로 넘어갑니다.

import { Activity, Layers, Repeat, TrendingUp } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import Badge from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import InsightBanner from '@/components/ui/insight-banner';
import { ErrorState, EmptyState } from '@/components/ui/state';
import {
  getDemandProfileKpi,
  getDemandProfiles,
  DEMAND_TYPE_DESC,
  DEMAND_TYPE_LABEL,
  type DemandType,
  type SkuDemandProfile,
} from '@/lib/demand-profile';
import type { ReasonCode } from '@/lib/status';
import FilterNotice from '@/components/ui/filter-notice';
import { applyFilter, labelOf, readFilter, type FilterSpec, type SearchParams } from '@/lib/filter';

export const dynamic = 'force-dynamic';

const TYPE_TONE: Record<DemandType, 'safe' | 'warn' | 'crit' | 'unknown' | 'info'> = {
  SMOOTH: 'safe',
  INTERMITTENT: 'warn',
  ERRATIC: 'info',
  LUMPY: 'crit',
  NO_DEMAND: 'unknown',
};

/** 뷰가 돌려준 사유 문자열을 화면 사유 코드로 좁힙니다 */
function toReason(value: string | null): ReasonCode | null {
  if (value === 'NO_USAGE_HISTORY' || value === 'INSUFFICIENT_SAMPLE') return value;
  return null;
}

function Percent({ value }: { value: number | null }) {
  if (value === null) return <EmptyValue align="right" showLabel={false} />;
  const tone = value > 0 ? 'var(--safe-fg)' : value < 0 ? 'var(--crit-fg)' : 'var(--text-3)';
  return (
    <span style={{ color: tone, fontWeight: 500 }}>
      {value > 0 ? '+' : ''}
      {formatNumber(value)}%
    </span>
  );
}

const columns: Column<SkuDemandProfile>[] = [
  { key: 'itemId', label: '품목코드', variant: 'code', render: (row) => row.itemId },
  {
    key: 'itemName',
    label: '품목명',
    variant: 'strong',
    render: (row) => row.itemName ?? <span className="text-3">이름 없음</span>,
  },
  {
    key: 'activePeriods',
    label: '출고 개월',
    align: 'right',
    variant: 'num',
    render: (row) => `${row.activePeriods} / ${row.periods}`,
  },
  {
    key: 'adi',
    label: 'ADI',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.adi === null ? (
        <EmptyValue align="right" reason={toReason(row.demandTypeReason)} showLabel={false} />
      ) : (
        formatNumber(row.adi)
      ),
  },
  {
    key: 'cvSquared',
    label: 'CV²',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.cvSquared === null ? (
        <EmptyValue align="right" showLabel={false} />
      ) : (
        formatNumber(row.cvSquared)
      ),
  },
  {
    key: 'meanQty',
    label: '월평균',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.meanQty === null ? <EmptyValue align="right" showLabel={false} /> : formatNumber(row.meanQty),
  },
  {
    key: 'trend',
    label: '추세',
    align: 'right',
    variant: 'num',
    render: (row) => <Percent value={row.trendPctPerPeriod} />,
  },
  {
    key: 'recent',
    label: '최근 3개월',
    align: 'right',
    variant: 'num',
    render: (row) => <Percent value={row.recentChangePct} />,
  },
  {
    key: 'seasonality',
    label: '계절성',
    render: (row) =>
      row.seasonalityIndex === null ? (
        <span className="t-sm text-3">
          {row.seasonalityReason === 'INSUFFICIENT_PERIODS' ? '기간 부족' : '—'}
        </span>
      ) : (
        formatNumber(row.seasonalityIndex)
      ),
  },
  {
    key: 'demandType',
    label: '분류',
    render: (row) =>
      row.demandType === null ? (
        <Badge tone="unknown">판정 불가</Badge>
      ) : (
        <Badge tone={TYPE_TONE[row.demandType]}>{DEMAND_TYPE_LABEL[row.demandType]}</Badge>
      ),
  },
];

/** KPI 카드 하나 = 목록 필터 하나 (design.md §6.4) */
const FILTERS: FilterSpec<SkuDemandProfile>[] = [
  { key: 'all', label: '분석 품목', match: null },
  { key: 'smooth', label: '평활 수요', match: (row) => row.demandType === 'SMOOTH' },
  {
    key: 'croston',
    label: '간헐 계열',
    match: (row) => row.demandType === 'INTERMITTENT' || row.demandType === 'LUMPY',
  },
  { key: 'unclassified', label: '판정 불가', match: (row) => row.demandType === null },
];

export default async function DemandProfilePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const activeFilter = readFilter(await searchParams);
  const [{ rows, error }, { data: kpi }] = await Promise.all([
    getDemandProfiles(),
    getDemandProfileKpi(),
  ]);

  const header = (
    <PageHeader
      title="수요 패턴"
      subtitle="품목마다 수요가 어떤 모양인지 분류합니다. 드문드문 나가는 품목은 일반 시계열 모델이 무너지므로, 이 분류가 다음 단계의 모델 선택을 결정합니다."
      meta={
        <>
          <MetaChip>PRD 10</MetaChip>
          <MetaChip>학습 구간만</MetaChip>
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
            title="분석할 품목이 없습니다"
            desc="sql/10-demand-profile.sql 을 실행했는지, 학습 구간에 데이터가 있는지 확인해주세요."
          />
        </Panel>
      </>
    );
  }

  const croston = kpi?.crostonNeeded ?? rows.filter((r) => r.demandType === 'INTERMITTENT' || r.demandType === 'LUMPY').length;
  const smooth = kpi?.smooth ?? rows.filter((r) => r.demandType === 'SMOOTH').length;
  const unclassified = kpi?.unclassified ?? rows.filter((r) => r.demandType === null).length;
  const periods = kpi?.trainPeriods ?? rows[0]?.periods ?? 0;
  const visible = applyFilter(rows, FILTERS, activeFilter);
  const filterLabel = labelOf(FILTERS, activeFilter);

  return (
    <>
      {header}

      <div className="grid grid-kpi">
        <KpiCard
          label="분석 품목"
          value={rows.length}
          unit="개"
          icon={Layers}
          foot={`학습 ${periods}개월 기준`}
          filter={{ key: 'all', active: activeFilter === 'all' }}
        />
        <KpiCard
          label="평활 수요"
          value={smooth}
          unit={`/ ${rows.length}`}
          icon={TrendingUp}
          foot="일반 시계열 모델이 맞습니다"
          filter={{ key: 'smooth', active: activeFilter === 'smooth' }}
        />
        <KpiCard
          label="간헐 계열"
          value={croston}
          unit={`/ ${rows.length}`}
          icon={Repeat}
          tone={croston > 0 ? 'warn' : 'default'}
          foot="Croston 계열이 필요합니다"
          filter={{ key: 'croston', active: activeFilter === 'croston' }}
        />
        <KpiCard
          label="판정 불가"
          value={unclassified}
          unit="개"
          icon={Activity}
          foot="표본 부족 · 출고 이력 없음"
          filter={{ key: 'unclassified', active: activeFilter === 'unclassified' }}
        />
      </div>

      <InsightBanner eyebrow="DEMAND PATTERN">
        전체 {rows.length}개 품목 중 <b>{croston}개</b>가 간헐 계열입니다. 이 품목들은 일반 시계열 모델로는
        예측이 무의미하며 <span className="t-code">Croston · SBA · TSB</span> 가 필요합니다. STEP 6 에서{' '}
        <span className="t-code">model_config.applicable_demand_type</span> 이 이 분류로 모델을 자동으로
        거릅니다.
        {periods < 24 && (
          <>
            {' '}
            학습 구간이 <span className="hl-warn">{periods}개월</span>뿐이라 <b>계절성은 판정하지 않았습니다.</b>{' '}
            최소 24개월이 필요합니다.
          </>
        )}
      </InsightBanner>

      <Panel title="분류 기준" >
        <p className="t-sm text-2" style={{ marginBottom: 'var(--s-4)' }}>
          Syntetos · Boylan · Croston (2005). <span className="t-code">ADI</span> 는 평균 수요 발생 간격,{' '}
          <span className="t-code">CV²</span> 는 출고가 있었던 달 수량의 변동계수 제곱입니다.
        </p>
        <div className="grid grid-2">
          {(['SMOOTH', 'INTERMITTENT', 'ERRATIC', 'LUMPY'] as DemandType[]).map((type) => {
            const count = rows.filter((row) => row.demandType === type).length;
            return (
              <div key={type} className="rail-tile">
                <span className="rail-tile-label">
                  <Badge tone={TYPE_TONE[type]}>{DEMAND_TYPE_LABEL[type]}</Badge>
                </span>
                <span className="rail-tile-value">{count}개</span>
                <span className="t-sm text-3">{DEMAND_TYPE_DESC[type]}</span>
              </div>
            );
          })}
        </div>
      </Panel>

      {filterLabel && (
        <FilterNotice label={filterLabel} shown={visible.length} total={rows.length} />
      )}

      <Panel
        title="품목별 프로파일"
        actions={<span className="t-label">ADI 높은 순 · 검증 구간은 보지 않습니다</span>}
        flush
      >
        {visible.length === 0 ? (
          <EmptyState
            title={`${filterLabel ?? ''} 에 해당하는 품목이 없습니다`}
            desc="위 카드를 다시 눌러 전체 목록으로 돌아갈 수 있습니다."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(row) => row.itemId}
            caption="analytics.v_sku_demand_profile — 학습 구간 기준 수요 패턴"
          />
        )}
      </Panel>
    </>
  );
}
