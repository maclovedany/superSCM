'use client';

// 예측 보정 — 사유별 AI vs Consensus WAPE (spec §4.2)
// 값은 v_forecast_value_add_by_reason 이 냈습니다.

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ACTUAL_COLOR, CHART_TOKENS, SERIES_COLORS } from '@/lib/chart-colors';
import { formatValue, pctTick } from '@/lib/chart-format';
import type { ReasonBar } from '@/lib/chart-model';
import ChartTooltip from './_base/tooltip';

export default function OverrideReasonBars({ bars, height = 240 }: { bars: ReasonBar[]; height?: number }) {
  return (
    <>
      <div className="chart-legend" style={{ marginBottom: 'var(--s-3)' }}>
        <span className="chart-legend-item"><span className="chart-legend-swatch" style={{ background: ACTUAL_COLOR }} />AI WAPE</span>
        <span className="chart-legend-item"><span className="chart-legend-swatch" style={{ background: SERIES_COLORS[0] }} />Consensus WAPE</span>
      </div>
      <div className="chart-wrap" style={{ height: height - 36 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bars} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="25%">
            <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: CHART_TOKENS.grid }} interval={0} />
            <YAxis tickFormatter={pctTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
            <Bar dataKey="aiWape" name="AI WAPE" fill={ACTUAL_COLOR} isAnimationActive={false} radius={[3, 3, 0, 0]} />
            <Bar dataKey="consensusWape" name="Consensus WAPE" fill={SERIES_COLORS[0]} isAnimationActive={false} radius={[3, 3, 0, 0]} />
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.03)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const b = payload[0].payload as ReasonBar;
                return (
                  <ChartTooltip
                    title={`${b.label} · ${formatValue(b.n, 'count')}`}
                    rows={[
                      { name: 'AI WAPE', value: formatValue(b.aiWape, 'pct'), color: ACTUAL_COLOR },
                      { name: 'Consensus WAPE', value: formatValue(b.consensusWape, 'pct'), color: SERIES_COLORS[0] },
                    ]}
                  />
                );
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
