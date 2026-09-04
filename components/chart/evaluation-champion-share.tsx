'use client';

// 모델 평가 — 모델별 Champion 점유 (spec §4.2)
// 가로 스택 한 줄. 건수는 v_chart_champion_share 가 냈습니다.

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { colorMap } from '@/lib/chart-colors';
import { formatValue } from '@/lib/chart-format';
import type { ChampionShareRow } from '@/lib/chart-model';
import ChartTooltip from './_base/tooltip';

export default function EvaluationChampionShare({ rows, height = 240 }: { rows: ChampionShareRow[]; height?: number }) {
  const colors = colorMap(rows.map((r) => r.modelId));
  const row: Record<string, number | string> = { name: 'Champion' };
  for (const r of rows) row[r.modelId] = r.nItems;
  const total = rows.reduce((sum, r) => sum + r.nItems, 0);
  return (
    <div style={{ height, display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
      <div className="chart-wrap" style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={[row]} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barSize={36}>
            <XAxis type="number" hide domain={[0, Math.max(total, 1)]} />
            <YAxis type="category" dataKey="name" hide />
            {rows.map((r) => (
              <Bar key={r.modelId} dataKey={r.modelId} name={r.modelName ?? r.modelId} stackId="share" fill={colors[r.modelId]} isAnimationActive={false} />
            ))}
            <Tooltip
              cursor={false}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                return (
                  <ChartTooltip
                    title={`Champion 품목 ${total}개`}
                    rows={rows.map((r) => ({ name: r.modelName ?? r.modelId, value: `${r.nItems}개${r.nManual > 0 ? ` (수동 ${r.nManual})` : ''}`, color: colors[r.modelId] }))}
                  />
                );
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-legend">
        {rows.map((r) => (
          <span key={r.modelId} className="chart-legend-item">
            <span className="chart-legend-swatch" style={{ background: colors[r.modelId] }} />
            {r.modelName ?? r.modelId} <b>{r.nItems}</b>
            {r.avgWape !== null && <span className="text-3">WAPE {formatValue(r.avgWape, 'pct')}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
