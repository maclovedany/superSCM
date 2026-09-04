'use client';

// 결품 위험 — 품목별 재고 유지 일수 vs 리드타임 (spec §4.2)
// 유지 일수 막대(상태색)와 리드타임 막대(회색)를 나란히. 유지 일수가 리드타임보다 짧으면 지금 발주해도 늦습니다.
// 값은 v_stockout_risk 가 냈습니다.

import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_TOKENS, STATUS_COLORS } from '@/lib/chart-colors';
import type { StockoutBar } from '@/lib/chart-model';
import { clickedPayload } from './_base/click';
import ChartTooltip from './_base/tooltip';

const STATUS_LABEL: Record<string, string> = {
  CRITICAL: '위험', WARNING: '주의', SAFE: '안전', CALCULATION_UNAVAILABLE: '산출 불가',
};

function statusColor(status: string): string {
  if (status === 'CRITICAL') return STATUS_COLORS.CRITICAL;
  if (status === 'WARNING') return STATUS_COLORS.WARNING;
  if (status === 'SAFE') return STATUS_COLORS.SAFE;
  return STATUS_COLORS.UNKNOWN;
}

export default function StockoutDaysBar({
  bars,
  hrefFor,
  height = 240,
}: {
  bars: StockoutBar[];
  hrefFor: (itemId: string) => string;
  height?: number;
}) {
  const router = useRouter();
  const go = (entry: unknown) => { const b = clickedPayload<StockoutBar>(entry); if (b) router.push(hrefFor(b.itemId)); };
  return (
    <>
      <div className="chart-legend" style={{ marginBottom: 'var(--s-3)' }}>
        {(['CRITICAL', 'WARNING', 'SAFE'] as const).map((s) => (
          <span key={s} className="chart-legend-item"><span className="chart-legend-swatch" style={{ background: statusColor(s) }} />{STATUS_LABEL[s]} · 유지 일수</span>
        ))}
        <span className="chart-legend-item"><span className="chart-legend-swatch" style={{ background: STATUS_COLORS.UNKNOWN }} />리드타임</span>
      </div>
      <div className="chart-wrap chart-clickable" style={{ height: height - 36 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 8 }} barCategoryGap={4} barGap={1}>
            <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" horizontal={false} />
            <XAxis type="number" tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} unit="일" />
            <YAxis type="category" dataKey="label" width={96} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
            <ReferenceLine x={0} stroke={CHART_TOKENS.markerLine} />
            <Bar dataKey="days" name="유지 일수" isAnimationActive={false} radius={[0, 3, 3, 0]} onClick={go}>
              {bars.map((b) => (<Cell key={b.itemId} fill={statusColor(b.status)} />))}
            </Bar>
            <Bar dataKey="leadTime" name="리드타임" fill={STATUS_COLORS.UNKNOWN} fillOpacity={0.55} isAnimationActive={false} radius={[0, 3, 3, 0]} onClick={go} />
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.03)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const b = payload[0].payload as StockoutBar;
                return (
                  <ChartTooltip
                    title={`${b.label} · ${STATUS_LABEL[b.status] ?? b.status}`}
                    rows={[
                      { name: '재고 유지 일수', value: b.days === null ? '—' : `${b.days}일`, color: statusColor(b.status) },
                      { name: '리드타임', value: b.leadTime === null ? '—' : `${b.leadTime}일`, color: STATUS_COLORS.UNKNOWN },
                    ]}
                    note="유지 일수 < 리드타임이면 지금 발주해도 늦습니다"
                  />
                );
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
