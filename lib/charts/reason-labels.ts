// 차트가 보여 주는 사유 코드의 한국어 문구 — lib/kpi/model.ts · lib/schedule/model.ts 와 같은 방식.
//
// ★ 왜 따로 두는가: 차트는 값이 **없는** 자리를 그리지 않는다. 그러면 화면에는 빈 구간만 남고,
//   보는 사람은 "왜 없는지"를 알 수 없다. 사유 코드는 그 빈자리의 유일한 설명이므로 반드시
//   함께 보여야 하고, 영문 코드 그대로는 설명이 아니다.
// ★ 각 코드는 **서로 다른 사실**을 주장한다. "예측이 아직 없다"와 "예측은 있는데 구간만 없다"를
//   한 문구로 뭉뚱그리면 사유 코드를 세 개로 나눠 둔 뷰의 설계가 화면에서 사라진다.

import { STATUS_REASON_LABELS } from '../status.ts';

/**
 * 차트가 마주칠 수 있는 사유 코드 전부.
 *
 * ★ 출처는 뷰 정의를 직접 읽어 뽑았다(2026-09-13 배포 DB):
 *   - `analytics.v_demand_series` actual_reason_code  → NO_ACTUAL_USAGE
 *   - 〃 predicted_reason_code → PREDICTED_QTY_NULL · NO_CHAMPION_SELECTION ·
 *     NO_CHAMPION_MODEL · PERIOD_NOT_FORECASTED
 *   - 〃 band_reason_code → BAND_UNAVAILABLE, 그 밖에는 predicted_reason_code 를 그대로 물려받음
 *   - `analytics.v_shipment_monthly_rollup` trend_reason_code →
 *     INSUFFICIENT_TRAILING_HISTORY · TRAILING_AVG_ZERO
 *   - `lib/analytics/model.ts` 정규화가 만드는 UNKNOWN_ROLLUP_LEVEL
 *   - `analytics.v_ol_accuracy` reason_code → NO_ACTUAL
 *   - 화면이 만드는 MONTH_ROW_ABSENT(행이 아예 없는 달)
 */
export const CHART_REASON_CODES = [
  'NO_ACTUAL_USAGE',
  'PREDICTED_QTY_NULL',
  'NO_CHAMPION_SELECTION',
  'NO_CHAMPION_MODEL',
  'PERIOD_NOT_FORECASTED',
  'BAND_UNAVAILABLE',
  'INSUFFICIENT_TRAILING_HISTORY',
  'TRAILING_AVG_ZERO',
  'UNKNOWN_ROLLUP_LEVEL',
  'NO_ACTUAL',
  'MONTH_ROW_ABSENT',
  'CALCULATION_UNAVAILABLE',
] as const;

export type ChartReasonCode = (typeof CHART_REASON_CODES)[number];

export const CHART_REASON_LABELS: Record<ChartReasonCode, string> = {
  NO_ACTUAL_USAGE: '이 달의 실적(사용 이력)이 없습니다',
  PREDICTED_QTY_NULL: '예측 행은 있으나 예측값이 비어 있습니다',
  NO_CHAMPION_SELECTION: 'Champion 모델을 고른 기록이 없습니다',
  NO_CHAMPION_MODEL: 'Champion 으로 선정된 모델이 없습니다',
  PERIOD_NOT_FORECASTED: '이 기간은 예측 대상이 아닙니다',
  BAND_UNAVAILABLE: '예측값은 있으나 p80·p90 구간이 없습니다',
  INSUFFICIENT_TRAILING_HISTORY: '직전 6개월 관측이 3개월 미만이라 비교하지 않습니다',
  TRAILING_AVG_ZERO: '직전 6개월 평균이 0이라 배수를 낼 수 없습니다',
  UNKNOWN_ROLLUP_LEVEL: '알 수 없는 집계 수준이라 어느 계열인지 정하지 못했습니다',
  NO_ACTUAL: '채점할 실적이 없습니다',
  MONTH_ROW_ABSENT: '이 달은 출고 기록 자체가 없습니다',
  // ★ 문구 출처를 하나로 둔다 — lib/status.ts 가 이미 같은 코드를 쓰고 있었는데 문구가 달랐다
  //   ('계산 불가' vs '계산할 수 없습니다'). 한 코드에 한국어가 둘이면 화면마다 다른 말이 된다.
  // ★ 코드 자체는 CHART_REASON_CODES 에 **그대로 남긴다.** 목록에서 빼면 chartReasonLabel() 의
  //   폴백이 영문 코드를 그대로 내보내고(사유 코드를 영문으로 노출하지 않는다는 규칙 위반),
  //   "모든 코드에 한국어 문구가 있다" 시험의 보호까지 함께 사라진다 — 둘 다 없어져 아무것도
  //   남지 않는다. 이 코드는 장식이 아니다: lib/charts/ol-accuracy.ts 의 bar() 가
  //   `reasonCode ?? 'CALCULATION_UNAVAILABLE'` 로 쓰므로 실제로 화면에 닿는다.
  // ★ 이 연결을 지키는 것은 **타입이 아니라 시험이다.** STATUS_REASON_LABELS 가
  //   Record<string, string> 이라 키가 사라져도 컴파일되고 값만 undefined 가 된다(탐침으로 확인).
  //   그 상황은 reason-labels.test.ts 의 `label !== undefined && label.length > 0` 이 잡는다.
  CALCULATION_UNAVAILABLE: STATUS_REASON_LABELS.CALCULATION_UNAVAILABLE,
};

/**
 * 사유 코드 → 화면 문구. 모르는 코드는 코드를 그대로 돌려준다(저장소의 기존 규칙).
 *
 * ★ 모르는 코드를 감추지 않는 이유: 없애 버리면 "사유가 없다"가 되어 **빈자리에 설명이 사라진다.**
 *   대신 위 목록이 뷰가 낼 수 있는 코드를 전부 덮는지를 시험으로 고정한다 — 화면에 영문 코드가
 *   나오는 상황 자체가 시험 실패로 잡히게 하는 것이 라벨 누락을 막는 실제 장치다.
 */
export function chartReasonLabel(code: string | null): string | null {
  if (code === null || code === '') return null;
  return (CHART_REASON_LABELS as Record<string, string>)[code] ?? code;
}
