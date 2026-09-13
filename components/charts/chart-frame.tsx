// 차트 껍데기 — 축·격자·제목. 계열(선·밴드·막대)은 children 으로 받는다.
//
// ★ 접근성: 차트는 장식이 아니다. <svg role="img"> 에 <title>·<desc> 를 넣어 스크린리더가
//   "무엇을 보여 주는 그림인지"를 읽을 수 있게 한다. 값 하나하나에 닿는 것은
//   chart-points.tsx(키보드 포커스)와 표 대체 표현이 맡는다.
// ★ 인라인 style= 은 쓰지 않는다. 좌표는 SVG 속성(x·y·d)으로 나가고, 색·굵기는 클래스다.

import type { ReactNode } from 'react';
import type { Plot } from '@/lib/charts/layout';
import { thinLabels } from '@/lib/charts/layout';

export default function ChartFrame({
  plot,
  title,
  description,
  xLabels,
  formatValue,
  maxXLabels,
  children,
}: {
  plot: Plot;
  /** 스크린리더가 읽을 그림의 이름 */
  title: string;
  /** 그림이 말하는 내용 한두 문장 */
  description: string;
  xLabels: readonly string[];
  formatValue: (value: number) => string;
  maxXLabels?: number;
  children: ReactNode;
}) {
  const { margin, innerWidth, innerHeight, width, height } = plot;
  const bottom = margin.top + innerHeight;

  return (
    <svg
      className="chart-svg"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <desc>{description}</desc>

      {/* 값 눈금과 격자 */}
      {plot.ticks.map((tick) => (
        <g key={`tick-${tick}`}>
          <line className="chart-grid-line" x1={margin.left} x2={margin.left + innerWidth} y1={plot.y(tick)} y2={plot.y(tick)} />
          <text className="chart-axis-label y" x={margin.left - 6} y={plot.y(tick)}>
            {formatValue(tick)}
          </text>
        </g>
      ))}

      {/* 0 기준선 — 음수가 있는 축에서만 의미가 있다 */}
      {plot.min < 0 && plot.max > 0 ? (
        <line className="chart-zero-line" x1={margin.left} x2={margin.left + innerWidth} y1={plot.y(0)} y2={plot.y(0)} />
      ) : null}

      <line className="chart-axis-line" x1={margin.left} x2={margin.left + innerWidth} y1={bottom} y2={bottom} />

      {/* 시간축 라벨 — 다 적으면 겹치므로 솎아 낸다 */}
      {thinLabels(xLabels, maxXLabels).map((label) => (
        <text className="chart-axis-label x" key={`x-${label.index}`} x={plot.x(label.index)} y={bottom + 14}>
          {label.label}
        </text>
      ))}

      {children}
    </svg>
  );
}
