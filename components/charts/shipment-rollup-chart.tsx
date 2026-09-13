'use client';

// 자리 ②  출고 월별 추이 — analytics.v_shipment_monthly_rollup
//
// ITEM_TYPE 누적막대 위에 TOTAL 선.
//
// ★ 행이 없는 품목 구분은 **칸 자체를 만들지 않는다**(0 높이로 쌓지 않는다). 실측 2026-09-13:
//   79개월 중 OPTION 79 · PART 40 · SUPPLY 40 — 절반의 달에 PART·SUPPLY 행이 아예 없다.
// ★ TOTAL 선도 값이 없는 달에서 끊긴다. 쌓인 막대와 선이 어긋나 보이면 그것은 결함이 아니라
//   **두 계열이 서로 다른 사실**이라는 신호다(누적은 있는 구분만 더한 값이다).

import { useMemo } from 'react';
import ChartEmpty from './chart-empty';
import ChartInteractive, { type ChartPoint } from './chart-interactive';
import ChartLegend from './chart-legend';
import ChartReasons from './chart-reasons';
import { isolatedPoints, linePath } from '@/lib/charts/geometry';
import { buildShipmentRollupChart } from '@/lib/charts/shipment-rollup';
import { createPlot } from '@/lib/charts/layout';
import type { ShipmentMonthlyRollupRow } from '@/lib/analytics/model';

const WIDTH = 760;
const HEIGHT = 260;

function qty(value: number | null): string | null {
  return value === null ? null : value.toLocaleString('ko-KR');
}

export default function ShipmentRollupChart({ rows }: { rows: ShipmentMonthlyRollupRow[] }) {
  const chart = useMemo(() => buildShipmentRollupChart(rows), [rows]);
  const plot = useMemo(
    () =>
      chart === null
        ? null
        : createPlot({ width: WIDTH, height: HEIGHT, count: chart.months.length, range: chart.valueRange, includeZero: true }),
    [chart],
  );

  if (chart === null || plot === null) {
    return <ChartEmpty message="출고 월별 집계에 값이 없습니다." />;
  }

  const tooltipPoints: ChartPoint[] = chart.months.map((month, index) => {
    const stack = chart.stacks[index];
    return {
      index,
      label: month,
      rows: [
        { name: '전체', value: qty(chart.total[index]), reason: '이 달의 총합 행이 없습니다' },
        ...chart.itemTypes.map((itemType) => {
          const entry = stack.entries.find((each) => each.itemType === itemType);
          return {
            name: itemType,
            value: entry === undefined ? null : qty(entry.qty),
            reason: '이 달은 이 구분의 행이 없습니다',
          };
        }),
      ],
    };
  });

  return (
    <figure className="chart-figure">
      <ChartInteractive
        plot={plot}
        title="출고 월별 추이"
        description={`${chart.months[0]}부터 ${chart.months[chart.months.length - 1]}까지 품목 구분별 누적 출고량과 전체 합계입니다. 행이 없는 달과 구분은 그리지 않습니다.`}
        xLabels={chart.months}
        formatValue={(value) => value.toLocaleString('ko-KR')}
        points={tooltipPoints}
      >
        {/* 누적막대 — 있는 구분만 아래에서부터 쌓는다 */}
        <g>
          {chart.stacks.map((stack, index) => {
            let runningTop = 0;
            return stack.entries.map((entry) => {
              const bottom = runningTop;
              runningTop += entry.qty;
              const toneIndex = chart.itemTypes.indexOf(entry.itemType) % 4;
              const yTop = plot.y(runningTop);
              const yBottom = plot.y(bottom);
              return (
                <rect
                  className={`chart-bar chart-stack-${toneIndex}`}
                  key={`${stack.ym}-${entry.itemType}`}
                  x={plot.xStart(index) + plot.bandWidth * 0.15}
                  width={Math.max(0.5, plot.bandWidth * 0.7)}
                  y={yTop}
                  height={Math.max(0, yBottom - yTop)}
                />
              );
            });
          })}
        </g>

        <path className="chart-line chart-line-total" d={linePath(chart.totalSegments, plot)} />
        {isolatedPoints(chart.totalSegments).map((point) => (
          <circle className="chart-point chart-point-actual" key={`t-${point.index}`} cx={plot.x(point.index)} cy={plot.y(point.value)} r={3} />
        ))}
      </ChartInteractive>

      <figcaption>
        <ChartLegend
          entries={[
            { tone: 'actual', label: '전체 합계(선)' },
            ...chart.itemTypes.map((itemType, index) => ({ tone: `stack-${index % 4}`, label: itemType })),
          ]}
        />
        <ChartReasons reasons={chart.trendReasons} title="추세 배수" />
        {chart.excludedUnknownLevel > 0 ? (
          <p className="chart-reason">
            <strong>제외</strong>
            <span>집계 수준을 읽지 못한 행 {chart.excludedUnknownLevel.toLocaleString('ko-KR')}건은 어느 계열에도 넣지 않았습니다.</span>
          </p>
        ) : null}
      </figcaption>
    </figure>
  );
}
