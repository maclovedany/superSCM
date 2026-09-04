'use client';

// 비교 차트 (Base vs 시나리오) — design.md §7.3 · step.md §4.1
//
// 두 시리즈를 나란히 놓고 무엇이 달라졌는지 보여줍니다.
//   실제(Base)   잉크 블랙 2.5px 실선  ← 항상 가장 진하게 (design.md §7.3)
//   시뮬레이션    시리즈 색 1번 2px 실선
//   0선          --crit 파선
//   결품 달       ReferenceDot — 실제는 채운 점, 시뮬은 속 빈 점
//
// 화면에서 recharts 를 직접 import 하지 않습니다. 이 폴더만 씁니다 (AGENTS.md 규칙 11).
// 여기서 계산하지 않습니다. 이미 계산된 값을 받아 그리기만 합니다 (AGENTS.md 규칙 2).
//
// ★ STEP 11(가상 운영 결과)과 STEP 18(What-If)이 같은 컴포넌트를 씁니다.
//   그래서 시리즈 이름을 props 로 받습니다.

import { useMemo } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Brush,
} from 'recharts';
import { ACTUAL_COLOR, CHART_TOKENS, SERIES_COLORS } from '@/lib/chart-colors';
import { brushProps } from './_base/period-brush';

export type ComparisonPoint = {
  /** YYYY-MM */
  period: string;
  /** 실제(Base) 값 */
  actual: number | null;
  /** 시뮬레이션(시나리오) 값 */
  simulated: number | null;
  /** 그 기간에 실제 쪽이 결품이었는가 */
  actualStockout?: boolean;
  /** 그 기간에 시뮬 쪽이 결품이었는가 */
  simStockout?: boolean;
};

const SIM_COLOR = SERIES_COLORS[0];

function formatNumber(value: number) {
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);
}

export default function ComparisonChart({
  data,
  actualLabel = '실제',
  simulatedLabel = '시뮬레이션',
  height = 320,
}: {
  data: ComparisonPoint[];
  actualLabel?: string;
  simulatedLabel?: string;
  height?: number;
}) {
  // 결품 표시를 찍을 자리. 값이 없는 기간에는 점을 찍지 않습니다.
  const actualMarks = useMemo(
    () =>
      data.filter(
        (point): point is ComparisonPoint & { actual: number } =>
          point.actualStockout === true && point.actual !== null,
      ),
    [data],
  );

  const simMarks = useMemo(
    () =>
      data.filter(
        (point): point is ComparisonPoint & { simulated: number } =>
          point.simStockout === true && point.simulated !== null,
      ),
    [data],
  );

  const brush = brushProps(data.length);

  return (
    <>
      <div className="chart-legend" style={{ marginBottom: 'var(--s-4)' }}>
        <span className="chart-legend-item">
          <span className="chart-legend-swatch" style={{ background: ACTUAL_COLOR }} />
          {actualLabel}
        </span>
        <span className="chart-legend-item">
          <span className="chart-legend-swatch" style={{ background: SIM_COLOR }} />
          {simulatedLabel}
        </span>
        <span className="chart-legend-item">
          <span className="chart-legend-swatch" style={{ background: CHART_TOKENS.deficitLine }} />
          결품
        </span>
      </div>

      <div className="chart-wrap" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
            {/* 가로선만 긋습니다 (design.md §7.1) */}
            <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" vertical={false} />
            <XAxis
              dataKey="period"
              tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: CHART_TOKENS.grid }}
            />
            <YAxis
              tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={64}
            />

            <ReferenceLine y={0} stroke={CHART_TOKENS.deficitLine} strokeDasharray="4 4" />

            <Line
              type="monotone"
              dataKey="actual"
              name={actualLabel}
              stroke={ACTUAL_COLOR}
              strokeWidth={2.5}
              dot={{ r: 3 }}
              isAnimationActive={false}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="simulated"
              name={simulatedLabel}
              stroke={SIM_COLOR}
              strokeWidth={2}
              dot={{ r: 3 }}
              isAnimationActive={false}
              connectNulls={false}
            />

            {/* 결품이 난 달. 실제는 채운 점, 시뮬은 속 빈 점입니다 — 색만으로 구분하지 않습니다 */}
            {actualMarks.map((point) => (
              <ReferenceDot
                key={`actual-${point.period}`}
                x={point.period}
                y={point.actual}
                r={6}
                fill={CHART_TOKENS.deficitLine}
                stroke={CHART_TOKENS.deficitLine}
              />
            ))}
            {simMarks.map((point) => (
              <ReferenceDot
                key={`sim-${point.period}`}
                x={point.period}
                y={point.simulated}
                r={6}
                fill="none"
                stroke={CHART_TOKENS.deficitLine}
                strokeWidth={2}
              />
            ))}

            <Tooltip
              cursor={{ stroke: CHART_TOKENS.cursor, strokeDasharray: '3 3' }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0]?.payload as ComparisonPoint | undefined;
                const lines: { label: string; value: number | null; stockout: boolean }[] = [
                  {
                    label: actualLabel,
                    value: point?.actual ?? null,
                    stockout: point?.actualStockout === true,
                  },
                  {
                    label: simulatedLabel,
                    value: point?.simulated ?? null,
                    stockout: point?.simStockout === true,
                  },
                ];
                return (
                  <div className="chart-annotation" style={{ borderRadius: 'var(--r-md)' }}>
                    <div style={{ marginBottom: 4, color: 'var(--text-3)' }}>{String(label)}</div>
                    {lines.map((line) => (
                      <div
                        key={line.label}
                        style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}
                      >
                        <span style={{ color: 'var(--text-3)' }}>{line.label}</span>
                        <b style={line.stockout ? { color: CHART_TOKENS.deficitLine } : undefined}>
                          {line.value === null ? '—' : formatNumber(line.value)}
                          {line.stockout ? ' · 결품' : ''}
                        </b>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            {/* 기간 브러시 — 점이 8개 이상일 때만 (spec §5) */}
            {brush && <Brush {...brush} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
