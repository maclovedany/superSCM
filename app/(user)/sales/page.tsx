// 영업 수급 조회 — renew.prd 27장 · 28.3
//
//   "내 문의 이력 · 가예약 현황 · 만료 임박 / 품목별 수급 상태 / 납기 위험 수주 건"  (28.3)
//
// 계산은 전부 SQL 이 끝냈습니다 (sql/23-atp-sales.sql). 이 화면은 조회와 표시만 합니다.
//
// ★ 정보 접근 범위 (renew.prd 4.5)
//   이 화면이 읽는 뷰에는 단가 · 발주 금액 · 공급처 상세 · 리드타임 통계 · 정확도
//   컬럼이 아예 없습니다. 화면에서 숨기는 것이 아니라 서버에서 오지 않습니다.
//
// ★ 이 화면은 영업 전용이 아닙니다. SCM 담당자도 "지금 팔 수 있는 수량" 을 봅니다.
//   막아야 하는 것은 반대 방향(영업이 단가를 보는 것)이고, 그것은 뷰 정의로 막혀 있습니다.

import Link from 'next/link';
import { kstStamp } from '@/lib/time';
import DataWaitBanner from '@/components/ui/data-wait-banner';
import {
  CalendarClock,
  Hourglass,
  Lock,
  MessageSquare,
  TriangleAlert,
} from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import Badge from '@/components/ui/badge';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import FilterNotice from '@/components/ui/filter-notice';
import InsightBanner from '@/components/ui/insight-banner';
import { EmptyState, ErrorState } from '@/components/ui/state';
import { isSalesUser, requireUser } from '@/lib/auth';
import { applyFilter, labelOf, readFilter, type FilterSpec, type SearchParams } from '@/lib/filter';
import { nullsLast } from '@/lib/status';
import {
  getSalesInquiries,
  getSalesPromiseRisk,
  getSalesSupplyStatus,
  getSoftAllocations,
  isExpiringSoon,
  ALLOCATION_LABEL,
  ALLOCATION_TONE,
  FEASIBILITY_LABEL,
  FEASIBILITY_TONE,
  SUPPLY_TONE,
  type SalesInquiry,
  type SalesPromiseRisk,
  type SalesSupplyStatus,
  type SoftAllocation,
} from '@/lib/atp';
import AllocationForm from './allocation-form';
import FeasibilityForm from './feasibility-form';
import { EXPIRING_WITHIN_DAYS } from './state';
import ChartFrame from '@/components/chart/_base/chart-frame';
import SalesStatusMix from '@/components/chart/sales-status-mix';
import SalesShortfall from '@/components/chart/sales-shortfall';
import { getSalesStatus } from '@/lib/charts';
import { toShortfallBars } from '@/lib/chart-model';

/** 공급 상태 → 이 화면의 카드 필터. FilterSpec 에 있는 키만 (blocked · watch) */
const SALES_STATUS_HREFS: Record<string, string> = {
  불가: '?filter=blocked',
  주의: '?filter=watch',
};

export const dynamic = 'force-dynamic';

/**
 * KPI 카드 필터 — design.md §6.4.
 *
 * 수급 상태 표를 좁힙니다. "내 문의" · "가예약" · "만료 임박" 카드는 다른 표의 건수라
 * 이 표를 좁힐 수 없습니다 — 그 세 장에는 filter 를 주지 않습니다.
 *
 * kpi-filter: 내 문의 · 가예약 · 만료 임박 · 납기 위험 수주 — 없음.
 *   네 카드는 수급 상태 표가 아니라 아래의 다른 표를 셉니다. 카드 하나에 목록 하나라는
 *   규칙을 지키려면 같은 표를 좁히는 카드에만 filter 를 줘야 합니다.
 */
const FILTERS: FilterSpec<SalesSupplyStatus>[] = [
  { key: 'all', label: '전체 품목', match: null },
  { key: 'blocked', label: '불가', match: (row) => row.status === '불가' },
  { key: 'watch', label: '주의', match: (row) => row.status === '주의' },
  { key: 'sellable', label: '지금 팔 수 있음', match: (row) => (row.atpNow ?? 0) > 0 },
];

function dateText(value: string | null): string {
  if (value === null) return '—';
  return kstStamp(value) ?? '—';
}

/** 수량 칸. 값이 없으면 숫자를 지어내지 않습니다 (design.md §8.2) */
function Qty({ value }: { value: number | null }) {
  if (value === null) return <EmptyValue align="right" showLabel={false} />;
  return <span>{formatNumber(value)}</span>;
}

const supplyColumns: Column<SalesSupplyStatus>[] = [
  { key: 'itemId', label: '품목', variant: 'code' },
  {
    key: 'itemName',
    label: '품목명',
    render: (row) => row.itemName ?? <span className="text-3">—</span>,
  },
  {
    key: 'status',
    label: '수급',
    render: (row) =>
      row.status === null ? (
        <EmptyValue reason={row.reason} showLabel={false} />
      ) : (
        <Badge tone={SUPPLY_TONE[row.status]}>{row.status}</Badge>
      ),
  },
  { key: 'atpNow', label: '즉시', align: 'right', variant: 'num', render: (row) => <Qty value={row.atpNow} /> },
  { key: 'atp2w', label: '2주 내', align: 'right', variant: 'num', render: (row) => <Qty value={row.atp2w} /> },
  { key: 'atp1m', label: '1개월 내', align: 'right', variant: 'num', render: (row) => <Qty value={row.atp1m} /> },
  {
    key: 'newSupply',
    label: '신규 발주 시',
    align: 'right',
    render: (row) =>
      row.earliestNewSupplyDate ? (
        <span className="t-sm">{row.earliestNewSupplyDate}</span>
      ) : (
        <EmptyValue align="right" reason="NO_LEADTIME" showLabel={false} />
      ),
  },
];

const promiseColumns: Column<SalesPromiseRisk>[] = [
  { key: 'soNo', label: '수주번호', variant: 'code' },
  { key: 'itemId', label: '품목', variant: 'code' },
  {
    key: 'itemName',
    label: '품목명',
    render: (row) => row.itemName ?? <span className="text-3">—</span>,
  },
  {
    key: 'customer',
    label: '고객',
    render: (row) => row.customer ?? <span className="text-3">—</span>,
  },
  {
    key: 'dueDate',
    label: '납기',
    render: (row) => (
      <span className={row.daysToDue !== null && row.daysToDue < 0 ? 'hl-crit' : undefined}>
        {row.dueDate ?? '—'}
      </span>
    ),
  },
  { key: 'qty', label: '수량', align: 'right', variant: 'num', render: (row) => <Qty value={row.qty} /> },
  {
    key: 'shortfallQty',
    label: '부족',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.shortfallQty === null ? (
        <EmptyValue align="right" showLabel={false} />
      ) : (
        <span className="hl-crit">{formatNumber(row.shortfallQty)}</span>
      ),
  },
  {
    key: 'atpNow',
    label: '즉시 가능',
    align: 'right',
    variant: 'num',
    render: (row) => <Qty value={row.atpNow} />,
  },
];

const inquiryColumns: Column<SalesInquiry>[] = [
  {
    key: 'askedAt',
    label: '문의',
    render: (row) => <span className="t-sm text-3">{dateText(row.askedAt)}</span>,
  },
  {
    key: 'itemId',
    label: '품목',
    variant: 'code',
    render: (row) => row.itemId ?? <span className="text-3">—</span>,
  },
  {
    key: 'requestedQty',
    label: '요청 수량',
    align: 'right',
    variant: 'num',
    render: (row) => <Qty value={row.requestedQty} />,
  },
  {
    key: 'requestedDate',
    label: '요청 납기',
    render: (row) => row.requestedDate ?? <span className="text-3">—</span>,
  },
  {
    key: 'answerStatus',
    label: '답변',
    render: (row) =>
      row.answerStatus === null ? (
        <span className="t-sm text-3">기록만</span>
      ) : (
        <Badge tone={FEASIBILITY_TONE[row.answerStatus]}>
          {FEASIBILITY_LABEL[row.answerStatus]}
        </Badge>
      ),
  },
  {
    key: 'converted',
    label: '수주 전환',
    render: (row) =>
      row.convertedToOrder ? <Badge tone="safe">전환</Badge> : <span className="t-sm text-3">—</span>,
  },
];

function allocationColumns(): Column<SoftAllocation>[] {
  return [
    { key: 'itemId', label: '품목', variant: 'code' },
    {
      key: 'itemName',
      label: '품목명',
      render: (row) => row.itemName ?? <span className="text-3">—</span>,
    },
    { key: 'qty', label: '수량', align: 'right', variant: 'num', render: (row) => <Qty value={row.qty} /> },
    {
      key: 'customer',
      label: '고객',
      render: (row) => row.customer ?? <span className="text-3">—</span>,
    },
    {
      key: 'status',
      label: '상태',
      render: (row) => <Badge tone={ALLOCATION_TONE[row.status]}>{ALLOCATION_LABEL[row.status]}</Badge>,
    },
    {
      key: 'validUntil',
      label: '유효기간',
      render: (row) => {
        if (row.validUntil === null) return <span className="text-3">—</span>;
        const soon = isExpiringSoon(row, EXPIRING_WITHIN_DAYS);
        return (
          <span className={soon ? 'hl-warn' : undefined}>
            {row.validUntil}
            {row.daysLeft !== null && row.status === 'RESERVED' && (
              <span className="t-sm text-3">
                {' '}
                {row.daysLeft < 0 ? '만료됨' : `${row.daysLeft}일 남음`}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (row) =>
        row.status === 'RESERVED' ? (
          <span style={{ display: 'inline-flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
            <AllocationForm allocationId={row.allocationId} kind="confirm" />
            <AllocationForm allocationId={row.allocationId} kind="release" />
          </span>
        ) : (
          <span className="t-sm text-3">
            {row.status === 'CONFIRMED' ? '수주로 전환됨' : dateText(row.releasedAt)}
          </span>
        ),
    },
  ];
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  const sales = isSalesUser(user);
  const activeFilter = readFilter(await searchParams);

  const [supply, allocations, inquiries, promise, statusMix] = await Promise.all([
    getSalesSupplyStatus(),
    getSoftAllocations(),
    getSalesInquiries(),
    getSalesPromiseRisk(),
    getSalesStatus(),
  ]);

  const header = (
    <PageHeader
      title="영업 수급 조회"
      subtitle="고객에게 납기를 약속하기 전에 확인합니다. 약속 가능 수량(ATP)은 이미 잡혀 있는 가예약과 확정 수주를 뺀 값입니다."
      meta={
        <>
          <MetaChip>PRD 27</MetaChip>
          <MetaChip>STEP 17</MetaChip>
          <MetaChip>{sales ? '영업' : 'SCM'}</MetaChip>
        </>
      }
    />
  );

  if (supply.error) {
    return (
      <>
        {header}
        <Panel>
          <ErrorState detail={supply.error} />
        </Panel>
      </>
    );
  }

  // 정렬은 SQL 이 낸 값으로만 합니다. 여기서 새 수치를 만들지 않습니다.
  const order: Record<string, number> = { 불가: 1, 주의: 2, 안전: 3 };
  const supplyRows = [...supply.rows].sort((a, b) => {
    const left = a.status === null ? 4 : order[a.status];
    const right = b.status === null ? 4 : order[b.status];
    if (left !== right) return left - right;
    return a.itemId.localeCompare(b.itemId);
  });

  const visible = applyFilter(supplyRows, FILTERS, activeFilter);
  const filterLabel = labelOf(FILTERS, activeFilter);

  const reserved = allocations.rows.filter((row) => row.status === 'RESERVED');
  const expiring = reserved.filter((row) => isExpiringSoon(row, EXPIRING_WITHIN_DAYS));

  // 납기 위험은 납기가 이른 것부터. 납기를 모르는 건은 맨 뒤입니다 (design.md §8.2).
  const promiseRows = [...promise.rows].sort(nullsLast((row) => row.daysToDue, 'asc'));

  const items = supplyRows.map((row) => ({ itemId: row.itemId, itemName: row.itemName }));

  return (
    <>
      {header}

      <DataWaitBanner kinds={['INVENTORY']} />

      <div className="grid grid-kpi">
        <KpiCard
          label="내 문의"
          value={inquiries.rows.length}
          unit="건"
          icon={MessageSquare}
          foot="최근 100건까지 봅니다"
        />
        <KpiCard
          label="가예약"
          value={reserved.length}
          unit="건"
          icon={Lock}
          foot="이 수량은 약속 가능 수량에서 이미 빠져 있습니다"
        />
        <KpiCard
          label="만료 임박"
          value={expiring.length}
          unit="건"
          icon={Hourglass}
          tone={expiring.length > 0 ? 'warn' : 'default'}
          foot={`${EXPIRING_WITHIN_DAYS}일 안에 풀립니다. 확정하거나 해제하세요`}
        />
        <KpiCard
          label="납기 위험 수주"
          value={promiseRows.length}
          unit="건"
          icon={CalendarClock}
          tone={promiseRows.length > 0 ? 'crit' : 'default'}
          foot="납기까지 재고가 확보되지 않는 확정 수주"
        />
        <KpiCard
          label="지금 팔 수 있는 품목"
          value={supplyRows.filter((row) => (row.atpNow ?? 0) > 0).length}
          unit="개"
          icon={TriangleAlert}
          foot="즉시 약속 가능 수량이 남아 있는 품목"
          filter={{ key: 'sellable', active: activeFilter === 'sellable' }}
        />
      </div>

      <InsightBanner eyebrow="ATP">
        <b>수급</b> 과 <b>즉시</b> 는 서로 다른 질문에 답합니다. 수급이 <b>불가</b>인 품목도 지금
        남아 있는 수량은 팔 수 있습니다 — 불가는 &ldquo;다음 물량이 리드타임 안에 도착하지
        않는다&rdquo; 는 뜻입니다. 반대로 즉시 수량이 넉넉해도 이미 확정된 수주와 가예약은 이미
        빠져 있으므로, 여기 보이는 수량은 <b>지금 약속해도 되는 수량</b> 입니다.
      </InsightBanner>

      <Panel
        title="빠른 확인"
        actions={<span className="t-label">품목 · 수량 · 납기 → 판정 → 가예약</span>}
      >
        {items.length === 0 ? (
          <EmptyState
            title="확인할 품목이 없습니다"
            desc="품목 마스터와 재고 데이터가 올라오면 여기에 나타납니다."
          />
        ) : (
          <FeasibilityForm items={items} />
        )}
      </Panel>

      {filterLabel && (
        <FilterNotice label={filterLabel} shown={visible.length} total={supplyRows.length} />
      )}

      {/* ── 차트 띠 — spec §4.3 (ATP 버킷 막대는 제외 — 화면이 v_atp 를 조회하지 않습니다) ── */}
      <div className="grid-charts">
        <ChartFrame
          title="공급 상태 분포"
          desc="품목별 수급 판정 · 누르면 그 판정만 봅니다"
          error={statusMix.error}
          empty={statusMix.rows.length === 0 ? '판정된 품목이 없습니다' : null}
        >
          <SalesStatusMix slices={statusMix.rows} hrefs={SALES_STATUS_HREFS} />
        </ChartFrame>
        <ChartFrame
          title="납기별 부족 수량"
          desc="납기 위험 수주 · 납기가 이른 순 · 빨강은 7일 이내"
          error={promise.error}
          empty={toShortfallBars(promise.rows).length === 0 ? '납기 위험 수주가 없습니다' : null}
        >
          <SalesShortfall bars={toShortfallBars(promise.rows)} />
        </ChartFrame>
      </div>

      <Panel
        title="품목별 수급 상태"
        actions={
          <span className="t-label">불가 · 주의 · 안전 순 · 약속 가능 수량은 가예약을 뺀 값</span>
        }
        flush
      >
        {supplyRows.length === 0 ? (
          <EmptyState
            title="수급 상태가 없습니다"
            desc="재고 전개와 결품 판정이 만들어지면 여기에 나타납니다 (sql/15 · sql/23)."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={`${filterLabel ?? ''} 에 해당하는 품목이 없습니다`}
            desc="위 카드를 다시 눌러 전체 목록으로 돌아갈 수 있습니다."
          />
        ) : (
          <DataTable
            columns={supplyColumns}
            rows={visible}
            rowKey={(row) => row.itemId}
            caption="analytics.v_sales_supply_status — 품목별 수급 상태와 구간별 약속 가능 수량"
          />
        )}
      </Panel>

      <Panel
        title="내 가예약"
        actions={<span className="t-label">유효기간이 지나면 자동으로 풀립니다</span>}
        flush
      >
        {allocations.error ? (
          <ErrorState detail={allocations.error} />
        ) : allocations.rows.length === 0 ? (
          <EmptyState
            title="가예약이 없습니다"
            desc="위 빠른 확인에서 판정을 받은 뒤 [가예약] 을 누르면 재고를 잡아 둡니다."
          />
        ) : (
          <DataTable
            columns={allocationColumns()}
            rows={allocations.rows}
            rowKey={(row) => String(row.allocationId)}
            caption="analytics.v_soft_allocation — 내 가예약 (관리자는 전부)"
          />
        )}
      </Panel>

      <Panel
        title="납기 위험 수주"
        actions={<span className="t-label">납기까지 재고가 확보되지 않는 확정 수주</span>}
        flush
      >
        {promise.error ? (
          <ErrorState detail={promise.error} />
        ) : promiseRows.length === 0 ? (
          <EmptyState
            title="납기 위험 수주가 없습니다"
            desc="확정 수주가 모두 납기 전에 확보됩니다. 확정 수주 데이터가 없으면 이 표도 비어 있습니다."
          />
        ) : (
          <DataTable
            columns={promiseColumns}
            rows={promiseRows}
            rowKey={(row) => row.soNo}
            caption="analytics.v_sales_promise_risk — 납기 전 확보 불가 확정 수주"
          />
        )}
      </Panel>

      <Panel
        title="내 문의 이력"
        actions={
          <Link href="/agent" className="btn ghost">
            AI 에게 묻기
          </Link>
        }
        flush
      >
        {inquiries.error ? (
          <ErrorState detail={inquiries.error} />
        ) : inquiries.rows.length === 0 ? (
          <EmptyState
            title="문의 이력이 없습니다"
            desc="빠른 확인과 AI Agent 의 영업 툴이 부를 때마다 여기에 한 줄씩 남습니다."
          />
        ) : (
          <DataTable
            columns={inquiryColumns}
            rows={inquiries.rows}
            rowKey={(row) => String(row.inquiryId)}
            caption="analytics.v_sales_inquiry — 내 문의 이력 (관리자는 전부)"
          />
        )}
      </Panel>
    </>
  );
}
