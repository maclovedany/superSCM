'use client';

// 수요 프로파일 — CV² × ADI 사분면 산점도 (spec §4.2)
// Syntetos-Boylan 경계선(ADI 1.32 · CV² 0.49)으로 네 칸을 나눕니다. 값은 v_sku_demand_profile 이 냈습니다.

import { useRouter } from 'next/navigation';
import { CartesianGrid, Cell, Label, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_TOKENS, SERIES_COLORS, STATUS_COLORS } from '@/lib/chart-colors';
import { QUADRANT_ADI, QUADRANT_CV2, type QuadrantPoint } from '@/lib/chart-model';
import { clickedPayload } from './_base/click';
import ChartTooltip from './_base/tooltip';

export const DEMAND_TYPE_COLOR: Record<string, string> = {
  SMOOTH: STATUS_COLORS.SAFE,
  INTERMITTENT: SERIES_COLORS[0],
  ERRATIC: SERIES_COLORS[3],
  LUMPY: SERIES_COLORS[2],
  NO_DEMAND: STATUS_COLORS.UNKNOWN,
};

const TYPE_LABEL: Record<string, string> = {
  SMOOTH: '평활', INTERMITTENT: '간헐', ERRATIC: '불규칙', LUMPY: '덩어리', NO_DEMAND: '수요 없음',
};

export default function DemandQuadrant({
  points,
  hrefFor,
  height = 240,
}: {
  points: QuadrantPoint[];
  hrefFor: (itemId: string) => string;
  height?: number;
}) {
  const router = useRouter();
  return (
    <>
      <div className="chart-legend" style={{ marginBottom: 'var(--s-3)' }}>
        {Object.keys(TYPE_LABEL).map((key) => (
          <span key={key} className="chart-legend-item">
            <span className="chart-legend-swatch" style={{ background: DEMAND_TYPE_COLOR[key] }} />
            {TYPE_LABEL[key]}
          </span>
        ))}
      </div>
      <div className="chart-wrap chart-clickable" style={{ height: height - 36 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" vertical={false} />
            <XAxis type="number" dataKey="adi" name="ADI" tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: CHART_TOKENS.grid }}>
              <Label value="ADI (평균 수요 간격)" position="insideBottomRight" offset={-2} fill={CHART_TOKENS.axis} fontSize={11} />
            </XAxis>
            <YAxis type="number" dataKey="cv2" name="CV²" tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={44}>
              <Label value="CV²" position="insideTopLeft" fill={CHART_TOKENS.axis} fontSize={11} />
            </YAxis>
            <ReferenceLine x={QUADRANT_ADI} stroke={CHART_TOKENS.markerLine} strokeDasharray="3 3">
              <Label value="ADI 1.32" position="insideTopRight" fill={CHART_TOKENS.axis} fontSize={10} />
            </ReferenceLine>
            <ReferenceLine y={QUADRANT_CV2} stroke={CHART_TOKENS.markerLine} strokeDasharray="3 3">
              <Label value="CV² 0.49" position="insideBottomRight" fill={CHART_TOKENS.axis} fontSize={10} />
            </ReferenceLine>
            <Scatter data={points} isAnimationActive={false} onClick={(entry) => { const p = clickedPayload<QuadrantPoint>(entry); if (p) router.push(hrefFor(p.itemId)); }}>
              {points.map((p) => (
                <Cell key={p.itemId} fill={DEMAND_TYPE_COLOR[p.demandType ?? ''] ?? STATUS_COLORS.UNKNOWN} fillOpacity={0.85} />
              ))}
            </Scatter>
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as QuadrantPoint;
                return (
                  <ChartTooltip
                    title={p.label}
                    rows={[
                      { name: 'ADI', value: p.adi.toFixed(2) },
                      { name: 'CV²', value: p.cv2.toFixed(2) },
                      { name: '유형', value: TYPE_LABEL[p.demandType ?? ''] ?? '판정 불가', color: DEMAND_TYPE_COLOR[p.demandType ?? ''] },
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
