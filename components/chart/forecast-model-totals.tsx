'use client';

// 수요 예측 — 실행의 모델별 예측 합계 (spec §4.2)
// 합계는 v_forecast_run_model 이 냈습니다. 막대를 누르면 그 모델로 바꿉니다 (재조회만, 재실행 없음).

import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_TOKENS, colorMap } from '@/lib/chart-colors';
import { formatValue, qtyTick } from '@/lib/chart-format';
import { clickedPayload, fillHref } from './_base/click';
import ChartTooltip from './_base/tooltip';

export type ModelTotal = { modelId: string; label: string; totalQty: number | null; rows: number; items: number };

export default function ForecastModelTotals({
  models,
  activeModelId,
  hrefTemplate,
  height = 240,
}: {
  models: ModelTotal[];
  activeModelId: string | null;
  /** 이동 주소 템플릿. {id} 가 품목·공급처·모델 ID 로 치환됩니다 (서버는 함수를 넘길 수 없습니다) */
  hrefTemplate: string;
  height?: number;
}) {
  const router = useRouter();
  const colors = colorMap(models.map((m) => m.modelId));
  const data = models.map((m) => ({ ...m, tag: m.modelId === activeModelId ? '선택' : '' }));
  return (
    <div className="chart-wrap chart-clickable" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
          <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: CHART_TOKENS.grid }} interval={0} />
          <YAxis tickFormatter={qtyTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
          <Bar dataKey="totalQty" name="예측 합계" isAnimationActive={false} radius={[4, 4, 0, 0]} onClick={(entry) => { const m = clickedPayload<ModelTotal>(entry); if (m) router.push(fillHref(hrefTemplate, m.modelId)); }}>
            {data.map((m) => (
              <Cell key={m.modelId} fill={colors[m.modelId]} fillOpacity={activeModelId === null || m.modelId === activeModelId ? 1 : 0.35} stroke={m.modelId === activeModelId ? CHART_TOKENS.markerLine : 'none'} />
            ))}
            <LabelList dataKey="tag" position="top" fill={CHART_TOKENS.axis} fontSize={10} />
          </Bar>
          <Tooltip
            cursor={{ fill: 'rgba(0,0,0,0.03)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const m = payload[0].payload as ModelTotal;
              return (
                <ChartTooltip
                  title={m.label}
                  rows={[
                    { name: '예측 합계', value: formatValue(m.totalQty, 'qty'), color: colors[m.modelId] },
                    { name: '품목', value: `${m.items}개` },
                    { name: '행', value: formatValue(m.rows, 'count') },
                  ]}
                />
              );
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
