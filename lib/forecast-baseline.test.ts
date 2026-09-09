import assert from 'node:assert/strict';
import test from 'node:test';
import { canProduceBaseline, validateModelParameters } from './forecast-baseline.ts';

test('이동평균 모델은 필요한 학습 기간이 모두 있을 때만 실행 가능하다', () => {
  assert.equal(canProduceBaseline('MA_3M', { availablePeriods: 3, hasSameMonthLastYear: false, hasSeasonalHistory: false }), true);
  assert.equal(canProduceBaseline('MA_3M', { availablePeriods: 2, hasSameMonthLastYear: false, hasSeasonalHistory: false }), false);
  assert.equal(canProduceBaseline('MA_6M', { availablePeriods: 6, hasSameMonthLastYear: false, hasSeasonalHistory: false }), true);
  assert.equal(canProduceBaseline('MA_6M', { availablePeriods: 5, hasSameMonthLastYear: false, hasSeasonalHistory: false }), false);
});

test('PY 및 Seasonal Naive는 필요한 과거 관측치가 없으면 결과 생성을 허용하지 않는다', () => {
  assert.equal(canProduceBaseline('PY_SAME_MONTH', { availablePeriods: 24, hasSameMonthLastYear: false, hasSeasonalHistory: true }), false);
  assert.equal(canProduceBaseline('PY_SAME_MONTH', { availablePeriods: 24, hasSameMonthLastYear: true, hasSeasonalHistory: true }), true);
  assert.equal(canProduceBaseline('SEASONAL_NAIVE', { availablePeriods: 24, hasSameMonthLastYear: true, hasSeasonalHistory: false }), false);
});

test('WMA_3M은 DB 파라미터의 최근순 3:2:1 가중치만 허용한다', () => {
  assert.deepEqual(validateModelParameters('WMA_3M', { weights: [3, 2, 1] }), { valid: true });
  assert.deepEqual(validateModelParameters('WMA_3M', { weights: [1, 1, 1] }), { valid: false, reasonCode: 'INVALID_WEIGHTS' });
});

test('지원하지 않는 수요 유형은 model config가 명시적으로 차단한다', () => {
  assert.deepEqual(validateModelParameters('MA_3M', { applicableDemandType: ['SMOOTH', 'ERRATIC'] }), { valid: true });
  assert.deepEqual(validateModelParameters('MA_3M', { applicableDemandType: ['UNKNOWN'] }), { valid: false, reasonCode: 'INVALID_DEMAND_TYPE' });
});
