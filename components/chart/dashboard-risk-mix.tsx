'use client';

// 대시보드 ② 결품 위험 분포 — spec §4.1
// 위험 · 주의 · 안전 · 미판정 네 건수를 가로 스택 막대 하나로. 원형 대신 막대입니다 (design.md §7.4).
// 건수는 analytics.v_stockout_kpi 가 냈습니다. 여기서 더하지 않습니다.

import { useRouter } from 'next/navigation';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { STATUS_COLORS } from '@/lib/chart-colors';
import { formatValue } from '@/lib/chart-format';
import type { RiskMixKey, RiskMixSlice } from '@/lib/chart-model';
import ChartTooltip from './_base/tooltip';

export default function DashboardRiskMix({
  slices,
  hrefFor,
  height = 240,
}: {
  slices: RiskMixSlice[];
  /** 상태를 눌렀을 때 갈 곳. null 이면 누를 수 없습니다 */
  hrefFor: (key: RiskMixKey) => string | null;
  height?: number;
}) {
  const router = useRouter();
  // recharts 는 스택을 한 행의 여러 열로 그립니다. 네 조각을 한 행으로 옮겨 담습니다.
  const row: Record<string, number | string> = { name: '품목' };
  for (const slice of slices) row[slice.key] = slice.n;
  const total = slices.reduce((sum, s) => sum + s.n, 0);

  const go = (key: RiskMixKey) => {
    const href = hrefFor(key);
    if (href) router.push(href);
  };

  return (
    <div style={{ height, display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
      <div className="chart-wrap chart-clickable" style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={[row]} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barSize={36}>
            <XAxis type="number" hide domain={[0, Math.max(total, 1)]} />
            <YAxis type="category" dataKey="name" hide />
            {slices.map((slice) => (
              <Bar
                key={slice.key}
                dataKey={slice.key}
                name={slice.label}
                stackId="mix"
                fill={STATUS_COLORS[slice.key]}
                isAnimationActive={false}
                onClick={() => go(slice.key)}
                radius={0}
              />
            ))}
            <Tooltip
              cursor={false}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                return (
                  <ChartTooltip
                    title={`전체 ${formatValue(total, 'count')}`}
                    rows={payload.map((entry) => ({
                      name: String(entry.name),
                      value: formatValue(typeof entry.value === 'number' ? entry.value : null, 'count'),
                      color: String(entry.color),
                    }))}
                  />
                );
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* 색만으로 읽지 않도록 상태 글자와 건수를 아래 칩으로 둡니다 */}
      <div className="chart-legend">
        {slices.map((slice) => {
          const href = hrefFor(slice.key);
          const inner = (
            <>
              <span className="chart-legend-swatch" style={{ background: STATUS_COLORS[slice.key] }} />
              {slice.label} <b>{slice.n}</b>
            </>
          );
          return href ? (
            <button key={slice.key} type="button" className="chart-legend-item" onClick={() => go(slice.key)}>
              {inner}
            </button>
          ) : (
            <span key={slice.key} className="chart-legend-item">{inner}</span>
          );
        })}
      </div>
    </div>
  );
}
