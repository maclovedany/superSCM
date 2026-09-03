// 리드타임 격차 — 신규 디자인 시스템의 본보기 화면
//
// 1  analytics.v_leadtime_gap   계산은 SQL 이 끝냅니다
// 2  lib/scm.ts                 조회
// 3  이 파일                     그리기만 합니다
//
// 색·간격을 직접 쓰지 않습니다. design.md 의 토큰과 컴포넌트만 씁니다.

import { Timer, TriangleAlert, Building2 } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import Badge from '@/components/ui/badge';
import InsightBanner from '@/components/ui/insight-banner';
import { ErrorState, EmptyState } from '@/components/ui/state';
import FilterNotice from '@/components/ui/filter-notice';
import { getLeadtimeGap } from '@/lib/scm';
import type { LeadtimeGap } from '@/lib/scm-model';
import { applyFilter, labelOf, readFilter, type FilterSpec, type SearchParams } from '@/lib/filter';

export const dynamic = 'force-dynamic';

/** 표본 30건 미만은 신뢰도를 낮게 봅니다 (renew.prd 18.2) */
function confidenceOf(sampleCount: number) {
  if (sampleCount >= 30) return null;
  return sampleCount >= 10 ? '표본 보통' : '표본 부족';
}

const columns: Column<LeadtimeGap>[] = [
  {
    key: 'supplier',
    label: '공급처',
    variant: 'strong',
    render: (row) => row.supplier,
  },
  {
    key: 'country',
    label: '국가',
    render: (row) => row.country,
  },
  {
    key: 'sampleCount',
    label: '표본',
    align: 'right',
    variant: 'num',
    render: (row) => {
      const note = confidenceOf(row.sampleCount);
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)' }}>
          {formatNumber(row.sampleCount)}
          {note && <Badge tone="unknown">{note}</Badge>}
        </span>
      );
    },
  },
  {
    key: 'masterLeadTime',
    label: '마스터',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.masterLeadTime === null ? (
        <EmptyValue align="right" showLabel={false} />
      ) : (
        formatNumber(row.masterLeadTime, '일')
      ),
  },
  {
    key: 'actualAverage',
    label: '실적 평균',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.actualAverage === null ? (
        <EmptyValue align="right" showLabel={false} />
      ) : (
        formatNumber(row.actualAverage, '일')
      ),
  },
  {
    key: 'p80',
    label: 'P80',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.p80 === null ? <EmptyValue align="right" showLabel={false} /> : formatNumber(row.p80, '일'),
  },
  {
    key: 'gap',
    label: '격차',
    align: 'right',
    variant: 'num',
    render: (row) => {
      if (row.gap === null) return <EmptyValue align="right" reason="INSUFFICIENT_SAMPLE" showLabel={false} />;
      // 양수 = 실제가 마스터보다 길다 = 계획이 현실보다 짧게 잡혀 있다
      const over = row.gap > 0;
      return (
        <span style={{ color: over ? 'var(--crit-fg)' : 'var(--safe-fg)', fontWeight: 600 }}>
          {over ? '+' : ''}
          {formatNumber(row.gap, '일')}
        </span>
      );
    },
  },
];

/** KPI 카드 하나 = 목록 필터 하나 (design.md §6.4) */
const FILTERS: FilterSpec<LeadtimeGap>[] = [
  { key: 'all', label: '공급처', match: null },
  { key: 'longer', label: '실적이 더 김', match: (row) => row.gap !== null && row.gap > 0 },
  { key: 'lowsample', label: '표본 부족', match: (row) => row.sampleCount < 30 },
];

export default async function LeadtimePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const activeFilter = readFilter(await searchParams);
  const { rows, error } = await getLeadtimeGap();

  const header = (
    <PageHeader
      title="리드타임 격차"
      subtitle="마스터에 적힌 표준 리드타임과 실제 실적 P80 을 비교해, 계획이 현실보다 짧게 잡혀 있는 공급처를 찾습니다. 끝점은 창고 입고가 아니라 QC Release 입니다."
      meta={
        <>
          <MetaChip>PRD 18</MetaChip>
          <MetaChip>END: QC RELEASE</MetaChip>
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
            title="표시할 공급처가 없습니다"
            desc="analytics.v_leadtime_gap 에 행이 없습니다. 실적 데이터가 적재되었는지 확인해주세요."
          />
        </Panel>
      </>
    );
  }

  const visible = applyFilter(rows, FILTERS, activeFilter);
  const filterLabel = labelOf(FILTERS, activeFilter);
  const supplierCount = rows.length;
  const longerCount = rows.filter((row) => row.gap !== null && row.gap > 0).length;
  const lowSampleCount = rows.filter((row) => row.sampleCount < 30).length;
  const worst = rows.reduce<LeadtimeGap | null>(
    (acc, row) => (row.gap !== null && (acc === null || row.gap > (acc.gap ?? 0)) ? row : acc),
    null,
  );

  return (
    <>
      {header}

      <div className="grid grid-3">
        <KpiCard
          label="공급처"
          value={supplierCount}
          unit="곳"
          icon={Building2}
          foot="사용 중인 생산법인"
          filter={{ key: 'all', active: activeFilter === 'all' }}
        />
        <KpiCard
          label="실적이 더 김"
          value={longerCount}
          unit={`/ ${supplierCount}`}
          icon={TriangleAlert}
          tone={longerCount > 0 ? 'crit' : 'default'}
          foot="격차 > 0 인 공급처"
          filter={{ key: 'longer', active: activeFilter === 'longer' }}
        />
        <KpiCard
          label="표본 부족"
          value={lowSampleCount}
          unit="곳"
          icon={Timer}
          foot="표본 30건 미만 · 신뢰도 낮음"
          filter={{ key: 'lowsample', active: activeFilter === 'lowsample' }}
        />
      </div>

      {worst && worst.gap !== null && worst.gap > 0 && (
        <InsightBanner eyebrow="LEAD TIME INSIGHT">
          가장 격차가 큰 공급처는 <b>{worst.supplier}</b> 이며, 실적 P80 이 마스터 값보다{' '}
          <span className="hl-crit">{formatNumber(worst.gap, '일')}</span> 깁니다. 계획 리드타임을 확정하지 않으면
          이 격차만큼 결품 판정이 늦어집니다.
        </InsightBanner>
      )}

      {filterLabel && (
        <FilterNotice label={filterLabel} shown={visible.length} total={rows.length} />
      )}

      <Panel title="공급처별 리드타임" actions={<span className="t-label">격차 = P80 − 마스터</span>} flush>
        {visible.length === 0 ? (
          <EmptyState
            title={`${filterLabel ?? ''} 에 해당하는 공급처가 없습니다`}
            desc="위 카드를 다시 눌러 전체 목록으로 돌아갈 수 있습니다."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(row, index) => `${row.supplier}-${index}`}
            caption="공급처별 마스터 리드타임과 실적 분위수 비교"
          />
        )}
      </Panel>
    </>
  );
}
