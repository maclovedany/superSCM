'use client';

// 모델 평가 — 베이스라인(이동평균 3개월) 대비 개선율 ± 막대 (spec §4.2)
// 값은 v_champion_model 이 냈습니다. 양수 초록, 음수 빨강.

import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_TOKENS, STATUS_COLORS } from '@/lib/chart-colors';
import { pctTick } from '@/lib/chart-format';
import type { ImprovementBar } from '@/lib/chart-model';
import { clickedPayload } from './_base/click';
import ChartTooltip from './_base/tooltip';

export default function EvaluationImprovement({
  bars,
  hrefFor,
  limit = 20,
  height = 240,
}: {
  bars: ImprovementBar[];
  hrefFor: (itemId: string) => string;
  limit?: number;
  height?: number;
}) {
  const router = useRouter();
  const data = bars.slice().sort((a, b) => a.improvement - b.improvement).slice(0, limit);
  return (
    <div className="chart-wrap chart-clickable" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 8 }} barCategoryGap={4}>
          <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" horizontal={false} />
          <XAxis type="number" tickFormatter={pctTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="label" width={96} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
          <ReferenceLine x={0} stroke={CHART_TOKENS.markerLine} />
          <Bar dataKey="improvement" name="개선율" isAnimationActive={false} radius={2} onClick={(entry) => { const b = clickedPayload<ImprovementBar>(entry); if (b) router.push(hrefFor(b.itemId)); }}>
            {data.map((b) => (<Cell key={b.itemId} fill={b.improvement >= 0 ? STATUS_COLORS.SAFE : STATUS_COLORS.CRITICAL} />))}
          </Bar>
          <Tooltip
            cursor={{ fill: 'rgba(0,0,0,0.03)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const b = payload[0].payload as ImprovementBar;
              return <ChartTooltip title={b.label} rows={[{ name: '베이스라인 대비', value: `${b.improvement > 0 ? '+' : ''}${pctTick(b.improvement)}` }]} note="이동평균 3개월 WAPE 대비" />;
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
