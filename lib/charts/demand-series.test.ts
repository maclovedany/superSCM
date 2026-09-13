import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDemandSeriesChart, demandSeriesItems } from './demand-series.ts';
import { linePath, bandPath } from './geometry.ts';
import type { DemandSeriesPoint } from '../analytics/model.ts';

const projector = { x: (index: number) => index * 10, y: (value: number) => 500 - value };

function point(over: Partial<DemandSeriesPoint> & { period: string }): DemandSeriesPoint {
  return {
    itemId: 'ITEM1',
    itemName: '테스트 품목',
    actualQty: null,
    actualReasonCode: null,
    modelId: null,
    predictedQty: null,
    predictedReasonCode: null,
    p80: null,
    p90: null,
    bandReasonCode: null,
    ...over,
  };
}

/**
 * 배포 DB 실측 모양(2026-09-13) — 품목 10개가 **전부** 이 한 가지 모양이다.
 * 18개월: 실적 앞 12개월 · 예측/밴드 뒤 9개월(3개월 겹침). **내부 결측이 없다.**
 */
function productionShape(): DemandSeriesPoint[] {
  const rows: DemandSeriesPoint[] = [];
  const months = [
    '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
    '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
    '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03',
  ];
  months.forEach((ym, index) => {
    const hasActual = index < 12;
    const hasForecast = index >= 9;
    rows.push(
      point({
        period: `${ym}-01`,
        actualQty: hasActual ? 200 + index : null,
        actualReasonCode: hasActual ? null : 'NO_ACTUAL_USAGE',
        modelId: hasForecast ? 'WMA_3M' : null,
        predictedQty: hasForecast ? 246 : null,
        predictedReasonCode: hasForecast ? null : 'PERIOD_NOT_FORECASTED',
        p80: hasForecast ? 275 : null,
        p90: hasForecast ? 290 : null,
        bandReasonCode: hasForecast ? null : 'PERIOD_NOT_FORECASTED',
      }),
    );
  });
  return rows;
}

test('수요 차트 — 실측 모양에서 실적 1구간(12점) · 예측 1구간(9점)', () => {
  const chart = buildDemandSeriesChart(productionShape(), 'ITEM1');
  assert.ok(chart !== null);
  assert.equal(chart.months.length, 18);
  assert.equal(chart.actualSegments.length, 1);
  assert.equal(chart.actualSegments[0].points.length, 12);
  assert.equal(chart.predictedSegments.length, 1);
  assert.equal(chart.predictedSegments[0].points.length, 9);
});

test('수요 차트 — 예측이 없는 달을 0 으로 채우지 않는다', () => {
  const chart = buildDemandSeriesChart(productionShape(), 'ITEM1');
  assert.ok(chart !== null);
  // 앞 9개월은 예측이 없다 — null 이어야 하고, 0 이면 "예측이 0이었다"는 거짓이 된다.
  assert.deepEqual(chart.predicted.slice(0, 9), new Array(9).fill(null));
});

test('수요 차트 — 예측선이 안쪽 결측에서 끊긴다(M 개수 = 구간 수)', () => {
  const rows = [
    point({ period: '2026-01-01', predictedQty: 10, predictedReasonCode: null }),
    point({ period: '2026-02-01', predictedQty: null, predictedReasonCode: 'PREDICTED_QTY_NULL' }),
    point({ period: '2026-03-01', predictedQty: 30, predictedReasonCode: null }),
  ];
  const chart = buildDemandSeriesChart(rows, 'ITEM1');
  assert.ok(chart !== null);
  assert.equal(chart.predictedSegments.length, 2);
  assert.equal((linePath(chart.predictedSegments, projector).match(/M/g) ?? []).length, 2);
});

test('수요 차트 — 실적선과 예측선은 서로 독립으로 끊긴다', () => {
  const rows = [
    point({ period: '2026-01-01', actualQty: 5, predictedQty: null, predictedReasonCode: 'PERIOD_NOT_FORECASTED' }),
    point({ period: '2026-02-01', actualQty: null, actualReasonCode: 'NO_ACTUAL_USAGE', predictedQty: 20 }),
  ];
  const chart = buildDemandSeriesChart(rows, 'ITEM1');
  assert.ok(chart !== null);
  assert.equal(chart.actualSegments.length, 1);
  assert.equal(chart.predictedSegments.length, 1);
  assert.notEqual(chart.actualSegments[0].from, chart.predictedSegments[0].from);
});

test('수요 차트 — p80 이 없는 달에는 p80 밴드를 그리지 않는다', () => {
  const rows = [
    point({ period: '2026-01-01', predictedQty: 100, p80: 120, p90: 130 }),
    point({ period: '2026-02-01', predictedQty: 100, p80: null, p90: 130, bandReasonCode: 'BAND_UNAVAILABLE' }),
    point({ period: '2026-03-01', predictedQty: 100, p80: 120, p90: 130 }),
  ];
  const chart = buildDemandSeriesChart(rows, 'ITEM1');
  assert.ok(chart !== null);
  assert.equal(chart.p80Band.length, 2);
  assert.equal((bandPath(chart.p80Band, projector).match(/M/g) ?? []).length, 2);
});

test('수요 차트 — p90 은 p80 과 독립으로 끊긴다(한쪽만 막아도 다른 쪽이 새지 않는다)', () => {
  const rows = [
    point({ period: '2026-01-01', predictedQty: 100, p80: 120, p90: 130 }),
    point({ period: '2026-02-01', predictedQty: 100, p80: 120, p90: null, bandReasonCode: 'BAND_UNAVAILABLE' }),
    point({ period: '2026-03-01', predictedQty: 100, p80: 120, p90: 130 }),
  ];
  const chart = buildDemandSeriesChart(rows, 'ITEM1');
  assert.ok(chart !== null);
  assert.equal(chart.p80Band.length, 1, 'p80 은 이어져 있어야 한다');
  assert.equal(chart.p90Band.length, 2, 'p90 만 끊겨야 한다');
});

test('수요 차트 — 예측이 없으면 밴드도 없다(밴드를 예측으로 메우지 않는다)', () => {
  const rows = [
    point({ period: '2026-01-01', predictedQty: null, predictedReasonCode: 'PERIOD_NOT_FORECASTED', p80: 120, p90: 130 }),
  ];
  const chart = buildDemandSeriesChart(rows, 'ITEM1');
  assert.ok(chart !== null);
  assert.equal(chart.p80Band.length, 0);
  assert.equal(chart.p90Band.length, 0);
});

test('수요 차트 — 밴드 폭이 0 인 가짜 밴드를 만들지 않는다(coalesce 금지)', () => {
  const rows = [point({ period: '2026-01-01', predictedQty: 100, p80: null, p90: null, bandReasonCode: 'BAND_UNAVAILABLE' })];
  const chart = buildDemandSeriesChart(rows, 'ITEM1');
  assert.ok(chart !== null);
  assert.equal(bandPath(chart.p80Band, projector), '');
  assert.equal(bandPath(chart.p90Band, projector), '');
});

test('수요 차트 — 빠진 달의 사유가 한국어로 나온다(영문 코드 그대로 노출 금지)', () => {
  const chart = buildDemandSeriesChart(productionShape(), 'ITEM1');
  assert.ok(chart !== null);
  const predicted = chart.predictedReasons.find((reason) => reason.code === 'PERIOD_NOT_FORECASTED');
  assert.ok(predicted !== undefined);
  assert.equal(predicted.months.length, 9);
  assert.match(predicted.label, /[가-힣]/);
  assert.notEqual(predicted.label, predicted.code);
});

test('수요 차트 — "예측 없음"과 "밴드만 없음"을 다른 사유로 말한다', () => {
  const rows = [
    point({ period: '2026-01-01', predictedQty: null, predictedReasonCode: 'PERIOD_NOT_FORECASTED', bandReasonCode: 'PERIOD_NOT_FORECASTED' }),
    point({ period: '2026-02-01', predictedQty: 100, p80: null, p90: null, bandReasonCode: 'BAND_UNAVAILABLE' }),
  ];
  const chart = buildDemandSeriesChart(rows, 'ITEM1');
  assert.ok(chart !== null);
  const codes = chart.bandReasons.map((reason) => reason.code).sort();
  assert.deepEqual(codes, ['BAND_UNAVAILABLE', 'PERIOD_NOT_FORECASTED']);
});

test('수요 차트 — 월 축은 빠짐없이 채운다(행이 없는 달도 자리를 차지한다)', () => {
  const rows = [
    point({ period: '2026-01-01', actualQty: 10 }),
    point({ period: '2026-04-01', actualQty: 40 }),
  ];
  const chart = buildDemandSeriesChart(rows, 'ITEM1');
  assert.ok(chart !== null);
  assert.deepEqual(chart.months, ['2026-01', '2026-02', '2026-03', '2026-04']);
  assert.equal(chart.actualSegments.length, 2, '행이 없는 달에서 실적선이 끊겨야 한다');
});

test('수요 차트 — 다른 품목의 행이 섞이지 않는다', () => {
  const rows = [
    point({ period: '2026-01-01', actualQty: 10 }),
    { ...point({ period: '2026-01-01', actualQty: 999 }), itemId: 'OTHER' },
  ];
  const chart = buildDemandSeriesChart(rows, 'ITEM1');
  assert.ok(chart !== null);
  assert.deepEqual(chart.actual, [10]);
});

test('수요 차트 — 행이 없는 품목은 null 이다(빈 축을 그리지 않는다)', () => {
  assert.equal(buildDemandSeriesChart(productionShape(), '없는품목'), null);
});

test('수요 차트 — 품목 목록은 행이 있는 품목만 준다', () => {
  const items = demandSeriesItems(productionShape());
  assert.deepEqual(items, [{ itemId: 'ITEM1', itemName: '테스트 품목' }]);
});
