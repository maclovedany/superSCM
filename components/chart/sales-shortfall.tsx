'use client';

// 판매 — 납기 위험 수주의 부족 수량 (spec §4.3). 값은 v_sales_promise_risk 그대로, 납기 순입니다.

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_TOKENS, STATUS_COLORS } from '@/lib/chart-colors';
import { formatValue, qtyTick } from '@/lib/chart-format';
import type { ShortfallBar } from '@/lib/chart-model';
import ChartTooltip from './_base/tooltip';

export default function SalesShortfall({ bars, height = 240 }: { bars: ShortfallBar[]; height?: number }) {
  return (
    <div className="chart-wrap" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 8 }} barCategoryGap={4}>
          <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" horizontal={false} />
          <XAxis type="number" tickFormatter={qtyTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="label" width={120} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
          <Bar dataKey="shortfallQty" name="부족 수량" isAnimationActive={false} radius={[0, 3, 3, 0]}>
            {bars.map((b) => (<Cell key={b.soNo} fill={b.daysToDue !== null && b.daysToDue <= 7 ? STATUS_COLORS.CRITICAL : STATUS_COLORS.WARNING} />))}
          </Bar>
          <Tooltip cursor={{ fill: 'rgba(0,0,0,0.03)' }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const b = payload[0].payload as ShortfallBar;
            return <ChartTooltip title={b.label} rows={[{ name: '부족 수량', value: formatValue(b.shortfallQty, 'qty') }, { name: '납기', value: `${b.dueDate}${b.daysToDue === null ? '' : ` (${b.daysToDue}일 남음)`}` }]} note="빨강은 납기 7일 이내" />;
          }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
