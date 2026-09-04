'use client';

// 가상 운영 — 품목별 결품 월 실제 vs 시뮬 (spec §4.3). 값은 v_simulation_item 이 냈습니다.

import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ACTUAL_COLOR, CHART_TOKENS, SERIES_COLORS } from '@/lib/chart-colors';
import { formatValue } from '@/lib/chart-format';
import type { SimulationItemBar } from '@/lib/chart-model';
import { clickedPayload } from './_base/click';
import ChartTooltip from './_base/tooltip';

export default function SimulationItemBars({ bars, hrefFor, height = 240 }: { bars: SimulationItemBar[]; hrefFor: (itemId: string) => string; height?: number }) {
  const router = useRouter();
  const go = (entry: unknown) => { const b = clickedPayload<SimulationItemBar>(entry); if (b) router.push(hrefFor(b.itemId)); };
  return (
    <>
      <div className="chart-legend" style={{ marginBottom: 'var(--s-3)' }}>
        <span className="chart-legend-item"><span className="chart-legend-swatch" style={{ background: ACTUAL_COLOR }} />실제 결품 월</span>
        <span className="chart-legend-item"><span className="chart-legend-swatch" style={{ background: SERIES_COLORS[0] }} />AI 추천대로 발주했을 때</span>
      </div>
      <div className="chart-wrap chart-clickable" style={{ height: height - 36 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 8 }} barCategoryGap={4} barGap={1}>
            <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} unit="월" />
            <YAxis type="category" dataKey="label" width={96} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
            <Bar dataKey="actualStockouts" name="실제" fill={ACTUAL_COLOR} isAnimationActive={false} radius={[0, 3, 3, 0]} onClick={go} />
            <Bar dataKey="simStockouts" name="시뮬" fill={SERIES_COLORS[0]} isAnimationActive={false} radius={[0, 3, 3, 0]} onClick={go} />
            <Tooltip cursor={{ fill: 'rgba(0,0,0,0.03)' }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const b = payload[0].payload as SimulationItemBar;
              return <ChartTooltip title={b.label} rows={[
                { name: '실제 결품 월', value: `${b.actualStockouts}개월`, color: ACTUAL_COLOR },
                { name: '시뮬 결품 월', value: `${b.simStockouts}개월`, color: SERIES_COLORS[0] },
                { name: '평균 재고 실제 → 시뮬', value: `${formatValue(b.actualAvgInv, 'qty')} → ${formatValue(b.simAvgInv, 'qty')}` },
              ]} />;
            }} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
