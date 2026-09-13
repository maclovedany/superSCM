// 차트 기하 — 순수 함수만 둔다. React·DOM·색·디자인 토큰을 모르고 좌표만 계산한다.
//
// ★ 왜 lib/ 에 있는가: package.json 의 test 는 `node --test "lib/**/*.test.ts"` 다. 기하가
//   components/ 안에 있으면 한 줄도 시험되지 않는다. "끊어진 선을 끊어진 채로 그린다"가 이
//   라운드의 계약이므로, 그 계약을 지키는 코드는 시험되는 자리에 있어야 한다.
// ★ 값을 지어내지 않는다(AGENTS.md 5번). null 은 null 로 흘려보낸다 — 끊을 뿐 메우지 않고,
//   0 으로 떨어뜨리지도 않는다.

/** 값이 없을 수 있는 계열의 한 점. null 은 "그 자리에 값이 없다"는 뜻이다. */
export type Nullable = number | null;

/** 값이 이어진 구간 하나. from·to 는 원본 배열의 인덱스(양끝 포함). */
export type Segment = {
  from: number;
  to: number;
  points: readonly { index: number; value: number }[];
};

/** 위·아래 두 값이 **모두** 있는 구간 하나. 밴드는 한쪽만 있으면 그릴 수 없다. */
export type PairedSegment = {
  from: number;
  to: number;
  points: readonly { index: number; upper: number; base: number }[];
};

/** 인덱스 → x, 값 → y. 차트가 자기 여백·크기를 알고 만들어 넘긴다. */
export type Projector = { x(index: number): number; y(value: number): number };

/** 좌표 문자열 — 소수 둘째 자리에서 끊는다(경로 문자열을 시험에서 그대로 비교할 수 있게). */
function coord(value: number): string {
  return String(Number(value.toFixed(2)));
}

function usable(value: Nullable): value is number {
  return value !== null && Number.isFinite(value);
}

/**
 * 이어진 값 구간으로 쪼갠다 — **null 에서 끊는다.**
 *
 * ★ 이 함수가 이 라운드의 계약 그 자체다. `v_demand_series` 의 predicted_qty · p80 · p90 은
 *   각각 독립적으로 null 일 수 있고, 각 null 에는 **서로 다른 사실을 주장하는 사유 코드**가
 *   붙는다. 구간을 이어 그리면 "그 달에도 예측이 있었다", 0 으로 떨어뜨리면 "그 달 실적이
 *   0이었다" — 둘 다 데이터가 말하지 않은 문장이다.
 * ★ 행 자체가 없는 달은 이 함수에 오기 전에 `densify()` 가 null 로 바꿔 놓는다. "행이 없다"와
 *   "값이 null 이다"는 원인이 다르지만, 이어 그리면 화면에서 똑같이 거짓이 된다.
 */
export function segments(values: readonly Nullable[]): Segment[] {
  const out: Segment[] = [];
  let current: { from: number; to: number; points: { index: number; value: number }[] } | null = null;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!usable(value)) {
      current = null;
      continue;
    }
    if (current === null) {
      current = { from: index, to: index, points: [] };
      out.push(current);
    }
    current.to = index;
    current.points.push({ index, value });
  }

  return out;
}

/**
 * 위·아래가 **둘 다** 있는 구간만 남긴다 — 밴드 전용.
 *
 * ★ p80 과 p90 은 서로 독립이고, 밴드의 아래쪽(예측값)과도 독립이다. 어느 한쪽이라도 없으면
 *   그 자리의 밴드는 **그리지 않는다** — `coalesce(p80, predicted)` 처럼 메우면 폭 0 짜리
 *   가짜 밴드가 생겨 "구간을 계산했는데 마침 예측과 같았다"로 읽힌다.
 */
export function pairedSegments(upper: readonly Nullable[], base: readonly Nullable[]): PairedSegment[] {
  const out: PairedSegment[] = [];
  let current: { from: number; to: number; points: { index: number; upper: number; base: number }[] } | null = null;
  const length = Math.min(upper.length, base.length);

  for (let index = 0; index < length; index += 1) {
    const top = upper[index];
    const bottom = base[index];
    if (!usable(top) || !usable(bottom)) {
      current = null;
      continue;
    }
    if (current === null) {
      current = { from: index, to: index, points: [] };
      out.push(current);
    }
    current.to = index;
    current.points.push({ index, upper: top, base: bottom });
  }

  return out;
}

/**
 * 구간마다 `M` 으로 **다시 시작하는** 선 경로.
 *
 * ★ `M` 의 개수 = 구간의 개수다. 이 항등식이 "선이 정말 끊겼는가"를 시험에서 셀 수 있게 한다.
 *   구간을 이어 붙이면(`L` 로 계속하면) `M` 이 하나로 줄어 시험이 즉시 실패한다.
 */
export function linePath(segs: readonly Segment[], projector: Projector): string {
  return segs
    .map((segment) =>
      segment.points
        .map((point, i) => `${i === 0 ? 'M' : 'L'}${coord(projector.x(point.index))} ${coord(projector.y(point.value))}`)
        .join(' '),
    )
    .join(' ');
}

/**
 * 점이 하나뿐인 구간 — 선으로는 보이지 않으므로 차트가 점을 찍어야 한다.
 *
 * ★ 앞뒤가 모두 null 인 값 하나는 `M` 만 남아 **화면에서 사라진다.** 값이 있는데 안 보이는
 *   것은 "데이터가 없다"는 거짓 신호라, 끊어 그리는 것만으로는 부족하다.
 */
export function isolatedPoints(segs: readonly Segment[]): { index: number; value: number }[] {
  return segs.filter((segment) => segment.points.length === 1).map((segment) => segment.points[0]);
}

/**
 * 밴드 구간 하나의 닫힌 영역 경로 — 위를 따라가고 아래를 거꾸로 돌아온다.
 *
 * ★ 구간마다 독립된 경로를 만든다(`M` … `Z`). 구간 사이를 잇지 않는다.
 */
export function bandPath(segs: readonly PairedSegment[], projector: Projector): string {
  return segs
    .map((segment) => {
      const top = segment.points
        .map((point, i) => `${i === 0 ? 'M' : 'L'}${coord(projector.x(point.index))} ${coord(projector.y(point.upper))}`)
        .join(' ');
      const bottom = [...segment.points]
        .reverse()
        .map((point) => `L${coord(projector.x(point.index))} ${coord(projector.y(point.base))}`)
        .join(' ');
      return `${top} ${bottom} Z`;
    })
    .join(' ');
}

// ══ 축 ═══════════════════════════════════════════════════════════

/**
 * 사람이 읽기 좋은 눈금값 — 1·2·5×10ⁿ 간격.
 *
 * ★ 항상 0 을 포함하지는 않는다. 수량 축은 0 부터 시작하는 것이 정직하지만(막대 길이가 곧
 *   비율이므로), 그 판단은 부르는 쪽이 `includeZero` 로 한다.
 */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];

  const rawStep = (max - min) / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const niceStep = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;

  const first = Math.ceil(min / niceStep) * niceStep;
  const ticks: number[] = [];
  for (let tick = first; tick <= max + niceStep / 1000; tick += niceStep) {
    ticks.push(Number(tick.toFixed(10)));
  }
  return ticks;
}

/** 값 범위 — 계열 여럿을 한 축에 올릴 때 쓴다. 값이 하나도 없으면 null 이다(축을 그리지 않는다). */
export function extent(...series: readonly Nullable[][]): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const values of series) {
    for (const value of values) {
      if (!usable(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

// ══ 월 축 ════════════════════════════════════════════════════════

const YM = /^(\d{4})-(\d{2})$/;

function toMonthIndex(ym: string): number | null {
  const match = YM.exec(ym);
  if (match === null) return null;
  return Number(match[1]) * 12 + (Number(match[2]) - 1);
}

function fromMonthIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** "YYYY-MM-01"(date) 과 "YYYY-MM"(char) 을 모두 받아 "YYYY-MM" 으로 맞춘다. */
export function toYm(period: string): string {
  return period.length >= 7 ? period.slice(0, 7) : period;
}

/** 두 달 사이의 **빠짐없는** 월 목록. 범위를 못 읽으면 빈 배열이다. */
export function monthRange(firstYm: string, lastYm: string): string[] {
  const first = toMonthIndex(toYm(firstYm));
  const last = toMonthIndex(toYm(lastYm));
  if (first === null || last === null || last < first) return [];
  const out: string[] = [];
  for (let index = first; index <= last; index += 1) out.push(fromMonthIndex(index));
  return out;
}

/**
 * 행이 **없는** 달을 null 자리로 벌려 놓는다.
 *
 * ★ `v_shipment_monthly_item` 은 출고가 없는 달의 행 자체가 없다(실측 2026-09-13: 10,198
 *   품목 중 6,612 품목에 내부 결측 달이 있고, 합계 93,984 달, 최대 62 달). 행을 순서대로만
 *   이으면 없는 달을 건너뛴 직선이 되어 **없는 달에 출고가 있었던 것처럼** 보인다.
 * ★ 여기서 만든 null 은 뷰가 준 사유 코드가 아니라 **화면이 만든 자리**다 — 그래서 사유
 *   코드도 화면 것(MONTH_ROW_ABSENT)을 쓴다. 뷰의 사유 코드와 섞지 않는다.
 */
export function densify<T>(
  months: readonly string[],
  rows: readonly T[],
  getYm: (row: T) => string,
  getValue: (row: T) => Nullable,
): Nullable[] {
  const byMonth = new Map<string, Nullable>();
  for (const row of rows) byMonth.set(toYm(getYm(row)), getValue(row));
  return months.map((month) => (byMonth.has(month) ? (byMonth.get(month) as Nullable) : null));
}

/** 화면이 만든 사유 코드 — 뷰가 준 것이 아니다(행이 아예 없는 달). */
export const MONTH_ROW_ABSENT = 'MONTH_ROW_ABSENT';
