import assert from 'node:assert/strict';
import test from 'node:test';

import { buildShipmentRollupChart } from './shipment-rollup.ts';
import { linePath } from './geometry.ts';
import type { ShipmentMonthlyRollupRow } from '../analytics/model.ts';

const projector = { x: (index: number) => index * 10, y: (value: number) => 500 - value };

function row(over: Partial<ShipmentMonthlyRollupRow> & { ym: string }): ShipmentMonthlyRollupRow {
  return {
    level: 'TOTAL',
    levelReasonCode: null,
    itemType: null,
    qty: 0,
    qtyVsTrailing6mAvg: null,
    trendReasonCode: null,
    ...over,
  };
}

test('출고 롤업 — TOTAL 선이 행 없는 달에서 끊긴다', () => {
  const chart = buildShipmentRollupChart([
    row({ ym: '2026-01', qty: 100 }),
    row({ ym: '2026-03', qty: 300 }),
  ]);
  assert.ok(chart !== null);
  assert.deepEqual(chart.months, ['2026-01', '2026-02', '2026-03']);
  assert.equal(chart.totalSegments.length, 2);
  assert.equal((linePath(chart.totalSegments, projector).match(/M/g) ?? []).length, 2);
});

test('출고 롤업 — qty 가 null 인 달을 0 으로 그리지 않는다', () => {
  const chart = buildShipmentRollupChart([
    row({ ym: '2026-01', qty: 100 }),
    row({ ym: '2026-02', qty: null }),
  ]);
  assert.ok(chart !== null);
  assert.deepEqual(chart.total, [100, null]);
  assert.equal(chart.totalSegments.length, 1);
});

/**
 * 실측(2026-09-13): 79개월 중 OPTION 79 · PART 40 · SUPPLY 40.
 * 즉 **절반의 달에는 PART·SUPPLY 행이 아예 없다** — 이 차트의 진짜 결측 자리다.
 */
test('출고 롤업 — 행이 없는 품목 구분은 누적막대에 0 으로 쌓이지 않는다', () => {
  const chart = buildShipmentRollupChart([
    row({ ym: '2026-01', level: 'ITEM_TYPE', itemType: 'OPTION', qty: 10 }),
    row({ ym: '2026-02', level: 'ITEM_TYPE', itemType: 'OPTION', qty: 20 }),
    row({ ym: '2026-02', level: 'ITEM_TYPE', itemType: 'PART', qty: 5 }),
  ]);
  assert.ok(chart !== null);
  const january = chart.stacks.find((stack) => stack.ym === '2026-01');
  assert.ok(january !== undefined);
  assert.deepEqual(january.entries.map((entry) => entry.itemType), ['OPTION']);
  assert.equal(january.entries.some((entry) => entry.itemType === 'PART'), false, 'PART 칸이 생기면 안 된다');
});

test('출고 롤업 — 누적 높이는 있는 구분만 더한 값이다', () => {
  const chart = buildShipmentRollupChart([
    row({ ym: '2026-02', level: 'ITEM_TYPE', itemType: 'OPTION', qty: 20 }),
    row({ ym: '2026-02', level: 'ITEM_TYPE', itemType: 'PART', qty: 5 }),
  ]);
  assert.ok(chart !== null);
  assert.equal(chart.stacks[0].stackTotal, 25);
});

test('출고 롤업 — 구분별 qty 가 null 이면 그 칸을 쌓지 않는다', () => {
  const chart = buildShipmentRollupChart([
    row({ ym: '2026-01', level: 'ITEM_TYPE', itemType: 'OPTION', qty: 10 }),
    row({ ym: '2026-01', level: 'ITEM_TYPE', itemType: 'PART', qty: null }),
  ]);
  assert.ok(chart !== null);
  assert.deepEqual(chart.stacks[0].entries.map((entry) => entry.itemType), ['OPTION']);
});

test('출고 롤업 — level 을 못 읽은 행은 TOTAL 에 섞이지 않는다', () => {
  const chart = buildShipmentRollupChart([
    row({ ym: '2026-01', qty: 100 }),
    row({ ym: '2026-01', level: null, levelReasonCode: 'UNKNOWN_ROLLUP_LEVEL', qty: 9999 }),
  ]);
  assert.ok(chart !== null);
  assert.deepEqual(chart.total, [100], 'UNKNOWN 행이 총합에 더해지면 안 된다');
  assert.equal(chart.excludedUnknownLevel, 1);
});

test('출고 롤업 — 추세 배수를 못 낸 달의 사유가 한국어로 나온다', () => {
  const chart = buildShipmentRollupChart([
    row({ ym: '2026-01', qty: 100, qtyVsTrailing6mAvg: null, trendReasonCode: 'INSUFFICIENT_TRAILING_HISTORY' }),
  ]);
  assert.ok(chart !== null);
  const reason = chart.trendReasons[0];
  assert.equal(reason.code, 'INSUFFICIENT_TRAILING_HISTORY');
  assert.match(reason.label, /[가-힣]/);
  assert.notEqual(reason.label, reason.code);
});

test('출고 롤업 — 범례는 실제로 등장한 구분만 담는다', () => {
  const chart = buildShipmentRollupChart([
    row({ ym: '2026-01', level: 'ITEM_TYPE', itemType: 'SUPPLY', qty: 1 }),
    row({ ym: '2026-01', level: 'ITEM_TYPE', itemType: 'OPTION', qty: 2 }),
  ]);
  assert.ok(chart !== null);
  assert.deepEqual(chart.itemTypes, ['OPTION', 'SUPPLY']);
});

test('출고 롤업 — 행이 하나도 없으면 null 이다(빈 축을 그리지 않는다)', () => {
  assert.equal(buildShipmentRollupChart([]), null);
});
