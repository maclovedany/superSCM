import test from 'node:test';
import assert from 'node:assert/strict';
import { formatValue, moneyTick, monthTick, pctTick, qtyTick } from './chart-format.ts';

test('monthTick — YYYY-MM-DD 와 YYYY-MM 을 YY.MM 으로', () => {
  assert.equal(monthTick('2026-03-01'), '26.03');
  assert.equal(monthTick('2026-11'), '26.11');
  assert.equal(monthTick(''), '');
});

test('qtyTick — 천 · 만 · 억 단위로 줄인다', () => {
  assert.equal(qtyTick(0), '0');
  assert.equal(qtyTick(850), '850');
  assert.equal(qtyTick(1200), '1.2천');
  assert.equal(qtyTick(15000), '1.5만');
  assert.equal(qtyTick(230000000), '2.3억');
  assert.equal(qtyTick(-1200), '-1.2천');
});

test('moneyTick — 만원 · 억원', () => {
  assert.equal(moneyTick(9000), '9,000원');
  assert.equal(moneyTick(120000), '12만원');
  assert.equal(moneyTick(350000000), '3.5억원');
});

test('pctTick — 비율 0~1 을 퍼센트로', () => {
  assert.equal(pctTick(0.123), '12.3%');
  assert.equal(pctTick(1), '100%');
  assert.equal(pctTick(-0.05), '-5%');
});

test('formatValue — null 은 — 로, 종류별 전체 표기', () => {
  assert.equal(formatValue(null, 'qty'), '—');
  assert.equal(formatValue(1234.5, 'qty'), '1,234.5');
  assert.equal(formatValue(1234567, 'money'), '1,234,567원');
  assert.equal(formatValue(0.4567, 'pct'), '45.7%');
  assert.equal(formatValue(12, 'count'), '12건');
});
