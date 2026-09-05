// 수요 예측 — renew.prd 12장
//
// 예측 실행(STEP 6)이 만든 결과를 봅니다.
// 모델을 바꿔도 재실행하지 않습니다. 저장된 결과를 조회만 합니다 (renew.prd 16.5).
//
// 차트는 STEP 7 에서 붙습니다. 지금은 표로 봅니다.

import Link from 'next/link';
import StaleBanner from '@/components/ui/stale-banner';
import { CalendarRange, Layers, PackageSearch, Sigma } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import Badge from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import InsightBanner from '@/components/ui/insight-banner';
import { ErrorState, EmptyState } from '@/components/ui/state';
import {
  getForecastDetail,
  getForecastSummary,
  getLatestSuccessfulRun,
  getRunModels,
  type ForecastPoint,
  type ForecastSummary,
} from '@/lib/forecast';
import type { SearchParams } from '@/lib/filter';
import ChartFrame from '@/components/chart/_base/chart-frame';
import ForecastModelTotals from '@/components/chart/forecast-model-totals';
import ForecastOverlayChart, { type SeriesPoint } from '@/components/chart/forecast-overlay-chart';
import { getItemSeries } from '@/lib/backtest';

export const dynamic = 'force-dynamic';

// kpi-filter: 없음 — 이 화면의 카드는 아래 목록(품목별 예측)의 부분집합이 아닙니다.
// 실행 정보·모델 수·예측 기간은 조건을 설명하는 지표라 눌러도 좁힐 대상이 없습니다.
// 목록을 좁히는 조작은 모델 칩과 품목 선택이 맡습니다 (AGENTS.md 규칙 9).

function param(params: SearchParams, key: string): string | null {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** 기간별 예측을 모델별 열로 펼칩니다 */
type PeriodRow = { period: string; byModel: Record<string, ForecastPoint> };

function toPeriodRows(points: ForecastPoint[]): PeriodRow[] {
  const map = new Map<string, PeriodRow>();
  for (const point of points) {
    const row = map.get(point.period) ?? { period: point.period, byModel: {} };
    row.byModel[point.modelId] = point;
    map.set(point.period, row);
  }
  return Array.from(map.values()).sort((a, b) => a.period.localeCompare(b.period));
}

export default async function ForecastPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const run = await getLatestSuccessfulRun();

  const header = (
    <PageHeader
      title="수요 예측"
      subtitle="가장 최근 실행이 만든 예측입니다. 모델을 바꿔도 다시 계산하지 않고 저장된 결과를 조회합니다."
      meta={
        <>
          <MetaChip>PRD 12</MetaChip>
          {run && <MetaChip>{run.runId}</MetaChip>}
        </>
      }
    />
  );

  if (!run) {
    return (
      <>
        {header}
        <Panel>
          <EmptyState
            title="아직 예측 결과가 없습니다"
            desc="관리자가 예측 실행 화면에서 한 번 실행하면 여기에 결과가 나타납니다."
          />
        </Panel>
      </>
    );
  }

  const [{ rows: runModels, error: modelError }] = await Promise.all([getRunModels(run.runId)]);

  if (modelError) {
    return (
      <>
        {header}
        <Panel>
          <ErrorState detail={modelError} />
        </Panel>
      </>
    );
  }

  if (runModels.length === 0) {
    return (
      <>
        {header}
        <Panel>
          <EmptyState
            title="이 실행에는 결과가 없습니다"
            desc="sql/12-forecast-summary.sql 을 실행했는지 확인해주세요."
          />
        </Panel>
      </>
    );
  }

  // 선택된 모델. 없으면 결과가 가장 많은 모델을 씁니다.
  const activeModel =
    param(params, 'model') && runModels.some((m) => m.modelId === param(params, 'model'))
      ? (param(params, 'model') as string)
      : runModels.slice().sort((a, b) => b.rows - a.rows)[0].modelId;

  const activeItem = param(params, 'item');

  const [{ rows: summary, error }, detail, series] = await Promise.all([
    getForecastSummary(run.runId, activeModel),
    activeItem ? getForecastDetail(run.runId, activeItem) : Promise.resolve({ rows: [], error: null }),
    activeItem ? getItemSeries(activeItem) : Promise.resolve({ rows: [], error: null }),
  ]);

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

  const selected = runModels.find((m) => m.modelId === activeModel);
  const periods = summary[0]?.periods ?? 0;

  const summaryColumns: Column<ForecastSummary>[] = [
    {
      key: 'itemId',
      label: '품목코드',
      variant: 'code',
      render: (row) => (
        <Link href={`?model=${activeModel}&item=${row.itemId}`} style={{ color: 'var(--info-fg)' }}>
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
      key: 'periods',
      label: '예측 개월',
      align: 'right',
      variant: 'num',
      render: (row) => row.periods,
    },
    {
      key: 'totalQty',
      label: '기간 합계',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.totalQty === null ? (
          <EmptyValue align="right" showLabel={false} />
        ) : (
          formatNumber(row.totalQty)
        ),
    },
    {
      key: 'avgQty',
      label: '월평균',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.avgQty === null ? <EmptyValue align="right" showLabel={false} /> : formatNumber(row.avgQty),
    },
    {
      key: 'p80Margin',
      label: 'P80 여유',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.p80Margin === null ? (
          // σ 를 못 구하면 예측구간을 만들 수 없습니다 (임의 값 금지)
          <EmptyValue align="right" reason="INSUFFICIENT_SAMPLE" showLabel={false} />
        ) : (
          `+${formatNumber(row.p80Margin)}`
        ),
    },
    {
      key: 'open',
      label: '',
      render: (row) => (
        <Link href={`?model=${activeModel}&item=${row.itemId}`} className="btn ghost">
          기간별 보기
        </Link>
      ),
    },
  ];

  const periodRows = toPeriodRows(detail.rows);
  const detailModels = Array.from(new Set(detail.rows.map((point) => point.modelId))).sort();

  // ── 오버레이 차트 데이터 조립 — 계산이 아니라 병합입니다 (model-comparison 과 같은 방식) ──
  const byPeriod = new Map<string, SeriesPoint>();
  const ensure = (period: string): SeriesPoint => {
    const key = period.slice(0, 7);
    const found = byPeriod.get(key);
    if (found) return found;
    const created: SeriesPoint = { period: key, actual: null, forecast: {}, isTest: false };
    byPeriod.set(key, created);
    return created;
  };
  for (const row of series.rows) {
    const point = ensure(row.period);
    point.actual = row.quantity;
    if (row.segment === 'TEST') point.isTest = true;
  }
  for (const row of detail.rows) {
    const point = ensure(row.period);
    point.forecast[row.modelId] = row.predictedQty;
    if (row.modelId === activeModel) {
      point.p80 = row.p80;
      point.p90 = row.p90;
    }
  }
  const chartData = Array.from(byPeriod.values()).sort((a, b) => a.period.localeCompare(b.period));
  const chartModels = detailModels.map((modelId) => ({
    modelId,
    label: runModels.find((m) => m.modelId === modelId)?.modelName ?? modelId,
  }));
  const modelTotals = runModels.map((m) => ({
    modelId: m.modelId,
    label: m.modelName ?? m.modelId,
    totalQty: m.totalQty,
    rows: m.rows,
    items: m.items,
  }));

  return (
    <>
      {header}

      <div className="grid grid-kpi">
        <KpiCard
          label="예측 품목"
          value={run.nItems}
          unit="개"
          icon={PackageSearch}
          foot={`결과 ${formatNumber(run.nRows)}행`}
        />
        <KpiCard label="모델" value={runModels.length} unit="종" icon={Layers} foot="같은 조건으로 함께 실행" />
        <KpiCard
          label="예측 기간"
          value={run.horizon}
          unit="개월"
          icon={CalendarRange}
          foot={run.trainEnd ? `${run.trainEnd} 다음 달부터` : undefined}
        />
        <KpiCard
          label="상태"
          value={run.isStale ? '재실행 필요' : '최신'}
          icon={Sigma}
          tone={run.isStale ? 'warn' : 'default'}
          foot={run.isStale ? '실행 뒤 데이터가 바뀌었습니다' : '기준 데이터와 일치합니다'}
        />
      </div>

      <StaleBanner />

      <Panel title="모델 선택" actions={<span className="t-label">재실행 없이 즉시 바뀝니다</span>}>
        <div className="chart-legend">
          {runModels.map((model) => {
            const active = model.modelId === activeModel;
            return (
              <Link
                key={model.modelId}
                href={`?model=${model.modelId}${activeItem ? `&item=${activeItem}` : ''}`}
                className="chart-legend-item"
                aria-pressed={active}
                style={
                  active
                    ? { borderColor: 'var(--ink)', color: 'var(--text-1)', fontWeight: 600 }
                    : undefined
                }
              >
                {model.modelName ?? model.modelId}
                <span className="text-3">{model.items}개</span>
              </Link>
            );
          })}
        </div>
      </Panel>

      <ChartFrame
        title="모델별 예측 합계"
        desc="이 실행에서 모델마다 낸 예측 수량의 합 · 누르면 그 모델로 바꿉니다 (재실행 없음)"
        empty={modelTotals.length === 0 ? '모델이 없습니다' : null}
      >
        <ForecastModelTotals
          models={modelTotals}
          activeModelId={activeModel}
          hrefTemplate={`?model={id}${activeItem ? `&item=${encodeURIComponent(activeItem)}` : ''}`}
        />
      </ChartFrame>

      <InsightBanner eyebrow="FORECAST">
        <b>{selected?.modelName ?? activeModel}</b> 기준으로 {summary.length}개 품목의 향후 {periods}개월 수요를
        예측했습니다. 모델 칩을 눌러도 <b>다시 계산하지 않습니다</b> — 실행 시점에 모든 모델 결과를 저장해 두었기
        때문입니다. 어느 모델이 더 정확한지는 <span className="t-code">STEP 7</span> 백테스트가 판정합니다.
      </InsightBanner>

      {activeItem && (
        <Panel
          title={`${activeItem} 기간별 예측`}
          actions={
            <Link href={`?model=${activeModel}`} className="btn ghost">
              닫기
            </Link>
          }
          flush
        >
          {periodRows.length === 0 ? (
            <EmptyState title="이 품목의 예측 결과가 없습니다" />
          ) : (
            <>
              <div style={{ padding: 'var(--s-4) var(--s-4) 0' }}>
                <ForecastOverlayChart data={chartData} models={chartModels} bandModelId={activeModel} height={280} />
              </div>
            <div className="table-wrap">
              <table className="table">
                <caption className="t-label">모델별 예측을 나란히 놓았습니다</caption>
                <thead>
                  <tr>
                    <th scope="col">기간</th>
                    {detailModels.map((modelId) => (
                      <th key={modelId} scope="col" style={{ textAlign: 'right' }}>
                        {runModels.find((m) => m.modelId === modelId)?.modelName ?? modelId}
                      </th>
                    ))}
                    <th scope="col" style={{ textAlign: 'right' }}>
                      P80 ({selected?.modelName ?? activeModel})
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {periodRows.map((row) => (
                    <tr key={row.period}>
                      <td className="cell-code">{row.period.slice(0, 7)}</td>
                      {detailModels.map((modelId) => {
                        const point = row.byModel[modelId];
                        return (
                          <td key={modelId} className="cell-num">
                            {point?.predictedQty === null || point === undefined ? (
                              <EmptyValue align="right" showLabel={false} />
                            ) : (
                              formatNumber(point.predictedQty)
                            )}
                          </td>
                        );
                      })}
                      <td className="cell-num">
                        {row.byModel[activeModel]?.p80 == null ? (
                          <EmptyValue align="right" showLabel={false} />
                        ) : (
                          formatNumber(row.byModel[activeModel].p80 as number)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </Panel>
      )}

      <Panel
        title="품목별 예측"
        actions={
          <span className="t-label">
            {selected?.modelName ?? activeModel} · 품목을 누르면 기간별로 펼쳐집니다
          </span>
        }
        flush
      >
        {summary.length === 0 ? (
          <EmptyState
            title="이 모델은 결과를 내지 못했습니다"
            desc="학습 데이터가 모자라면 값을 지어내지 않고 결과를 비웁니다. 다른 모델을 선택해보세요."
          />
        ) : (
          <DataTable
            columns={summaryColumns}
            rows={summary}
            rowKey={(row) => row.itemId}
            selectedKey={activeItem ?? undefined}
            caption="analytics.v_forecast_summary — 품목별 예측 합계"
          />
        )}
      </Panel>
    </>
  );
}
