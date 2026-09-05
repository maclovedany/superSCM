'use client';

// 판매 — 공급 상태별 품목 수 (spec §4.3). 값은 v_chart_sales_status 가 냈습니다.

import { useRouter } from 'next/navigation';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { STATUS_COLORS } from '@/lib/chart-colors';
import { formatValue } from '@/lib/chart-format';
import type { SalesStatusSlice } from '@/lib/chart-model';
import ChartTooltip from './_base/tooltip';

function statusColor(status: string): string {
  if (status === '불가') return STATUS_COLORS.CRITICAL;
  if (status === '주의') return STATUS_COLORS.WARNING;
  if (status === '가능') return STATUS_COLORS.SAFE;
  return STATUS_COLORS.UNKNOWN;
}

export default function SalesStatusMix({ slices, hrefs = {}, height = 240 }: { slices: SalesStatusSlice[]; /** 키 → 이동 주소. 없는 키는 누를 수 없습니다 (서버는 함수를 넘길 수 없어 맵으로 받습니다) */
  hrefs?: Partial<Record<string, string>>; height?: number }) {
  const router = useRouter();
  const row: Record<string, number | string> = { name: '품목' };
  for (const s of slices) row[s.status] = s.nItems;
  const total = slices.reduce((sum, s) => sum + s.nItems, 0);
  const go = (status: string) => { const href = hrefs[status]; if (href) router.push(href); };
  return (
    <div style={{ height, display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
      <div className="chart-wrap chart-clickable" style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={[row]} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barSize={36}>
            <XAxis type="number" hide domain={[0, Math.max(total, 1)]} />
            <YAxis type="category" dataKey="name" hide />
            {slices.map((s) => (<Bar key={s.status} dataKey={s.status} name={s.status} stackId="mix" fill={statusColor(s.status)} isAnimationActive={false} onClick={() => go(s.status)} />))}
            <Tooltip cursor={false} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              return <ChartTooltip title={`전체 ${total}개 품목`} rows={payload.map((e) => ({ name: String(e.name), value: `${typeof e.value === 'number' ? e.value : 0}개`, color: String(e.color) }))} />;
            }} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-legend">
        {slices.map((s) => {
          const href = hrefs[s.status];
          const inner = (<><span className="chart-legend-swatch" style={{ background: statusColor(s.status) }} />{s.status} <b>{formatValue(s.nItems, 'count').replace('건', '개')}</b></>);
          return href ? <button key={s.status} type="button" className="chart-legend-item" onClick={() => go(s.status)}>{inner}</button> : <span key={s.status} className="chart-legend-item">{inner}</span>;
        })}
      </div>
    </div>
  );
}
