import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyDemandType, seasonalityAvailability } from './demand-profile.ts';

test('수요 간격과 변동계수 제곱으로 SBC 네 가지 수요 유형을 분류한다', () => {
  assert.equal(classifyDemandType(1.1, 0.2), 'SMOOTH');
  assert.equal(classifyDemandType(1.5, 0.2), 'INTERMITTENT');
  assert.equal(classifyDemandType(1.1, 0.6), 'ERRATIC');
  assert.equal(classifyDemandType(1.5, 0.6), 'LUMPY');
});

test('계산 불가 ADI 또는 CV²는 수요 유형으로 임의 분류하지 않는다', () => {
  assert.equal(classifyDemandType(null, 0.2), null);
  assert.equal(classifyDemandType(1.5, null), null);
});

test('24개 기간 미만의 계절성은 false가 아닌 계산 불가로 표시한다', () => {
  assert.deepEqual(seasonalityAvailability(23, 0.4, 0.2), {
    value: null,
    reasonCode: 'INSUFFICIENT_PERIODS',
  });
});

test('충분한 기간의 계절성은 설정된 임계값으로 판정한다', () => {
  assert.deepEqual(seasonalityAvailability(24, 0.2, 0.2), { value: true, reasonCode: null });
  assert.deepEqual(seasonalityAvailability(24, 0.19, 0.2), { value: false, reasonCode: null });
});
