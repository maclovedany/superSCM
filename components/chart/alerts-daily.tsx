'use client';

// 알림 — 최근 30일 일별 발생 · 해결 (spec §4.3). 값은 v_chart_alert_daily 가 냈습니다.

import { Bar, Brush, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_TOKENS, SERIES_COLORS, STATUS_COLORS } from '@/lib/chart-colors';
import { formatValue } from '@/lib/chart-format';
import type { AlertDailyPoint } from '@/lib/chart-model';
import { brushProps } from './_base/period-brush';
import ChartTooltip from './_base/tooltip';

function dayTick(d: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[1]}/${m[2]}` : d;
}

export default function AlertsDaily({ points, height = 240 }: { points: AlertDailyPoint[]; height?: number }) {
  const data = points.map((p) => ({ ...p, period: p.day }));
  const brush = brushProps(data.length);
  return (
    <>
      <div className="chart-legend" style={{ marginBottom: 'var(--s-3)' }}>
        <span className="chart-legend-item"><span className="chart-legend-swatch" style={{ background: STATUS_COLORS.WARNING }} />발생</span>
        <span className="chart-legend-item"><span className="chart-legend-swatch" style={{ background: SERIES_COLORS[1] }} />해결</span>
      </div>
      <div className="chart-wrap" style={{ height: height - 36 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barCategoryGap="30%">
            <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" vertical={false} />
            <XAxis dataKey="period" tickFormatter={dayTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: CHART_TOKENS.grid }} />
            <YAxis allowDecimals={false} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={32} />
            <Bar dataKey="nDetected" name="발생" fill={STATUS_COLORS.WARNING} isAnimationActive={false} radius={[3, 3, 0, 0]} />
            <Line type="monotone" dataKey="nResolved" name="해결" stroke={SERIES_COLORS[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.03)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as AlertDailyPoint;
                return <ChartTooltip title={p.day} rows={[{ name: '발생', value: formatValue(p.nDetected, 'count'), color: STATUS_COLORS.WARNING }, { name: '해결', value: formatValue(p.nResolved, 'count'), color: SERIES_COLORS[1] }]} />;
              }}
            />
            {brush && <Brush {...brush} tickFormatter={dayTick} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
