'use client';

// 재고 전개 차트 — renew.prd 19장 · design.md §7.3
//
// 화면에서 recharts 를 직접 import 하지 않습니다. 이 폴더만 씁니다 (AGENTS.md 규칙 11).
//
// 여기서 계산하지 않습니다. 기초·입고·수요·기말은 analytics.v_inventory_projection 이
// 이미 계산한 값이고, 이 컴포넌트는 그것을 그리기만 합니다 (AGENTS.md 규칙 2).

import { useMemo } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Brush,
} from 'recharts';
import { CHART_TOKENS, SERIES_COLORS } from '@/lib/chart-colors';
import { brushProps } from './_base/period-brush';

export type ProjectionPoint = {
  /** YYYY-MM */
  period: string;
  opening: number | null;
  receipt: number | null;
  demand: number | null;
  closing: number | null;
};

const STOCK_COLOR = SERIES_COLORS[0];
const RECEIPT_COLOR = SERIES_COLORS[1];

function formatNumber(value: number) {
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);
}

const LABEL: Record<string, string> = {
  closing: '예상재고',
  receipt: '입고예정',
  demand: '적용수요',
};

/**
 * 오늘 + 리드타임 이 속한 달을 찾습니다.
 *
 * 지표 계산이 아니라 세로 안내선을 어느 눈금에 세울지 고르는 일입니다.
 * x축이 월 단위 범주라 라벨로 바꿔야 recharts 가 위치를 잡습니다.
 */
function leadTimeTick(periods: string[], leadTimeDays: number): string | null {
  const target = new Date();
  target.setDate(target.getDate() + leadTimeDays);
  const key = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`;
  return periods.includes(key) ? key : null;
}

export default function ProjectionChart({
  data,
  leadTimeDays = null,
  height = 320,
}: {
  data: ProjectionPoint[];
  /** 있으면 오늘 + 리드타임 위치에 세로 기준선을 세웁니다 */
  leadTimeDays?: number | null;
  height?: number;
}) {
  const periods = useMemo(() => data.map((point) => point.period), [data]);

  // 음수 구간 음영의 아래 끝. 차트 범위이지 지표가 아닙니다.
  const floorValue = useMemo(() => {
    const values = data
      .map((point) => point.closing)
      .filter((value): value is number => value !== null);
    const min = values.length === 0 ? 0 : Math.min(...values);
    return min < 0 ? min : 0;
  }, [data]);

  const leadTimeMark =
    leadTimeDays === null || leadTimeDays === undefined
      ? null
      : leadTimeTick(periods, leadTimeDays);

  const brush = brushProps(data.length);

  return (
    <>
      <div className="chart-legend" style={{ marginBottom: 'var(--s-4)' }}>
        <span className="chart-legend-item">
          <span className="chart-legend-swatch" style={{ background: STOCK_COLOR }} />
          예상재고
        </span>
        <span className="chart-legend-item">
          <span className="chart-legend-swatch" style={{ background: RECEIPT_COLOR }} />
          입고예정
        </span>
        <span className="chart-legend-item">
          <span className="chart-legend-swatch" style={{ background: CHART_TOKENS.deficitBand }} />
          결품 구간
        </span>
      </div>

      <div className="chart-wrap" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
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
              width={64}
            />

            {/* 0 아래는 결품입니다 (design.md §7.3) */}
            {floorValue < 0 && (
              <ReferenceArea
                y1={floorValue}
                y2={0}
                fill={CHART_TOKENS.deficitBand}
                strokeOpacity={0}
              />
            )}

            <ReferenceLine y={0} stroke={CHART_TOKENS.deficitLine} strokeDasharray="4 4" />

            {leadTimeMark && (
              <ReferenceLine
                x={leadTimeMark}
                stroke={CHART_TOKENS.markerLine}
                strokeDasharray="3 3"
                label={{ value: '리드타임', position: 'top', fill: CHART_TOKENS.axis, fontSize: 11 }}
              />
            )}

            <Bar dataKey="receipt" name="입고예정" fill={RECEIPT_COLOR} fillOpacity={0.35} barSize={22} />

            <Line
              type="monotone"
              dataKey="closing"
              name="예상재고"
              stroke={STOCK_COLOR}
              strokeWidth={2.5}
              dot={{ r: 3 }}
              isAnimationActive={false}
              connectNulls={false}
            />

            <Tooltip
              cursor={{ stroke: CHART_TOKENS.cursor, strokeDasharray: '3 3' }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0]?.payload as ProjectionPoint | undefined;
                return (
                  <div className="chart-annotation" style={{ borderRadius: 'var(--r-md)' }}>
                    <div style={{ marginBottom: 4, color: 'var(--text-3)' }}>{String(label)}</div>
                    {(['closing', 'receipt', 'demand'] as const).map((key) => {
                      const value = point?.[key];
                      return (
                        <div
                          key={key}
                          style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}
                        >
                          <span style={{ color: 'var(--text-3)' }}>{LABEL[key]}</span>
                          <b>{typeof value === 'number' ? formatNumber(value) : '—'}</b>
                        </div>
                      );
                    })}
                  </div>
                );
              }}
            />
            {/* 기간 브러시 — 점이 8개 이상일 때만 (spec §5) */}
            {brush && <Brush {...brush} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
