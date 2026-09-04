// 가상 운영 결과 ★ — renew.prd 13.2 · 2장 성공기준 16
//
// "오차율만으로는 '그래서 도입하면 뭐가 나아지나'에 답할 수 없다.
//  16번(가상 운영 결과)이 도입 판단의 근거가 된다."
//
// 검증 구간 시작으로 돌아가 시스템이 추천했을 발주를 매달 내고, 그대로 발주했을 때의
// 재고 추이를 실제 발주·입고 실적과 나란히 놓습니다.
//
// 계산은 core.run_virtual_operation() 이 전부 끝냈습니다. 이 화면은 조회와 표시만 합니다
// (AGENTS.md 규칙 2). 문장도 SQL 이 만들어 simulation_run.sentence 에 저장한 것을 그대로 씁니다.

import Link from 'next/link';
import {
  ArrowLeftRight,
  Boxes,
  PackageX,
  RefreshCw,
  Repeat,
  TriangleAlert,
} from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import Badge from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import FilterNotice from '@/components/ui/filter-notice';
import InsightBanner from '@/components/ui/insight-banner';
import { ErrorState, EmptyState } from '@/components/ui/state';
import ComparisonChart, { type ComparisonPoint } from '@/components/chart/comparison-chart';
import { requireUser } from '@/lib/auth';
import { getPolicyNumber } from '@/lib/policy';
import { getForecastRuns } from '@/lib/forecast';
import {
  getLatestSimulation,
  getSimulationItems,
  getSimulationRuns,
  getSimulationSeries,
  getSimulationTotals,
  type SimulationItem,
  type SimulationRun,
} from '@/lib/simulation';
import { deltaDirection, monthOf } from '@/lib/simulation-model';
import { applyFilter, labelOf, readFilter, type FilterSpec, type SearchParams } from '@/lib/filter';
import RunForm from './run-form';
import ChartFrame from '@/components/chart/_base/chart-frame';
import SimulationTotalsChart from '@/components/chart/simulation-totals';
import SimulationItemBars from '@/components/chart/simulation-item-bars';
import { toSimulationItemBars, toSimulationTotalPoints } from '@/lib/chart-model';

export const dynamic = 'force-dynamic';

// kpi-filter: 없음 — 상단 4쌍(결품 · 평균 재고 · 과잉 발주 · 회전율)은 실행 전체의 요약이라
// 아래 품목 목록의 부분집합이 아닙니다. 목록을 좁히는 카드는 "품목별 비교" 위의 세 장뿐입니다
// (AGENTS.md 규칙 9 · design.md §6.4).

const FILTERS: FilterSpec<SimulationItem>[] = [
  { key: 'all', label: '전체 품목', match: null },
  {
    key: 'improved',
    label: '결품이 줄어든 품목',
    match: (row) => row.simStockouts < row.actualStockouts,
  },
  {
    key: 'worse',
    label: '결품이 늘어난 품목',
    match: (row) => row.simStockouts > row.actualStockouts,
  },
];

function param(params: SearchParams, key: string): string | null {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** 값이 없으면 숫자를 지어내지 않습니다 (design.md §8.2) */
function Num({ value, suffix = '' }: { value: number | null; suffix?: string }) {
  if (value === null) return <EmptyValue align="right" showLabel={false} />;
  return <>{formatNumber(value, suffix)}</>;
}

/** 실제 → 시뮬 한 칸. 좋아졌으면 초록, 나빠졌으면 빨강입니다 (design.md §10 — 글자도 함께) */
function Pair({
  actual,
  sim,
  lowerIsBetter,
  suffix = '',
}: {
  actual: number | null;
  sim: number | null;
  lowerIsBetter: boolean;
  suffix?: string;
}) {
  if (actual === null || sim === null) return <EmptyValue align="right" showLabel={false} />;
  const better = lowerIsBetter ? sim < actual : sim > actual;
  const worse = lowerIsBetter ? sim > actual : sim < actual;
  // .table 스코프에 .hl-safe 규칙이 없어 클래스로는 색이 붙지 않습니다 (error.md #13).
  // 새 CSS 를 더하지 않고 토큰을 직접 씁니다 (design.md §3.3 상태색).
  const color = better ? 'var(--safe-fg)' : worse ? 'var(--crit-fg)' : undefined;
  return (
    <span>
      <span className="text-3">{formatNumber(actual, suffix)}</span>
      <span className="text-3"> → </span>
      <span style={{ color, fontWeight: 500 }}>{formatNumber(sim, suffix)}</span>
    </span>
  );
}

const itemColumns: Column<SimulationItem>[] = [
  {
    key: 'itemId',
    label: '품목코드',
    variant: 'code',
    render: (row) => (
      <Link href={`?item=${row.itemId}`} scroll={false} style={{ color: 'var(--info-fg)' }}>
        {row.itemId}
      </Link>
    ),
  },
  {
    key: 'itemName',
    label: '품목명',
    variant: 'strong',
    render: (row) => row.itemName ?? <span className="text-3">이름 없음</span>,
  },
  {
    key: 'stockout',
    label: '결품 (실제 → 시뮬)',
    align: 'right',
    variant: 'num',
    render: (row) => (
      <Pair actual={row.actualStockouts} sim={row.simStockouts} lowerIsBetter suffix="회" />
    ),
  },
  {
    key: 'inventory',
    label: '품목 평균 재고 (실제 → 시뮬)',
    align: 'right',
    variant: 'num',
    render: (row) => <Pair actual={row.actualAvgInv} sim={row.simAvgInv} lowerIsBetter />,
  },
  {
    key: 'orders',
    // 양쪽 모두 "발주가 있었던 품목-월" 입니다 (실제 쪽 발주 라인 수와는 단위가 다릅니다).
    label: '발주 품목-월 (실제 → 시뮬)',
    align: 'right',
    variant: 'num',
    render: (row) => (
      <span>
        <span className="text-3">{formatNumber(row.actualOrders)}</span>
        <span className="text-3"> → </span>
        <span style={{ fontWeight: 500 }}>{formatNumber(row.simOrders)}</span>
      </span>
    ),
  },
  {
    key: 'excess',
    label: '과잉 발주',
    align: 'right',
    variant: 'num',
    render: (row) => (
      <Pair actual={row.actualExcessOrders} sim={row.simExcessOrders} lowerIsBetter suffix="건" />
    ),
  },
  {
    key: 'result',
    label: '판정',
    render: (row) =>
      row.simStockouts < row.actualStockouts ? (
        <Badge tone="safe">결품 감소</Badge>
      ) : row.simStockouts > row.actualStockouts ? (
        <Badge tone="crit">결품 증가</Badge>
      ) : (
        <Badge tone="plain">같음</Badge>
      ),
  },
];

const runColumns: Column<SimulationRun>[] = [
  { key: 'id', label: '실행', variant: 'code', render: (row) => row.simulationId },
  {
    key: 'status',
    label: '상태',
    render: (row) =>
      row.status === 'SUCCESS' ? (
        <Badge tone="safe">성공</Badge>
      ) : row.status === 'RUNNING' ? (
        <Badge tone="info">실행 중</Badge>
      ) : (
        <Badge tone="crit">실패</Badge>
      ),
  },
  {
    key: 'window',
    label: '기간',
    render: (row) =>
      row.simStart && row.simEnd ? (
        <span className="t-code">
          {monthOf(row.simStart)} ~ {monthOf(row.simEnd)}
        </span>
      ) : (
        <span className="text-3">—</span>
      ),
  },
  { key: 'items', label: '품목', align: 'right', variant: 'num', render: (row) => row.nItems },
  {
    key: 'stockout',
    label: '결품 (실제 → 시뮬)',
    align: 'right',
    variant: 'num',
    render: (row) => (
      <Pair
        actual={row.actualStockoutMonths}
        sim={row.simStockoutMonths}
        lowerIsBetter
        suffix="회"
      />
    ),
  },
  {
    key: 'inventory',
    label: '평균 재고 변화',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.inventoryChangePct === null ? (
        <EmptyValue align="right" showLabel={false} />
      ) : (
        <span
          style={{
            color: row.inventoryChangePct < 0 ? 'var(--safe-fg)' : undefined,
            fontWeight: 500,
          }}
        >
          {row.inventoryChangePct > 0 ? '+' : ''}
          {row.inventoryChangePct.toFixed(1)}%
        </span>
      ),
  },
  {
    key: 'forecastRun',
    label: '예측 실행',
    variant: 'code',
    render: (row) => row.forecastRunId ?? <span className="text-3">—</span>,
  },
  {
    key: 'startedAt',
    label: '실행 시각',
    render: (row) => (
      <span className="t-sm text-2">{row.startedAt ? row.startedAt.slice(0, 19).replace('T', ' ') : '—'}</span>
    ),
  },
  {
    key: 'who',
    label: '실행자',
    render: (row) => <span className="t-sm text-2">{row.triggeredEmail ?? '—'}</span>,
  },
];

export default async function VirtualOperationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  const isAdmin = user.role === 'ADMIN';

  const params = await searchParams;
  const activeFilter = readFilter(params);
  const requestedItem = param(params, 'item');

  const [{ data: latest, error: latestError }, { rows: runs }, excessMonths] = await Promise.all([
    getLatestSimulation(),
    getSimulationRuns(),
    getPolicyNumber('EXCESS_STOCK_MONTHS'),
  ]);

  // ★ 운영(PRODUCTION) 실행은 목록에 올리지 않습니다.
  //   그 실행의 예측은 전부 검증 구간 뒤에 있어 비교가 성립하지 않습니다.
  //   core.run_virtual_operation 이 사유와 함께 거절하지만(sql/27 §6), 고를 수 있게
  //   두면 관리자가 두 번 눌러 거절 문구를 만나게 됩니다. 애초에 보이지 않는 편이 낫습니다.
  //   mode 가 null 인 것(sql/27 이전에 깔린 DB)은 그대로 둡니다 — 전부 검증 실행입니다.
  const forecastRunIds = isAdmin
    ? (await getForecastRuns()).rows
        .filter((run) => run.status === 'SUCCESS' && run.mode !== 'PRODUCTION')
        .map((run) => run.runId)
    : [];

  const header = (
    <PageHeader
      title="가상 운영 결과"
      subtitle="검증 구간 시작으로 돌아가, 시스템이 추천했을 발주를 매달 내고 재고를 전개합니다. 실제 발주·입고 실적과 나란히 놓아 결품·재고·과잉 발주·회전율을 비교합니다."
      meta={
        <>
          <MetaChip>PRD 13.2</MetaChip>
          <MetaChip>STEP 11</MetaChip>
          {latest && <MetaChip>{latest.simulationId}</MetaChip>}
        </>
      }
    />
  );

  const runForm = isAdmin ? (
    <Panel title="가상 운영 실행">
      <RunForm runIds={forecastRunIds} />
    </Panel>
  ) : null;

  if (latestError) {
    return (
      <>
        {header}
        <Panel>
          <ErrorState detail={latestError} />
        </Panel>
      </>
    );
  }

  if (!latest) {
    return (
      <>
        {header}
        {runForm}
        <Panel>
          <EmptyState
            title="아직 시뮬레이션을 돌리지 않았습니다"
            desc={
              isAdmin
                ? 'sql/17-virtual-operation.sql 을 실행한 뒤 위에서 가상 운영 실행을 눌러주세요. 예측이 한 번은 성공해 있어야 합니다.'
                : '관리자가 가상 운영을 실행하면 여기에 결과가 나타납니다.'
            }
          />
        </Panel>
        {runs.length > 0 && (
          <Panel title="실행 이력" flush>
            <DataTable
              columns={runColumns}
              rows={runs}
              rowKey={(row) => row.simulationId}
              caption="analytics.v_simulation_run — 가상 운영 실행 이력"
            />
          </Panel>
        )}
      </>
    );
  }

  const [{ rows: items, error: itemError }, { rows: totals }] = await Promise.all([
    getSimulationItems(latest.simulationId),
    getSimulationTotals(latest.simulationId),
  ]);

  const itemExists = requestedItem !== null && items.some((row) => row.itemId === requestedItem);
  const activeItem = itemExists ? requestedItem : null;

  const { rows: series } = activeItem
    ? await getSimulationSeries(latest.simulationId, activeItem)
    : { rows: [] };

  const chartData: ComparisonPoint[] = activeItem
    ? series.map((row) => ({
        period: monthOf(row.period),
        actual: row.actualClosing,
        simulated: row.simClosing,
        actualStockout: row.actualStockout,
        simStockout: row.simStockout,
      }))
    : totals.map((row) => ({
        period: monthOf(row.period),
        actual: row.actualTotalInventory,
        simulated: row.simTotalInventory,
        actualStockout: row.actualStockoutItems > 0,
        simStockout: row.simStockoutItems > 0,
      }));

  const visible = applyFilter(items, FILTERS, activeFilter);
  const filterLabel = labelOf(FILTERS, activeFilter);
  const improved = items.filter((row) => row.simStockouts < row.actualStockouts).length;
  const worse = items.filter((row) => row.simStockouts > row.actualStockouts).length;

  const inventoryDelta =
    latest.inventoryChangePct === null
      ? undefined
      : {
          value: `${latest.inventoryChangePct > 0 ? '+' : ''}${latest.inventoryChangePct.toFixed(1)}% 실제 대비`,
          direction: latest.inventoryChangePct < 0 ? ('down' as const) : latest.inventoryChangePct > 0 ? ('up' as const) : ('flat' as const),
        };

  return (
    <>
      {header}

      {/* ★ 이 화면의 주인공. SQL 이 만든 문장을 그대로 씁니다 (renew.prd 13.2) */}
      <InsightBanner eyebrow="가상 운영 결과">
        <b>{latest.sentence ?? '문장을 만들지 못했습니다.'}</b>
      </InsightBanner>

      {latest.skippedItems !== null && latest.skippedItems > 0 && (
        <div className="stale-banner">
          <TriangleAlert size={14} aria-hidden />
          근거(재고 · 리드타임 · 서비스 수준 · 예측 오차)가 없어 {latest.skippedItems}개 품목을
          비교에서 제외했습니다. 실제와 시뮬레이션은 같은 품목 집합에서만 비교합니다.
        </div>
      )}

      <div className="grid grid-2">
        <KpiCard
          label="결품 횟수"
          value={latest.simStockoutMonths}
          unit="회"
          icon={PackageX}
          delta={
            latest.actualStockoutMonths === null
              ? undefined
              : {
                  value: `실제 ${latest.actualStockoutMonths}회`,
                  direction: deltaDirection(latest.simStockoutMonths, latest.actualStockoutMonths),
                }
          }
          reason="NO_FORECAST"
          foot={
            latest.prevented === null
              ? '품목 × 월 단위로 셉니다'
              : `${latest.prevented}회를 막을 수 있었습니다 · 품목 × 월 단위`
          }
        />
        <KpiCard
          label="평균 재고"
          value={latest.simAvgInventory === null ? null : formatNumber(latest.simAvgInventory)}
          unit="개"
          icon={Boxes}
          delta={inventoryDelta}
          reason="NO_INVENTORY_DATA"
          foot={
            latest.actualAvgInventory === null
              ? '전 품목 합계 기준 · 기간 평균'
              : `실제 ${formatNumber(latest.actualAvgInventory)}개 · 전 품목 합계 기준 기간 평균`
          }
        />
        <KpiCard
          label="과잉 발주"
          value={latest.excessOrdersSim}
          unit="건"
          icon={ArrowLeftRight}
          delta={
            latest.excessOrdersActual === null
              ? undefined
              : {
                  value: `실제 ${latest.excessOrdersActual}건`,
                  direction: deltaDirection(latest.excessOrdersSim, latest.excessOrdersActual),
                }
          }
          reason="INSUFFICIENT_SAMPLE"
          foot={
            excessMonths === null
              ? '발주 시점 재고가 기준 개월치를 넘은 건'
              : `발주 시점 재고가 ${excessMonths}개월치를 넘은 건`
          }
        />
        <KpiCard
          label="재고 회전율"
          value={latest.simTurnover === null ? null : latest.simTurnover.toFixed(2)}
          unit="회"
          icon={Repeat}
          delta={
            latest.actualTurnover === null
              ? undefined
              : {
                  value: `실제 ${latest.actualTurnover.toFixed(2)}회`,
                  direction: deltaDirection(latest.simTurnover, latest.actualTurnover),
                }
          }
          reason="INSUFFICIENT_SAMPLE"
          foot="기간 수요 합 ÷ 평균 재고(전 품목 합계 기준) · 높을수록 재고가 덜 잠깁니다"
        />
      </div>

      <Panel
        title={activeItem ? `재고 추이 · ${activeItem}` : '재고 추이 · 전 품목 합'}
        actions={
          activeItem ? (
            <Link href="?" scroll={false} className="btn ghost">
              전 품목 합으로
            </Link>
          ) : (
            <span className="t-label">품목을 누르면 그 품목만 봅니다</span>
          )
        }
      >
        {requestedItem !== null && !itemExists ? (
          <EmptyState
            title="요청한 품목을 찾을 수 없습니다"
            desc={`품목코드 ${requestedItem} 는 이번 시뮬레이션 대상이 아닙니다. 아래 표에서 품목을 골라주세요.`}
          />
        ) : chartData.length === 0 ? (
          <EmptyState title="그릴 기간이 없습니다" desc="시뮬레이션 결과가 비어 있습니다." />
        ) : (
          <ComparisonChart
            data={chartData}
            actualLabel="실제"
            simulatedLabel="AI 추천대로 발주"
          />
        )}
      </Panel>

      <div className="grid grid-3">
        <KpiCard
          label="비교 품목"
          value={items.length}
          unit="품목"
          foot={
            latest.simStart && latest.simEnd
              ? `${monthOf(latest.simStart)} ~ ${monthOf(latest.simEnd)}`
              : undefined
          }
          filter={{ key: 'all', active: activeFilter === 'all' }}
        />
        <KpiCard
          label="결품이 줄어든 품목"
          value={improved}
          unit={`/ ${items.length}`}
          foot="시뮬레이션 결품이 실제보다 적습니다"
          filter={{ key: 'improved', active: activeFilter === 'improved' }}
        />
        <KpiCard
          label="결품이 늘어난 품목"
          value={worse}
          unit={`/ ${items.length}`}
          tone={worse > 0 ? 'warn' : 'default'}
          foot="추천대로 발주해도 나아지지 않은 품목입니다"
          filter={{ key: 'worse', active: activeFilter === 'worse' }}
        />
      </div>

      {filterLabel && (
        <FilterNotice label={filterLabel} shown={visible.length} total={items.length} />
      )}

      {/* ── 차트 띠 — spec §4.3 ── */}
      <div className="grid-charts">
        <ChartFrame
          title="전 품목 재고 합 · 결품 품목 수"
          desc="실제 vs AI 추천대로 발주했을 때 · 범례를 눌러 시리즈를 끄고 켭니다"
          empty={totals.length === 0 ? '시뮬레이션 결과가 비어 있습니다' : null}
        >
          <SimulationTotalsChart points={toSimulationTotalPoints(totals)} />
        </ChartFrame>
        <ChartFrame
          title="품목별 결품 월"
          desc="결품 월이 많은 품목부터 15 · 누르면 그 품목의 추이"
          empty={items.length === 0 ? '비교할 품목이 없습니다' : null}
        >
          <SimulationItemBars bars={toSimulationItemBars(items)} hrefFor={(id) => `?item=${encodeURIComponent(id)}`} />
        </ChartFrame>
      </div>

      <Panel
        title="품목별 비교"
        actions={<span className="t-label">품목코드를 누르면 위 차트가 그 품목으로 바뀝니다</span>}
        flush
      >
        {itemError ? (
          <ErrorState detail={itemError} />
        ) : items.length === 0 ? (
          <EmptyState
            title="비교할 품목이 없습니다"
            desc="재고 · 리드타임 · 서비스 수준 · 예측 오차가 모두 있는 품목이 없습니다."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={`${filterLabel ?? ''}에 해당하는 품목이 없습니다`}
            desc="위 카드를 다시 눌러 전체 목록으로 돌아갈 수 있습니다."
          />
        ) : (
          <DataTable
            columns={itemColumns}
            rows={visible}
            rowKey={(row) => row.itemId}
            selectedKey={activeItem ?? undefined}
            caption="analytics.v_simulation_item — 품목별 실제 vs 시뮬레이션"
          />
        )}
      </Panel>

      <p className="t-sm text-3">
        기초 재고는 현재고에서 입고·사용 실적으로 역산한 추정치입니다. 리드타임·정책값은 실행 시점
        값입니다.
        {latest.openingClampedItems !== null && latest.openingClampedItems > 0
          ? ` 역산 결과가 음수여서 0 에서 시작한 품목이 ${latest.openingClampedItems}개 있습니다.`
          : ''}{' '}
        미충족 수요는 유실로 보고 다음 달로 이월하지 않습니다.
        {latest.pipelineSeedRows !== null && latest.pipelineSeedRows > 0
          ? ` 검증 구간 시작 전에 낸 발주의 입고 ${latest.pipelineSeedRows}건은 시뮬레이션도 그대로 물려받습니다.`
          : ''}
        {latest.windowTruncated !== null && latest.windowTruncated > 0
          ? ` 발주 판단 창이 예측 기간을 넘어간 품목-월이 ${latest.windowTruncated}건 있어, 그만큼 시뮬레이션이 적게 발주했습니다.`
          : ''}
      </p>

      {runForm}

      <Panel
        title="실행 이력"
        actions={
          isAdmin ? (
            <span className="t-label">
              <RefreshCw size={12} aria-hidden /> 정책을 바꾼 뒤 다시 실행해 비교하세요
            </span>
          ) : undefined
        }
        flush
      >
        {runs.length === 0 ? (
          <EmptyState title="실행 이력이 없습니다" />
        ) : (
          <DataTable
            columns={runColumns}
            rows={runs}
            rowKey={(row) => row.simulationId}
            selectedKey={latest.simulationId}
            caption="analytics.v_simulation_run — 가상 운영 실행 이력"
          />
        )}
      </Panel>
    </>
  );
}
