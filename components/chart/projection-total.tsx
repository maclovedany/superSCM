'use client';

// 재고 전개 — 전 품목 기말 재고 합계 + 결품 품목 수 (spec §4.3)
// 값은 v_chart_projection_total 이 냈습니다.

import { Area, Bar, Brush, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ACTUAL_COLOR, CHART_TOKENS, STATUS_COLORS } from '@/lib/chart-colors';
import { formatValue, monthTick, qtyTick } from '@/lib/chart-format';
import type { ProjectionTotalPoint } from '@/lib/chart-model';
import { brushProps } from './_base/period-brush';
import ChartTooltip from './_base/tooltip';

export default function ProjectionTotal({ points, height = 240 }: { points: ProjectionTotalPoint[]; height?: number }) {
  const brush = brushProps(points.length);
  return (
    <>
      <div className="chart-legend" style={{ marginBottom: 'var(--s-3)' }}>
        <span className="chart-legend-item"><span className="chart-legend-swatch" style={{ background: ACTUAL_COLOR }} />기말 재고 합계</span>
        <span className="chart-legend-item"><span className="chart-legend-swatch" style={{ background: STATUS_COLORS.CRITICAL }} />결품 품목 수</span>
      </div>
      <div className="chart-wrap" style={{ height: height - 36 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="projTotalFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ACTUAL_COLOR} stopOpacity={0.12} />
                <stop offset="100%" stopColor={ACTUAL_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" vertical={false} />
            <XAxis dataKey="period" tickFormatter={monthTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: CHART_TOKENS.grid }} />
            <YAxis yAxisId="qty" tickFormatter={qtyTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
            <YAxis yAxisId="n" orientation="right" allowDecimals={false} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={28} />
            <Bar yAxisId="n" dataKey="nStockoutItems" name="결품 품목 수" fill={STATUS_COLORS.CRITICAL} fillOpacity={0.5} isAnimationActive={false} radius={[3, 3, 0, 0]} barSize={14} />
            <Area yAxisId="qty" type="monotone" dataKey="totalClosing" name="기말 재고 합계" stroke={ACTUAL_COLOR} strokeWidth={2.5} fill="url(#projTotalFill)" dot={false} isAnimationActive={false} connectNulls={false} />
            <Tooltip
              cursor={{ stroke: CHART_TOKENS.cursor, strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as ProjectionTotalPoint;
                return (
                  <ChartTooltip
                    title={monthTick(p.period)}
                    rows={[
                      { name: '기말 재고 합계', value: formatValue(p.totalClosing, 'qty'), color: ACTUAL_COLOR },
                      { name: '입고 합계', value: formatValue(p.totalReceipt, 'qty') },
                      { name: '수요 합계', value: formatValue(p.totalDemand, 'qty') },
                      { name: '결품 품목', value: `${p.nStockoutItems} / ${p.nItems}개`, color: STATUS_COLORS.CRITICAL },
                    ]}
                  />
                );
              }}
            />
            {brush && <Brush {...brush} tickFormatter={monthTick} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
