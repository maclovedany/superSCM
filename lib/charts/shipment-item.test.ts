import assert from 'node:assert/strict';
import test from 'node:test';

import { buildShipmentItemChart } from './shipment-item.ts';
import { linePath } from './geometry.ts';
import type { ShipmentMonthlyItemRow } from '../analytics/model.ts';

const projector = { x: (index: number) => index * 10, y: (value: number) => 500 - value };

function row(over: Partial<ShipmentMonthlyItemRow> & { ym: string }): ShipmentMonthlyItemRow {
  return { itemCode: 'VC7161', itemType: 'OPTION', qty: 10, nSourceCodes: 1, ...over };
}

/**
 * 실측(2026-09-13): 10,198 품목 중 6,612 품목에 내부 결측 달이 있다(합계 93,984 달, 최대 62).
 * 예: EM829839 는 2020-01~2026-07(79개월) 중 75개월만 행이 있다.
 */
test('품목별 출고 — 행이 없는 달에서 선이 끊긴다(행을 순서대로 잇지 않는다)', () => {
  const chart = buildShipmentItemChart(
    [row({ ym: '2026-01', qty: 10 }), row({ ym: '2026-04', qty: 40 })],
    'VC7161',
  );
  assert.ok(chart !== null);
  assert.deepEqual(chart.months, ['2026-01', '2026-02', '2026-03', '2026-04']);
  assert.equal(chart.qtySegments.length, 2);
  assert.equal((linePath(chart.qtySegments, projector).match(/M/g) ?? []).length, 2);
});

test('품목별 출고 — 행이 없는 달을 0 으로 채우지 않는다', () => {
  const chart = buildShipmentItemChart(
    [row({ ym: '2026-01', qty: 10 }), row({ ym: '2026-03', qty: 30 })],
    'VC7161',
  );
  assert.ok(chart !== null);
  assert.deepEqual(chart.qty, [10, null, 30]);
});

test('품목별 출고 — 없는 달의 수와 한국어 설명을 돌려준다', () => {
  const chart = buildShipmentItemChart(
    [row({ ym: '2026-01' }), row({ ym: '2026-04' })],
    'VC7161',
  );
  assert.ok(chart !== null);
  assert.deepEqual(chart.absentMonths.months, ['2026-02', '2026-03']);
  assert.match(chart.absentMonths.label, /[가-힣]/);
  assert.notEqual(chart.absentMonths.label, chart.absentMonths.code);
});

test('품목별 출고 — 뷰가 준 qty null 도 끊는다', () => {
  const chart = buildShipmentItemChart(
    [row({ ym: '2026-01', qty: 10 }), row({ ym: '2026-02', qty: null }), row({ ym: '2026-03', qty: 30 })],
    'VC7161',
  );
  assert.ok(chart !== null);
  assert.deepEqual(chart.qty, [10, null, 30]);
  assert.equal(chart.qtySegments.length, 2);
});

test('품목별 출고 — 값이 0 인 달은 값이 있는 달이다(끊지 않는다)', () => {
  const chart = buildShipmentItemChart(
    [row({ ym: '2026-01', qty: 10 }), row({ ym: '2026-02', qty: 0 }), row({ ym: '2026-03', qty: 30 })],
    'VC7161',
  );
  assert.ok(chart !== null);
  assert.equal(chart.qtySegments.length, 1, '실제로 0인 달과 행이 없는 달은 다른 사실이다');
});

test('품목별 출고 — 다른 품목의 행이 섞이지 않는다', () => {
  const chart = buildShipmentItemChart(
    [row({ ym: '2026-01', qty: 10 }), row({ ym: '2026-01', itemCode: 'OTHER', qty: 999 })],
    'VC7161',
  );
  assert.ok(chart !== null);
  assert.deepEqual(chart.qty, [10]);
});

test('품목별 출고 — 합쳐진 원본 코드 수의 최대를 드러낸다(HOC 귀속)', () => {
  const chart = buildShipmentItemChart(
    [row({ ym: '2026-01', nSourceCodes: 1 }), row({ ym: '2026-02', nSourceCodes: 3 })],
    'VC7161',
  );
  assert.ok(chart !== null);
  assert.equal(chart.maxSourceCodes, 3);
});

test('품목별 출고 — 행이 없는 품목은 null 이다(빈 축을 그리지 않는다)', () => {
  assert.equal(buildShipmentItemChart([row({ ym: '2026-01' })], '없는품목'), null);
});
