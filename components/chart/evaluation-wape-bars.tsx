'use client';

// 모델 평가 — 품목별 Champion WAPE (spec §4.2)
// 부정확한 품목이 위. 수동 지정은 옅게 그리고 "수동" 을 적습니다. 값은 v_champion_model 이 냈습니다.

import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_TOKENS, SERIES_COLORS } from '@/lib/chart-colors';
import { formatValue, pctTick } from '@/lib/chart-format';
import type { WapeBar } from '@/lib/chart-model';
import { clickedPayload, fillHref } from './_base/click';
import ChartTooltip from './_base/tooltip';

export default function EvaluationWapeBars({
  bars,
  hrefTemplate,
  limit = 20,
  height = 240,
}: {
  bars: WapeBar[];
  /** 이동 주소 템플릿. {id} 가 품목·공급처·모델 ID 로 치환됩니다 (서버는 함수를 넘길 수 없습니다) */
  hrefTemplate: string;
  limit?: number;
  height?: number;
}) {
  const router = useRouter();
  const data = bars.filter((b) => b.wape !== null).slice(0, limit).map((b) => ({ ...b, tag: b.manual ? '수동' : '' }));
  return (
    <div className="chart-wrap chart-clickable" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, bottom: 0, left: 8 }} barCategoryGap={4}>
          <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" horizontal={false} />
          <XAxis type="number" tickFormatter={pctTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="label" width={96} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
          <Bar dataKey="wape" name="WAPE" isAnimationActive={false} radius={[0, 3, 3, 0]} onClick={(entry) => { const b = clickedPayload<WapeBar>(entry); if (b) router.push(fillHref(hrefTemplate, b.itemId)); }}>
            {data.map((b) => (<Cell key={b.itemId} fill={SERIES_COLORS[0]} fillOpacity={b.manual ? 0.45 : 1} />))}
            <LabelList dataKey="tag" position="right" fill={CHART_TOKENS.axis} fontSize={10} />
          </Bar>
          <Tooltip
            cursor={{ fill: 'rgba(0,0,0,0.03)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const b = payload[0].payload as WapeBar;
              return (
                <ChartTooltip
                  title={b.label}
                  rows={[
                    { name: 'WAPE', value: formatValue(b.wape, 'pct') },
                    { name: 'Champion', value: `${b.modelName ?? '—'}${b.manual ? ' (수동)' : ''}` },
                    { name: '베이스라인 대비', value: b.improvement === null ? '—' : `${b.improvement > 0 ? '+' : ''}${pctTick(b.improvement)}` },
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
