import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlot, niceDomain, thinLabels } from './layout.ts';

test('배치 — 값 범위가 없으면 Plot 을 만들지 않는다(빈 축 금지)', () => {
  assert.equal(createPlot({ width: 100, height: 100, count: 3, range: null }), null);
});

test('배치 — 슬롯이 없으면 Plot 을 만들지 않는다', () => {
  assert.equal(createPlot({ width: 100, height: 100, count: 0, range: { min: 0, max: 10 } }), null);
});

test('배치 — y 는 큰 값이 위로 간다', () => {
  const plot = createPlot({ width: 200, height: 120, count: 4, range: { min: 0, max: 100 } });
  assert.ok(plot !== null);
  assert.ok(plot.y(100) < plot.y(0), '값이 클수록 y 가 작아야 한다(위쪽)');
});

test('배치 — 슬롯 가운데가 왼쪽 끝보다 오른쪽이다', () => {
  const plot = createPlot({ width: 200, height: 120, count: 4, range: { min: 0, max: 10 } });
  assert.ok(plot !== null);
  assert.ok(plot.x(0) > plot.xStart(0));
  assert.equal(plot.x(0) - plot.xStart(0), plot.bandWidth / 2);
});

test('배치 — 막대 축은 0 을 포함한다(길이가 곧 크기라서)', () => {
  const domain = niceDomain({ min: 20, max: 50 }, { includeZero: true });
  assert.ok(domain !== null);
  assert.equal(domain.min, 0);
});

test('배치 — 선 축은 0 을 강요하지 않는다', () => {
  const domain = niceDomain({ min: 200, max: 300 }, { includeZero: false });
  assert.ok(domain !== null);
  assert.ok(domain.min > 0, '0 을 끌어오면 변화가 안 보인다');
});

test('배치 — 음수 범위를 보존한다(Bias 의 부호)', () => {
  const domain = niceDomain({ min: -0.5, max: 0.3 }, { includeZero: true });
  assert.ok(domain !== null);
  assert.ok(domain.min <= -0.5);
  assert.ok(domain.max >= 0.3);
});

test('배치 — 값이 전부 같아도 축이 납작해지지 않는다', () => {
  const domain = niceDomain({ min: 5, max: 5 });
  assert.ok(domain !== null);
  assert.notEqual(domain.min, domain.max);
});

test('배치 — 값이 전부 0 이어도 축을 만든다', () => {
  const domain = niceDomain({ min: 0, max: 0 });
  assert.deepEqual(domain, { min: 0, max: 1, ticks: [0, 1] });
});

test('축 라벨 — 적으면 전부 남긴다', () => {
  assert.deepEqual(thinLabels(['a', 'b', 'c'], 8).map((l) => l.label), ['a', 'b', 'c']);
});

test('축 라벨 — 많으면 솎아 내되 첫 달과 마지막 달은 남긴다', () => {
  const months = Array.from({ length: 79 }, (_, i) => `m${i}`);
  const thinned = thinLabels(months, 8);
  assert.ok(thinned.length <= 9);
  assert.equal(thinned[0].label, 'm0');
  assert.equal(thinned[thinned.length - 1].label, 'm78');
});

test('축 라벨 — 빈 목록은 빈 결과다', () => {
  assert.deepEqual(thinLabels([], 8), []);
});
