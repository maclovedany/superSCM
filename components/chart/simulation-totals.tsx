'use client';

// 가상 운영 — 전 품목 재고 합 실제 vs 시뮬 + 결품 품목 수 (spec §4.3). 값은 v_simulation_totals 가 냈습니다.

import { Bar, Brush, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ACTUAL_COLOR, CHART_TOKENS, SERIES_COLORS, STATUS_COLORS } from '@/lib/chart-colors';
import { formatValue, monthTick, qtyTick } from '@/lib/chart-format';
import type { SimulationTotalPoint } from '@/lib/chart-model';
import { brushProps } from './_base/period-brush';
import { useSeriesToggle } from './_base/use-series-toggle';
import ChartTooltip from './_base/tooltip';

const SERIES = [
  { key: 'actualInventory', label: '실제 재고 합', color: ACTUAL_COLOR },
  { key: 'simInventory', label: '시뮬 재고 합', color: SERIES_COLORS[0] },
  { key: 'actualStockoutItems', label: '실제 결품 품목', color: STATUS_COLORS.CRITICAL },
  { key: 'simStockoutItems', label: '시뮬 결품 품목', color: SERIES_COLORS[2] },
] as const;

export default function SimulationTotalsChart({ points, height = 240 }: { points: SimulationTotalPoint[]; height?: number }) {
  const { toggle, visible } = useSeriesToggle(SERIES.map((s) => s.key));
  const brush = brushProps(points.length);
  return (
    <>
      <div className="chart-legend" style={{ marginBottom: 'var(--s-3)' }}>
        {SERIES.map((s) => (<button key={s.key} type="button" className="chart-legend-item" aria-pressed={visible(s.key)} onClick={() => toggle(s.key)}><span className="chart-legend-swatch" style={{ background: s.color }} />{s.label}</button>))}
      </div>
      <div className="chart-wrap" style={{ height: height - 36 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" vertical={false} />
            <XAxis dataKey="period" tickFormatter={monthTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: CHART_TOKENS.grid }} />
            <YAxis yAxisId="qty" tickFormatter={qtyTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
            <YAxis yAxisId="n" orientation="right" allowDecimals={false} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={28} />
            {visible('actualStockoutItems') && <Bar yAxisId="n" dataKey="actualStockoutItems" name="실제 결품 품목" fill={STATUS_COLORS.CRITICAL} fillOpacity={0.45} isAnimationActive={false} barSize={10} />}
            {visible('simStockoutItems') && <Bar yAxisId="n" dataKey="simStockoutItems" name="시뮬 결품 품목" fill={SERIES_COLORS[2]} fillOpacity={0.45} isAnimationActive={false} barSize={10} />}
            {visible('actualInventory') && <Line yAxisId="qty" type="monotone" dataKey="actualInventory" name="실제 재고 합" stroke={ACTUAL_COLOR} strokeWidth={2.5} dot={false} isAnimationActive={false} connectNulls={false} />}
            {visible('simInventory') && <Line yAxisId="qty" type="monotone" dataKey="simInventory" name="시뮬 재고 합" stroke={SERIES_COLORS[0]} strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={false} connectNulls={false} />}
            <Tooltip cursor={{ stroke: CHART_TOKENS.cursor, strokeDasharray: '3 3' }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as SimulationTotalPoint;
              return <ChartTooltip title={monthTick(p.period)} rows={[
                { name: '실제 재고 합', value: formatValue(p.actualInventory, 'qty'), color: ACTUAL_COLOR },
                { name: '시뮬 재고 합', value: formatValue(p.simInventory, 'qty'), color: SERIES_COLORS[0] },
                { name: '실제 결품 품목', value: `${p.actualStockoutItems}개`, color: STATUS_COLORS.CRITICAL },
                { name: '시뮬 결품 품목', value: `${p.simStockoutItems}개`, color: SERIES_COLORS[2] },
              ]} />;
            }} />
            {brush && <Brush {...brush} tickFormatter={monthTick} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
