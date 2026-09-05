'use client';

// 결정 이력 — 승인 조정량 ± 막대 (Plan C 의 스펙 변경 — 산점도 대신)
// 추천 대비 얼마나 늘리고 줄였나. 값은 v_decision_history 의 adjustment 그대로입니다.

import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_TOKENS, SERIES_COLORS, STATUS_COLORS } from '@/lib/chart-colors';
import { formatValue, qtyTick } from '@/lib/chart-format';
import type { AdjustmentBar } from '@/lib/chart-model';
import { clickedPayload, fillHref } from './_base/click';
import ChartTooltip from './_base/tooltip';

export default function DecisionAdjustment({ bars, hrefTemplate, height = 240 }: { bars: AdjustmentBar[]; hrefTemplate: string; height?: number }) {
  const router = useRouter();
  const data = bars.map((b) => ({ ...b, key: `${b.refId}` }));
  return (
    <div className="chart-wrap chart-clickable" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 8 }} barCategoryGap={4}>
          <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" horizontal={false} />
          <XAxis type="number" tickFormatter={qtyTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="label" width={96} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
          <ReferenceLine x={0} stroke={CHART_TOKENS.markerLine} />
          <Bar dataKey="adjustment" name="조정량" isAnimationActive={false} radius={2} onClick={(entry) => { const b = clickedPayload<AdjustmentBar>(entry); if (b) router.push(fillHref(hrefTemplate, b.refId)); }}>
            {data.map((b) => (<Cell key={b.key} fill={b.adjustment > 0 ? SERIES_COLORS[0] : STATUS_COLORS.WARNING} />))}
          </Bar>
          <Tooltip
            cursor={{ fill: 'rgba(0,0,0,0.03)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const b = payload[0].payload as AdjustmentBar;
              return <ChartTooltip title={b.label} rows={[{ name: '조정량 (승인 − 추천)', value: `${b.adjustment > 0 ? '+' : ''}${formatValue(b.adjustment, 'qty')}` }, { name: '결정', value: `${b.at.slice(0, 10)} · ${b.actorEmail ?? '—'}` }]} />;
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
