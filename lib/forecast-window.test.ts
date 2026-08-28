import test from 'node:test';
import assert from 'node:assert/strict';
import { isIsolatedForecastWindow } from './forecast-window.ts';

test('기간 설정이 비어 있으면 학습과 검증을 차단한다', () => {
  assert.equal(isIsolatedForecastWindow({ trainStart: null, trainEnd: null, testStart: null, testEnd: null, granularity: 'DAY' }), false);
});

test('학습과 검증 기간이 겹치면 차단한다', () => {
  assert.equal(isIsolatedForecastWindow({ trainStart: '2026-01-01', trainEnd: '2026-03-31', testStart: '2026-03-31', testEnd: '2026-04-30', granularity: 'DAY' }), false);
});

test('인접하지만 겹치지 않는 기간만 격리된 설정으로 인정한다', () => {
  assert.equal(isIsolatedForecastWindow({ trainStart: '2026-01-01', trainEnd: '2026-03-31', testStart: '2026-04-01', testEnd: '2026-04-30', granularity: 'MONTH' }), true);
});
