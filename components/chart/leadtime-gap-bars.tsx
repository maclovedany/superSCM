'use client';

// 리드타임 — 공급처별 마스터 vs 실측 P80 그룹 막대 (spec §4.2)
// 값은 v_leadtime_gap 이 냈습니다. 표본 30건 미만은 막대 위에 표본 수를 적습니다.

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_TOKENS, SERIES_COLORS, STATUS_COLORS } from '@/lib/chart-colors';
import { formatValue } from '@/lib/chart-format';
import type { LeadtimeBar } from '@/lib/chart-model';
import { useSeriesToggle } from './_base/use-series-toggle';
import ChartTooltip from './_base/tooltip';

const SERIES = [
  { key: 'master', label: '마스터', color: STATUS_COLORS.UNKNOWN },
  { key: 'avg', label: '실측 평균', color: SERIES_COLORS[5] },
  { key: 'p80', label: '실측 P80', color: SERIES_COLORS[0] },
] as const;

export default function LeadtimeGapBars({ bars, height = 240 }: { bars: LeadtimeBar[]; height?: number }) {
  const { toggle, visible } = useSeriesToggle(SERIES.map((s) => s.key));
  const data = bars.map((b) => ({ ...b, sampleTag: b.lowSample ? '표본↓' : '' }));
  return (
    <>
      <div className="chart-legend" style={{ marginBottom: 'var(--s-3)' }}>
        {SERIES.map((s) => (
          <button key={s.key} type="button" className="chart-legend-item" aria-pressed={visible(s.key)} onClick={() => toggle(s.key)}>
            <span className="chart-legend-swatch" style={{ background: s.color }} />{s.label}
          </button>
        ))}
      </div>
      <div className="chart-wrap" style={{ height: height - 36 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }} barCategoryGap="25%">
            <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" vertical={false} />
            <XAxis dataKey="supplier" tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: CHART_TOKENS.grid }} interval={0} angle={-20} textAnchor="end" height={40} />
            <YAxis tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={32} unit="일" />
            {SERIES.filter((s) => visible(s.key)).map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} isAnimationActive={false} radius={[3, 3, 0, 0]}>
                {s.key === 'p80' && <LabelList dataKey="sampleTag" position="top" fill={STATUS_COLORS.WARNING} fontSize={10} />}
              </Bar>
            ))}
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.03)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const b = payload[0].payload as LeadtimeBar;
                return (
                  <ChartTooltip
                    title={b.supplier}
                    rows={[
                      { name: '마스터', value: b.master === null ? '—' : `${b.master}일`, color: SERIES[0].color },
                      { name: '실측 평균', value: b.avg === null ? '—' : `${b.avg}일`, color: SERIES[1].color },
                      { name: '실측 P80', value: b.p80 === null ? '—' : `${b.p80}일`, color: SERIES[2].color },
                      { name: '격차', value: b.gap === null ? '—' : `${b.gap > 0 ? '+' : ''}${b.gap}일` },
                    ]}
                    note={b.lowSample ? '표본 30건 미만 — 신뢰도 낮음' : undefined}
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
