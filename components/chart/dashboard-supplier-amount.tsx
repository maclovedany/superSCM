'use client';

// 대시보드 ③ 공급처별 추천 금액 — spec §4.1
// 금액이 큰 공급처부터 가로 막대. 순서는 뷰(v_chart_recommendation_by_supplier)가 정했습니다.
// 금액이 null(단가 없음)인 공급처는 막대 대신 "단가 없음" 으로 표시합니다 — 0원이 아닙니다.

import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_TOKENS, SERIES_COLORS, STATUS_COLORS } from '@/lib/chart-colors';
import { formatValue, moneyTick } from '@/lib/chart-format';
import type { SupplierAmountRow } from '@/lib/chart-model';
import { clickedPayload } from './_base/click';
import ChartTooltip from './_base/tooltip';

export default function DashboardSupplierAmount({
  rows,
  hrefFor,
  height = 240,
}: {
  rows: SupplierAmountRow[];
  hrefFor: (supplierId: string) => string;
  height?: number;
}) {
  const router = useRouter();
  const data = rows.map((row) => ({
    ...row,
    label: row.supplierName ?? row.supplierId,
    // 단가 없는 공급처는 축에 0 으로 서지 않게 null 로 둡니다 (design.md ④)
    amount: row.totalAmount,
    tag: row.totalAmount === null ? '단가 없음' : row.nUrgent > 0 ? `긴급 ${row.nUrgent}` : '',
  }));

  return (
    <div className="chart-wrap chart-clickable" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 0, left: 8 }} barCategoryGap={6}>
          <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" horizontal={false} />
          <XAxis type="number" tickFormatter={moneyTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="label" width={96} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
          <Bar dataKey="amount" name="추천 금액" isAnimationActive={false} radius={[0, 4, 4, 0]} onClick={(entry) => { const row = clickedPayload<SupplierAmountRow>(entry); if (row) router.push(hrefFor(row.supplierId)); }}>
            {data.map((row) => (
              <Cell key={row.supplierId} fill={row.nUrgent > 0 ? STATUS_COLORS.CRITICAL : SERIES_COLORS[0]} />
            ))}
            <LabelList dataKey="tag" position="right" fill={CHART_TOKENS.axis} fontSize={11} />
          </Bar>
          <Tooltip
            cursor={{ fill: 'rgba(0,0,0,0.03)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as SupplierAmountRow & { label: string };
              return (
                <ChartTooltip
                  title={row.label}
                  rows={[
                    { name: '추천 금액', value: formatValue(row.totalAmount, 'money') },
                    { name: '추천 수량', value: formatValue(row.totalQty, 'qty') },
                    { name: '품목', value: formatValue(row.nItems, 'count') },
                    { name: '긴급', value: formatValue(row.nUrgent, 'count'), color: STATUS_COLORS.CRITICAL },
                  ]}
                  note={row.nMissingPrice ? `단가 없는 품목 ${row.nMissingPrice}개는 금액에 없습니다` : undefined}
                />
              );
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
