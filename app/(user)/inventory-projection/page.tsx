// 재고 전개 — renew.prd 19장
//
// 한 줄 나눗셈(가용재고 ÷ 일평균)이 아니라 기간별 전개입니다.
//   기말 = 기초 + 입고예정 − 적용수요
//   적용수요 = max(예측, 확정수주) + 가예약
//
// 확정 수주가 있으면 예측보다 우선합니다 (renew.prd 22.1).
// 둘을 더하면 같은 수요를 두 번 세게 됩니다.
//
// forecast 가 없는 기간은 행이 없습니다. 전개가 거기서 끊기는 것이 정답이고,
// 임의 값으로 이어 붙이지 않습니다 (AGENTS.md 규칙 5).

import Link from 'next/link';
import StaleBanner from '@/components/ui/stale-banner';
import { Boxes, CalendarClock, PackagePlus, Timer } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import Badge, { StatusBadge } from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import InsightBanner from '@/components/ui/insight-banner';
import { ErrorState, EmptyState } from '@/components/ui/state';
import ProjectionChart, { type ProjectionPoint } from '@/components/chart/projection-chart';
import { requireUser } from '@/lib/auth';
import {
  getInventoryProjection,
  getProjectionItems,
  type ProjectionItem,
  type ProjectionRow,
} from '@/lib/inventory';
import { getLatestSuccessfulRun } from '@/lib/forecast';
import { getStockoutRisks } from '@/lib/scm';
import type { SearchParams } from '@/lib/filter';
import ItemSearchPanel from '@/components/ui/item-search-panel';
import DataWaitBanner from '@/components/ui/data-wait-banner';
import { searchItems } from '@/lib/items';
import ChartFrame from '@/components/chart/_base/chart-frame';
import ProjectionTotal from '@/components/chart/projection-total';
import { getProjectionTotal } from '@/lib/charts';

export const dynamic = 'force-dynamic';

// kpi-filter: 없음 — 이 화면의 카드는 목록의 부분집합이 아니라
// 선택된 한 품목을 설명하는 지표입니다. 목록을 좁히는 조작은 위의 품목 선택 칩이 맡습니다
// (AGENTS.md 규칙 9 · design.md §6.4).

function param(params: SearchParams, key: string): string | null {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** 2026-09-01 → 2026-09 */
function monthOf(period: string) {
  return period.slice(0, 7);
}

const columns: Column<ProjectionRow>[] = [
  { key: 'period', label: '기간', variant: 'code', render: (row) => monthOf(row.period) },
  {
    key: 'opening',
    label: '기초',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.openingQty === null ? (
        <EmptyValue align="right" reason="NO_INVENTORY_DATA" showLabel={false} />
      ) : (
        formatNumber(row.openingQty)
      ),
  },
  {
    key: 'receipt',
    label: '입고예정',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.receiptQty === null ? (
        <EmptyValue align="right" showLabel={false} />
      ) : (
        formatNumber(row.receiptQty)
      ),
  },
  {
    key: 'forecast',
    label: '예측수요',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.forecastQty === null ? (
        <EmptyValue align="right" reason="NO_FORECAST" showLabel={false} />
      ) : (
        formatNumber(row.forecastQty)
      ),
  },
  {
    key: 'committed',
    label: '확정수주',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.committedSoQty === null ? (
        <EmptyValue align="right" showLabel={false} />
      ) : (
        formatNumber(row.committedSoQty)
      ),
  },
  {
    key: 'soft',
    label: '가예약',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.softAllocationQty === null ? (
        <EmptyValue align="right" showLabel={false} />
      ) : (
        formatNumber(row.softAllocationQty)
      ),
  },
  {
    key: 'demand',
    label: '적용수요',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.demandQty === null ? (
        <EmptyValue align="right" showLabel={false} />
      ) : (
        formatNumber(row.demandQty)
      ),
  },
  {
    key: 'closing',
    label: '기말',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.closingQty === null ? (
        <EmptyValue align="right" reason="NO_INVENTORY_DATA" showLabel={false} />
      ) : (
        <span className={row.closingQty < 0 ? 'hl-crit' : undefined}>
          {formatNumber(row.closingQty)}
        </span>
      ),
  },
  {
    key: 'status',
    label: '상태',
    render: (row) =>
      row.closingQty !== null && row.closingQty < 0 ? (
        <Badge tone="crit">결품</Badge>
      ) : (
        <Badge tone="plain">정상</Badge>
      ),
  },
];

export default async function InventoryProjectionPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();

  const params = await searchParams;
  const q = param(params, 'q') ?? '';
  const [{ rows: items, error: itemError }, { rows: risks }, run, total, search] = await Promise.all([
    getProjectionItems(),
    getStockoutRisks(),
    getLatestSuccessfulRun(),
    getProjectionTotal(),
    q.trim().length >= 2 ? searchItems(q) : Promise.resolve({ rows: [], error: null }),
  ]);

  const requested = param(params, 'item');

  // ?item= 을 칩 목록(상위 200개)만 보고 검증하지 않습니다.
  // 목록에 없다고 조용히 다른 품목으로 떨어지면, 재고 소진 위험 표에서 201번째 행을 누른 사람이
  // 자기가 누른 것과 다른 품목의 전개를 보면서도 알아채지 못합니다.
  // 요청받은 품목의 전개를 직접 조회해 그 결과로 판정하고, 정말 없으면 그렇다고 말합니다.
  const requestedProjection = requested ? await getInventoryProjection(requested) : null;

  const requestedExists =
    requested !== null &&
    ((requestedProjection?.rows.length ?? 0) > 0 ||
      items.some((item) => item.itemId === requested) ||
      risks.some((row) => row.itemId === requested));

  // 기본 선택은 가장 먼저 결품되는 품목입니다. 목록이 이미 위험 순입니다.
  const fallbackItem =
    items.find((item) => item.stockoutDays !== null)?.itemId ?? items[0]?.itemId ?? null;

  const activeItem = requestedExists ? requested : fallbackItem;

  const header = (
    <PageHeader
      title="재고 전개"
      subtitle="현재고에서 시작해 기간마다 입고예정을 더하고 수요를 뺍니다. 확정 수주가 있으면 예측보다 우선하며, 예측이 없는 기간은 값을 지어내지 않고 전개를 멈춥니다."
      meta={
        <>
          <MetaChip>PRD 19</MetaChip>
          {run && <MetaChip>{run.runId}</MetaChip>}
        </>
      }
    />
  );

  // 칩 목록은 두 자리에서 씁니다 — 정상 화면과 "품목을 찾을 수 없음" 화면.
  // 후자에서는 아무 칩도 선택하지 않습니다.
  const itemChips = (selected: string | null) => (
    <ItemSearchPanel q={q} results={search.rows} selectedItemId={selected} title="품목 선택"
      hint="대표코드 · 품목명 · 구코드로 검색 · 아래 칩은 결품 임박 순">
      <div className="chart-legend">
        {items.slice(0, 24).map((item) => {
          const active = item.itemId === selected;
          return (
            <Link
              key={item.itemId}
              href={`?item=${item.itemId}`}
              className="chart-legend-item"
              aria-pressed={active}
              scroll={false}
              style={
                active ? { borderColor: 'var(--ink)', color: 'var(--text-1)', fontWeight: 600 } : undefined
              }
            >
              <span className="t-code">{item.itemId}</span>
              <StatusBadge status={item.riskStatus} />
            </Link>
          );
        })}
      </div>
    </ItemSearchPanel>
  );

  if (itemError) {
    return (
      <>
        {header}
        <Panel>
          <ErrorState detail={itemError} />
        </Panel>
      </>
    );
  }

  if (!activeItem) {
    return (
      <>
        {header}
        <Panel>
          <EmptyState
            title="전개할 품목이 없습니다"
            desc="sql/15-inventory-projection.sql 을 실행하고, 관리자 화면에서 예측을 한 번 실행해주세요."
          />
        </Panel>
      </>
    );
  }

  // 링크로 들어온 품목코드가 어디에도 없으면, 다른 품목을 대신 보여주지 않고 그렇다고 말합니다.
  if (requested !== null && !requestedExists) {
    return (
      <>
        {header}
        {itemChips(null)}
        <Panel>
          <EmptyState
            title="요청한 품목을 찾을 수 없습니다"
            desc={`품목코드 ${requested} 에 해당하는 품목이 없습니다. 단종되었거나 주소가 잘못되었을 수 있습니다. 위 목록에서 품목을 골라주세요.`}
          />
        </Panel>
      </>
    );
  }

  // 위에서 이미 조회한 결과를 다시 쓰지 않도록 재사용합니다.
  const { rows, error } =
    requestedProjection && activeItem === requested
      ? requestedProjection
      : await getInventoryProjection(activeItem);

  const risk = risks.find((row) => row.itemId === activeItem) ?? null;

  // 칩 목록 밖의 품목이면 요약이 없습니다. 그때는 위험 목록의 같은 값으로 채웁니다.
  const summary: ProjectionItem | null =
    items.find((item) => item.itemId === activeItem) ??
    (risk
      ? {
          itemId: risk.itemId,
          itemName: risk.itemName,
          riskStatus: risk.riskStatus,
          stockoutDate: risk.stockoutDate,
          stockoutDays: risk.stockoutDays,
          reason: risk.reason,
        }
      : null);

  const chartData: ProjectionPoint[] = rows.map((row) => ({
    period: monthOf(row.period),
    opening: row.openingQty,
    receipt: row.receiptQty,
    demand: row.demandQty,
    closing: row.closingQty,
  }));

  const firstNegative = rows.find((row) => row.closingQty !== null && row.closingQty < 0) ?? null;

  return (
    <>
      {header}

      <DataWaitBanner kinds={['INVENTORY']} />

      {itemChips(activeItem)}

      <StaleBanner />

      {/* ── 전 품목 합계 — spec §4.3. 품목 하나의 전개 위에 전체 흐름을 먼저 둡니다 ── */}
      <ChartFrame
        title="전 품목 재고 전개 합계"
        desc="기간별 기말 재고 합계와 그 기간에 기말이 음수인 품목 수"
        error={total.error}
        empty={total.rows.length === 0 ? '전개할 기간이 없습니다' : null}
      >
        <ProjectionTotal points={total.rows} />
      </ChartFrame>

      <div className="grid grid-kpi">
        <KpiCard
          label="현재고"
          value={risk?.currentStock ?? null}
          unit={risk?.currentStock === null || risk === null ? undefined : '개'}
          icon={Boxes}
          reason="NO_INVENTORY_DATA"
          foot="창고 합산"
        />
        <KpiCard
          label="입고예정"
          value={risk?.inboundQty ?? null}
          unit={risk?.inboundQty === null || risk === null ? undefined : '개'}
          icon={PackagePlus}
          foot="진행 중 선적"
        />
        <KpiCard
          label="결품 예상일"
          value={summary?.stockoutDate ?? null}
          icon={CalendarClock}
          reason={summary?.reason ?? null}
          tone={summary?.riskStatus === 'CRITICAL' ? 'crit' : summary?.riskStatus === 'WARNING' ? 'warn' : 'default'}
          foot="기말이 처음 음수가 되는 시점"
        />
        <KpiCard
          label="소진까지"
          value={summary?.stockoutDays ?? null}
          unit={summary?.stockoutDays === null ? undefined : '일'}
          icon={Timer}
          reason={summary?.reason ?? null}
          foot={
            risk?.monthsOfSupply === null || risk?.monthsOfSupply === undefined
              ? '전개 기간 안에서 계산합니다'
              : `전개에서 ${risk.monthsOfSupply}개월 커버 확인`
          }
        />
      </div>

      {error ? (
        <Panel>
          <ErrorState detail={error} />
        </Panel>
      ) : rows.length === 0 ? (
        <Panel>
          <EmptyState
            title="이 품목은 전개할 예측이 없습니다"
            desc="오늘이 속한 달 이후의 예측이 하나도 없습니다. 관리자 화면에서 예측을 실행하거나 horizon 을 늘려주세요."
          />
        </Panel>
      ) : (
        <>
          <Panel
            title={`${activeItem} 예상재고`}
            actions={<span className="t-label">0선 아래가 결품 구간입니다</span>}
          >
            <ProjectionChart data={chartData} leadTimeDays={risk?.plannedLeadTime ?? null} />
          </Panel>

          <InsightBanner eyebrow="PROJECTION INSIGHT">
            {firstNegative ? (
              <>
                기말 재고가 <b>{monthOf(firstNegative.period)}</b> 에 처음 음수가 됩니다.
              </>
            ) : (
              <>전개 기간 안에서는 기말 재고가 음수가 되지 않습니다.</>
            )}
            {risk?.leadtimeDemandQty !== null && risk?.leadtimeDemandQty !== undefined && (
              <>
                {' '}
                리드타임과 검토 주기 안에 커버해야 하는 누적 수요는{' '}
                <span className="hl-warn">{formatNumber(risk.leadtimeDemandQty)}</span> 개입니다.
              </>
            )}
            {risk?.requiredQty !== null && risk?.requiredQty !== undefined && (
              <>
                {' '}
                가용재고를 뺀 필요량은{' '}
                <span className={risk.requiredQty > 0 ? 'hl-crit' : undefined}>
                  {formatNumber(risk.requiredQty)}
                </span>{' '}
                개입니다.
              </>
            )}
          </InsightBanner>

          <Panel
            title="월별 전개"
            actions={<span className="t-label">적용수요 = max(예측, 확정수주) + 가예약</span>}
            flush
          >
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(row) => row.period}
              caption="analytics.v_inventory_projection — 기간별 재고 전개"
            />
          </Panel>
        </>
      )}
    </>
  );
}
