import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bandPath,
  densify,
  extent,
  isolatedPoints,
  linePath,
  monthRange,
  niceTicks,
  pairedSegments,
  segments,
  toYm,
  type Nullable,
} from './geometry.ts';

// 좌표를 그대로 읽을 수 있는 단순 투영 — 기하만 시험하고 여백·크기는 시험하지 않는다.
const projector = { x: (index: number) => index * 10, y: (value: number) => 100 - value };

/**
 * 배포 DB 실측 모양(2026-09-13) — `v_demand_series` 의 품목 하나.
 * 18개월 중 실적은 앞 12개월, 예측·밴드는 뒤 9개월(3개월 겹침).
 * ★ 실측된 10개 품목이 **전부 이 한 가지 모양**이다 — 내부 결측이 하나도 없다. 그래서 아래
 *   "안쪽이 끊긴" 시험은 전부 합성 fixture 로 만든다(보고서 §수용 시험 1 참고).
 */
const PROD_ACTUAL: Nullable[] = [270, 307, 335, 348, 342, 319, 286, 253, 228, 221, 233, 262, null, null, null, null, null, null];
const PROD_PREDICTED: Nullable[] = [null, null, null, null, null, null, null, null, null, 246, 246, 246, 246, 246, 246, 246, 246, 246];

test('구간 — null 에서 끊는다(안쪽 결측이 두 구간을 만든다)', () => {
  const result = segments([1, 2, null, 4, 5]);
  assert.equal(result.length, 2);
  assert.deepEqual([result[0].from, result[0].to], [0, 1]);
  assert.deepEqual([result[1].from, result[1].to], [3, 4]);
});

test('구간 — 선행·후행 null 은 구간을 늘리지 않는다', () => {
  const result = segments([null, null, 3, 4, null]);
  assert.equal(result.length, 1);
  assert.deepEqual([result[0].from, result[0].to], [2, 3]);
});

test('구간 — 값이 하나도 없으면 구간이 없다(빈 축을 그릴 근거가 된다)', () => {
  assert.deepEqual(segments([null, null, null]), []);
});

test('구간 — NaN 은 값이 아니다(0 으로 떨어뜨리지 않는다)', () => {
  const result = segments([1, Number.NaN, 3]);
  assert.equal(result.length, 2);
});

test('구간 — 실측 모양: 실적은 한 구간(12점), 예측도 한 구간(9점)', () => {
  const actual = segments(PROD_ACTUAL);
  const predicted = segments(PROD_PREDICTED);
  assert.equal(actual.length, 1);
  assert.equal(actual[0].points.length, 12);
  assert.equal(predicted.length, 1);
  assert.equal(predicted[0].points.length, 9);
});

test('선 경로 — M 개수가 구간 개수와 같다', () => {
  const path = linePath(segments([1, 2, null, 4, null, 6]), projector);
  assert.equal((path.match(/M/g) ?? []).length, 3);
});

test('선 경로 — 끊긴 구간을 L 로 잇지 않는다', () => {
  const path = linePath(segments([10, null, 30]), projector);
  // 이어 그렸다면 M 이 하나뿐이고 L 이 생긴다.
  assert.equal((path.match(/M/g) ?? []).length, 2);
  assert.equal(path, 'M0 90 M20 70');
});

test('선 경로 — 값이 없으면 빈 경로다', () => {
  assert.equal(linePath(segments([null, null]), projector), '');
});

test('외딴 점 — 앞뒤가 null 인 값 하나는 점으로 돌려준다(선으로는 사라진다)', () => {
  const found = isolatedPoints(segments([null, 5, null, 7, 8]));
  assert.deepEqual(found, [{ index: 1, value: 5 }]);
});

test('밴드 구간 — 위(p80)가 null 이면 그 자리 밴드가 없다', () => {
  const result = pairedSegments([10, null, 30], [1, 2, 3]);
  assert.equal(result.length, 2);
});

test('밴드 구간 — 아래(예측)가 null 이면 밴드가 없다', () => {
  const result = pairedSegments([10, 20, 30], [1, null, 3]);
  assert.equal(result.length, 2);
});

test('밴드 구간 — p80 과 p90 은 서로 독립으로 끊긴다', () => {
  const base: Nullable[] = [1, 2, 3, 4];
  const p80: Nullable[] = [10, null, 30, 40];
  const p90: Nullable[] = [11, 21, null, 41];
  assert.equal(pairedSegments(p80, base).length, 2);
  assert.equal(pairedSegments(p90, base).length, 2);
  // 한쪽만 막아도 다른 쪽이 대신 이어 주지 않는다 — 끊긴 자리가 서로 다르다.
  assert.notDeepEqual(
    pairedSegments(p80, base).map((s) => s.from),
    pairedSegments(p90, base).map((s) => s.from),
  );
});

test('밴드 경로 — 구간마다 M 으로 시작하고 Z 로 닫는다', () => {
  const path = bandPath(pairedSegments([10, null, 30, 40], [1, 2, 3, 4]), projector);
  assert.equal((path.match(/M/g) ?? []).length, 2);
  assert.equal((path.match(/Z/g) ?? []).length, 2);
});

test('밴드 경로 — 밴드가 하나도 없으면 빈 경로다(빈 영역을 그리지 않는다)', () => {
  assert.equal(bandPath(pairedSegments([null, null], [1, 2]), projector), '');
});

test('눈금 — 1·2·5 배수로 떨어진다', () => {
  assert.deepEqual(niceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(niceTicks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
});

test('눈금 — 최소·최대가 같으면 눈금 하나다', () => {
  assert.deepEqual(niceTicks(5, 5), [5]);
});

test('범위 — 값이 하나도 없으면 null 이다(축을 그리지 않는다)', () => {
  assert.equal(extent([null, null]), null);
});

test('범위 — 계열 여럿을 한 축에 올린다', () => {
  assert.deepEqual(extent([1, 5], [null, 9]), { min: 1, max: 9 });
});

test('월 축 — 빠짐없는 월 목록을 만든다(연말을 넘어간다)', () => {
  assert.deepEqual(monthRange('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
});

test('월 축 — 거꾸로거나 형식이 아니면 빈 목록이다', () => {
  assert.deepEqual(monthRange('2026-02', '2025-11'), []);
  assert.deepEqual(monthRange('아무거나', '2025-11'), []);
});

test('월 축 — "YYYY-MM-01"(date) 도 "YYYY-MM" 으로 읽는다', () => {
  assert.equal(toYm('2026-07-01'), '2026-07');
  assert.deepEqual(monthRange('2026-07-01', '2026-09-01'), ['2026-07', '2026-08', '2026-09']);
});

test('채우기 — 행이 없는 달은 null 자리가 된다(0 으로 채우지 않는다)', () => {
  const rows = [
    { ym: '2026-01', qty: 10 },
    { ym: '2026-03', qty: 30 },
  ];
  const months = monthRange('2026-01', '2026-03');
  assert.deepEqual(
    densify(months, rows, (r) => r.ym, (r) => r.qty),
    [10, null, 30],
  );
});

/**
 * 이 시험이 품목별 출고 차트의 핵심이다 — `v_shipment_monthly_item` 은 출고가 없는 달의
 * **행 자체가 없다**(실측: 10,198 품목 중 6,612 품목에 내부 결측, 합계 93,984 달).
 * 행을 순서대로만 이으면 없는 달을 건너뛴 직선이 되어 그 달에 출고가 있었던 것처럼 보인다.
 */
test('채우기 — 행이 없는 달에서 선이 끊긴다(행을 순서대로 잇지 않는다)', () => {
  const rows = [
    { ym: '2026-01', qty: 10 },
    { ym: '2026-04', qty: 40 },
  ];
  const months = monthRange('2026-01', '2026-04');
  const values = densify(months, rows, (r) => r.ym, (r) => r.qty);
  const path = linePath(segments(values), projector);
  assert.equal((path.match(/M/g) ?? []).length, 2);
});

test('채우기 — 뷰가 준 null 은 null 그대로 남는다(행 없음과 구분하지 않고 둘 다 끊는다)', () => {
  const rows = [
    { ym: '2026-01', qty: 10 },
    { ym: '2026-02', qty: null as number | null },
  ];
  const months = monthRange('2026-01', '2026-02');
  assert.deepEqual(densify(months, rows, (r) => r.ym, (r) => r.qty), [10, null]);
});
