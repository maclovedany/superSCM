'use client';

// 스파크라인 — design.md §7 · step.md §4.1 목록의 마지막 차트
//
// 표 한 칸에 들어가는 소형 선입니다. 축도 눈금도 범례도 없습니다 —
// "이 품목의 수요가 어느 쪽으로 가고 있나" 만 보여 주고, 숫자는 옆 칸이 말합니다.
//
// 화면에서 recharts 를 직접 import 하지 않습니다. 이 폴더만 씁니다 (AGENTS.md 규칙 11).
//
// 여기서 계산하지 않습니다. 실적은 core.v_usage_monthly, 예측은 core.v_consensus_forecast 가
// 이미 만든 값이고(analytics.v_dashboard_sparkline), 이 컴포넌트는 그리기만 합니다.

import { useMemo } from 'react';
import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts';
import { ACTUAL_COLOR, SERIES_COLORS } from '@/lib/chart-colors';

const FORECAST_COLOR = SERIES_COLORS[0];

export type SparklineDatum = {
  /** YYYY-MM-DD 또는 YYYY-MM */
  period: string;
  qty: number | null;
  kind: 'ACTUAL' | 'FORECAST';
};

type Row = {
  period: string;
  actual: number | null;
  forecast: number | null;
};

/**
 * 기간별로 두 시리즈를 나란히 놓습니다. 계산이 아니라 recharts 가 요구하는 모양으로
 * 옮겨 담는 일입니다 (projection-chart 와 같은 방식).
 *
 * ★ 마지막 실적 값을 예측 시리즈의 시작점으로도 넣습니다.
 *   그러지 않으면 실선과 파선 사이가 끊겨 "예측이 다른 높이에서 갑자기 시작" 한 것처럼 보입니다.
 *   값을 지어내는 것이 아니라 이미 있는 실적 한 점을 두 선이 공유하는 것입니다.
 */
function toRows(data: SparklineDatum[]): Row[] {
  const byPeriod = new Map<string, Row>();
  const periods: string[] = [];

  for (const point of data) {
    let row = byPeriod.get(point.period);
    if (row === undefined) {
      row = { period: point.period, actual: null, forecast: null };
      byPeriod.set(point.period, row);
      periods.push(point.period);
    }
    if (point.kind === 'ACTUAL') row.actual = point.qty;
    else row.forecast = point.qty;
  }

  periods.sort();
  const rows = periods.map((period) => byPeriod.get(period) as Row);

  const lastActualIndex = rows.reduce(
    (found, row, index) => (row.actual === null ? found : index),
    -1,
  );
  if (lastActualIndex >= 0 && rows[lastActualIndex].forecast === null) {
    rows[lastActualIndex] = { ...rows[lastActualIndex], forecast: rows[lastActualIndex].actual };
  }

  return rows;
}

export default function Sparkline({
  data,
  label,
}: {
  data: SparklineDatum[];
  /** 스크린리더용 설명. 선만으로는 무엇의 추이인지 알 수 없습니다 (design.md §10) */
  label?: string;
}) {
  const rows = useMemo(() => toRows(data), [data]);

  // 점이 하나뿐이면 선이 그려지지 않습니다. 빈 칸을 두는 편이 낫습니다.
  if (rows.length < 2) return null;

  return (
    <div className="sparkline" role="img" aria-label={label ?? '수요 추이'}>
      <ResponsiveContainer width="100%" height={36}>
        <LineChart data={rows} margin={{ top: 3, right: 2, bottom: 3, left: 2 }}>
          {/* 축은 그리지 않지만, 두 시리즈가 같은 눈금을 쓰도록 도메인만 잡아 둡니다 */}
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Line
            type="monotone"
            dataKey="actual"
            stroke={ACTUAL_COLOR}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="forecast"
            stroke={FORECAST_COLOR}
            strokeWidth={1.5}
            strokeDasharray="3 3"
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
