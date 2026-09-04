'use client';

// 대시보드 ④ 예측 정확도 랭킹 — spec §4.1
// 좋은 5(초록) 와 나쁜 5(빨강) 를 한 축에. WAPE 낮을수록 정확합니다.
// 순위는 뷰(v_dashboard_accuracy_ranking)가 매겼고, 여기서는 고르기만 합니다.

import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_TOKENS, STATUS_COLORS } from '@/lib/chart-colors';
import { formatValue, pctTick } from '@/lib/chart-format';
import type { AccuracyBar } from '@/lib/chart-model';
import { clickedPayload } from './_base/click';
import ChartTooltip from './_base/tooltip';

export default function DashboardAccuracyRanking({
  bars,
  hrefFor,
  height = 240,
}: {
  bars: AccuracyBar[];
  hrefFor: (itemId: string) => string;
  height?: number;
}) {
  const router = useRouter();
  const data = bars.map((bar) => ({ ...bar, key: `${bar.side}-${bar.itemId}` }));
  const bestList = data.filter((d) => d.side === 'best');
  const lastBest = bestList.length > 0 ? bestList[bestList.length - 1].key : null;

  return (
    <div className="chart-wrap chart-clickable" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, bottom: 0, left: 8 }} barCategoryGap={4}>
          <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" horizontal={false} />
          <XAxis type="number" tickFormatter={pctTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="label" width={96} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
          {lastBest && <ReferenceLine y={lastBest} stroke={CHART_TOKENS.markerLine} strokeDasharray="3 3" position="end" />}
          <Bar dataKey="wape" name="WAPE" isAnimationActive={false} radius={[0, 4, 4, 0]} onClick={(entry) => { const bar = clickedPayload<AccuracyBar>(entry); if (bar) router.push(hrefFor(bar.itemId)); }}>
            {data.map((bar) => (
              <Cell key={bar.key} fill={bar.side === 'best' ? STATUS_COLORS.SAFE : STATUS_COLORS.CRITICAL} />
            ))}
          </Bar>
          <Tooltip
            cursor={{ fill: 'rgba(0,0,0,0.03)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const bar = payload[0].payload as AccuracyBar;
              return (
                <ChartTooltip
                  title={`${bar.label} · ${bar.side === 'best' ? '정확한' : '부정확한'} ${bar.rank}위`}
                  rows={[
                    { name: 'WAPE', value: formatValue(bar.wape, 'pct') },
                    { name: 'Champion', value: bar.modelName ?? '—' },
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
