'use client';

// 자리 ①  수요 실적 vs 예측 + p80/p90 밴드 — analytics.v_demand_series
//
// ★ 계열 넷이 **각각 독립적으로** 끊긴다. 끊는 판단은 전부 lib/charts/demand-series.ts 가
//   이미 했고(그래서 시험된다), 이 파일은 받은 구간을 그리기만 한다.
// ★ 밴드는 p90(넓음) 을 먼저, p80(좁음) 을 그 위에 그린다. 없는 구간은 경로 자체가 없다.
// ★ 빈 구간의 사유는 ChartReasons 가 한국어로 적는다 — 끊긴 것만 보이고 왜인지 안 보이면
//   보는 사람이 빈자리를 마음대로 메워 읽는다.

import { useMemo, useState } from 'react';
import ChartEmpty from './chart-empty';
import ChartInteractive, { type ChartPoint } from './chart-interactive';
import ChartLegend from './chart-legend';
import ChartReasons from './chart-reasons';
import ChartTable from './chart-table';
import { bandPath, isolatedPoints, linePath } from '@/lib/charts/geometry';
import { buildDemandSeriesChart, demandSeriesItems } from '@/lib/charts/demand-series';
import { createPlot } from '@/lib/charts/layout';
import type { DemandSeriesPoint } from '@/lib/analytics/model';

const WIDTH = 760;
const HEIGHT = 260;

function qty(value: number | null): string | null {
  return value === null ? null : `${value.toLocaleString('ko-KR')} EA`;
}

export default function DemandSeriesChart({ points }: { points: DemandSeriesPoint[] }) {
  const items = useMemo(() => demandSeriesItems(points), [points]);
  const [itemId, setItemId] = useState(() => items[0]?.itemId ?? '');
  const chart = useMemo(() => buildDemandSeriesChart(points, itemId), [points, itemId]);

  if (items.length === 0) {
    return <ChartEmpty message="수요 시계열에 품목이 없습니다." />;
  }

  const plot =
    chart === null
      ? null
      : createPlot({ width: WIDTH, height: HEIGHT, count: chart.months.length, range: chart.valueRange, includeZero: true });

  const selector = (
    <div className="chart-controls">
      <label htmlFor="demand-series-item">품목</label>
      <select
        id="demand-series-item"
        className="table-select"
        value={itemId}
        onChange={(event) => setItemId(event.target.value)}
      >
        {items.map((item) => (
          <option key={item.itemId} value={item.itemId}>
            {item.itemId} · {item.itemName}
          </option>
        ))}
      </select>
    </div>
  );

  if (chart === null || plot === null) {
    return (
      <>
        {selector}
        <ChartEmpty message="이 품목은 그릴 값이 없습니다." reason="실적과 예측이 모두 비어 있습니다." />
      </>
    );
  }

  const tooltipPoints: ChartPoint[] = chart.months.map((month, index) => ({
    index,
    label: month,
    rows: [
      { name: '실적', value: qty(chart.actual[index]), reason: chart.actualReasons.find((r) => r.months.includes(month))?.label ?? null },
      { name: '예측', value: qty(chart.predicted[index]), reason: chart.predictedReasons.find((r) => r.months.includes(month))?.label ?? null },
      { name: 'p80', value: qty(chart.p80[index]), reason: chart.bandReasons.find((r) => r.months.includes(month))?.label ?? null },
      { name: 'p90', value: qty(chart.p90[index]), reason: chart.bandReasons.find((r) => r.months.includes(month))?.label ?? null },
    ],
  }));

  return (
    <>
      {selector}
      <figure className="chart-figure">
        <ChartInteractive
          plot={plot}
          title={`${chart.itemName}(${chart.itemId}) 수요 실적과 예측`}
          description={`${chart.months[0]}부터 ${chart.months[chart.months.length - 1]}까지 월별 실적과 Champion 모델 예측, p80·p90 구간입니다. 값이 없는 달은 선을 잇지 않습니다.`}
          xLabels={chart.months}
          formatValue={(value) => value.toLocaleString('ko-KR')}
          points={tooltipPoints}
        >
          {/* 밴드 — 넓은 p90 을 먼저, 좁은 p80 을 위에 */}
          <path className="chart-band chart-band-p90" d={bandPath(chart.p90Band, plot)} />
          <path className="chart-band chart-band-p80" d={bandPath(chart.p80Band, plot)} />

          {/* 선 — 구간마다 M 으로 다시 시작한다 */}
          <path className="chart-line chart-line-actual" d={linePath(chart.actualSegments, plot)} />
          <path className="chart-line chart-line-predicted" d={linePath(chart.predictedSegments, plot)} />

          {/* 앞뒤가 결측이라 선으로는 보이지 않는 값 */}
          {isolatedPoints(chart.actualSegments).map((point) => (
            <circle className="chart-point chart-point-actual" key={`a-${point.index}`} cx={plot.x(point.index)} cy={plot.y(point.value)} r={3} />
          ))}
          {isolatedPoints(chart.predictedSegments).map((point) => (
            <circle className="chart-point chart-point-predicted" key={`p-${point.index}`} cx={plot.x(point.index)} cy={plot.y(point.value)} r={3} />
          ))}
        </ChartInteractive>

        <figcaption>
          <ChartLegend
            entries={[
              { tone: 'actual', label: '실적' },
              { tone: 'predicted', label: `예측${chart.months.length > 0 ? '' : ''}` },
              { tone: 'band-p80', label: 'p80 구간' },
              { tone: 'band-p90', label: 'p90 구간' },
            ]}
          />
          <ChartReasons reasons={chart.actualReasons} title="실적" />
          <ChartReasons reasons={chart.predictedReasons} title="예측" />
          <ChartReasons reasons={chart.bandReasons} title="구간" />
        </figcaption>
      </figure>

      <ChartTable
        caption="같은 값을 표로 보기"
        columns={['월', '실적', '예측', 'p80', 'p90']}
        rows={chart.months.map((month, index) => ({
          key: month,
          cells: [month, qty(chart.actual[index]), qty(chart.predicted[index]), qty(chart.p80[index]), qty(chart.p90[index])],
          reasons: [
            null,
            chart.actualReasons.find((r) => r.months.includes(month))?.label ?? null,
            chart.predictedReasons.find((r) => r.months.includes(month))?.label ?? null,
            chart.bandReasons.find((r) => r.months.includes(month))?.label ?? null,
            chart.bandReasons.find((r) => r.months.includes(month))?.label ?? null,
          ],
        }))}
      />
    </>
  );
}
