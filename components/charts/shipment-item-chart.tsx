'use client';

// 자리 ④  품목별 출고 — analytics.v_shipment_monthly_item
//
// ★ 이 뷰는 출고가 없는 달의 **행 자체가 없다.** 실측 2026-09-13: 10,198 품목 중 6,612 품목에
//   내부 결측 달이 있고 합계 93,984 달(최대 62달 연속). 행을 순서대로만 이으면 없는 달을
//   건너뛴 직선이 되어 그 달에도 출고가 있었던 것처럼 보인다 — lib 이 월 축을 빠짐없이 만든 뒤
//   없는 달에서 끊는다.
// ★ 품목 지정은 필수다 — getShipmentMonthlyByItem 이 애초에 필터 없는 조회를 제공하지 않는다
//   (102,765행 · PostgREST 1,000행 상한).
// ★ 대표코드 합산(HOC)이라 한 선이 여러 원본 코드의 합일 수 있다. 그 사실을 숨기지 않는다.

import { useMemo } from 'react';
import ChartEmpty from './chart-empty';
import ChartInteractive, { type ChartPoint } from './chart-interactive';
import ChartLegend from './chart-legend';
import ChartReasons from './chart-reasons';
import { isolatedPoints, linePath } from '@/lib/charts/geometry';
import { buildShipmentItemChart } from '@/lib/charts/shipment-item';
import { createPlot } from '@/lib/charts/layout';
import type { ShipmentMonthlyItemRow } from '@/lib/analytics/model';

const WIDTH = 760;
const HEIGHT = 240;

function qty(value: number | null): string | null {
  return value === null ? null : value.toLocaleString('ko-KR');
}

export default function ShipmentItemChart({ rows, itemCode }: { rows: ShipmentMonthlyItemRow[]; itemCode: string }) {
  const chart = useMemo(() => buildShipmentItemChart(rows, itemCode), [rows, itemCode]);
  const plot = useMemo(
    () =>
      chart === null
        ? null
        : createPlot({ width: WIDTH, height: HEIGHT, count: chart.months.length, range: chart.valueRange, includeZero: true }),
    [chart],
  );

  if (chart === null || plot === null) {
    return <ChartEmpty message="이 품목의 출고 행이 없습니다." reason="선택한 품목코드로 조회된 월별 출고가 없습니다." />;
  }

  const absent = new Set(chart.absentMonths.months);
  const tooltipPoints: ChartPoint[] = chart.months.map((month, index) => ({
    index,
    label: month,
    rows: [
      {
        name: '출고량',
        value: qty(chart.qty[index]),
        reason: absent.has(month) ? chart.absentMonths.label : '출고량이 비어 있습니다',
      },
    ],
  }));

  return (
    <figure className="chart-figure">
      <ChartInteractive
        plot={plot}
        title={`${chart.itemCode} 월별 출고량`}
        description={`${chart.months[0]}부터 ${chart.months[chart.months.length - 1]}까지 월별 출고량입니다. 출고 기록이 없는 달은 선을 잇지 않습니다.`}
        xLabels={chart.months}
        formatValue={(value) => value.toLocaleString('ko-KR')}
        points={tooltipPoints}
      >
        <path className="chart-line chart-line-item" d={linePath(chart.qtySegments, plot)} />
        {isolatedPoints(chart.qtySegments).map((point) => (
          <circle className="chart-point chart-point-item" key={`i-${point.index}`} cx={plot.x(point.index)} cy={plot.y(point.value)} r={3} />
        ))}
      </ChartInteractive>

      <figcaption>
        <ChartLegend entries={[{ tone: 'actual', label: `${chart.itemCode} 출고량${chart.itemType ? ` · ${chart.itemType}` : ''}` }]} />
        <ChartReasons reasons={[chart.absentMonths]} title="출고 없음" />
        {chart.maxSourceCodes !== null && chart.maxSourceCodes > 1 ? (
          <p className="chart-reason">
            <strong>대표코드 합산</strong>
            <span>
              이 선은 원본 코드 최대 {chart.maxSourceCodes.toLocaleString('ko-KR')}개를 대표코드 하나로 합친 값입니다.
            </span>
          </p>
        ) : null}
      </figcaption>
    </figure>
  );
}
