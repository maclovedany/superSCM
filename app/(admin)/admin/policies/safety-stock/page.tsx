// 안전재고 정책 — renew.prd 21장 · 32장
//
//   σ_DLT = √( L × σ_d² + d² × σ_L² )
//   Safety Stock = Z × σ_DLT
//
// σ_d 는 백테스트 RMSE 에서 옵니다. 예측 정확도가 안전재고 두께를 결정합니다 — 예측이 잘
// 맞는 품목은 버퍼를 얇게, 자주 빗나가는 품목은 두껍게 가져갑니다 (renew.prd 21.1).
//
// 아래 표는 읽기 전용입니다. 값을 직접 고치지 않고, 위의 정책값과 서비스 수준을 바꿔서
// 움직입니다. 그래야 어떤 안전재고든 근거를 되짚을 수 있습니다.

import { Boxes, Database, HelpCircle, LineChart } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import Badge from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import FilterNotice from '@/components/ui/filter-notice';
import Forbidden from '@/components/ui/forbidden';
import InsightBanner from '@/components/ui/insight-banner';
import { EmptyState, ErrorState } from '@/components/ui/state';
import { requireAdmin } from '@/lib/auth';
import { getPolicies, type Policy } from '@/lib/policy';
import { getSafetyStocks } from '@/lib/recommendation';
import type { SafetyStock } from '@/lib/recommendation-model';
import { applyFilter, labelOf, readFilter, type FilterSpec, type SearchParams } from '@/lib/filter';
import { EDITABLE_POLICY_KEYS } from './state';
import PolicyConfigForm from './policy-config-form';

export const dynamic = 'force-dynamic';

/** KPI 카드 하나 = 목록 필터 하나 (design.md §6.4) */
const FILTERS: FilterSpec<SafetyStock>[] = [
  { key: 'all', label: '대상 품목', match: null },
  { key: 'backtest', label: '백테스트 σ', match: (row) => row.sigmaSource === 'BACKTEST' },
  { key: 'insample', label: 'in-sample σ', match: (row) => row.sigmaSource === 'IN_SAMPLE' },
  { key: 'unknown', label: '산출 불가', match: (row) => row.safetyStock === null },
];

function pct(value: number | null): string | null {
  return value === null ? null : `${(value * 100).toFixed(1)}%`;
}

export default async function SafetyStockPolicyPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // 레이아웃이 이미 막지만 화면에서도 검증합니다 (AGENTS.md 규칙 8).
  const admin = await requireAdmin();
  if (!admin) return <Forbidden role="USER" />;

  const activeFilter = readFilter(await searchParams);
  const [{ rows, error }, { rows: policies, error: policyError }] = await Promise.all([
    getSafetyStocks(),
    getPolicies(),
  ]);

  const header = (
    <PageHeader
      title="안전재고 정책"
      subtitle="수요 변동과 리드타임 변동을 함께 반영해 σ_DLT 를 구하고 서비스 수준의 Z 를 곱합니다. σ_d 는 백테스트 결과에서 오므로, 예측이 좋아지면 같은 서비스 수준에서도 안전재고가 얇아집니다."
      meta={
        <>
          <MetaChip>PRD 21</MetaChip>
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

  // 이 화면에서 고칠 정책값만 골라, state.ts 에 적은 순서대로 보여 줍니다.
  const editable = EDITABLE_POLICY_KEYS.map((key) =>
    policies.find((row) => row.key === key),
  ).filter((row): row is Policy => row !== undefined);

  const policyColumns: Column<Policy>[] = [
    { key: 'key', label: '키', variant: 'code', render: (row) => row.key },
    { key: 'description', label: '설명', render: (row) => row.description },
    {
      key: 'valueNum',
      label: '현재 값',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.valueNum === null ? (
          <EmptyValue align="right" showLabel={false} />
        ) : (
          <b>
            {formatNumber(row.valueNum)}
            {row.unit ? ` ${row.unit}` : ''}
          </b>
        ),
    },
    { key: 'form', label: '변경', render: (row) => <PolicyConfigForm policy={row} /> },
  ];

  const columns: Column<SafetyStock>[] = [
    {
      key: 'item',
      label: '품목',
      variant: 'strong',
      render: (row) => (
        <span style={{ display: 'grid' }}>
          <span>{row.itemName ?? row.itemId}</span>
          <span className="t-code text-3">{row.itemId}</span>
        </span>
      ),
    },
    {
      key: 'itemGrade',
      label: '등급',
      render: (row) =>
        row.itemGrade === null ? <span className="text-3">없음</span> : <Badge>{row.itemGrade}</Badge>,
    },
    {
      key: 'serviceLevel',
      label: 'SL',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.serviceLevel === null ? (
          <EmptyValue align="right" showLabel={false} />
        ) : (
          pct(row.serviceLevel)
        ),
    },
    {
      key: 'zValue',
      label: 'Z',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.zValue === null ? <EmptyValue align="right" showLabel={false} /> : row.zValue.toFixed(4),
    },
    {
      key: 'leadTimeDays',
      label: 'L',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.leadTimeDays === null ? (
          <EmptyValue align="right" reason="NO_LEADTIME" showLabel={false} />
        ) : (
          formatNumber(row.leadTimeDays, '일')
        ),
    },
    {
      key: 'leadTimeSd',
      // 표본이 1건이면 표준편차가 없습니다. σ_DLT 에서는 0 으로 두고 신뢰도로 드러냅니다
      // (renew.prd 18.2 · design.md §8.3).
      label: 'σ_L',
      align: 'right',
      variant: 'num',
      render: (row) => (
        <span>
          {row.leadTimeSd === null ? (
            <EmptyValue align="right" reason="INSUFFICIENT_SAMPLE" showLabel={false} />
          ) : (
            row.leadTimeSd.toFixed(2)
          )}
          {row.leadTimeConfidence === 'LOW' && (
            <>
              {' '}
              <Badge tone="crit">표본 부족</Badge>
            </>
          )}
          {row.leadTimeConfidence === 'MEDIUM' && (
            <>
              {' '}
              <Badge tone="warn">표본 보통</Badge>
            </>
          )}
        </span>
      ),
    },
    {
      key: 'dailyDemand',
      label: 'd',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.dailyDemand === null ? (
          <EmptyValue align="right" reason="NO_FORECAST" showLabel={false} />
        ) : (
          row.dailyDemand.toFixed(1)
        ),
    },
    {
      key: 'sigmaD',
      label: 'σ_d',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.sigmaD === null ? (
          <EmptyValue align="right" reason="INSUFFICIENT_SAMPLE" showLabel={false} />
        ) : (
          row.sigmaD.toFixed(2)
        ),
    },
    {
      key: 'sigmaSource',
      label: 'σ 출처',
      render: (row) =>
        row.sigmaSource === null ? (
          <EmptyValue reason="INSUFFICIENT_SAMPLE" showLabel={false} />
        ) : (
          <Badge tone={row.sigmaSource === 'BACKTEST' ? 'safe' : 'warn'}>
            {row.sigmaSource === 'BACKTEST' ? '백테스트' : 'in-sample'}
          </Badge>
        ),
    },
    {
      key: 'sigmaDlt',
      label: 'σ_DLT',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.sigmaDlt === null ? (
          <EmptyValue align="right" reason={row.reason} showLabel={false} />
        ) : (
          row.sigmaDlt.toFixed(1)
        ),
    },
    {
      key: 'safetyStock',
      label: '안전재고',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.safetyStock === null ? (
          <EmptyValue align="right" reason={row.reason} showLabel={false} />
        ) : (
          <b className="hl-warn">{formatNumber(row.safetyStock)}</b>
        ),
    },
    {
      key: 'reason',
      label: '사유',
      render: (row) =>
        row.reason === null ? <span className="text-3">—</span> : <EmptyValue reason={row.reason} />,
    },
  ];

  const visible = applyFilter(rows, FILTERS, activeFilter);
  const filterLabel = labelOf(FILTERS, activeFilter);

  const backtestCount = rows.filter((row) => row.sigmaSource === 'BACKTEST').length;
  const insampleCount = rows.filter((row) => row.sigmaSource === 'IN_SAMPLE').length;
  const unknownCount = rows.filter((row) => row.safetyStock === null).length;

  return (
    <>
      {header}

      <Panel
        title="공통 정책값"
        actions={<span className="t-label">core.policy_config · 값을 비울 수 없습니다</span>}
        flush
      >
        {policyError ? (
          <ErrorState detail={policyError} />
        ) : editable.length === 0 ? (
          <EmptyState
            title="정책값이 없습니다"
            desc="sql/06-core-extend.sql 이 기본 정책값을 심습니다. 실행 여부를 확인해주세요."
          />
        ) : (
          <DataTable
            columns={policyColumns}
            rows={editable}
            rowKey={(row) => row.key}
            caption="core.policy_config — 안전재고와 발주 권고일에 들어가는 값"
          />
        )}
      </Panel>

      <div className="grid grid-kpi">
        <KpiCard
          label="대상 품목"
          value={rows.length}
          unit="개"
          icon={Boxes}
          foot="활성 품목 전체"
          filter={{ key: 'all', active: activeFilter === 'all' }}
        />
        <KpiCard
          label="백테스트 σ 사용"
          value={backtestCount}
          unit={`/ ${rows.length}`}
          icon={LineChart}
          foot="검증 구간에서 실제로 잰 오차"
          filter={{ key: 'backtest', active: activeFilter === 'backtest' }}
        />
        <KpiCard
          label="in-sample σ 사용"
          value={insampleCount}
          unit={`/ ${rows.length}`}
          icon={Database}
          tone={insampleCount > 0 ? 'warn' : 'default'}
          foot="학습 데이터로 잰 값이라 낙관적입니다"
          filter={{ key: 'insample', active: activeFilter === 'insample' }}
        />
        <KpiCard
          label="산출 불가"
          value={unknownCount}
          unit="개"
          icon={HelpCircle}
          foot="리드타임 · 예측 · 서비스 수준 미확보"
          filter={{ key: 'unknown', active: activeFilter === 'unknown' }}
        />
      </div>

      <InsightBanner eyebrow="SAFETY STOCK">
        σ_d 가 <b>in-sample</b> 인 품목은 학습에 쓴 데이터로 잰 오차라 실제보다 작게 나옵니다.
        그만큼 안전재고가 얇아지므로, 백테스트를 한 번 돌려 <b>백테스트 σ</b> 로 바꾸는 편이
        안전합니다. 월 단위 오차를 √30.4 로 나눠 일 단위로 내리는데, 일별 오차가 서로 독립이라는
        가정이 들어 있어 실제 변동보다 작게 잡힐 수 있습니다.
      </InsightBanner>

      {filterLabel && <FilterNotice label={filterLabel} shown={visible.length} total={rows.length} />}

      <Panel
        title="품목별 안전재고"
        actions={<span className="t-label">읽기 전용 · 안전재고 큰 순</span>}
        flush
      >
        {rows.length === 0 ? (
          <EmptyState
            title="안전재고를 산출할 품목이 없습니다"
            desc="analytics.v_safety_stock 에 행이 없습니다. sql/16-safety-stock-recommendation.sql 실행 여부를 확인해주세요."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={`${filterLabel ?? ''} 에 해당하는 품목이 없습니다`}
            desc="위 카드를 다시 눌러 전체 목록으로 돌아갈 수 있습니다."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(row) => row.itemId}
            caption="analytics.v_safety_stock — σ_DLT 와 안전재고"
          />
        )}
      </Panel>
    </>
  );
}
