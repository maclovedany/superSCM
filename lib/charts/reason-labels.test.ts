import assert from 'node:assert/strict';
import test from 'node:test';

import { CHART_REASON_CODES, CHART_REASON_LABELS, chartReasonLabel } from './reason-labels.ts';

/**
 * 화면에 닿을 수 있는 사유 코드 목록 — 2026-09-13 배포 DB 의 뷰 정의를 직접 읽어 뽑았고,
 * 화면 코드가 폴백으로 만들어 내는 코드도 함께 둔다(출처별 소절 참고).
 * 뷰에 분기가 하나 늘면 이 시험이 먼저 깨져서 라벨 없는 코드가 화면에 새는 것을 막는다.
 *
 * ★ 이 목록이 지키는 것: 어떤 코드가 CHART_REASON_CODES 에서 **지워지는** 것. 완전성(:36)·
 *   구별성(:44) 가드는 CHART_REASON_CODES 를 돌기 때문에, 목록에서 빠진 코드는 그 두 가드의
 *   검사 대상에서도 조용히 빠진다. 여기 적힌 코드는 그 제거를 잡는다(2026-09-13 리뷰 ④-b).
 */
const CODES_THE_VIEWS_CAN_EMIT = [
  // analytics.v_demand_series
  'NO_ACTUAL_USAGE',
  'PREDICTED_QTY_NULL',
  'NO_CHAMPION_SELECTION',
  'NO_CHAMPION_MODEL',
  'PERIOD_NOT_FORECASTED',
  'BAND_UNAVAILABLE',
  // analytics.v_shipment_monthly_rollup (+ lib/analytics/model.ts 정규화)
  'INSUFFICIENT_TRAILING_HISTORY',
  'TRAILING_AVG_ZERO',
  'UNKNOWN_ROLLUP_LEVEL',
  // analytics.v_ol_accuracy
  'NO_ACTUAL',
  // 화면 코드가 만드는 폴백 — 뷰가 내지 않는다. lib/charts/ol-accuracy.ts:46 의
  // `reasonCode ?? 'CALCULATION_UNAVAILABLE'`. 문구는 lib/status.ts 를 참조하지만 코드 자체는
  // CHART_REASON_CODES 에 남아야 하고, 이 항목이 그 제거를 잡는다.
  'CALCULATION_UNAVAILABLE',
];

test('사유 코드 — 뷰가 낼 수 있는 코드가 전부 목록에 있다', () => {
  for (const code of CODES_THE_VIEWS_CAN_EMIT) {
    assert.ok(
      (CHART_REASON_CODES as readonly string[]).includes(code),
      `${code} 가 CHART_REASON_CODES 에 없습니다 — 화면에 영문 코드가 그대로 나옵니다.`,
    );
  }
});

test('사유 코드 — 모든 코드에 한국어 문구가 있다(영문 코드 그대로 노출 금지)', () => {
  for (const code of CHART_REASON_CODES) {
    const label = CHART_REASON_LABELS[code];
    assert.ok(label !== undefined && label.length > 0, `${code} 에 문구가 없습니다.`);
    assert.notEqual(label, code, `${code} 의 문구가 코드 그대로입니다.`);
    assert.match(label, /[가-힣]/, `${code} 의 문구에 한국어가 없습니다.`);
  }
});

test('사유 코드 — 문구가 서로 다르다(서로 다른 사실을 같은 말로 뭉뚱그리지 않는다)', () => {
  const labels = CHART_REASON_CODES.map((code) => CHART_REASON_LABELS[code]);
  assert.equal(new Set(labels).size, labels.length);
});

test('사유 코드 — "예측이 없다"와 "구간만 없다"는 다른 문구다', () => {
  assert.notEqual(CHART_REASON_LABELS.PERIOD_NOT_FORECASTED, CHART_REASON_LABELS.BAND_UNAVAILABLE);
});

test('사유 코드 — null 은 문구도 null 이다(없는 사유를 지어내지 않는다)', () => {
  assert.equal(chartReasonLabel(null), null);
  assert.equal(chartReasonLabel(''), null);
});

test('사유 코드 — 아는 코드는 한국어로 바꾼다', () => {
  assert.equal(chartReasonLabel('NO_ACTUAL_USAGE'), '이 달의 실적(사용 이력)이 없습니다');
});
