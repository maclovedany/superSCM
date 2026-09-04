'use client';

// What-If — 기준 vs 시나리오 지표 비교 (spec §4.3). 값은 core.simulate_scenario 가 냈습니다.
// 지표마다 단위가 달라 작은 차트 넷을 나란히 둡니다. 한 축에 섞으면 큰 값이 작은 값을 지웁니다.

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ACTUAL_COLOR, CHART_TOKENS, SERIES_COLORS } from '@/lib/chart-colors';
import { formatValue, qtyTick } from '@/lib/chart-format';
import type { WhatIfCompareRow } from '@/lib/chart-model';
import ChartTooltip from './_base/tooltip';

export default function WhatIfCompare({ rows, height = 240 }: { rows: WhatIfCompareRow[]; height?: number }) {
  return (
    <>
      <div className="chart-legend" style={{ marginBottom: 'var(--s-3)' }}>
        <span className="chart-legend-item"><span className="chart-legend-swatch" style={{ background: ACTUAL_COLOR }} />기준 (Base)</span>
        <span className="chart-legend-item"><span className="chart-legend-swatch" style={{ background: SERIES_COLORS[0] }} />시나리오</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))`, gap: 'var(--s-3)', height: height - 36 }}>
        {rows.map((r) => {
          const data = [{ name: r.label, base: r.base, scenario: r.scenario }];
          const delta = r.base !== null && r.scenario !== null ? r.scenario - r.base : null;
          return (
            <div key={r.key} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div className="t-label" style={{ textAlign: 'center' }}>
                {r.label}
                {delta !== null && delta !== 0 && (
                  <span className={delta > 0 ? ' hl-warn' : ' hl-crit'} style={{ marginLeft: 6 }}>{delta > 0 ? '+' : ''}{formatValue(delta, 'qty')}{r.unit}</span>
                )}
              </div>
              <div className="chart-wrap" style={{ flex: 1, minHeight: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="20%">
                    <XAxis dataKey="name" hide />
                    <YAxis tickFormatter={qtyTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 10 }} tickLine={false} axisLine={false} width={36} />
                    <Bar dataKey="base" name="기준" fill={ACTUAL_COLOR} isAnimationActive={false} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="scenario" name="시나리오" fill={SERIES_COLORS[0]} isAnimationActive={false} radius={[3, 3, 0, 0]} />
                    <Tooltip cursor={{ fill: 'rgba(0,0,0,0.03)' }} content={({ active }) => {
                      if (!active) return null;
                      return <ChartTooltip title={r.label} rows={[
                        { name: '기준', value: r.base === null ? '—' : `${formatValue(r.base, 'qty')}${r.unit}`, color: ACTUAL_COLOR },
                        { name: '시나리오', value: r.scenario === null ? '—' : `${formatValue(r.scenario, 'qty')}${r.unit}`, color: SERIES_COLORS[0] },
                      ]} />;
                    }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
