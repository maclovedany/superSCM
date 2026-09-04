'use client';

// 모델 비교 — 모델별 WAPE · Bias 그룹 막대 (spec §4.2)
// 값은 v_model_performance 가 냈습니다. Champion 은 잉크 테두리로 표시합니다.

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ACTUAL_COLOR, CHART_TOKENS, SERIES_COLORS } from '@/lib/chart-colors';
import { formatValue, pctTick } from '@/lib/chart-format';
import type { MetricBar } from '@/lib/chart-model';
import { useSeriesToggle } from './_base/use-series-toggle';
import ChartTooltip from './_base/tooltip';

const SERIES = [
  { key: 'wape', label: 'WAPE', color: SERIES_COLORS[0] },
  { key: 'bias', label: 'Bias', color: SERIES_COLORS[3] },
] as const;

export default function ComparisonMetricBars({ bars, height = 240 }: { bars: MetricBar[]; height?: number }) {
  const { toggle, visible } = useSeriesToggle(SERIES.map((s) => s.key));
  return (
    <>
      <div className="chart-legend" style={{ marginBottom: 'var(--s-3)' }}>
        {SERIES.map((s) => (
          <button key={s.key} type="button" className="chart-legend-item" aria-pressed={visible(s.key)} onClick={() => toggle(s.key)}>
            <span className="chart-legend-swatch" style={{ background: s.color }} />{s.label}
          </button>
        ))}
        <span className="chart-legend-item"><span className="chart-legend-swatch" style={{ background: 'transparent', border: `2px solid ${ACTUAL_COLOR}` }} />Champion</span>
      </div>
      <div className="chart-wrap" style={{ height: height - 36 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bars} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="25%">
            <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: CHART_TOKENS.grid }} interval={0} />
            <YAxis tickFormatter={pctTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
            <ReferenceLine y={0} stroke={CHART_TOKENS.markerLine} />
            {SERIES.filter((s) => visible(s.key)).map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} isAnimationActive={false} radius={[3, 3, 0, 0]}>
                {bars.map((b) => (<Cell key={b.modelId} stroke={b.isChampion ? ACTUAL_COLOR : 'none'} strokeWidth={b.isChampion ? 2 : 0} />))}
              </Bar>
            ))}
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.03)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const b = payload[0].payload as MetricBar;
                return (
                  <ChartTooltip
                    title={`${b.label}${b.isChampion ? ' · Champion' : ''}`}
                    rows={[
                      { name: 'WAPE', value: formatValue(b.wape, 'pct'), color: SERIES[0].color },
                      { name: 'Bias', value: b.bias === null ? '—' : `${b.bias > 0 ? '+' : ''}${pctTick(b.bias)}`, color: SERIES[1].color },
                    ]}
                    note="WAPE 는 낮을수록, Bias 는 0 에 가까울수록 좋습니다"
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
