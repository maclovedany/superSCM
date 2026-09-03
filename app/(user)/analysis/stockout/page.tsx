// 재고 소진 위험 — renew.prd 19장 · 20장
//
// 이 화면의 핵심은 "계산할 수 없는 품목을 계산된 척하지 않는 것" 입니다.
// 재고·리드타임·예측 중 하나라도 없으면 숫자 대신 — 와 사유 코드를 보여줍니다 (design.md §8.2).
//
// STEP 9 에서 계산식이 바뀌었습니다.
//   전  가용재고 ÷ 일평균 사용량 (한 줄 나눗셈)
//   후  analytics.v_inventory_projection 의 기간별 전개에서 기말이 처음 음수가 되는 시점
// 판정도 3상태에서 4상태로 늘었습니다. 임계값은 core.policy_config 에서 옵니다.

import Link from 'next/link';
import { Boxes, CalendarClock, HelpCircle, ShieldAlert, TriangleAlert } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import Badge, { StatusBadge } from '@/components/ui/badge';
import InsightBanner from '@/components/ui/insight-banner';
import { ErrorState, EmptyState } from '@/components/ui/state';
import FilterNotice from '@/components/ui/filter-notice';
import { requireUser } from '@/lib/auth';
import { getStockoutKpi, getStockoutRisks } from '@/lib/scm';
import type { StockoutRisk } from '@/lib/scm-model';
import { nullsLast } from '@/lib/status';
import { applyFilter, labelOf, readFilter, type FilterSpec, type SearchParams } from '@/lib/filter';

export const dynamic = 'force-dynamic';

const SOURCE_LABEL: Record<string, string> = {
  CHAMPION: 'Champion',
  DEFAULT: '기본',
};

const columns: Column<StockoutRisk>[] = [
  {
    key: 'itemId',
    label: '품목코드',
    variant: 'code',
    // 코드를 누르면 그 품목의 기간별 전개로 넘어갑니다. 판정 근거가 거기 있습니다.
    render: (row) => (
      <Link href={`/inventory-projection?item=${row.itemId}`} style={{ color: 'var(--info-fg)' }}>
        {row.itemId}
      </Link>
    ),
  },
  { key: 'itemName', label: '품목명', variant: 'strong', render: (row) => row.itemName },
  { key: 'supplierId', label: '공급처', variant: 'code', render: (row) => row.supplierId },
  {
    key: 'availableQty',
    label: '가용재고',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.availableQty === null ? (
        <EmptyValue align="right" reason="NO_INVENTORY_DATA" showLabel={false} />
      ) : (
        formatNumber(row.availableQty)
      ),
  },
  {
    key: 'dailyUsageAvg',
    label: '일평균 사용',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.dailyUsageAvg === null ? (
        <EmptyValue align="right" reason="NO_USAGE_HISTORY" showLabel={false} />
      ) : (
        formatNumber(row.dailyUsageAvg)
      ),
  },
  {
    key: 'forecastSource',
    label: '예측 기준',
    render: (row) =>
      row.forecastSource === null ? (
        <EmptyValue reason="NO_FORECAST" showLabel={false} />
      ) : (
        <Badge tone={row.forecastSource === 'CHAMPION' ? 'safe' : 'plain'}>
          {SOURCE_LABEL[row.forecastSource] ?? row.forecastSource}
        </Badge>
      ),
  },
  {
    key: 'plannedLeadTime',
    label: '계획 L/T',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.plannedLeadTime === null ? (
        <EmptyValue align="right" reason="NO_LEADTIME" showLabel={false} />
      ) : (
        formatNumber(row.plannedLeadTime, '일')
      ),
  },
  {
    key: 'stockoutDays',
    label: '소진까지',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.stockoutDays === null ? (
        <EmptyValue align="right" reason={row.reason} showLabel={false} />
      ) : (
        formatNumber(row.stockoutDays, '일')
      ),
  },
  {
    key: 'stockoutDate',
    label: '소진 예상일',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.stockoutDate === null ? (
        <EmptyValue align="right" showLabel={false} />
      ) : (
        row.stockoutDate
      ),
  },
  {
    key: 'requiredQty',
    label: '필요량',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.requiredQty === null ? (
        <EmptyValue align="right" reason={row.reason ?? 'NO_LEADTIME'} showLabel={false} />
      ) : (
        <span className={row.requiredQty > 0 ? 'hl-warn' : undefined}>
          {formatNumber(row.requiredQty)}
        </span>
      ),
  },
  {
    key: 'riskStatus',
    label: '판정',
    render: (row) => <StatusBadge status={row.riskStatus} />,
  },
];

/**
 * KPI 카드 하나가 목록 필터 하나에 대응합니다 (design.md §6.4).
 * 카드를 누르면 아래 표가 그 카드의 데이터로 좁혀집니다.
 */
const FILTERS: FilterSpec<StockoutRisk>[] = [
  { key: 'all', label: '대상 품목', match: null },
  { key: 'critical', label: '위험', match: (row) => row.riskStatus === 'CRITICAL' },
  { key: 'warning', label: '주의', match: (row) => row.riskStatus === 'WARNING' },
  {
    // ★ 이 화면에는 카드가 없는 필터입니다. 대시보드의 "위험 SKU" 카드가 이 키로 들어옵니다 —
    //   그 카드는 v_dashboard_kpi.n_risk_items(= n_critical + n_warning)를 보여주므로
    //   위험만 걸러 보내면 카드는 12건인데 목록은 3건인 화면이 열립니다.
    key: 'risk',
    label: '위험 + 주의',
    match: (row) => row.riskStatus === 'CRITICAL' || row.riskStatus === 'WARNING',
  },
  {
    key: 'within30',
    // 이미 소진된 품목(음수)은 "앞으로 30일 안에" 가 아닙니다.
    // analytics.v_stockout_kpi 의 n_within_30d 와 같은 조건이어야 카드 숫자와 목록이 맞습니다.
    label: '30일 이내 소진',
    match: (row) => row.stockoutDays !== null && row.stockoutDays >= 0 && row.stockoutDays <= 30,
  },
  {
    // within30 과 같은 이유로 카드가 없는 필터입니다. 대시보드의 "60일 결품 위험" 카드가 씁니다.
    // 조건은 analytics.v_stockout_kpi 의 n_within_60d 와 같습니다 (between 0 and 60).
    key: 'within60',
    label: '60일 이내 소진',
    match: (row) => row.stockoutDays !== null && row.stockoutDays >= 0 && row.stockoutDays <= 60,
  },
  {
    key: 'unknown',
    label: '산출 불가',
    match: (row) => row.riskStatus === 'CALCULATION_UNAVAILABLE',
  },
];

export default async function StockoutPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();

  const activeFilter = readFilter(await searchParams);
  const [{ rows, error }, { data: kpi }] = await Promise.all([getStockoutRisks(), getStockoutKpi()]);

  const header = (
    <PageHeader
      title="재고 소진 위험"
      subtitle="기간별 재고 전개에서 기말 재고가 처음 음수가 되는 시점을 봅니다. 지금 발주해도 늦으면 위험, 이번 검토 주기 안에 발주해야 하면 주의입니다. 재고·리드타임·예측이 없는 품목은 숫자로 채우지 않고 산출 불가로 표시합니다."
      meta={
        <>
          <MetaChip>PRD 20</MetaChip>
          <MetaChip>PRD 19 전개 기반</MetaChip>
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
            title="표시할 품목이 없습니다"
            desc="analytics.v_stockout_risk 에 행이 없습니다. sql/15-inventory-projection.sql 실행 여부를 확인해주세요."
          />
        </Panel>
      </>
    );
  }

  // 산출 불가 행은 맨 뒤로 보냅니다. 0 으로 취급하면 가장 급한 품목처럼 보입니다.
  const sorted = [...rows].sort(nullsLast((row) => row.stockoutDays));
  const visible = applyFilter(sorted, FILTERS, activeFilter);
  const filterLabel = labelOf(FILTERS, activeFilter);

  const criticalCount = kpi?.criticalCount ?? rows.filter((row) => row.riskStatus === 'CRITICAL').length;
  const warningCount = kpi?.warningCount ?? rows.filter((row) => row.riskStatus === 'WARNING').length;
  const unknownCount =
    kpi?.unknownCount ?? rows.filter((row) => row.riskStatus === 'CALCULATION_UNAVAILABLE').length;
  const itemCount = kpi?.itemCount ?? rows.length;
  const within30 = kpi?.within30DaysCount ?? null;
  const soonest = sorted.find((row) => row.stockoutDays !== null) ?? null;

  return (
    <>
      {header}

      {/* 카드 5장이라 grid-kpi 에서 두 줄이 됩니다. 30일 이내와 60일 이내를 합치지 않습니다 */}
      <div className="grid grid-kpi">
        <KpiCard
          label="대상 품목"
          value={itemCount}
          unit="개"
          icon={Boxes}
          foot="판정 대상 전체"
          filter={{ key: 'all', active: activeFilter === 'all' }}
        />
        <KpiCard
          label="위험"
          value={criticalCount}
          unit={`/ ${itemCount}`}
          icon={TriangleAlert}
          tone={criticalCount > 0 ? 'crit' : 'default'}
          foot="지금 발주해도 결품 후 도착"
          filter={{ key: 'critical', active: activeFilter === 'critical' }}
        />
        <KpiCard
          label="주의"
          value={warningCount}
          unit={`/ ${itemCount}`}
          icon={ShieldAlert}
          tone={warningCount > 0 ? 'warn' : 'default'}
          foot="이번 검토 주기 안에 발주"
          filter={{ key: 'warning', active: activeFilter === 'warning' }}
        />
        <KpiCard
          label="30일 이내 소진"
          value={within30}
          unit={within30 === null ? undefined : '개'}
          icon={CalendarClock}
          tone={within30 !== null && within30 > 0 ? 'warn' : 'default'}
          foot="가장 먼저 확인할 구간"
          filter={{ key: 'within30', active: activeFilter === 'within30' }}
        />
        <KpiCard
          label="산출 불가"
          value={unknownCount}
          unit="개"
          icon={HelpCircle}
          foot="재고 · 리드타임 · 예측 미확보"
          filter={{ key: 'unknown', active: activeFilter === 'unknown' }}
        />
      </div>

      {soonest && soonest.stockoutDays !== null && (
        <InsightBanner eyebrow="STOCKOUT INSIGHT">
          가장 먼저 소진되는 품목은 <b>{soonest.itemName}</b>(<span className="t-code">{soonest.itemId}</span>)
          이며, 약 <span className="hl-crit">{formatNumber(soonest.stockoutDays, '일')}</span> 뒤 소진이 예상됩니다.
          {soonest.requiredQty !== null && soonest.requiredQty > 0 && (
            <>
              {' '}
              리드타임과 검토 주기를 덮으려면 <span className="hl-warn">{formatNumber(soonest.requiredQty)}개</span>{' '}
              가 더 필요합니다.
            </>
          )}
          {unknownCount > 0 && (
            <>
              {' '}
              전체 {itemCount}개 중 <span className="hl-warn">{unknownCount}개</span> 는 재고·리드타임·예측 중
              하나가 없어 판정하지 못했습니다. 이 품목들은 평균 계산에서 제외했습니다.
            </>
          )}
        </InsightBanner>
      )}

      {filterLabel && (
        <FilterNotice label={filterLabel} shown={visible.length} total={sorted.length} />
      )}

      <Panel
        title="품목별 소진 위험"
        actions={<span className="t-label">소진 임박 순 · 산출 불가는 맨 뒤</span>}
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
            caption="품목별 가용재고와 소진 예상 시점"
          />
        )}
      </Panel>
    </>
  );
}
