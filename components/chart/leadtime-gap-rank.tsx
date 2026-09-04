'use client';

// 리드타임 — 격차(P80 − 마스터) 순위 ± 가로 막대 (spec §4.2)
// 양수(실적이 더 김)는 빨강, 0 이하는 초록. 격차가 없는 공급처는 뺍니다.

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_TOKENS, STATUS_COLORS } from '@/lib/chart-colors';
import type { LeadtimeBar } from '@/lib/chart-model';
import ChartTooltip from './_base/tooltip';

export default function LeadtimeGapRank({ bars, height = 240 }: { bars: LeadtimeBar[]; height?: number }) {
  const data = bars.filter((b) => b.gap !== null).sort((a, b) => (b.gap ?? 0) - (a.gap ?? 0));
  return (
    <div className="chart-wrap" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 8 }} barCategoryGap={4}>
          <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" horizontal={false} />
          <XAxis type="number" tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} unit="일" />
          <YAxis type="category" dataKey="supplier" width={88} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
          <ReferenceLine x={0} stroke={CHART_TOKENS.markerLine} />
          <Bar dataKey="gap" name="격차" isAnimationActive={false} radius={2}>
            {data.map((b) => (
              <Cell key={b.supplier} fill={(b.gap ?? 0) > 0 ? STATUS_COLORS.CRITICAL : STATUS_COLORS.SAFE} />
            ))}
          </Bar>
          <Tooltip
            cursor={{ fill: 'rgba(0,0,0,0.03)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const b = payload[0].payload as LeadtimeBar;
              return (
                <ChartTooltip
                  title={b.supplier}
                  rows={[
                    { name: '격차 (P80 − 마스터)', value: `${(b.gap ?? 0) > 0 ? '+' : ''}${b.gap}일` },
                    { name: '마스터', value: b.master === null ? '—' : `${b.master}일` },
                    { name: '실측 P80', value: b.p80 === null ? '—' : `${b.p80}일` },
                  ]}
                />
              );
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
