'use client';

// 다중 모델 Overlay 차트 — renew.prd 16.2 · design.md §7
//
// 화면에서 recharts 를 직접 import 하지 않습니다. 이 폴더만 씁니다 (AGENTS.md 규칙 11).
//
// 여기서 계산하지 않습니다. 이미 계산된 값을 받아 그리기만 합니다 (AGENTS.md 규칙 2).
//
// ★ 모델을 켜고 끄면 재조회 없이 즉시 갱신됩니다 (renew.prd 16.5).
//   실행 시점에 모든 모델 결과를 저장해 두었기 때문에 가능합니다.

import { useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ACTUAL_COLOR, CHART_TOKENS, colorMap } from '@/lib/chart-colors';

export type SeriesPoint = {
  /** YYYY-MM */
  period: string;
  /** 실적. 미래 구간에는 없습니다 */
  actual: number | null;
  /** 모델 ID → 예측값 */
  forecast: Record<string, number | null>;
  /** 선택된 모델의 예측구간 */
  p80?: number | null;
  p90?: number | null;
  /** 검증 구간인가 */
  isTest: boolean;
};

export type SeriesModel = { modelId: string; label: string; isChampion?: boolean };

function formatNumber(value: number) {
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);
}

export default function ForecastOverlayChart({
  data,
  models,
  bandModelId,
  height = 340,
}: {
  data: SeriesPoint[];
  models: SeriesModel[];
  /** 예측구간 밴드를 그릴 모델. 없으면 밴드를 그리지 않습니다 */
  bandModelId?: string | null;
  height?: number;
}) {
  const colors = useMemo(() => colorMap(models.map((m) => m.modelId)), [models]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showActual, setShowActual] = useState(true);

  const toggle = (modelId: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });

  // 검증 구간의 시작과 끝. ReferenceArea 로 음영을 칠합니다.
  const testRange = useMemo(() => {
    const testPoints = data.filter((point) => point.isTest);
    if (testPoints.length === 0) return null;
    return { from: testPoints[0].period, to: testPoints[testPoints.length - 1].period };
  }, [data]);

  // recharts 는 평평한 객체를 원합니다. 모델별 값을 위로 펼칩니다.
  const rows = useMemo(
    () =>
      data.map((point) => {
        const flat: Record<string, unknown> = {
          period: point.period,
          actual: point.actual,
          // 밴드는 [하한, 상한] 배열로 그립니다
          band80:
            point.p80 != null && point.forecast[bandModelId ?? ''] != null
              ? [point.forecast[bandModelId ?? ''], point.p80]
              : null,
          band90:
            point.p90 != null && point.forecast[bandModelId ?? ''] != null
              ? [point.forecast[bandModelId ?? ''], point.p90]
              : null,
        };
        for (const [modelId, value] of Object.entries(point.forecast)) flat[modelId] = value;
        return flat;
      }),
    [data, bandModelId],
  );

  return (
    <>
      <div className="chart-legend" style={{ marginBottom: 'var(--s-4)' }}>
        <button
          type="button"
          className="chart-legend-item"
          aria-pressed={showActual}
          onClick={() => setShowActual((prev) => !prev)}
        >
          <span className="chart-legend-swatch" style={{ background: ACTUAL_COLOR }} />
          실적
        </button>
        {models.map((model) => {
          const visible = !hidden.has(model.modelId);
          return (
            <button
              key={model.modelId}
              type="button"
              className="chart-legend-item"
              aria-pressed={visible}
              onClick={() => toggle(model.modelId)}
            >
              <span
                className="chart-legend-swatch"
                style={{ background: colors[model.modelId] }}
              />
              {model.label}
              {model.isChampion && <span className="badge safe">Champion</span>}
            </button>
          );
        })}
      </div>

      <div className="chart-wrap" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            {/* 가로선만 긋습니다 (design.md §7.1) */}
            <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" vertical={false} />
            <XAxis
              dataKey="period"
              tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: CHART_TOKENS.grid }}
            />
            <YAxis
              tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={56}
            />

            {/* 검증 구간 음영 — renew.prd 16.2 */}
            {testRange && (
              <ReferenceArea
                x1={testRange.from}
                x2={testRange.to}
                fill={CHART_TOKENS.validationBand}
                strokeOpacity={0}
              />
            )}

            {/* 예측구간 밴드. 넓을수록 그 모델이 자주 빗나갔다는 뜻입니다 */}
            {bandModelId && !hidden.has(bandModelId) && (
              <>
                <Area
                  dataKey="band90"
                  fill={colors[bandModelId]}
                  fillOpacity={0.06}
                  stroke="none"
                  isAnimationActive={false}
                  connectNulls
                />
                <Area
                  dataKey="band80"
                  fill={colors[bandModelId]}
                  fillOpacity={0.12}
                  stroke="none"
                  isAnimationActive={false}
                  connectNulls
                />
              </>
            )}

            {models.map((model) =>
              hidden.has(model.modelId) ? null : (
                <Line
                  key={model.modelId}
                  type="monotone"
                  dataKey={model.modelId}
                  name={model.label}
                  stroke={colors[model.modelId]}
                  strokeWidth={2}
                  // 미래 예측은 파선입니다 (design.md §7.3)
                  strokeDasharray="4 4"
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              ),
            )}

            {/* 실적은 항상 가장 진하고 굵게. 실선입니다 */}
            {showActual && (
              <Line
                type="monotone"
                dataKey="actual"
                name="실적"
                stroke={ACTUAL_COLOR}
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}

            <Tooltip
              cursor={{ stroke: CHART_TOKENS.cursor, strokeDasharray: '3 3' }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="chart-annotation" style={{ borderRadius: 'var(--r-md)' }}>
                    <div style={{ marginBottom: 4, color: 'var(--text-3)' }}>{String(label)}</div>
                    {payload
                      .filter((entry) => entry.dataKey !== 'band80' && entry.dataKey !== 'band90')
                      .map((entry) => (
                        <div
                          key={String(entry.dataKey)}
                          style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}
                        >
                          <span style={{ color: entry.color }}>{entry.name}</span>
                          <b>{typeof entry.value === 'number' ? formatNumber(entry.value) : '—'}</b>
                        </div>
                      ))}
                  </div>
                );
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
