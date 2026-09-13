import assert from 'node:assert/strict';
import test from 'node:test';

import { accuracyFySheets, buildOlAccuracyChart } from './ol-accuracy.ts';
import type { OlAccuracy } from '../scm-model.ts';

function row(over: Partial<OlAccuracy> & { modelBase: string; fySheet: string }): OlAccuracy {
  return {
    biz: null,
    nRows: 12,
    firstYm: '2023-04',
    lastYm: '2024-03',
    totalAct: 100,
    nScoredSales: 12,
    salesWape: 0.4,
    salesBias: 0.1,
    nScoredScm: 12,
    scmWape: 0.5,
    scmBias: -0.2,
    reasonCode: null,
    ...over,
  };
}

test('OL 정확도 — WAPE 가 null 이면 막대를 그리지 않는다(0 으로 바꾸지 않는다)', () => {
  const chart = buildOlAccuracyChart([
    row({ modelBase: 'MDL1', fySheet: 'FY23', salesWape: null, reasonCode: 'NO_ACTUAL' }),
  ]);
  assert.ok(chart !== null);
  assert.equal(chart.groups[0].salesWape.value, null);
  assert.notEqual(chart.groups[0].salesWape.value, 0, 'null 을 0 으로 그리면 "완벽히 맞혔다"가 된다');
});

test('OL 정확도 — 값이 없는 칸에 한국어 사유가 붙는다', () => {
  const chart = buildOlAccuracyChart([
    row({ modelBase: 'MDL1', fySheet: 'FY23', salesWape: null, scmWape: null, reasonCode: 'NO_ACTUAL' }),
  ]);
  assert.ok(chart !== null);
  const label = chart.groups[0].salesWape.reasonLabel;
  assert.ok(label !== null);
  assert.match(label, /[가-힣]/);
  assert.notEqual(label, 'NO_ACTUAL');
});

test('OL 정확도 — 사유 코드가 없으면 계산 불가로 말한다(빈자리를 설명 없이 두지 않는다)', () => {
  const chart = buildOlAccuracyChart([row({ modelBase: 'MDL1', fySheet: 'FY23', salesWape: null, reasonCode: null })]);
  assert.ok(chart !== null);
  assert.equal(chart.groups[0].salesWape.reasonCode, 'CALCULATION_UNAVAILABLE');
  assert.ok(chart.groups[0].salesWape.reasonLabel !== null);
});

test('OL 정확도 — 영업과 SCM 은 독립으로 빈다(한쪽이 다른 쪽을 대신하지 않는다)', () => {
  const chart = buildOlAccuracyChart([
    row({ modelBase: 'MDL1', fySheet: 'FY23', salesWape: null, scmWape: 0.3, reasonCode: 'NO_ACTUAL' }),
  ]);
  assert.ok(chart !== null);
  assert.equal(chart.groups[0].salesWape.value, null);
  assert.equal(chart.groups[0].scmWape.value, 0.3);
});

test('OL 정확도 — 축 최대값에 null 이 0 으로 끼어들지 않는다', () => {
  const chart = buildOlAccuracyChart([
    row({ modelBase: 'MDL1', fySheet: 'FY23', salesWape: null, scmWape: 0.8, salesBias: null, scmBias: -0.5, reasonCode: 'NO_ACTUAL' }),
  ]);
  assert.ok(chart !== null);
  assert.equal(chart.wapeMax, 0.8);
  assert.equal(chart.biasAbsMax, 0.5);
  assert.equal(chart.missingBars, 2);
});

test('OL 정확도 — Bias 는 음수를 보존한다(과소예측을 과대예측으로 뒤집지 않는다)', () => {
  const chart = buildOlAccuracyChart([row({ modelBase: 'MDL1', fySheet: 'FY23', scmBias: -0.2 })]);
  assert.ok(chart !== null);
  assert.equal(chart.groups[0].scmBias.value, -0.2);
});

test('OL 정확도 — 값이 하나도 없으면 축 최대가 null 이다(빈 축을 그리지 않는다)', () => {
  const chart = buildOlAccuracyChart([
    row({ modelBase: 'MDL1', fySheet: 'FY23', salesWape: null, scmWape: null, salesBias: null, scmBias: null, reasonCode: 'NO_ACTUAL' }),
  ]);
  assert.ok(chart !== null);
  assert.equal(chart.wapeMax, null);
  assert.equal(chart.biasAbsMax, null);
});

test('OL 정확도 — 회계연도로 거른다', () => {
  const rows = [row({ modelBase: 'MDL1', fySheet: 'FY23' }), row({ modelBase: 'MDL2', fySheet: 'FY24' })];
  const chart = buildOlAccuracyChart(rows, 'FY24');
  assert.ok(chart !== null);
  assert.equal(chart.groups.length, 1);
  assert.equal(chart.groups[0].modelBase, 'MDL2');
});

test('OL 정확도 — 해당 연도 행이 없으면 null 이다', () => {
  assert.equal(buildOlAccuracyChart([row({ modelBase: 'MDL1', fySheet: 'FY23' })], 'FY99'), null);
});

test('OL 정확도 — 회계연도 목록을 정렬해 준다', () => {
  const rows = [row({ modelBase: 'A', fySheet: 'FY24' }), row({ modelBase: 'B', fySheet: 'FY23' })];
  assert.deepEqual(accuracyFySheets(rows), ['FY23', 'FY24']);
});
