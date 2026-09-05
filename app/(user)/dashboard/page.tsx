// 대시보드 — renew.prd 28장 · 31.4
//
// 로그인 후 첫 화면입니다. "오늘 무엇을 해야 하는가" 를 한 화면에 모읍니다.
//
// ★ 이 화면은 새 숫자를 만들지 않습니다.
//   상단 KPI 12종은 analytics.v_dashboard_kpi 한 줄에서 통째로 옵니다.
//   하단 위젯도 각자의 뷰가 이미 정렬·절단해 둔 목록을 그리기만 합니다.
//   여기서 합계나 평균을 내면 대시보드와 상세 화면이 다른 값을 말하게 됩니다 (AGENTS.md 규칙 2).
//
// ★ LLM 없이 완전히 동작합니다 (renew.prd 31.4).
//   우측 레일의 인사이트는 AI 응답이 아니라 뷰 숫자로 조립한 정적 문장입니다
//   (lib/dashboard-model.ts 의 railSentences). STEP 16 의 AI Agent 가 없어도,
//   있어도 응답하지 못해도 이 화면은 그대로 나옵니다.
//
// ★ 차트 띠 6종(spec §4.1)은 각자의 뷰 숫자만 그립니다. 표와 다른 값을 보이면 뷰가 다른 것이지
//   화면이 계산한 것이 아닙니다.
//
// kpi-filter: 없음 — 카드는 다른 화면으로 가는 링크입니다.
//   대시보드에는 좁힐 목록이 없습니다. 카드를 누르면 그 숫자를 만든 화면으로 갑니다.
//
//   ★ 링크에 다는 ?filter= 는 그 화면의 FilterSpec 조건이 이 카드의 뷰 조건과
//     **정확히 같을 때만** 답니다. 어긋나면 카드는 12건이라 하는데 목록은 3건인 화면이 열립니다.
//     맞는 필터가 없으면 그 화면에 만들었습니다 (필터 정의는 언제나 그 화면 한 곳입니다) —
//       /analysis/stockout  risk(위험+주의) · within60
//       /alerts             excess(EXCESS_INVENTORY 유형)
//     합계 카드(총 추천 수량 · 금액)는 좁힐 대상이 없어 필터 없이 목록으로 보냅니다.

import Link from 'next/link';
import StaleBanner from '@/components/ui/stale-banner';
import {
  Activity,
  BadgeCheck,
  Boxes,
  CalendarClock,
  CircleAlert,
  Coins,
  Gauge,
  PackageSearch,
  ShoppingCart,
  Sparkles,
  Ship,
  Target,
} from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import Badge, { StatusBadge } from '@/components/ui/badge';
import AlertRow from '@/components/ui/alert-row';
import { EmptyState, ErrorState } from '@/components/ui/state';
import Sparkline, { type SparklineDatum } from '@/components/chart/sparkline';
import ChartFrame from '@/components/chart/_base/chart-frame';
import DashboardDemandTrend from '@/components/chart/dashboard-demand-trend';
import DashboardRiskMix from '@/components/chart/dashboard-risk-mix';
import DashboardSupplierAmount from '@/components/chart/dashboard-supplier-amount';
import DashboardAccuracyRanking from '@/components/chart/dashboard-accuracy-ranking';
import AlertsTypeMix from '@/components/chart/alerts-type-mix';
import DecisionMonthly from '@/components/chart/decision-monthly';
import { isSalesUser, requireUser } from '@/lib/auth';
import { getStockoutKpi } from '@/lib/scm';
import {
  getAlertTypeMix,
  getApprovalMonthly,
  getDemandTrend,
  getRecommendationBySupplier,
} from '@/lib/charts';
import {
  pivotAlertTypeMix,
  pivotApprovalMonthly,
  riskMixFromKpi,
  toAccuracyBars,
  type RiskMixKey,
} from '@/lib/chart-model';
import {
  getDashboardAccuracyRanking,
  getDashboardKpi,
  getDashboardOpenPoRisk,
  getDashboardPurchasePriority,
  getDashboardRecentApprovals,
  getDashboardSparklines,
  monthLabel,
  percentText,
  railSentences,
  signedPercentText,
  type AccuracyRankingRow,
  type OpenPoRiskRow,
  type PurchasePriorityRow,
} from '@/lib/dashboard';
import { getProjectionItems } from '@/lib/inventory';
import { getAlerts, alertAgeText, SEVERITY_LABEL, SEVERITY_TONE } from '@/lib/alerts';
import { DECISION_TONE, decisionLabel, isDecision } from '@/lib/approval-model';

export const dynamic = 'force-dynamic';

/** 금액 표시. 발주 추천 화면과 같은 형식이어야 두 화면이 같은 값을 같게 읽힙니다 */
function money(value: number): string {
  return `${Math.round(value).toLocaleString()}원`;
}

function dateText(value: string | null): string | null {
  if (value === null) return null;
  return value.slice(0, 10);
}

function stampText(value: string | null): string | null {
  if (value === null) return null;
  return new Date(value).toLocaleString('ko-KR');
}

/** 지연 일수 문구. 양수면 지났고 음수면 남았습니다 */
function delayText(days: number | null): string | null {
  if (days === null) return null;
  if (days > 0) return `${days}일 경과`;
  if (days === 0) return '오늘';
  return `${-days}일 남음`;
}

/**
 * 결품 위험 분포에서 누른 판정 → /analysis/stockout 의 필터.
 * ★ 그 화면 FilterSpec 에 있는 키만 씁니다 (위 ?filter= 규칙). 없는 판정은 이동하지 않습니다.
 */
const RISK_HREFS: Partial<Record<RiskMixKey, string>> = {
  CRITICAL: '/analysis/stockout?filter=critical',
  WARNING: '/analysis/stockout?filter=risk',
};

/** 알림 유형 → /alerts 의 필터. 그 화면 FilterSpec 에 있는 유형 키만 씁니다 (지금은 excess 하나) */
function alertTypeHref(type: string): string {
  return type === 'EXCESS_INVENTORY' ? '/alerts?filter=excess' : '/alerts';
}

const priorityColumns = (
  sparklines: Map<string, SparklineDatum[]>,
): Column<PurchasePriorityRow>[] => [
  {
    key: 'itemId',
    label: '품목',
    variant: 'code',
    render: (row) => (
      <Link
        href={`/purchase-recommendation/${encodeURIComponent(row.itemId)}`}
        style={{ color: 'var(--info-fg)' }}
      >
        {row.itemId}
      </Link>
    ),
  },
  { key: 'itemName', label: '품목명', variant: 'strong', render: (row) => row.itemName ?? '—' },
  {
    key: 'risk',
    label: '판정',
    render: (row) => (
      <>
        <StatusBadge status={row.risk} />
        {row.isUrgent === true && <Badge tone="crit">긴급</Badge>}
      </>
    ),
  },
  {
    key: 'requiredOrderDate',
    label: '발주 권고일',
    render: (row) =>
      row.requiredOrderDate === null ? (
        <EmptyValue reason={row.reasonCode} showLabel={false} />
      ) : (
        <span className={row.isUrgent === true ? 'hl-crit' : undefined}>
          {dateText(row.requiredOrderDate)}
        </span>
      ),
  },
  {
    key: 'finalRecommendedQty',
    label: '추천 수량',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.finalRecommendedQty === null ? (
        <EmptyValue align="right" reason={row.reasonCode} showLabel={false} />
      ) : (
        formatNumber(row.finalRecommendedQty)
      ),
  },
  {
    key: 'recommendedAmount',
    label: '추천 금액',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.recommendedAmount === null ? (
        // 단가가 없어 금액을 못 낸 것이지 0원이 아닙니다.
        <EmptyValue align="right" />
      ) : (
        money(row.recommendedAmount)
      ),
  },
  {
    key: 'trend',
    label: '추이',
    render: (row) => {
      const points = sparklines.get(row.itemId);
      if (points === undefined || points.length === 0) return <span className="text-3">—</span>;
      return <Sparkline data={points} label={`${row.itemName ?? row.itemId} 수요 추이`} />;
    },
  },
];

const openPoColumns: Column<OpenPoRiskRow>[] = [
  { key: 'itemId', label: '품목', variant: 'code', render: (row) => row.itemId },
  { key: 'itemName', label: '품목명', variant: 'strong', render: (row) => row.itemName ?? '—' },
  {
    key: 'supplier',
    label: '공급처',
    render: (row) => <span className="t-sm text-2">{row.supplierName ?? row.supplierId ?? '—'}</span>,
  },
  {
    key: 'earliestDueDate',
    label: '최초 예정일',
    render: (row) => dateText(row.earliestDueDate) ?? <EmptyValue />,
  },
  {
    key: 'daysLate',
    label: '지연',
    align: 'right',
    render: (row) =>
      row.daysLate === null ? (
        <EmptyValue align="right" />
      ) : (
        <span className={row.isLate === true ? 'hl-crit' : 'hl-warn'}>{delayText(row.daysLate)}</span>
      ),
  },
  {
    key: 'nShipments',
    label: '선적',
    align: 'right',
    variant: 'num',
    render: (row) => (row.nShipments === null ? <EmptyValue align="right" /> : `${row.nShipments}건`),
  },
  {
    key: 'openQty',
    label: '수량',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.openQty === null ? <EmptyValue align="right" /> : formatNumber(row.openQty),
  },
];

export default async function DashboardPage() {
  const user = await requireUser();

  const [
    kpiResult,
    priority,
    ranking,
    openPo,
    approvals,
    projection,
    alerts,
    demandTrend,
    stockoutKpi,
    supplierAmount,
    alertMix,
    approvalMonthly,
  ] = await Promise.all([
    getDashboardKpi(),
    getDashboardPurchasePriority(),
    getDashboardAccuracyRanking(),
    getDashboardOpenPoRisk(),
    getDashboardRecentApprovals(),
    getProjectionItems(),
    getAlerts(5),
    getDemandTrend(),
    getStockoutKpi(),
    getRecommendationBySupplier(8),
    getAlertTypeMix(),
    getApprovalMonthly(),
  ]);

  const kpi = kpiResult.data;

  // 스파크라인은 표에 실제로 뜨는 품목만 받아옵니다. 목록이 정해진 뒤라 순서가 하나 늦습니다.
  const sparklineResult = await getDashboardSparklines(priority.rows.map((row) => row.itemId));

  // 품목별로 나누기만 합니다 — 더하지도 평균 내지도 않습니다.
  const sparklines = new Map<string, SparklineDatum[]>();
  for (const point of sparklineResult.rows) {
    const bucket = sparklines.get(point.itemId);
    const datum: SparklineDatum = {
      period: monthLabel(point.period),
      qty: point.qty,
      kind: point.kind,
    };
    if (bucket === undefined) sparklines.set(point.itemId, [datum]);
    else bucket.push(datum);
  }

  // 정확도가 없는 이유. Champion 이 하나도 없으면 아직 백테스트 전입니다.
  const accuracyReason = kpi !== null && kpi.nChampions === 0 ? 'INSUFFICIENT_SAMPLE' : null;

  // ★ 겹침은 가져온 행 수가 아니라 뷰가 센 전체 Champion 수로 판정합니다.
  //   조회가 양 끝 10건만 받아 오므로 rows.length 는 언제나 10 이하입니다 —
  //   그것으로 판정하면 Champion 이 100개여도 "겹칩니다" 라고 말하게 됩니다.
  const nRanked = ranking.rows[0]?.nRanked ?? null;
  const rankingOverlap = nRanked !== null && nRanked < 10;

  // 결품 위험 칩. 판정이 위험·주의인 품목만, 뷰가 정렬해 준 순서 그대로입니다.
  const riskChips = projection.rows
    .filter((row) => row.riskStatus === 'CRITICAL' || row.riskStatus === 'WARNING')
    .slice(0, 12);

  const topPriority = priority.rows[0] ?? null;
  const railLines = railSentences({
    urgentItemName: topPriority === null ? null : (topPriority.itemName ?? topPriority.itemId),
    urgentOrderDate: topPriority === null ? null : dateText(topPriority.requiredOrderDate),
    nUrgentOrders: kpi?.nUrgentOrders ?? null,
    nPendingApproval: kpi?.nPendingApproval ?? null,
  });

  const dataEnd = dateText(kpi?.dataEnd ?? null);

  return (
    <>
      <PageHeader
        title="대시보드"
        subtitle="전 세계 공급망 현황과 오늘 처리해야 할 일을 한 화면에 모읍니다."
        meta={
          <>
            <MetaChip>PRD 28</MetaChip>
            {dataEnd && <MetaChip>데이터 {dataEnd}</MetaChip>}
            {kpi?.forecastRunId && <MetaChip>RUN {kpi.forecastRunId}</MetaChip>}
          </>
        }
      />

      <StaleBanner />

      {kpiResult.error !== null ? (
        <Panel title="상단 KPI">
          <ErrorState detail={kpiResult.error} />
        </Panel>
      ) : (
        <div className="grid grid-kpi">
          <KpiCard
            label="예측 정확도"
            value={percentText(kpi?.forecastAccuracy ?? null)}
            icon={Target}
            reason={accuracyReason}
            href="/model-evaluation"
            foot={
              accuracyReason === null
                ? '1 − 평균 WAPE · Champion 기준'
                : '백테스트를 아직 돌리지 않았습니다'
            }
          />
          <KpiCard
            label="예측 Bias"
            value={signedPercentText(kpi?.forecastBias ?? null)}
            unit="%"
            icon={Gauge}
            reason={accuracyReason}
            href="/model-evaluation"
            foot="+ 는 과대예측 · − 는 과소예측"
          />
          <KpiCard
            label="위험 SKU"
            value={kpi?.nRiskItems ?? null}
            unit="개"
            icon={Activity}
            tone={kpi !== null && kpi.nRiskItems !== null && kpi.nRiskItems > 0 ? 'crit' : 'default'}
            href="/analysis/stockout?filter=risk"
            foot="위험 + 주의 판정 품목"
          />
          <KpiCard
            label="30일 결품 위험"
            value={kpi?.nStockout30d ?? null}
            unit="개"
            icon={CalendarClock}
            tone={
              kpi !== null && kpi.nStockout30d !== null && kpi.nStockout30d > 0 ? 'crit' : 'default'
            }
            href="/analysis/stockout?filter=within30"
            foot="앞으로 30일 안에 소진"
          />
          <KpiCard
            label="60일 결품 위험"
            value={kpi?.nStockout60d ?? null}
            unit="개"
            icon={CalendarClock}
            tone={
              kpi !== null && kpi.nStockout60d !== null && kpi.nStockout60d > 0 ? 'warn' : 'default'
            }
            href="/analysis/stockout?filter=within60"
            foot="앞으로 60일 안에 소진"
          />
          <KpiCard
            label="과잉 재고"
            value={kpi?.nExcessInventory ?? null}
            unit="건"
            icon={Boxes}
            href="/alerts?filter=excess"
            foot="알림 센터의 과잉 재고 미해결 건"
          />
          <KpiCard
            label="지연 Open PO"
            value={kpi?.nDelayedOpenPo ?? null}
            unit="건"
            icon={Ship}
            tone={
              kpi !== null && kpi.nDelayedOpenPo !== null && kpi.nDelayedOpenPo > 0
                ? 'warn'
                : 'default'
            }
            href="/alerts"
            foot="예정일이 지난 진행 중 선적"
          />
          <KpiCard
            label="발주 추천"
            value={kpi?.nRecommendations ?? null}
            unit="개"
            icon={ShoppingCart}
            href="/purchase-recommendation?filter=needed"
            foot="추천 수량이 0보다 큰 품목"
          />
          <KpiCard
            label="긴급 발주"
            value={kpi?.nUrgentOrders ?? null}
            unit="개"
            icon={CircleAlert}
            tone={
              kpi !== null && kpi.nUrgentOrders !== null && kpi.nUrgentOrders > 0 ? 'crit' : 'default'
            }
            href="/purchase-recommendation?filter=urgent"
            foot="발주 권고일이 이미 지났습니다"
          />
          <KpiCard
            label="총 추천 수량"
            value={
              kpi?.totalRecommendedQty === null || kpi?.totalRecommendedQty === undefined
                ? null
                : formatNumber(kpi.totalRecommendedQty)
            }
            icon={PackageSearch}
            href="/purchase-recommendation"
            foot="추천 수량의 합"
          />
          <KpiCard
            label="총 추천 금액"
            value={
              kpi?.totalRecommendedAmount === null || kpi?.totalRecommendedAmount === undefined
                ? null
                : money(kpi.totalRecommendedAmount)
            }
            icon={Coins}
            href="/purchase-recommendation"
            foot={
              kpi !== null && kpi.nMissingPrice !== null && kpi.nMissingPrice > 0
                ? `${kpi.nMissingPrice}개 품목 단가 없음 — 합계에서 제외`
                : '추천 수량 × 단가의 합'
            }
          />
          <KpiCard
            label="승인 대기"
            value={kpi?.nPendingApproval ?? null}
            unit="건"
            icon={BadgeCheck}
            tone={
              kpi !== null && kpi.nPendingApproval !== null && kpi.nPendingApproval > 0
                ? 'warn'
                : 'default'
            }
            href="/purchase-recommendation?filter=pending"
            foot="발주가 필요한데 아직 결정하지 않은 품목"
          />
        </div>
      )}

      {/* ── 차트 띠 — spec §4.1. 3×2. 각 차트는 자기 뷰의 숫자만 그립니다 ── */}
      <div className="grid-charts" data-cols="3">
        <ChartFrame
          title="수요 추이"
          desc="최근 12개월 실적 합계와 향후 3개월 Consensus 예측"
          error={demandTrend.error}
          empty={demandTrend.rows.length === 0 ? '실적이 아직 없습니다' : null}
        >
          <DashboardDemandTrend data={demandTrend.rows} />
        </ChartFrame>

        <ChartFrame
          title="결품 위험 분포"
          desc="재고 전개 판정별 품목 수 · 누르면 그 판정만 봅니다"
          error={stockoutKpi.error}
          empty={stockoutKpi.data === null ? '판정된 품목이 없습니다' : null}
        >
          {stockoutKpi.data !== null && (
            <DashboardRiskMix slices={riskMixFromKpi(stockoutKpi.data)} hrefs={RISK_HREFS} />
          )}
        </ChartFrame>

        <ChartFrame
          title="공급처별 추천 금액"
          desc="추천 수량이 있는 품목의 금액 합계 · 상위 8 · 빨간 막대는 긴급 포함"
          error={supplierAmount.error}
          empty={supplierAmount.rows.length === 0 ? '추천 수량이 있는 품목이 없습니다' : null}
          masked={isSalesUser(user)}
        >
          <DashboardSupplierAmount
            rows={supplierAmount.rows}
            hrefTemplate="/purchase-recommendation?supplier={id}"
          />
        </ChartFrame>

        <ChartFrame
          title="예측 정확도 랭킹"
          desc={`WAPE 낮을수록 정확 · 정확한 5 (초록) · 부정확한 5 (빨강)${
            rankingOverlap ? ` · Champion 이 ${nRanked}개라 양쪽에 같은 품목이 있습니다` : ''
          }`}
          error={ranking.error}
          empty={ranking.rows.length === 0 ? '정확도를 매길 품목이 없습니다' : null}
          masked={isSalesUser(user)}
        >
          <DashboardAccuracyRanking
            bars={toAccuracyBars(ranking.rows)}
            hrefTemplate="/model-comparison?item={id}"
          />
        </ChartFrame>

        <ChartFrame
          title="알림 유형별 현황"
          desc="열린 알림을 유형과 심각도로 · 범례를 눌러 심각도를 끄고 켭니다"
          error={alertMix.error}
          empty={alertMix.rows.length === 0 ? '열린 알림이 없습니다' : null}
        >
          <AlertsTypeMix
            stacks={pivotAlertTypeMix(alertMix.rows)}
            hrefs={Object.fromEntries(
              pivotAlertTypeMix(alertMix.rows).map((stack) => [stack.type, alertTypeHref(stack.type)]),
            )}
          />
        </ChartFrame>

        <ChartFrame
          title="월별 결정"
          desc="최근 6개월 발주 결정 건수 · 누르면 결정 이력으로"
          error={approvalMonthly.error}
          empty={approvalMonthly.rows.length === 0 ? '아직 내려진 결정이 없습니다' : null}
        >
          <DecisionMonthly stacks={pivotApprovalMonthly(approvalMonthly.rows)} href="/decision-history" />
        </ChartFrame>
      </div>

      <div className="grid grid-rail">
        {/* ── 주 패널 ─────────────────────────────────────────── */}
        <div className="grid">
          <Panel
            title="발주 우선순위"
            actions={<span className="t-label">발주 권고일이 이른 순 · 상위 10</span>}
            flush
          >
            {priority.error !== null ? (
              <ErrorState detail={priority.error} />
            ) : priority.rows.length === 0 ? (
              <EmptyState
                title="지금 발주가 필요한 품목이 없습니다"
                desc="추천 수량이 0보다 큰 품목이 생기면 여기에 나타납니다."
              />
            ) : (
              <DataTable
                columns={priorityColumns(sparklines)}
                rows={priority.rows}
                rowKey={(row) => row.itemId}
                caption="analytics.v_dashboard_purchase_priority — 발주 우선순위 상위 10"
              />
            )}
          </Panel>

          <Panel
            title="재고 소진 위험"
            actions={
              <Link href="/analysis/stockout" className="btn ghost">
                전체 보기
              </Link>
            }
          >
            {projection.error !== null ? (
              <ErrorState detail={projection.error} />
            ) : riskChips.length === 0 ? (
              <EmptyState
                title="위험·주의 판정 품목이 없습니다"
                desc="재고 전개에서 기말이 음수가 되는 품목이 생기면 여기에 나타납니다."
              />
            ) : (
              <div className="chip-list">
                {riskChips.map((item) => (
                  <Link
                    key={item.itemId}
                    href={`/inventory-projection?item=${encodeURIComponent(item.itemId)}`}
                    className="chip"
                  >
                    <span className="t-code">{item.itemId}</span>
                    <StatusBadge status={item.riskStatus} />
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title="Open PO 위험"
            actions={<span className="t-label">예정일 경과 또는 7일 이내 · 품목 단위</span>}
            flush
          >
            {openPo.error !== null ? (
              <ErrorState detail={openPo.error} />
            ) : openPo.rows.length === 0 ? (
              <EmptyState
                title="예정일이 임박한 진행 중 선적이 없습니다"
                desc="예정일이 지나거나 7일 안에 닥치는 선적이 생기면 여기에 나타납니다."
              />
            ) : (
              <DataTable
                columns={openPoColumns}
                rows={openPo.rows}
                rowKey={(row) => row.itemId}
                caption="analytics.v_dashboard_open_po_risk — 진행 중 선적 위험"
              />
            )}
          </Panel>
        </div>

        {/* ── 우측 레일 ───────────────────────────────────────── */}
        <aside className="grid">
          <section className="rail">
            <header className="rail-head">
              <Sparkles size={16} aria-hidden />
              AI Insight
            </header>

            {/* ★ LLM 호출이 아닙니다. 위 KPI 뷰의 숫자로 조립한 문장입니다 (renew.prd 31.4) */}
            <div className="rail-note">
              {railLines.length === 0
                ? '요약할 수치를 아직 읽지 못했습니다. 아래 패널에서 원인을 확인하세요.'
                : railLines.map((line) => <p key={line}>{line}</p>)}
            </div>

            <div className="rail-tiles">
              <div className="rail-tile">
                <span className="rail-tile-label">위험 SKU</span>
                <span className="rail-tile-value">
                  {kpi?.nRiskItems ?? <EmptyValue />}
                </span>
              </div>
              <div className="rail-tile">
                <span className="rail-tile-label">긴급 발주</span>
                <span className="rail-tile-value">
                  {kpi?.nUrgentOrders ?? <EmptyValue />}
                </span>
              </div>
              <div className="rail-tile">
                <span className="rail-tile-label">승인 대기</span>
                <span className="rail-tile-value">
                  {kpi?.nPendingApproval ?? <EmptyValue />}
                </span>
              </div>
              <div className="rail-tile">
                <span className="rail-tile-label">미확인 알림</span>
                <span className="rail-tile-value">
                  {kpi?.nUnacknowledgedAlerts ?? <EmptyValue />}
                </span>
              </div>
            </div>

            <Link href="/agent" className="btn primary block">
              AI Agent 에게 묻기
            </Link>
          </section>

          <Panel
            title="알림"
            actions={
              <Link href="/alerts" className="btn ghost">
                전체 보기
              </Link>
            }
            flush
          >
            {alerts.error !== null ? (
              <ErrorState detail={alerts.error} />
            ) : alerts.rows.length === 0 ? (
              <EmptyState title="열린 알림이 없습니다" />
            ) : (
              <div className="alert-list">
                {alerts.rows.map((row) => (
                  <AlertRow
                    key={row.alertId}
                    tone={SEVERITY_TONE[row.severity]}
                    type={row.typeLabel}
                    time={alertAgeText(row.ageHours) ?? undefined}
                    meta={
                      <>
                        <Badge tone={SEVERITY_TONE[row.severity]}>
                          {SEVERITY_LABEL[row.severity]}
                        </Badge>
                        {row.itemId && <span className="t-code">{row.itemId}</span>}
                      </>
                    }
                    body={row.reason ?? '사유가 기록되지 않았습니다'}
                  />
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title="최근 승인"
            actions={
              <Link href="/decision-history" className="btn ghost">
                전체 보기
              </Link>
            }
          >
            {approvals.error !== null ? (
              <ErrorState detail={approvals.error} />
            ) : approvals.rows.length === 0 ? (
              <EmptyState title="아직 내려진 결정이 없습니다" />
            ) : (
              <div className="agent-convo-list">
                {approvals.rows.slice(0, 5).map((row) => (
                  <Link
                    key={row.approvalId}
                    href={`/decision-history/${row.approvalId}`}
                    className="agent-convo-link"
                  >
                    <span className="t-code">{row.itemId}</span>
                    <span className="t-sm text-2">
                      {row.decision !== null && isDecision(row.decision) ? (
                        <Badge tone={DECISION_TONE[row.decision]}>{decisionLabel(row.decision)}</Badge>
                      ) : (
                        (row.decision ?? '—')
                      )}
                      {row.approvedQty === null ? '' : ` · ${formatNumber(row.approvedQty)}`}
                    </span>
                    <span className="t-sm text-3">
                      {row.approvedEmail ?? '작성자 미상'} · {stampText(row.approvedAt) ?? '—'}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </Panel>
        </aside>
      </div>
    </>
  );
}
