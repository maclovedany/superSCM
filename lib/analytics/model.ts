// 차트 데이터 타입 — analytics.v_demand_series · v_shipment_monthly_rollup · v_shipment_monthly_item
// (chart-views 트랙, 20260912001000). 화면(차트 컴포넌트)은 다른 트랙이 만든다 — 여기서는
// 뷰가 이미 계산해 둔 값을 화면 타입으로 옮기기만 한다. 새로 집계하지 않는다.
//
// ★ 사유 코드는 절대 값으로 채우지 않는다 — null + reasonCode를 그대로 유지한다(AGENTS.md 5번
//   규칙, analytics.v_demand_series 머리 주석 참고).

function value(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null) return row[key];
  return undefined;
}

function text(row: Record<string, unknown>, keys: string[]): string | null {
  const raw = value(row, keys);
  return raw === undefined || raw === null || raw === '' ? null : String(raw);
}

function numberValue(row: Record<string, unknown>, keys: string[]): number | null {
  const raw = value(row, keys);
  if (raw === undefined || raw === null || raw === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 수요 실적 vs 예측(Champion 모델) 월별 시계열 — analytics.v_demand_series 한 행.
 *
 * ★ 실적 달과 예측 기간의 합집합이다 — 한쪽만 있는 (item, period)도 행으로 남는다. 화면은
 *   actualQty와 predictedQty를 서로 다른 계열로 그리고, 값이 없는 구간은 이어 그리지 않는다
 *   (끊어진 선 = 갭. 0으로 채우면 "실제로 0이었다"는 거짓 신호가 된다).
 * ★ 사유 코드 3개는 서로 다른 사실만 주장한다 — actualReasonCode(실적 결측)
 *   predictedReasonCode(예측 결측: NO_CHAMPION_SELECTION · NO_CHAMPION_MODEL ·
 *   PERIOD_NOT_FORECASTED) · bandReasonCode(밴드만 결측: BAND_UNAVAILABLE, 또는 예측 자체가
 *   없으면 predictedReasonCode를 그대로 물려받는다).
 */
export type DemandSeriesPoint = {
  itemId: string;
  itemName: string;
  /** 월 첫날(YYYY-MM-01) */
  period: string;
  actualQty: number | null;
  actualReasonCode: string | null;
  /** Champion으로 선정된 모델 id. 예측 행이 없으면 null */
  modelId: string | null;
  predictedQty: number | null;
  predictedReasonCode: string | null;
  p80: number | null;
  p90: number | null;
  bandReasonCode: string | null;
};

export function normalizeDemandSeriesPoint(row: Record<string, unknown>): DemandSeriesPoint {
  return {
    itemId: String(value(row, ['item_id']) ?? '미정'),
    itemName: String(value(row, ['item_name']) ?? '미정'),
    period: String(value(row, ['period']) ?? ''),
    actualQty: numberValue(row, ['actual_qty']),
    actualReasonCode: text(row, ['actual_reason_code']),
    modelId: text(row, ['model_id']),
    predictedQty: numberValue(row, ['predicted_qty']),
    predictedReasonCode: text(row, ['predicted_reason_code']),
    p80: numberValue(row, ['p80']),
    p90: numberValue(row, ['p90']),
    bandReasonCode: text(row, ['band_reason_code']),
  };
}

export const SHIPMENT_ROLLUP_LEVELS = ['TOTAL', 'ITEM_TYPE'] as const;
export type ShipmentRollupLevel = (typeof SHIPMENT_ROLLUP_LEVELS)[number];

export function isShipmentRollupLevel(input: unknown): input is ShipmentRollupLevel {
  return typeof input === 'string' && (SHIPMENT_ROLLUP_LEVELS as readonly string[]).includes(input);
}

/**
 * 출고 월별 총합(TOTAL) · 품목구분×월(ITEM_TYPE) 롤업 — analytics.v_shipment_monthly_rollup 한 행.
 *
 * ★ qtyVsTrailing6mAvg는 직전 6개월(최소 3개월 관측) 평균 대비 이번 달 배수다. 특정 달을
 *   하드코딩해 이상치로 표시하지 않는다 — 이 값이 크면(예: 2026-07) 화면이 그 사실을 스스로
 *   드러낸다. 관측치가 부족하면(시계열 시작 구간) null + INSUFFICIENT_TRAILING_HISTORY.
 */
export type ShipmentMonthlyRollupRow = {
  level: ShipmentRollupLevel;
  /** level이 TOTAL이면 null */
  itemType: string | null;
  /** YYYY-MM */
  ym: string;
  qty: number;
  qtyVsTrailing6mAvg: number | null;
  trendReasonCode: string | null;
};

export function normalizeShipmentMonthlyRollupRow(row: Record<string, unknown>): ShipmentMonthlyRollupRow {
  const rawLevel = value(row, ['level']);
  return {
    level: isShipmentRollupLevel(rawLevel) ? rawLevel : 'TOTAL',
    itemType: text(row, ['item_type']),
    ym: String(value(row, ['ym']) ?? ''),
    qty: numberValue(row, ['qty']) ?? 0,
    qtyVsTrailing6mAvg: numberValue(row, ['qty_vs_trailing_6m_avg']),
    trendReasonCode: text(row, ['trend_reason_code']),
  };
}

/**
 * 출고 품목×월 — analytics.v_shipment_monthly_item 한 행(HOC 대표코드 기준).
 *
 * ★ 이 뷰는 10만 행대라 PostgREST 1000행 상한에 곧바로 걸린다 — getShipmentMonthlyByItem은
 *   itemCode를 선택 인자가 아니라 필수 인자로 받는다(뷰 머리 주석과 같은 이유).
 */
export type ShipmentMonthlyItemRow = {
  itemCode: string;
  itemType: string | null;
  /** YYYY-MM */
  ym: string;
  qty: number;
  nSourceCodes: number;
};

export function normalizeShipmentMonthlyItemRow(row: Record<string, unknown>): ShipmentMonthlyItemRow {
  return {
    itemCode: String(value(row, ['item_code']) ?? '미정'),
    itemType: text(row, ['item_type']),
    ym: String(value(row, ['ym']) ?? ''),
    qty: numberValue(row, ['qty']) ?? 0,
    nSourceCodes: numberValue(row, ['n_source_codes']) ?? 0,
  };
}
