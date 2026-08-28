import assert from 'node:assert/strict';
import test from 'node:test';
import { backtestMetricAvailability, biasDirection, validateManualChampionReason } from './backtest-policy.ts';

test('actual 합계가 0이면 WAPE를 계산 불가로 유지한다', () => {
  assert.deepEqual(backtestMetricAvailability({ matchedPeriods: 3, actualAbsoluteSum: 0, mapeNonzeroPeriods: 0 }), {
    wape: 'WAPE_ZERO_DENOMINATOR', mape: 'MAPE_ZERO_DENOMINATOR', reasonCode: 'WAPE_ZERO_DENOMINATOR',
  });
});

test('Bias 양수는 과대예측, 음수는 과소예측으로 해석한다', () => {
  assert.equal(biasDirection(12), 'OVER_FORECAST');
  assert.equal(biasDirection(-12), 'UNDER_FORECAST');
  assert.equal(biasDirection(null), 'CALCULATION_UNAVAILABLE');
});

test('수동 Champion 지정에는 빈 사유를 허용하지 않는다', () => {
  assert.equal(validateManualChampionReason(''), false);
  assert.equal(validateManualChampionReason('  '), false);
  assert.equal(validateManualChampionReason('계절성 행사 대응 모델로 변경'), true);
});
