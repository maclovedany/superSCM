'use client';

// 자리 ③  OL 예측 정확도 — analytics.v_ol_accuracy
//
// 회계연도 하나를 골라 기종별 WAPE 를 영업 OL · SCM OL 나란히 본다.
//
// ★ WAPE 가 null 인 칸은 **막대를 그리지 않는다.** 0 으로 그리면 "오차 0% = 완벽히 맞혔다"가
//   되어 최악의 칸이 최고의 칸으로 뒤집힌다. 실측 2026-09-13: 117행 중 둘 다 null 인 7행의
//   사유는 NO_ACTUAL(채점할 실적이 없음)이다.
// ★ 값이 없는 자리에는 막대 대신 사유를 툴팁·aria-label 로 읽어 준다.

import { useMemo, useState } from 'react';
import ChartEmpty from './chart-empty';
import ChartInteractive, { type ChartPoint } from './chart-interactive';
import ChartLegend from './chart-legend';
import { accuracyFySheets, buildOlAccuracyChart } from '@/lib/charts/ol-accuracy';
import { createPlot } from '@/lib/charts/layout';
import type { OlAccuracy } from '@/lib/scm-model';

const WIDTH = 760;
const HEIGHT = 260;

function percent(value: number | null): string | null {
  return value === null ? null : `${(value * 100).toFixed(1)}%`;
}

export default function OlAccuracyChart({ rows }: { rows: OlAccuracy[] }) {
  const fySheets = useMemo(() => accuracyFySheets(rows), [rows]);
  const [fySheet, setFySheet] = useState(() => fySheets[fySheets.length - 1] ?? '');
  const chart = useMemo(() => buildOlAccuracyChart(rows, fySheet), [rows, fySheet]);

  if (fySheets.length === 0) {
    return <ChartEmpty message="채점된 OL 정확도 행이 없습니다." />;
  }

  const plot =
    chart === null || chart.wapeMax === null
      ? null
      : createPlot({
          width: WIDTH,
          height: HEIGHT,
          count: chart.groups.length,
          range: { min: 0, max: chart.wapeMax },
          includeZero: true,
        });

  const selector = (
    <div className="chart-controls">
      <label htmlFor="ol-accuracy-fy">회계연도</label>
      <select id="ol-accuracy-fy" className="table-select" value={fySheet} onChange={(event) => setFySheet(event.target.value)}>
        {fySheets.map((sheet) => (
          <option key={sheet} value={sheet}>
            {sheet}
          </option>
        ))}
      </select>
    </div>
  );

  if (chart === null || plot === null) {
    return (
      <>
        {selector}
        <ChartEmpty message="이 회계연도에는 그릴 WAPE 값이 없습니다." reason="채점할 실적이 없어 모든 칸이 비어 있습니다." />
      </>
    );
  }

  const tooltipPoints: ChartPoint[] = chart.groups.map((group, index) => ({
    index,
    label: `${group.modelBase}${group.biz ? ` · ${group.biz}` : ''}`,
    rows: [
      { name: '영업 WAPE', value: percent(group.salesWape.value), reason: group.salesWape.reasonLabel },
      { name: 'SCM WAPE', value: percent(group.scmWape.value), reason: group.scmWape.reasonLabel },
      { name: '영업 Bias', value: percent(group.salesBias.value), reason: group.salesBias.reasonLabel },
      { name: 'SCM Bias', value: percent(group.scmBias.value), reason: group.scmBias.reasonLabel },
    ],
  }));

  const barWidth = Math.max(0.5, plot.bandWidth * 0.34);

  return (
    <>
      {selector}
      <figure className="chart-figure">
        <ChartInteractive
          plot={plot}
          title={`${fySheet} 기종별 OL 예측 정확도(WAPE)`}
          description="영업 OL 과 SCM OL 의 WAPE 를 기종별로 나란히 봅니다. 값이 작을수록 잘 맞힌 것이고, 채점할 실적이 없는 기종은 막대를 그리지 않습니다."
          xLabels={chart.groups.map((group) => group.modelBase)}
          formatValue={(value) => `${(value * 100).toFixed(0)}%`}
          points={tooltipPoints}
        >
          <g>
            {chart.groups.map((group, index) => {
              const left = plot.xStart(index) + plot.bandWidth * 0.12;
              return (
                <g key={group.key}>
                  {/* 값이 없으면 막대가 아예 없다 — 0 높이 막대도 그리지 않는다 */}
                  {group.salesWape.value === null ? null : (
                    <rect
                      className="chart-bar chart-bar-sales"
                      x={left}
                      width={barWidth}
                      y={plot.y(group.salesWape.value)}
                      height={Math.max(0, plot.y(0) - plot.y(group.salesWape.value))}
                    />
                  )}
                  {group.scmWape.value === null ? null : (
                    <rect
                      className="chart-bar chart-bar-scm"
                      x={left + barWidth + plot.bandWidth * 0.08}
                      width={barWidth}
                      y={plot.y(group.scmWape.value)}
                      height={Math.max(0, plot.y(0) - plot.y(group.scmWape.value))}
                    />
                  )}
                </g>
              );
            })}
          </g>
        </ChartInteractive>

        <figcaption>
          <ChartLegend
            entries={[
              { tone: 'sales', label: '영업 OL WAPE' },
              { tone: 'scm', label: 'SCM OL WAPE' },
            ]}
          />
          {chart.missingBars > 0 ? (
            <p className="chart-reason">
              <strong>빈 막대</strong>
              <span>
                값이 없어 그리지 않은 칸 {chart.missingBars.toLocaleString('ko-KR')}개 — 0%(완벽히 맞힘)와 다른 사실입니다.
              </span>
            </p>
          ) : null}
        </figcaption>
      </figure>
    </>
  );
}
