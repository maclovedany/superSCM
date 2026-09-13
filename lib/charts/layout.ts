// 차트 배치 — 크기·여백에서 좌표 함수를 만든다. 여기까지가 lib(시험되는 자리)이고,
// components/charts/* 는 이 값을 받아 그리기만 한다.
//
// ★ 컴포넌트 안에서 좌표를 계산하면 시험되지 않는다(npm test 는 lib/**/*.test.ts 만 돈다).
// ★ 값 범위가 없으면(전부 결측) Plot 을 만들지 않는다 — 빈 축을 그릴 근거가 없기 때문이다.

import { niceTicks } from './geometry.ts';

export type Margin = { top: number; right: number; bottom: number; left: number };

export type Plot = {
  width: number;
  height: number;
  margin: Margin;
  innerWidth: number;
  innerHeight: number;
  /** x 슬롯 개수(월 수 · 막대 그룹 수) */
  count: number;
  /** 슬롯 하나의 너비 */
  bandWidth: number;
  /** 슬롯 가운데 x */
  x(index: number): number;
  /** 슬롯 왼쪽 끝 x */
  xStart(index: number): number;
  y(value: number): number;
  min: number;
  max: number;
  ticks: number[];
};

export const DEFAULT_MARGIN: Margin = { top: 12, right: 12, bottom: 28, left: 48 };

/**
 * 값 범위를 눈금에 맞춰 넓힌다.
 *
 * ★ `includeZero` 는 부르는 쪽이 정한다. 막대는 길이가 곧 크기라 0 에서 시작하지 않으면
 *   거짓이 되고, 선은 0 을 강요하면 변화가 안 보인다 — 같은 규칙을 둘에 함께 쓸 수 없다.
 */
export function niceDomain(
  range: { min: number; max: number } | null,
  options: { includeZero?: boolean; tickCount?: number } = {},
): { min: number; max: number; ticks: number[] } | null {
  if (range === null) return null;
  const includeZero = options.includeZero ?? false;

  let min = includeZero ? Math.min(0, range.min) : range.min;
  let max = includeZero ? Math.max(0, range.max) : range.max;

  if (min === max) {
    // 값이 하나뿐이거나 전부 같다 — 0 을 기준으로 폭을 준다(선이 축에 붙어 사라지지 않게).
    if (min === 0) return { min: 0, max: 1, ticks: [0, 1] };
    min = Math.min(0, min);
    max = Math.max(0, max);
  }

  const ticks = niceTicks(min, max, options.tickCount ?? 5);
  if (ticks.length === 0) return { min, max, ticks: [min, max] };
  return { min: Math.min(min, ticks[0]), max: Math.max(max, ticks[ticks.length - 1]), ticks };
}

export function createPlot(options: {
  width: number;
  height: number;
  count: number;
  range: { min: number; max: number } | null;
  margin?: Margin;
  includeZero?: boolean;
  tickCount?: number;
}): Plot | null {
  const domain = niceDomain(options.range, {
    includeZero: options.includeZero,
    tickCount: options.tickCount,
  });
  if (domain === null || options.count <= 0) return null;

  const margin = options.margin ?? DEFAULT_MARGIN;
  const innerWidth = Math.max(0, options.width - margin.left - margin.right);
  const innerHeight = Math.max(0, options.height - margin.top - margin.bottom);
  const bandWidth = innerWidth / options.count;
  const span = domain.max - domain.min;

  return {
    width: options.width,
    height: options.height,
    margin,
    innerWidth,
    innerHeight,
    count: options.count,
    bandWidth,
    xStart: (index: number) => margin.left + bandWidth * index,
    x: (index: number) => margin.left + bandWidth * (index + 0.5),
    y: (value: number) => margin.top + innerHeight * (1 - (value - domain.min) / (span === 0 ? 1 : span)),
    min: domain.min,
    max: domain.max,
    ticks: domain.ticks,
  };
}

/**
 * x 축 라벨을 솎아 낸다 — 79개월을 다 적으면 글자가 겹쳐 아무것도 못 읽는다.
 * 첫 달과 마지막 달은 항상 남긴다(범위를 말해 주는 두 값이라).
 */
export function thinLabels(labels: readonly string[], maxLabels = 8): { index: number; label: string }[] {
  if (labels.length === 0) return [];
  if (labels.length <= maxLabels) return labels.map((label, index) => ({ index, label }));
  const step = Math.ceil(labels.length / maxLabels);
  const out: { index: number; label: string }[] = [];
  for (let index = 0; index < labels.length; index += step) out.push({ index, label: labels[index] });
  const lastIndex = labels.length - 1;
  if (out[out.length - 1].index !== lastIndex) out.push({ index: lastIndex, label: labels[lastIndex] });
  return out;
}
