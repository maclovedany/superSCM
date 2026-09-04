'use client';

// 수요 프로파일 — 수요 유형 분포 (spec §4.2)
// 여섯 건수를 가로 스택 한 줄로. 건수는 v_demand_profile_kpi 가 냈습니다.

import { useRouter } from 'next/navigation';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { STATUS_COLORS } from '@/lib/chart-colors';
import { formatValue } from '@/lib/chart-format';
import type { DemandTypeKey, DemandTypeSlice } from '@/lib/chart-model';
import { DEMAND_TYPE_COLOR } from './demand-quadrant';
import ChartTooltip from './_base/tooltip';

const COLOR: Record<DemandTypeKey, string> = {
  SMOOTH: DEMAND_TYPE_COLOR.SMOOTH,
  INTERMITTENT: DEMAND_TYPE_COLOR.INTERMITTENT,
  ERRATIC: DEMAND_TYPE_COLOR.ERRATIC,
  LUMPY: DEMAND_TYPE_COLOR.LUMPY,
  NO_DEMAND: DEMAND_TYPE_COLOR.NO_DEMAND,
  UNCLASSIFIED: STATUS_COLORS.UNKNOWN,
};

export default function DemandTypeMix({
  slices,
  hrefFor,
  height = 240,
}: {
  slices: DemandTypeSlice[];
  hrefFor: (key: DemandTypeKey) => string | null;
  height?: number;
}) {
  const router = useRouter();
  const row: Record<string, number | string> = { name: '품목' };
  for (const s of slices) row[s.key] = s.n;
  const total = slices.reduce((sum, s) => sum + s.n, 0);
  const go = (key: DemandTypeKey) => { const href = hrefFor(key); if (href) router.push(href); };

  return (
    <div style={{ height, display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
      <div className="chart-wrap chart-clickable" style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={[row]} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barSize={36}>
            <XAxis type="number" hide domain={[0, Math.max(total, 1)]} />
            <YAxis type="category" dataKey="name" hide />
            {slices.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} stackId="mix" fill={COLOR[s.key]} isAnimationActive={false} onClick={() => go(s.key)} />
            ))}
            <Tooltip
              cursor={false}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                return (
                  <ChartTooltip
                    title={`전체 ${formatValue(total, 'count')}`}
                    rows={payload.map((e) => ({ name: String(e.name), value: formatValue(typeof e.value === 'number' ? e.value : null, 'count'), color: String(e.color) }))}
                  />
                );
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-legend">
        {slices.map((s) => {
          const href = hrefFor(s.key);
          const inner = (<><span className="chart-legend-swatch" style={{ background: COLOR[s.key] }} />{s.label} <b>{s.n}</b></>);
          return href ? (
            <button key={s.key} type="button" className="chart-legend-item" onClick={() => go(s.key)}>{inner}</button>
          ) : (
            <span key={s.key} className="chart-legend-item">{inner}</span>
          );
        })}
      </div>
    </div>
  );
}
