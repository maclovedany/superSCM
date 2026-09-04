'use client';

// 알림 유형 × 심각도 — spec §4.1 ⑤ · §4.3 (대시보드와 알림 화면이 함께 씁니다)
// 유형마다 심각도 셋을 쌓은 가로 막대. 건수는 v_chart_alert_by_type 이 냈습니다.

import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_TOKENS, STATUS_COLORS } from '@/lib/chart-colors';
import { formatValue } from '@/lib/chart-format';
import type { AlertSeverity, AlertTypeStack } from '@/lib/chart-model';
import { clickedPayload } from './_base/click';
import { useSeriesToggle } from './_base/use-series-toggle';
import ChartTooltip from './_base/tooltip';

const SEVERITIES: { key: AlertSeverity; label: string; color: string }[] = [
  { key: 'CRITICAL', label: '위험', color: STATUS_COLORS.CRITICAL },
  { key: 'WARNING', label: '주의', color: STATUS_COLORS.WARNING },
  { key: 'INFO', label: '정보', color: STATUS_COLORS.INFO },
];

export default function AlertsTypeMix({
  stacks,
  hrefFor,
  height = 240,
}: {
  stacks: AlertTypeStack[];
  hrefFor: (type: string) => string | null;
  height?: number;
}) {
  const router = useRouter();
  const { toggle, visible } = useSeriesToggle(SEVERITIES.map((s) => s.key));

  return (
    <>
      <div className="chart-legend" style={{ marginBottom: 'var(--s-3)' }}>
        {SEVERITIES.map((s) => (
          <button key={s.key} type="button" className="chart-legend-item" aria-pressed={visible(s.key)} onClick={() => toggle(s.key)}>
            <span className="chart-legend-swatch" style={{ background: s.color }} />
            {s.label}
          </button>
        ))}
      </div>
      <div className="chart-wrap chart-clickable" style={{ height: height - 36 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={stacks} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 8 }} barCategoryGap={6}>
            <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="typeLabel" width={96} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
            {SEVERITIES.filter((s) => visible(s.key)).map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId="sev"
                fill={s.color}
                isAnimationActive={false}
                onClick={(entry) => {
                  const stack = clickedPayload<AlertTypeStack>(entry);
                  const href = stack ? hrefFor(stack.type) : null;
                  if (href) router.push(href);
                }}
              />
            ))}
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.03)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const stack = payload[0].payload as AlertTypeStack;
                return (
                  <ChartTooltip
                    title={`${stack.typeLabel} · 열린 알림 ${formatValue(stack.total, 'count')}`}
                    rows={SEVERITIES.map((s) => ({ name: s.label, value: formatValue(stack[s.key], 'count'), color: s.color }))}
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
