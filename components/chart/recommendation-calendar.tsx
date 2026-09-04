'use client';

// 발주 추천 — 발주 권고일 주별 캘린더 (spec §4.3)
// 주마다 발주해야 할 품목 수(막대)와 금액(선). 값은 v_chart_order_calendar 가 냈습니다.

import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_TOKENS, SERIES_COLORS, STATUS_COLORS } from '@/lib/chart-colors';
import { formatValue, moneyTick } from '@/lib/chart-format';
import type { OrderCalendarRow } from '@/lib/chart-model';
import ChartTooltip from './_base/tooltip';

function weekTick(d: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[1]}/${m[2]}` : d;
}

export default function RecommendationCalendar({ rows, showAmount = true, height = 240 }: { rows: OrderCalendarRow[]; showAmount?: boolean; height?: number }) {
  return (
    <>
      <div className="chart-legend" style={{ marginBottom: 'var(--s-3)' }}>
        <span className="chart-legend-item"><span className="chart-legend-swatch" style={{ background: SERIES_COLORS[0] }} />품목 수</span>
        <span className="chart-legend-item"><span className="chart-legend-swatch" style={{ background: STATUS_COLORS.CRITICAL }} />그중 긴급</span>
        {showAmount && <span className="chart-legend-item"><span className="chart-legend-swatch" style={{ background: SERIES_COLORS[3] }} />금액</span>}
      </div>
      <div className="chart-wrap" style={{ height: height - 36 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: showAmount ? 8 : 16, bottom: 0, left: 0 }} barCategoryGap="30%">
            <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" vertical={false} />
            <XAxis dataKey="weekStart" tickFormatter={weekTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: CHART_TOKENS.grid }} />
            <YAxis yAxisId="n" allowDecimals={false} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={32} />
            {showAmount && <YAxis yAxisId="amt" orientation="right" tickFormatter={moneyTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={56} />}
            <Bar yAxisId="n" dataKey="nItems" name="품목 수" fill={SERIES_COLORS[0]} isAnimationActive={false} radius={[3, 3, 0, 0]} />
            <Bar yAxisId="n" dataKey="nUrgent" name="긴급" fill={STATUS_COLORS.CRITICAL} isAnimationActive={false} radius={[3, 3, 0, 0]} />
            {showAmount && <Line yAxisId="amt" type="monotone" dataKey="totalAmount" name="금액" stroke={SERIES_COLORS[3]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} connectNulls={false} />}
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.03)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload as OrderCalendarRow;
                return (
                  <ChartTooltip
                    title={`${r.weekStart} 주`}
                    rows={[
                      { name: '품목 수', value: formatValue(r.nItems, 'count'), color: SERIES_COLORS[0] },
                      { name: '긴급', value: formatValue(r.nUrgent, 'count'), color: STATUS_COLORS.CRITICAL },
                      { name: '추천 수량', value: formatValue(r.totalQty, 'qty') },
                      ...(showAmount ? [{ name: '금액', value: formatValue(r.totalAmount, 'money'), color: SERIES_COLORS[3] }] : []),
                    ]}
                  />
                );
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
