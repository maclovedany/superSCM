'use client';

// 대시보드 ① 수요 추이 — spec §4.1
// 최근 12개월 실적 합계(면적 + 잉크 블랙 실선)와 향후 3개월 Consensus(파란 파선).
// 여기서 계산하지 않습니다. 합계는 analytics.v_chart_demand_trend 가 냈습니다.

import { useMemo, useState } from 'react';
import {
  Area,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ACTUAL_COLOR, CHART_TOKENS, SERIES_COLORS } from '@/lib/chart-colors';
import { formatValue, monthTick, qtyTick } from '@/lib/chart-format';
import type { DemandTrendPoint } from '@/lib/chart-model';
import ChartTooltip from './_base/tooltip';
import { brushProps } from './_base/period-brush';

const FORECAST_COLOR = SERIES_COLORS[0];

export default function DashboardDemandTrend({
  data,
  height = 280,
}: {
  data: DemandTrendPoint[];
  height?: number;
}) {
  const [showActual, setShowActual] = useState(true);
  const [showForecast, setShowForecast] = useState(true);

  // 실적이 끝나는 기간. 여기서 예측이 시작되므로 세로 안내선을 긋습니다.
  const lastActual = useMemo(
    () => [...data].reverse().find((p) => p.actual !== null)?.period ?? null,
    [data],
  );
  const brush = brushProps(data.length);

  return (
    <>
      <div className="chart-legend" style={{ marginBottom: 'var(--s-3)' }}>
        <button type="button" className="chart-legend-item" aria-pressed={showActual} onClick={() => setShowActual((v) => !v)}>
          <span className="chart-legend-swatch" style={{ background: ACTUAL_COLOR }} />
          실적 합계
        </button>
        <button type="button" className="chart-legend-item" aria-pressed={showForecast} onClick={() => setShowForecast((v) => !v)}>
          <span className="chart-legend-swatch" style={{ background: FORECAST_COLOR }} />
          Consensus 예측
        </button>
      </div>
      <div className="chart-wrap" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="demandTrendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ACTUAL_COLOR} stopOpacity={0.12} />
                <stop offset="100%" stopColor={ACTUAL_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" vertical={false} />
            <XAxis dataKey="period" tickFormatter={monthTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: CHART_TOKENS.grid }} />
            <YAxis tickFormatter={qtyTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={52} />
            {lastActual && (
              <ReferenceLine x={lastActual} stroke={CHART_TOKENS.markerLine} strokeDasharray="3 3" label={{ value: '예측 시작', fill: CHART_TOKENS.axis, fontSize: 11, position: 'insideTopRight' }} />
            )}
            {showActual && (
              <Area type="monotone" dataKey="actual" name="실적 합계" stroke={ACTUAL_COLOR} strokeWidth={2.5} fill="url(#demandTrendFill)" dot={false} isAnimationActive={false} connectNulls={false} />
            )}
            {showForecast && (
              <Line type="monotone" dataKey="forecast" name="Consensus 예측" stroke={FORECAST_COLOR} strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={false} connectNulls={false} />
            )}
            <Tooltip
              cursor={{ stroke: CHART_TOKENS.cursor, strokeDasharray: '3 3' }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0].payload as DemandTrendPoint;
                return (
                  <ChartTooltip
                    title={String(label)}
                    rows={payload.map((entry) => ({
                      name: String(entry.name),
                      value: formatValue(typeof entry.value === 'number' ? entry.value : null, 'qty'),
                      color: String(entry.color),
                    }))}
                    note={point.nItems === null ? undefined : `품목 ${point.nItems}개 합계`}
                  />
                );
              }}
            />
            {brush && <Brush {...brush} tickFormatter={monthTick} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
