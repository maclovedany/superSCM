'use client';

// 월별 결정 건수 — spec §4.1 ⑥ · §4.3 (대시보드와 결정 이력 화면이 함께 씁니다)
// 최근 6개월, 결정 넷을 쌓은 세로 막대. 건수는 v_chart_approval_monthly 가 냈습니다.

import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_TOKENS, SERIES_COLORS, STATUS_COLORS } from '@/lib/chart-colors';
import { formatValue, monthTick } from '@/lib/chart-format';
import { APPROVAL_DECISIONS, APPROVAL_DECISION_LABEL, type ApprovalDecision, type ApprovalMonthStack } from '@/lib/chart-model';
import { useSeriesToggle } from './_base/use-series-toggle';
import ChartTooltip from './_base/tooltip';

const DECISION_COLOR: Record<ApprovalDecision, string> = {
  APPROVED: STATUS_COLORS.SAFE,
  ADJUSTED: SERIES_COLORS[0],
  REJECTED: STATUS_COLORS.CRITICAL,
  DEFERRED: STATUS_COLORS.UNKNOWN,
};

export default function DecisionMonthly({
  stacks,
  href,
  height = 240,
}: {
  stacks: ApprovalMonthStack[];
  href: string | null;
  height?: number;
}) {
  const router = useRouter();
  const { toggle, visible } = useSeriesToggle(APPROVAL_DECISIONS);

  return (
    <>
      <div className="chart-legend" style={{ marginBottom: 'var(--s-3)' }}>
        {APPROVAL_DECISIONS.map((d) => (
          <button key={d} type="button" className="chart-legend-item" aria-pressed={visible(d)} onClick={() => toggle(d)}>
            <span className="chart-legend-swatch" style={{ background: DECISION_COLOR[d] }} />
            {APPROVAL_DECISION_LABEL[d]}
          </button>
        ))}
      </div>
      <div className={`chart-wrap${href ? ' chart-clickable' : ''}`} style={{ height: height - 36 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={stacks} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barCategoryGap="30%">
            <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" vertical={false} />
            <XAxis dataKey="month" tickFormatter={monthTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: CHART_TOKENS.grid }} />
            <YAxis allowDecimals={false} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
            {APPROVAL_DECISIONS.filter(visible).map((d) => (
              <Bar key={d} dataKey={d} name={APPROVAL_DECISION_LABEL[d]} stackId="dec" fill={DECISION_COLOR[d]} isAnimationActive={false} onClick={() => href && router.push(href)} />
            ))}
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.03)' }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const stack = payload[0].payload as ApprovalMonthStack;
                return (
                  <ChartTooltip
                    title={monthTick(String(label))}
                    rows={APPROVAL_DECISIONS.map((d) => ({ name: APPROVAL_DECISION_LABEL[d], value: formatValue(stack[d], 'count'), color: DECISION_COLOR[d] }))}
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
