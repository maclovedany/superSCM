import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeDemandSeriesPoint,
  normalizeShipmentMonthlyItemRow,
  normalizeShipmentMonthlyRollupRow,
} from './model.ts';

// fix round 1(리뷰 B-2) — qty·nSourceCodes를 `?? 0`으로 지어내면 "값이 없다"와 "실제로 0이었다"가
// 구분되지 않는다. 뷰가 null을 돌려주면 이 함수도 null을 그대로 옮겨야 한다.
test('출고 롤업 — qty가 null이면 0으로 지어내지 않는다', () => {
  const row = normalizeShipmentMonthlyRollupRow({
    level: 'TOTAL', item_type: null, ym: '2026-07', qty: null,
    qty_vs_trailing_6m_avg: null, trend_reason_code: null,
  });
  assert.equal(row.qty, null);
});

test('출고 롤업 — 알 수 없는 level은 조용히 TOTAL로 떨어지지 않는다', () => {
  const row = normalizeShipmentMonthlyRollupRow({
    level: 'UNKNOWN_LEVEL', item_type: 'PART', ym: '2026-07', qty: 100,
    qty_vs_trailing_6m_avg: null, trend_reason_code: null,
  });
  assert.equal(row.level, null);
  assert.equal(row.levelReasonCode, 'UNKNOWN_ROLLUP_LEVEL');
});

test('출고 롤업 — 알려진 level은 그대로, 사유 코드 없음', () => {
  const row = normalizeShipmentMonthlyRollupRow({
    level: 'ITEM_TYPE', item_type: 'PART', ym: '2026-07', qty: 100,
    qty_vs_trailing_6m_avg: 10, trend_reason_code: null,
  });
  assert.equal(row.level, 'ITEM_TYPE');
  assert.equal(row.levelReasonCode, null);
});

test('출고 롤업 — trailing 평균이 정확히 0이면 사유 코드가 있다(TRAILING_AVG_ZERO)', () => {
  const row = normalizeShipmentMonthlyRollupRow({
    level: 'ITEM_TYPE', item_type: 'SUPPLY', ym: '2026-04', qty: 0,
    qty_vs_trailing_6m_avg: null, trend_reason_code: 'TRAILING_AVG_ZERO',
  });
  assert.equal(row.qtyVsTrailing6mAvg, null);
  assert.equal(row.trendReasonCode, 'TRAILING_AVG_ZERO');
});

test('출고 품목×월 — qty·nSourceCodes가 null이면 0으로 지어내지 않는다', () => {
  const row = normalizeShipmentMonthlyItemRow({
    item_code: 'CHSHIP01', item_type: 'PART', ym: '2026-07', qty: null, n_source_codes: null,
  });
  assert.equal(row.qty, null);
  assert.equal(row.nSourceCodes, null);
});

// 밴드는 한쪽만 있어도(부분 밴드) 다른 값으로 채워지지 않는다(fix round 1, 리뷰 B-4).
test('수요 시계열 — p80만 있고 p90이 없으면 p90은 null 그대로다', () => {
  const row = normalizeDemandSeriesPoint({
    item_id: 'CHDEM06', item_name: '차트 테스트 부분밴드', period: '2026-07-01',
    actual_qty: null, actual_reason_code: 'NO_ACTUAL_USAGE',
    model_id: 'MA_3M', predicted_qty: 90, predicted_reason_code: null,
    p80: 95, p90: null, band_reason_code: 'BAND_UNAVAILABLE',
  });
  assert.equal(row.p80, 95);
  assert.equal(row.p90, null);
  assert.equal(row.bandReasonCode, 'BAND_UNAVAILABLE');
});
