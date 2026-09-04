'use client';

// 예측 보정 — AI 오차 vs Consensus 오차 산점도 (Plan B 의 스펙 변경 — 기간별 선 대신)
// 대각선 아래 = 보정이 AI 보다 맞음. 값은 v_forecast_value_add 행 그대로입니다.

import { CartesianGrid, Cell, Label, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_TOKENS, STATUS_COLORS } from '@/lib/chart-colors';
import { formatValue, qtyTick } from '@/lib/chart-format';
import type { ErrorPoint } from '@/lib/chart-model';
import ChartTooltip from './_base/tooltip';

function color(improved: boolean | null): string {
  if (improved === true) return STATUS_COLORS.SAFE;
  if (improved === false) return STATUS_COLORS.CRITICAL;
  return STATUS_COLORS.UNKNOWN;
}

export default function OverrideErrorScatter({ points, height = 240 }: { points: ErrorPoint[]; height?: number }) {
  const max = points.reduce((m, p) => Math.max(m, p.aiError, p.consensusError), 0);
  return (
    <>
      <div className="chart-legend" style={{ marginBottom: 'var(--s-3)' }}>
        <span className="chart-legend-item"><span className="chart-legend-swatch" style={{ background: STATUS_COLORS.SAFE }} />보정이 더 맞음</span>
        <span className="chart-legend-item"><span className="chart-legend-swatch" style={{ background: STATUS_COLORS.CRITICAL }} />AI 가 더 맞음</span>
        <span className="chart-legend-item"><span className="chart-legend-swatch" style={{ background: STATUS_COLORS.UNKNOWN }} />판정 없음</span>
      </div>
      <div className="chart-wrap" style={{ height: height - 36 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" vertical={false} />
            <XAxis type="number" dataKey="aiError" name="AI 오차" tickFormatter={qtyTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: CHART_TOKENS.grid }} domain={[0, max]}>
              <Label value="AI 절대 오차" position="insideBottomRight" offset={-2} fill={CHART_TOKENS.axis} fontSize={11} />
            </XAxis>
            <YAxis type="number" dataKey="consensusError" name="Consensus 오차" tickFormatter={qtyTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={48} domain={[0, max]}>
              <Label value="Consensus 절대 오차" position="insideTopLeft" fill={CHART_TOKENS.axis} fontSize={11} />
            </YAxis>
            {max > 0 && <ReferenceLine segment={[{ x: 0, y: 0 }, { x: max, y: max }]} stroke={CHART_TOKENS.markerLine} strokeDasharray="3 3" />}
            <Scatter data={points} isAnimationActive={false}>
              {points.map((p) => (<Cell key={`${p.itemId}-${p.period}`} fill={color(p.improved)} fillOpacity={0.8} />))}
            </Scatter>
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as ErrorPoint;
                return (
                  <ChartTooltip
                    title={`${p.itemId} · ${p.period}`}
                    rows={[
                      { name: 'AI 절대 오차', value: formatValue(p.aiError, 'qty') },
                      { name: 'Consensus 절대 오차', value: formatValue(p.consensusError, 'qty') },
                      { name: '판정', value: p.improved === null ? '—' : p.improved ? '보정이 더 맞음' : 'AI 가 더 맞음', color: color(p.improved) },
                    ]}
                  />
                );
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
