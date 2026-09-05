// 발주 추천 — renew.prd 22장
//
// 이 화면이 답하는 질문은 두 개입니다. "무엇을 얼마나 사야 하나" 와 "언제까지 발주해야 하나".
//
//   추천 수량   창 수요 + 안전재고 − 현재고 − 입고예정 → MOQ · 포장 단위 반영
//   발주 권고일 결품 예상일 − 리드타임 − 여유일
//
// 계산은 analytics.v_purchase_recommendation 이 전부 끝냈습니다. 여기서는 그리기만 합니다
// (AGENTS.md 규칙 2). 설명 문장도 뷰가 조립한 것을 그대로 씁니다 — 화면·CSV·AI 가
// 같은 문장을 써야 근거가 흔들리지 않습니다.
//
// ★ STEP 13 부터 이 화면은 analytics.v_purchase_recommendation_with_approval 을 읽습니다.
//   기존 뷰를 감싸 유효한 결정(승인 · 반려 · 보류)을 붙인 뷰입니다. 기존 뷰는 그대로 두었으므로
//   CSV 라우트와 다른 단계가 읽는 이름은 바뀌지 않습니다 (renew.prd 32 — 추천과 승인 분리).

import Link from 'next/link';
import StaleBanner from '@/components/ui/stale-banner';
import {
  CalendarClock,
  ClipboardCheck,
  HelpCircle,
  ShoppingCart,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import Badge, { StatusBadge } from '@/components/ui/badge';
import InsightBanner from '@/components/ui/insight-banner';
import FilterNotice from '@/components/ui/filter-notice';
import { ErrorState, EmptyState } from '@/components/ui/state';
import RestrictedNotice from '@/components/ui/restricted-notice';
import { isSalesUser, requireUser } from '@/lib/auth';
import { getLatestSuccessfulRun } from '@/lib/forecast';
import { getPurchaseRecommendationKpi } from '@/lib/recommendation';
import { getRecommendationsWithApproval } from '@/lib/approval';
import {
  DECISION_TONE,
  decisionLabel,
  type RecommendationWithApproval,
} from '@/lib/approval-model';
import { applyFilter, labelOf, readFilter, type FilterSpec, type SearchParams } from '@/lib/filter';
import ChartFrame from '@/components/chart/_base/chart-frame';
import RecommendationCalendar from '@/components/chart/recommendation-calendar';
import DashboardSupplierAmount from '@/components/chart/dashboard-supplier-amount';
import { getOrderCalendar, getRecommendationBySupplier } from '@/lib/charts';

export const dynamic = 'force-dynamic';

function money(value: number): string {
  return `${Math.round(value).toLocaleString()}원`;
}

export default async function PurchaseRecommendationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  // renew.prd 4.5 — 영업은 조달 단가 · 발주 금액 · 공급처 상세를 보지 않습니다.
  // 화면에서 숨기는 것이 아니라 열과 카드를 만들지 않습니다 (AGENTS.md 규칙 8 —
  // 판정은 서버에서). 서버 컴포넌트라 렌더하지 않은 값은 브라우저까지 가지 않습니다.
  const sales = isSalesUser(user);

  /**
   * KPI 카드 하나 = 목록 필터 하나 (design.md §6.4).
   * 카드 조건은 뷰의 KPI 계산과 같아야 카드 숫자와 목록 건수가 어긋나지 않습니다.
   */
  const FILTERS: FilterSpec<RecommendationWithApproval>[] = [
    { key: 'all', label: '대상 품목', match: null },
    {
      key: 'needed',
      label: '발주 필요',
      match: (row) => row.finalRecommendedQty !== null && row.finalRecommendedQty > 0,
    },
    // ★ "긴급" 은 뷰가 판정합니다. 화면에서 다시 오늘과 비교하면 앱 서버와 DB 의
    //   시간대가 달라 카드 숫자와 목록 건수가 하루만큼 어긋납니다.
    { key: 'urgent', label: '긴급', match: (row) => row.isUrgent === true },
    { key: 'critical', label: '위험', match: (row) => row.risk === 'CRITICAL' },
    // ★ "승인 대기" 도 뷰가 판정합니다 (is_pending). 화면에서 조건을 다시 쓰면
    //   v_approval_kpi.pending 과 어긋납니다 — 두 곳이 같은 값을 말해야 합니다.
    { key: 'pending', label: '승인 대기', match: (row) => row.isPending === true },
    {
      key: 'unknown',
      label: '산출 불가',
      match: (row) => row.risk === 'CALCULATION_UNAVAILABLE' || row.finalRecommendedQty === null,
    },
  ];

  const params = await searchParams;
  const activeFilter = readFilter(params);
  // 대시보드 "공급처별 추천 금액" 막대가 이 파라미터로 들어옵니다. 카드 필터와 함께 걸립니다.
  const supplierParam = readFilter(params, 'supplier');
  const [{ rows, error }, { data: kpi }, run, calendar, bySupplier] = await Promise.all([
    getRecommendationsWithApproval(),
    getPurchaseRecommendationKpi(),
    getLatestSuccessfulRun(),
    getOrderCalendar(),
    getRecommendationBySupplier(8),
  ]);

  const header = (
    <PageHeader
      title="발주 추천"
      subtitle="리드타임과 검토 주기 동안 필요한 수요에 안전재고를 더하고, 현재고와 입고예정을 뺀 값입니다. MOQ 와 포장 단위를 반영해 실제로 발주할 수 있는 수량으로 올립니다. 근거가 하나라도 없으면 숫자를 지어내지 않고 산출 불가로 둡니다."
      meta={
        <>
          <MetaChip>PRD 22</MetaChip>
          {run && <MetaChip>{run.runId}</MetaChip>}
        </>
      }
      actions={
        <a className="btn secondary" href="/api/recommendation/recommendations.csv">
          CSV 내보내기
        </a>
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
            title="추천할 품목이 없습니다"
            desc="analytics.v_purchase_recommendation_with_approval 에 행이 없습니다. sql/16-safety-stock-recommendation.sql 과 sql/19-approval.sql 실행 여부를 확인해주세요."
          />
        </Panel>
      </>
    );
  }

  // ★ renew.prd 4.5 — 영업에게는 공급처 상세와 발주 금액을 내지 않습니다.
  //   숨기는 것이 아니라 **열을 만들지 않습니다.** 이 화면은 서버 컴포넌트라,
  //   렌더하지 않은 값은 브라우저까지 가지 않습니다.
  const allColumns: (Column<RecommendationWithApproval> | null)[] = [
    {
      key: 'itemId',
      label: '품목코드',
      variant: 'code',
      // 코드를 누르면 그 품목의 SKU Detail 로 넘어갑니다. 판정 근거 전부가 거기 있습니다.
      render: (row) => (
        <Link
          href={`/purchase-recommendation/${row.itemId}`}
          style={{ color: 'var(--info-fg)' }}
        >
          {row.itemId}
        </Link>
      ),
    },
    { key: 'itemName', label: '품목명', variant: 'strong', render: (row) => row.itemName },
    sales
      ? null
      : {
          key: 'supplier',
          label: '공급처',
          variant: 'code',
          render: (row) => row.supplierName ?? row.supplierId,
        },
    { key: 'risk', label: '판정', render: (row) => <StatusBadge status={row.risk} /> },
    {
      key: 'stockoutDate',
      label: '결품 예상일',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.stockoutDate === null ? (
          <EmptyValue align="right" reason={row.reasonCode} showLabel={false} />
        ) : (
          row.stockoutDate
        ),
    },
    {
      key: 'requiredOrderDate',
      label: '발주 권고일',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.requiredOrderDate === null ? (
          <EmptyValue align="right" reason={row.reasonCode} showLabel={false} />
        ) : (
          // 이미 지난 권고일은 "지금 발주해도 늦다" 는 뜻입니다. 배지와 함께 색을 씁니다.
          <span className={row.isUrgent === true ? 'hl-crit' : undefined}>
            {row.requiredOrderDate}
          </span>
        ),
    },
    {
      key: 'rawRecommendedQty',
      label: '필요량',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.rawRecommendedQty === null ? (
          <EmptyValue align="right" reason={row.reasonCode} showLabel={false} />
        ) : (
          formatNumber(row.rawRecommendedQty)
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
          <span className={row.finalRecommendedQty > 0 ? 'hl-warn' : undefined}>
            {formatNumber(row.finalRecommendedQty)}
          </span>
        ),
    },
    {
      key: 'moqPack',
      label: 'MOQ / 포장',
      align: 'right',
      variant: 'num',
      // 둘 다 없으면 "제약 없음" 입니다. 0 으로 채우지 않습니다 (core.item_policy 주석).
      render: (row) =>
        row.moq === null && row.packSize === null ? (
          <span className="text-3">제약 없음</span>
        ) : (
          <span>
            {row.moq === null ? '—' : formatNumber(row.moq)}
            {' / '}
            {row.packSize === null ? '—' : formatNumber(row.packSize)}
          </span>
        ),
    },
    sales
      ? null
      : {
          key: 'recommendedAmount',
          label: '금액',
          align: 'right',
          variant: 'num',
          render: (row) =>
            row.recommendedAmount === null ? (
              <EmptyValue align="right" showLabel={false} />
            ) : (
              money(row.recommendedAmount)
            ),
        },
    {
      key: 'approval',
      label: '승인',
      // renew.prd 32 — 추천과 승인은 다릅니다. 유효한 결정이 없으면 "미결정" 입니다.
      // "발주가 필요한데 미결정" 인 행만 주의색을 씁니다 — 발주가 필요 없는 품목까지
      // 노랗게 칠하면 색이 장식이 됩니다 (design.md §14-6).
      render: (row) => {
        if (row.approvalStatus !== null) {
          return (
            <span>
              <Badge tone={DECISION_TONE[row.approvalStatus]}>
                {decisionLabel(row.approvalStatus)}
              </Badge>
              {row.approvedQty !== null && (
                <>
                  {' '}
                  <span className="t-sm text-2">{formatNumber(row.approvedQty)}</span>
                </>
              )}
            </span>
          );
        }
        return row.isPending === true ? (
          <Badge tone="warn">미결정</Badge>
        ) : (
          <span className="text-3">미결정</span>
        );
      },
    },
    {
      key: 'explanation',
      label: '설명',
      render: (row) =>
        row.explanation === null ? (
          <EmptyValue showLabel={false} />
        ) : (
          <span className="t-sm text-2">{row.explanation}</span>
        ),
    },
  ];
  const columns = allColumns.filter(
    (column): column is Column<RecommendationWithApproval> => column !== null,
  );

  const visible = applyFilter(rows, FILTERS, activeFilter);
  const shown =
    supplierParam === null ? visible : visible.filter((row) => row.supplierId === supplierParam);
  const filterLabel = labelOf(FILTERS, activeFilter);

  const itemCount = kpi?.itemCount ?? rows.length;
  const orderNeeded =
    kpi?.orderNeededCount ??
    rows.filter((row) => row.finalRecommendedQty !== null && row.finalRecommendedQty > 0).length;
  const urgent = kpi?.urgentCount ?? rows.filter((row) => row.isUrgent === true).length;
  const critical = kpi?.criticalCount ?? rows.filter((row) => row.risk === 'CRITICAL').length;
  // KPI 뷰를 못 읽었을 때의 폴백입니다. 조건은 analytics.v_purchase_recommendation_kpi 의
  // n_unknown 과 같아야 합니다 — 결품은 판정했는데 안전재고를 못 내 추천 수량이 null 인 품목도
  // "산출 불가" 입니다. 조건이 어긋나면 카드 숫자와 목록 건수가 맞지 않습니다.
  const unknown =
    kpi?.unknownCount ??
    rows.filter(
      (row) => row.risk === 'CALCULATION_UNAVAILABLE' || row.finalRecommendedQty === null,
    ).length;
  // ★ 승인 대기만 목록에서 셉니다. analytics.v_approval_kpi.pending 은 뷰 전체를 세는데
  //   이 목록은 500행까지만 읽으므로, 그 값을 카드에 쓰면 카드 숫자와 목록 건수가 어긋납니다
  //   (design.md §6.4). 조건은 뷰의 is_pending 그대로입니다.
  const pending = rows.filter((row) => row.isPending === true).length;
  const totalAmount = kpi?.totalRecommendedAmount ?? null;
  const missingPrice = kpi?.missingPriceCount ?? 0;

  // 목록은 이미 발주 권고일 순으로 왔습니다. 가장 위가 가장 급한 품목입니다.
  const soonest = rows.find((row) => row.requiredOrderDate !== null) ?? null;

  return (
    <>
      {header}

      <StaleBanner />

      <div className="grid grid-kpi">
        <KpiCard
          label="발주 필요"
          value={orderNeeded}
          unit={`/ ${itemCount}`}
          icon={ShoppingCart}
          tone={orderNeeded > 0 ? 'warn' : 'default'}
          foot="추천 수량이 0 보다 큰 품목"
          filter={{ key: 'needed', active: activeFilter === 'needed' }}
        />
        <KpiCard
          label="긴급"
          value={urgent}
          unit="개"
          icon={CalendarClock}
          tone={urgent > 0 ? 'crit' : 'default'}
          foot="발주 권고일이 이미 지났습니다"
          filter={{ key: 'urgent', active: activeFilter === 'urgent' }}
        />
        <KpiCard
          label="승인 대기"
          value={pending}
          unit="개"
          icon={ClipboardCheck}
          tone={pending > 0 ? 'warn' : 'default'}
          foot="발주가 필요한데 결정이 없습니다"
          filter={{ key: 'pending', active: activeFilter === 'pending' }}
        />
        <KpiCard
          label="위험"
          value={critical}
          unit={`/ ${itemCount}`}
          icon={TriangleAlert}
          tone={critical > 0 ? 'crit' : 'default'}
          foot="지금 발주해도 결품 후 도착"
          filter={{ key: 'critical', active: activeFilter === 'critical' }}
        />
        <KpiCard
          label="산출 불가"
          value={unknown}
          unit="개"
          icon={HelpCircle}
          foot="재고 · 리드타임 · 예측 미확보"
          filter={{ key: 'unknown', active: activeFilter === 'unknown' }}
        />
        {/* kpi-filter: 없음 — 합계는 목록의 부분집합이 아닙니다.
            "금액이 있는 품목" 으로 좁히면 카드가 나타내는 값(합계)과 다른 것을 보여주게 됩니다
            (design.md §6.4). 단가가 빠진 품목 수는 foot 으로 밝힙니다 (design.md §8.2).

            ★ 영업에게는 이 카드를 만들지 않습니다 (renew.prd 4.5 — 발주 금액 ✕). */}
        {!sales && (
          <KpiCard
            label="총 추천 금액"
            value={totalAmount === null ? null : money(totalAmount)}
            icon={Wallet}
            foot={
              missingPrice > 0
                ? `${missingPrice}개 품목 단가 없음 — 합계에서 제외`
                : '추천 수량 × 단가의 합'
            }
          />
        )}
      </div>

      {sales && <RestrictedNotice items={['조달 단가', '발주 금액', '공급처']} />}

      {soonest && (
        <InsightBanner eyebrow="PURCHASE INSIGHT">
          가장 급한 품목은 <b>{soonest.itemName ?? soonest.itemId}</b>(
          <span className="t-code">{soonest.itemId}</span>) 이며, 발주 권고일은{' '}
          <span className={soonest.isUrgent === true ? 'hl-crit' : 'hl-warn'}>
            {soonest.requiredOrderDate}
          </span>{' '}
          입니다.
          {/* 뷰가 조립한 문장을 그대로 붙입니다. 마침표를 더하지 않습니다 — 사유 라벨로
              끝나기도 하고 '…됩니다' 로 끝나기도 해서, 붙이면 어느 쪽에선 두 번 찍힙니다. */}
          {soonest.explanation && <> {soonest.explanation}</>}
        </InsightBanner>
      )}

      {filterLabel && (
        <FilterNotice label={filterLabel} shown={visible.length} total={rows.length} />
      )}

      {/* ── 차트 띠 — spec §4.3. 값은 sql/31 의 집계 뷰가 냈습니다 ── */}
      <div className="grid-charts">
        <ChartFrame
          title="발주 권고일 캘린더"
          desc="주별로 발주해야 할 품목 수와 금액 · 빨간 막대는 그중 긴급"
          error={calendar.error}
          empty={calendar.rows.length === 0 ? '발주 권고일이 있는 품목이 없습니다' : null}
        >
          <RecommendationCalendar rows={calendar.rows} showAmount={!sales} />
        </ChartFrame>
        <ChartFrame
          title="공급처별 추천 금액"
          desc="상위 8 · 누르면 그 공급처만 봅니다"
          error={bySupplier.error}
          empty={bySupplier.rows.length === 0 ? '추천 수량이 있는 품목이 없습니다' : null}
          masked={sales}
        >
          <DashboardSupplierAmount rows={bySupplier.rows} hrefTemplate="?supplier={id}" />
        </ChartFrame>
      </div>

      <Panel
        title="품목별 발주 추천"
        actions={<span className="t-label">발주 권고일 순 · 산출 불가는 맨 뒤</span>}
        flush
      >
        {shown.length === 0 ? (
          <EmptyState
            title={`${filterLabel ?? ''} 에 해당하는 품목이 없습니다`}
            desc="위 카드를 다시 눌러 전체 목록으로 돌아갈 수 있습니다."
          />
        ) : (
          <>
            {supplierParam !== null && (
              <p className="t-sm text-3" style={{ padding: 'var(--s-2) var(--s-4)' }}>
                공급처 <span className="t-code">{supplierParam}</span> 만 보는 중 ·{' '}
                <Link href="/purchase-recommendation">전체</Link>
              </p>
            )}
            <DataTable
              columns={columns}
              rows={shown}
              rowKey={(row) => row.itemId}
              caption="analytics.v_purchase_recommendation_with_approval — 추천 수량 · 발주 권고일 · 유효한 결정"
            />
          </>
        )}
      </Panel>
    </>
  );
}
