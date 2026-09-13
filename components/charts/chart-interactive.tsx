'use client';

// 차트 껍데기 + 값에 닿는 자리 — 마우스와 **키보드** 둘 다.
//
// ★ 툴팁이 hover 전용이면 키보드만 쓰는 사용자에게는 없는 기능이다. 슬롯마다 tabIndex=0 인
//   <g> 를 두어 Tab 으로 순서대로 닿게 하고, focus 에서 hover 와 똑같이 연다.
// ★ 값이 없는 슬롯도 건너뛰지 않는다 — "그 달에 값이 없다"와 그 사유까지 읽을 수 있어야 한다.
// ★ aria-label 에 그 자리의 값을 그대로 적는다. 툴팁을 못 보는 사용자가 같은 값을 듣는다.
// ★ 상호작용이 필요한 부분만 'use client' 다 — 조회와 계산은 서버(page.tsx · lib/charts)가 한다.

import { Fragment, useState, type ReactNode } from 'react';
import ChartFrame from './chart-frame';
import type { Plot } from '@/lib/charts/layout';

export type ChartPointRow = { name: string; value: string | null; reason?: string | null };
export type ChartPoint = { index: number; label: string; rows: ChartPointRow[] };

export default function ChartInteractive({
  plot,
  title,
  description,
  xLabels,
  formatValue,
  maxXLabels,
  points,
  children,
}: {
  plot: Plot;
  title: string;
  description: string;
  xLabels: readonly string[];
  formatValue: (value: number) => string;
  maxXLabels?: number;
  points: readonly ChartPoint[];
  children: ReactNode;
}) {
  const [active, setActive] = useState<number | null>(null);
  const current = active === null ? null : (points.find((point) => point.index === active) ?? null);

  return (
    <div className="chart-tooltip-layer">
      <ChartFrame
        plot={plot}
        title={title}
        description={description}
        xLabels={xLabels}
        formatValue={formatValue}
        maxXLabels={maxXLabels}
      >
        {children}
        <g>
          {points.map((point) => {
            const spoken = point.rows
              .map((row) => (row.value === null ? `${row.name} ${row.reason ?? '값 없음'}` : `${row.name} ${row.value}`))
              .join(', ');
            return (
              <g
                key={point.index}
                tabIndex={0}
                role="img"
                aria-label={`${point.label}: ${spoken}`}
                onMouseEnter={() => setActive(point.index)}
                onMouseLeave={() => setActive((now) => (now === point.index ? null : now))}
                onFocus={() => setActive(point.index)}
                onBlur={() => setActive((now) => (now === point.index ? null : now))}
              >
                <rect
                  className="chart-hit"
                  x={plot.xStart(point.index)}
                  y={plot.margin.top}
                  width={plot.bandWidth}
                  height={plot.innerHeight}
                />
                {active === point.index ? (
                  <line
                    className="chart-hit-marker"
                    x1={plot.x(point.index)}
                    x2={plot.x(point.index)}
                    y1={plot.margin.top}
                    y2={plot.margin.top + plot.innerHeight}
                  />
                ) : null}
              </g>
            );
          })}
        </g>
      </ChartFrame>

      {current === null ? null : (
        <div
          className="chart-tooltip"
          role="status"
          // 좌표만 인라인 — 데이터에서 오는 값이다. 색·테두리는 styles/chart.css 가 맡는다.
          style={{ left: `${(plot.x(current.index) / plot.width) * 100}%`, top: 0 }}
        >
          <div className="chart-tooltip-title">{current.label}</div>
          <dl>
            {current.rows.map((row) => (
              <Fragment key={row.name}>
                <dt>{row.name}</dt>
                <dd>{row.value ?? '—'}</dd>
              </Fragment>
            ))}
          </dl>
          {current.rows
            .filter((row) => row.value === null && (row.reason ?? null) !== null)
            .map((row) => (
              <p className="chart-tooltip-reason" key={`${row.name}-reason`}>
                {row.name}: {row.reason}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}
