// 자리 ①  수요 실적 vs 예측 + p80/p90 밴드 — analytics.v_demand_series
//
// ★ 계열이 넷이고 **각각 독립적으로 끊긴다**: 실적선 · 예측선 · p80 밴드 · p90 밴드.
//   뷰가 사유 코드를 세 개로 나눠 둔 이유가 그것이다(실적 결측 / 예측 결측 / 밴드만 결측).
//   한 계열의 결측을 다른 계열로 메우면 그 구분이 화면에서 사라진다.
// ★ p80·p90 은 예측값(p50) **위쪽** 분위수다(실측 2026-09-13: 246 < 275.02 < 290.19).
//   그래서 밴드는 예측선과 각 분위수 사이의 영역이고, 예측값이 없으면 밴드도 없다.

import {
  extent,
  monthRange,
  pairedSegments,
  segments,
  toYm,
  type Nullable,
  type PairedSegment,
  type Segment,
} from './geometry.ts';
import { chartReasonLabel } from './reason-labels.ts';
import type { DemandSeriesPoint } from '../analytics/model.ts';

/** 빈자리 하나의 설명 — 어느 달이 왜 비었는가. */
export type ReasonSpan = { code: string; label: string; months: string[] };

export type DemandSeriesChart = {
  itemId: string;
  itemName: string;
  /** 빠짐없는 월 축(YYYY-MM) */
  months: string[];
  actual: Nullable[];
  predicted: Nullable[];
  p80: Nullable[];
  p90: Nullable[];
  actualSegments: Segment[];
  predictedSegments: Segment[];
  /** 예측선과 p80 사이 — 예측과 p80 이 **둘 다** 있는 자리만 */
  p80Band: PairedSegment[];
  /** 예측선과 p90 사이 — p80 과 **독립적으로** 끊긴다 */
  p90Band: PairedSegment[];
  valueRange: { min: number; max: number } | null;
  /** 실적이 없는 달의 설명 */
  actualReasons: ReasonSpan[];
  /** 예측이 없는 달의 설명 */
  predictedReasons: ReasonSpan[];
  /** 밴드가 없는 달의 설명 — 예측이 없어서인지, 밴드만 없어서인지를 구분한다 */
  bandReasons: ReasonSpan[];
};

/** 사유 코드별로 달을 모은다 — 값이 있는 달(코드 null)은 설명이 없다. */
function collectReasons(months: readonly string[], codes: readonly (string | null)[]): ReasonSpan[] {
  const byCode = new Map<string, string[]>();
  for (let index = 0; index < months.length; index += 1) {
    const code = codes[index] ?? null;
    if (code === null) continue;
    const bucket = byCode.get(code);
    if (bucket === undefined) byCode.set(code, [months[index]]);
    else bucket.push(months[index]);
  }
  return Array.from(byCode.entries()).map(([code, monthList]) => ({
    code,
    label: chartReasonLabel(code) ?? code,
    months: monthList,
  }));
}

/**
 * 품목 하나의 차트 모델. 그 품목의 행이 없으면 null 이다 — 빈 축을 그리지 않기 위해서다.
 *
 * ★ 값을 지어내지 않는다: 실적·예측·p80·p90 중 없는 것은 null 로 남기고, 사유 코드는 뷰가 준
 *   것을 그대로 옮긴다. 0 으로 채우거나 앞 값을 끌어오지 않는다.
 */
export function buildDemandSeriesChart(
  points: readonly DemandSeriesPoint[],
  itemId: string,
): DemandSeriesChart | null {
  const mine = points.filter((point) => point.itemId === itemId && point.period !== '');
  if (mine.length === 0) return null;

  const sorted = [...mine].sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
  const months = monthRange(sorted[0].period, sorted[sorted.length - 1].period);
  if (months.length === 0) return null;

  const byMonth = new Map<string, DemandSeriesPoint>();
  for (const point of sorted) byMonth.set(toYm(point.period), point);

  const pick = <T,>(read: (point: DemandSeriesPoint) => T, fallback: T): T[] =>
    months.map((month) => {
      const point = byMonth.get(month);
      return point === undefined ? fallback : read(point);
    });

  const actual = pick<Nullable>((point) => point.actualQty, null);
  const predicted = pick<Nullable>((point) => point.predictedQty, null);
  const p80 = pick<Nullable>((point) => point.p80, null);
  const p90 = pick<Nullable>((point) => point.p90, null);

  return {
    itemId,
    itemName: sorted[0].itemName,
    months,
    actual,
    predicted,
    p80,
    p90,
    actualSegments: segments(actual),
    predictedSegments: segments(predicted),
    // ★ 두 밴드를 따로 만든다. p80 만 있고 p90 이 없는 달(또는 그 반대)에 한쪽이 다른 쪽을
    //   대신 이어 주면, 있지도 않은 구간을 그리게 된다.
    p80Band: pairedSegments(p80, predicted),
    p90Band: pairedSegments(p90, predicted),
    valueRange: extent(actual, predicted, p80, p90),
    actualReasons: collectReasons(
      months,
      pick<string | null>((point) => point.actualReasonCode, null),
    ),
    predictedReasons: collectReasons(
      months,
      pick<string | null>((point) => point.predictedReasonCode, null),
    ),
    bandReasons: collectReasons(
      months,
      pick<string | null>((point) => point.bandReasonCode, null),
    ),
  };
}

/** 차트에 올릴 수 있는 품목 목록 — 행이 있는 품목만. */
export function demandSeriesItems(points: readonly DemandSeriesPoint[]): { itemId: string; itemName: string }[] {
  const byId = new Map<string, string>();
  for (const point of points) if (!byId.has(point.itemId)) byId.set(point.itemId, point.itemName);
  return Array.from(byId.entries())
    .map(([itemId, itemName]) => ({ itemId, itemName }))
    .sort((a, b) => (a.itemId < b.itemId ? -1 : 1));
}
