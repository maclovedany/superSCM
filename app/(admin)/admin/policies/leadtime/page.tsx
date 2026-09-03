// 리드타임 정책 — renew.prd 18장
//
// 확정값이 있으면 그 값, 없으면 실적 P80 을 씁니다 (renew.prd 18.3).
// 여기서 값을 바꾸면 화면 코드를 한 줄도 고치지 않고 결품 판정이 즉시 달라집니다.
//
// 사유 없이 바꿀 수 없습니다. 전/후 값과 사유가 core.leadtime_plan_history 에 남습니다.

import { Building2, CheckCircle2, Sigma, TriangleAlert } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import Badge from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import Forbidden from '@/components/ui/forbidden';
import FilterNotice from '@/components/ui/filter-notice';
import InsightBanner from '@/components/ui/insight-banner';
import { ErrorState, EmptyState } from '@/components/ui/state';
import { requireAdmin } from '@/lib/auth';
import {
  getLeadtimePlanHistory,
  getLeadtimePolicies,
  type LeadtimePlanHistory,
  type LeadtimePolicy,
} from '@/lib/inventory';
import { applyFilter, labelOf, readFilter, type FilterSpec, type SearchParams } from '@/lib/filter';
import LeadtimeRowForm from './leadtime-row-form';

export const dynamic = 'force-dynamic';

const CONFIRMED = '확정값';

/** KPI 카드 하나 = 목록 필터 하나 (design.md §6.4) */
const FILTERS: FilterSpec<LeadtimePolicy>[] = [
  { key: 'all', label: '공급처', match: null },
  { key: 'confirmed', label: '확정값 적용', match: (row) => row.source === CONFIRMED },
  { key: 'p80', label: '실적 P80 적용', match: (row) => row.source !== CONFIRMED },
  { key: 'low', label: '표본 부족', match: (row) => row.confidence === 'LOW' },
];

const columns: Column<LeadtimePolicy>[] = [
  {
    key: 'supplier',
    label: '공급처',
    variant: 'strong',
    render: (row) => (
      <span style={{ display: 'grid' }}>
        <span>{row.supplierName ?? row.supplierId}</span>
        <span className="t-code text-3">{row.supplierId}</span>
      </span>
    ),
  },
  { key: 'country', label: '국가', render: (row) => row.country ?? <EmptyValue showLabel={false} /> },
  {
    key: 'std',
    label: '마스터',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.stdLeadTime === null ? (
        <EmptyValue align="right" showLabel={false} />
      ) : (
        formatNumber(row.stdLeadTime, '일')
      ),
  },
  {
    key: 'p50',
    label: '실적 P50',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.p50Days === null ? <EmptyValue align="right" showLabel={false} /> : formatNumber(row.p50Days, '일'),
  },
  {
    key: 'p80',
    label: '실적 P80',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.p80Days === null ? <EmptyValue align="right" showLabel={false} /> : formatNumber(row.p80Days, '일'),
  },
  {
    key: 'p90',
    label: '실적 P90',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.p90Days === null ? <EmptyValue align="right" showLabel={false} /> : formatNumber(row.p90Days, '일'),
  },
  {
    key: 'samples',
    label: '표본',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.sampleCount === null ? (
        <EmptyValue align="right" reason="INSUFFICIENT_SAMPLE" showLabel={false} />
      ) : (
        formatNumber(row.sampleCount, '건')
      ),
  },
  {
    key: 'confidence',
    // HIGH 는 생략하고 MEDIUM · LOW 만 표시합니다 (design.md §8.3)
    label: '신뢰도',
    render: (row) =>
      row.confidence === 'LOW' ? (
        <Badge tone="crit">표본 부족</Badge>
      ) : row.confidence === 'MEDIUM' ? (
        <Badge tone="warn">표본 보통</Badge>
      ) : (
        <span className="text-3">—</span>
      ),
  },
  {
    key: 'effective',
    label: '적용값',
    align: 'right',
    variant: 'num',
    render: (row) => (
      <span style={{ display: 'inline-flex', gap: 'var(--s-2)', alignItems: 'center' }}>
        {row.effectiveLeadTime === null ? (
          <EmptyValue align="right" reason="NO_LEADTIME" showLabel={false} />
        ) : (
          formatNumber(row.effectiveLeadTime, '일')
        )}
        <Badge tone={row.source === CONFIRMED ? 'info' : 'plain'}>{row.source ?? '미정'}</Badge>
      </span>
    ),
  },
  {
    key: 'form',
    label: '확정 · 해제',
    render: (row) => <LeadtimeRowForm policy={row} />,
  },
];

const historyColumns: Column<LeadtimePlanHistory>[] = [
  {
    key: 'changedAt',
    label: '시각',
    variant: 'code',
    render: (row) => (row.changedAt === null ? <EmptyValue showLabel={false} /> : row.changedAt.slice(0, 19).replace('T', ' ')),
  },
  {
    key: 'supplier',
    label: '공급처',
    variant: 'strong',
    render: (row) => row.supplierName ?? row.supplierId,
  },
  {
    key: 'change',
    label: '변경',
    align: 'right',
    variant: 'num',
    render: (row) => (
      <span>
        {row.leadTimeBefore === null ? '—' : `${row.leadTimeBefore}일`}
        {' → '}
        {row.leadTimeAfter === null ? '실적 P80' : `${row.leadTimeAfter}일`}
      </span>
    ),
  },
  { key: 'reason', label: '사유', render: (row) => row.reason },
  {
    key: 'actor',
    label: '변경자',
    render: (row) => row.changedEmail ?? <EmptyValue showLabel={false} />,
  },
];

export default async function LeadtimePolicyPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // 레이아웃이 이미 막지만 화면에서도 검증합니다 (AGENTS.md 규칙 8).
  const admin = await requireAdmin();
  if (!admin) return <Forbidden role="USER" />;

  const activeFilter = readFilter(await searchParams);
  const [{ rows, error }, { rows: history }] = await Promise.all([
    getLeadtimePolicies(),
    getLeadtimePlanHistory(50),
  ]);

  const header = (
    <PageHeader
      title="리드타임 정책"
      subtitle="확정값이 있으면 그 값을, 없으면 실적 P80 을 씁니다. 여기서 값을 바꾸면 화면 코드를 고치지 않아도 재고 소진 판정이 즉시 달라집니다."
      meta={
        <>
          <MetaChip>PRD 18</MetaChip>
          <MetaChip>ROLE: ADMIN</MetaChip>
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
            title="공급처 리드타임 통계가 없습니다"
            desc="sql/15-inventory-projection.sql 을 실행하고, 선적 이력이 적재되어 있는지 확인해주세요."
          />
        </Panel>
      </>
    );
  }

  const confirmed = rows.filter((row) => row.source === CONFIRMED).length;
  const fromP80 = rows.length - confirmed;
  const lowConfidence = rows.filter((row) => row.confidence === 'LOW').length;
  const visible = applyFilter(rows, FILTERS, activeFilter);
  const filterLabel = labelOf(FILTERS, activeFilter);

  return (
    <>
      {header}

      <div className="grid grid-kpi">
        <KpiCard
          label="공급처"
          value={rows.length}
          unit="곳"
          icon={Building2}
          foot="실적이 있는 공급처"
          filter={{ key: 'all', active: activeFilter === 'all' }}
        />
        <KpiCard
          label="확정값 적용"
          value={confirmed}
          unit={`/ ${rows.length}`}
          icon={CheckCircle2}
          foot="사람이 확정한 값"
          filter={{ key: 'confirmed', active: activeFilter === 'confirmed' }}
        />
        <KpiCard
          label="실적 P80 적용"
          value={fromP80}
          unit={`/ ${rows.length}`}
          icon={Sigma}
          foot="아직 확정하지 않았습니다"
          filter={{ key: 'p80', active: activeFilter === 'p80' }}
        />
        <KpiCard
          label="표본 부족"
          value={lowConfidence}
          unit="곳"
          icon={TriangleAlert}
          tone={lowConfidence > 0 ? 'warn' : 'default'}
          foot="분위수를 그대로 믿기 어렵습니다"
          filter={{ key: 'low', active: activeFilter === 'low' }}
        />
      </div>

      <InsightBanner eyebrow="LEAD TIME POLICY">
        리드타임의 끝점은 창고 입고가 아니라 <b>QC Release</b> 입니다. 입고되어도 검수 전이면 쓸 수 없기
        때문입니다(<span className="t-code">renew.prd</span> 18.1). 표본이 부족한 공급처는 분위수가 흔들리므로,
        마스터 값과 실적을 함께 보고 확정하세요.
      </InsightBanner>

      {filterLabel && <FilterNotice label={filterLabel} shown={visible.length} total={rows.length} />}

      <Panel
        title="공급처별 리드타임"
        actions={<span className="t-label">사유 없이 저장할 수 없습니다</span>}
        flush
      >
        {visible.length === 0 ? (
          <EmptyState
            title={`${filterLabel ?? ''} 에 해당하는 공급처가 없습니다`}
            desc="위 카드를 다시 눌러 전체 목록으로 돌아갈 수 있습니다."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(row) => row.supplierId}
            caption="analytics.v_leadtime_policy — 실적 분위수와 적용 중인 계획 리드타임"
          />
        )}
      </Panel>

      <Panel title="변경 이력" actions={<span className="t-label">최근 50건</span>} flush>
        {history.length === 0 ? (
          <EmptyState
            title="아직 바꾼 기록이 없습니다"
            desc="위 표에서 일수와 사유를 입력해 확정하면 여기에 남습니다."
          />
        ) : (
          <DataTable
            columns={historyColumns}
            rows={history}
            rowKey={(row) => String(row.id)}
            caption="analytics.v_leadtime_plan_history — 계획 리드타임 변경 이력"
          />
        )}
      </Panel>
    </>
  );
}
