import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECOMMENDATION_CSV_HEADER,
  normalizeConsensusRow,
  normalizeItemPolicy,
  normalizePurchaseRecommendation,
  normalizePurchaseRecommendationKpi,
  normalizeSafetyStock,
  normalizeServiceLevel,
  normalizeSkuDetail,
  bool,
  num,
  recommendationCsvRow,
  toConfidence,
  toServiceLevelSource,
  toSigmaSource,
} from './recommendation-model.ts';

// 여기서 검사하는 것은 "뷰 한 줄 → 화면이 쓰는 모양" 뿐입니다.
// 계산은 전부 SQL 이 끝냈으므로 검산할 계산이 없습니다 (AGENTS.md 규칙 2).
//
// 대신 이 파일이 지키는 계약은 하나입니다 —
// 뷰가 null 을 준 자리에 0 이 들어가면 안 됩니다 (AGENTS.md 규칙 5 · design.md §8.2).

// ── num ───────────────────────────────────────────────────────

test('num 은 빈 값과 숫자가 아닌 값을 null 로 둔다', () => {
  assert.equal(num(null), null);
  assert.equal(num(undefined), null);
  assert.equal(num(''), null);
  assert.equal(num('abc'), null);
  assert.equal(num(0), 0);
  assert.equal(num('1620'), 1620);
  // PostgREST 는 numeric 을 문자열로 내려 줍니다
  assert.equal(num('402.75'), 402.75);
});

// ── enum 정규화 ───────────────────────────────────────────────

test('모르는 enum 값은 지어내지 않고 null 로 둔다', () => {
  assert.equal(toConfidence('HIGH'), 'HIGH');
  assert.equal(toConfidence('low'), null);
  assert.equal(toServiceLevelSource('GRADE'), 'GRADE');
  assert.equal(toServiceLevelSource('WHATEVER'), null);
  assert.equal(toSigmaSource('BACKTEST'), 'BACKTEST');
  assert.equal(toSigmaSource('IN_SAMPLE'), 'IN_SAMPLE');
  assert.equal(toSigmaSource(null), null);
});

// ── 발주 추천 ─────────────────────────────────────────────────

const recommendationRow = {
  item_id: 'ITEM001',
  item_name: '드럼 유닛',
  supplier_id: 'SUP001',
  supplier_name: 'Fujifilm BI Japan',
  current_inventory: '1250',
  incoming_qty: '300',
  available_qty: '1550',
  incoming_eta: '2026-10-14',
  forecast_qty: '1500.5',
  committed_qty: '120',
  consensus_forecast: '1620',
  lead_time: 42,
  lead_time_confidence: 'MEDIUM',
  review_period_days: '30',
  safety_buffer_days: '3',
  safety_stock: '400',
  stockout_date: '2026-11-02',
  required_order_date: '2026-09-18',
  is_urgent: true,
  raw_recommended_qty: '470',
  moq: '500',
  pack_size: '100',
  final_recommended_qty: '500',
  unit_price: '12000',
  recommended_amount: '6000000',
  risk: 'WARNING',
  reason_code: null,
  explanation: '리드타임 42일 + 검토 30일 동안 수요 1,620 · 안전재고 400 …',
  run_id: 'RUN-2026-09-01',
  data_snapshot_at: '2026-09-01T00:00:00Z',
};

test('발주 추천 한 줄을 화면이 쓰는 모양으로 바꾼다', () => {
  const row = normalizePurchaseRecommendation(recommendationRow);

  assert.equal(row.itemId, 'ITEM001');
  assert.equal(row.supplierName, 'Fujifilm BI Japan');
  assert.equal(row.consensusForecast, 1620);
  assert.equal(row.leadTimeConfidence, 'MEDIUM');
  assert.equal(row.rawRecommendedQty, 470);
  assert.equal(row.finalRecommendedQty, 500);
  assert.equal(row.recommendedAmount, 6_000_000);
  assert.equal(row.risk, 'WARNING');
  assert.equal(row.reasonCode, null);
  assert.equal(row.isUrgent, true);
});

test('산출 불가 행은 수량이 0 이 아니라 null 이고 사유가 남는다', () => {
  const row = normalizePurchaseRecommendation({
    ...recommendationRow,
    current_inventory: null,
    available_qty: null,
    consensus_forecast: null,
    safety_stock: null,
    stockout_date: null,
    required_order_date: null,
    is_urgent: null,
    raw_recommended_qty: null,
    final_recommended_qty: null,
    recommended_amount: null,
    risk: 'CALCULATION_UNAVAILABLE',
    reason_code: 'NO_INVENTORY_DATA',
    explanation: '산출할 수 없습니다: 재고 데이터 없음',
  });

  assert.equal(row.rawRecommendedQty, null);
  assert.equal(row.finalRecommendedQty, null);
  assert.equal(row.recommendedAmount, null);
  assert.equal(row.availableQty, null);
  assert.equal(row.risk, 'CALCULATION_UNAVAILABLE');
  assert.equal(row.reasonCode, 'NO_INVENTORY_DATA');
  // 권고일이 없으면 "긴급이 아니다" 가 아니라 "모른다" 입니다.
  assert.equal(row.isUrgent, null);
});

test('bool 은 모르는 값을 false 로 접지 않는다', () => {
  assert.equal(bool(true), true);
  assert.equal(bool(false), false);
  assert.equal(bool(null), null);
  assert.equal(bool(undefined), null);
  assert.equal(bool(''), null);
  // PostgREST 가 문자열로 내려 주는 경우도 받습니다
  assert.equal(bool('true'), true);
  assert.equal(bool('false'), false);
});

test('발주 불필요(0)와 산출 불가(null)를 섞지 않는다', () => {
  const covered = normalizePurchaseRecommendation({
    ...recommendationRow,
    raw_recommended_qty: '0',
    final_recommended_qty: '0',
    recommended_amount: '0',
    risk: 'SAFE',
    reason_code: null,
  });

  assert.equal(covered.rawRecommendedQty, 0);
  assert.equal(covered.finalRecommendedQty, 0);
  assert.equal(covered.reasonCode, null);
  assert.notEqual(covered.finalRecommendedQty, null);
});

test('모르는 판정 문자열은 산출 불가로 받는다', () => {
  const row = normalizePurchaseRecommendation({ ...recommendationRow, risk: 'UNKNOWN' });
  assert.equal(row.risk, 'CALCULATION_UNAVAILABLE');
});

// ── KPI ───────────────────────────────────────────────────────

test('KPI 의 건수는 0 으로, 합계는 null 로 둔다', () => {
  // 건수가 없으면 진짜 0 건입니다. 합계가 없으면 "합칠 값이 없다" 는 뜻이라 다릅니다.
  const kpi = normalizePurchaseRecommendationKpi({
    n_items: '20',
    n_order_needed: '7',
    n_urgent: '2',
    n_critical: '3',
    n_warning: '5',
    n_unknown: '4',
    total_recommended_qty: null,
    total_recommended_amount: null,
    n_missing_price: '4',
  });

  assert.equal(kpi.itemCount, 20);
  assert.equal(kpi.orderNeededCount, 7);
  assert.equal(kpi.urgentCount, 2);
  assert.equal(kpi.missingPriceCount, 4);
  assert.equal(kpi.totalRecommendedQty, null);
  assert.equal(kpi.totalRecommendedAmount, null);
});

test('KPI 컬럼이 하나도 없으면 건수는 0 이 된다', () => {
  const kpi = normalizePurchaseRecommendationKpi({});
  assert.equal(kpi.itemCount, 0);
  assert.equal(kpi.unknownCount, 0);
  assert.equal(kpi.totalRecommendedAmount, null);
});

// ── 안전재고 ──────────────────────────────────────────────────

test('안전재고 근거를 σ 출처와 함께 읽는다', () => {
  const row = normalizeSafetyStock({
    item_id: 'ITEM003',
    item_name: '정착 벨트',
    supplier_id: 'SUP002',
    item_grade: 'A',
    service_level: '0.98',
    z_value: '2.0537',
    service_level_source: 'GRADE',
    lead_time_days: 37,
    lead_time_sd: '6.4',
    lead_time_confidence: 'LOW',
    daily_demand: '24.2',
    sigma_d_monthly: '180',
    sigma_d: '32.64',
    sigma_source: 'BACKTEST',
    sigma_dlt: '210.4',
    safety_stock: '432',
    reason: null,
  });

  assert.equal(row.serviceLevelSource, 'GRADE');
  assert.equal(row.sigmaSource, 'BACKTEST');
  assert.equal(row.leadTimeConfidence, 'LOW');
  assert.equal(row.safetyStock, 432);
  assert.equal(row.reason, null);
});

test('리드타임 표본이 1건이면 σ_L 은 null 로 남고 사유 코드로 바뀌지 않는다', () => {
  // 표본 부족은 lead_time_confidence 가 드러냅니다. σ_L 을 0 으로 채우지 않습니다.
  const row = normalizeSafetyStock({
    item_id: 'ITEM007',
    lead_time_sd: null,
    lead_time_confidence: 'LOW',
    sigma_dlt: '95.2',
    safety_stock: '196',
    reason: null,
  });

  assert.equal(row.leadTimeSd, null);
  assert.equal(row.leadTimeConfidence, 'LOW');
  assert.equal(row.safetyStock, 196);
  assert.equal(row.reason, null);
});

test('안전재고를 못 내면 사유 코드가 남는다', () => {
  const row = normalizeSafetyStock({
    item_id: 'ITEM011',
    sigma_d: null,
    sigma_source: null,
    sigma_dlt: null,
    safety_stock: null,
    reason: 'INSUFFICIENT_SAMPLE',
  });

  assert.equal(row.safetyStock, null);
  assert.equal(row.sigmaSource, null);
  assert.equal(row.reason, 'INSUFFICIENT_SAMPLE');
});

// ── SKU Detail ────────────────────────────────────────────────

test('SKU Detail 한 줄을 읽는다', () => {
  const row = normalizeSkuDetail({
    item_id: 'ITEM001',
    item_name: '드럼 유닛',
    supplier_name: 'Fujifilm BI Japan',
    country: 'Japan',
    demand_type: 'SMOOTH',
    champion_model_id: 'croston',
    champion_model_name: 'Croston',
    champion_wape: '0.213',
    champion_bias: '-0.04',
    champion_selection_method: 'MANUAL',
    forecast_run_id: 'RUN-2026-09-01',
    forecast_source: 'CHAMPION',
    is_stale: true,
    consensus_forecast: '1620',
    stockout_days: '54',
    lead_time: 42,
    lead_time_source: '확정값',
    lead_time_confidence: 'HIGH',
    safety_stock: '400',
    sigma_dlt: '194.8',
    final_recommended_qty: '500',
    risk: 'WARNING',
    reason_code: null,
    n_overrides: '2',
  });

  assert.equal(row.championSelectionMethod, 'MANUAL');
  assert.equal(row.consensusForecast, 1620);
  assert.equal(row.isStale, true);
  assert.equal(row.leadTimeSource, '확정값');
  assert.equal(row.overrideCount, 2);
  assert.equal(row.risk, 'WARNING');
});

test('Champion 선정 방식이 비면 null 이고, is_stale 이 비면 false 다', () => {
  const row = normalizeSkuDetail({ item_id: 'ITEM002' });
  assert.equal(row.championSelectionMethod, null);
  assert.equal(row.isStale, false);
  assert.equal(row.overrideCount, 0);
  assert.equal(row.safetyStock, null);
});

// ── 입고예정의 창 분해 (renew.prd 22.1 · sql/16) ──────────────
//
// 근거 표가 빼는 값은 진행 중 선적 전량이 아니라 창 안에 도착하는 몫입니다.
// 두 값이 갈리는 순간 표의 뺄셈이 필요량과 맞지 않게 되므로, 화면이 둘을 따로 읽어야 합니다.

test('입고예정을 창 안 · 창 뒤로 나눠 읽고, 전량은 전량대로 남긴다', () => {
  const row = normalizeSkuDetail({
    item_id: 'ITEM003',
    incoming_qty: '157',
    incoming_eta: '2026-09-20',
    incoming_window_end: '2026-10-19',
    incoming_in_window_qty: '0',
    incoming_after_window_qty: '157',
  });

  // KPI 카드가 쓰는 전량은 뜻이 바뀌지 않았습니다.
  assert.equal(row.incomingQty, 157);
  assert.equal(row.incomingWindowEnd, '2026-10-19');
  // 창 안 몫이 진짜 0 이면 0 입니다 — 이건 "모른다" 가 아닙니다.
  assert.equal(row.incomingInWindowQty, 0);
  assert.equal(row.incomingAfterWindowQty, 157);
});

test('창 뒤 물량이 없으면 창 안 몫이 전량과 같고, 창 뒤는 0 이다', () => {
  const row = normalizeSkuDetail({
    item_id: 'ITEM001',
    incoming_qty: '911',
    incoming_window_end: '2026-11-04',
    incoming_in_window_qty: '911',
    incoming_after_window_qty: '0',
  });

  assert.equal(row.incomingInWindowQty, 911);
  assert.equal(row.incomingAfterWindowQty, 0);
});

test('창 컬럼이 없는 뷰에서는 0 이 아니라 null 이다', () => {
  // sql/16 · sql/19 를 아직 실행하지 않은 DB — 컬럼 자체가 없습니다.
  // 0 으로 접으면 근거 표가 "입고예정을 하나도 빼지 않았다" 고 단정하게 됩니다
  // (AGENTS.md 규칙 5).
  const row = normalizeSkuDetail({
    item_id: 'ITEM004',
    incoming_qty: '281',
    incoming_eta: '2026-09-25',
  });

  assert.equal(row.incomingQty, 281);
  assert.equal(row.incomingWindowEnd, null);
  assert.equal(row.incomingInWindowQty, null);
  assert.equal(row.incomingAfterWindowQty, null);
});

test('창을 모르는 품목은 세 컬럼이 전부 null 이다', () => {
  // 리드타임 또는 검토 주기가 없으면 창의 끝을 모르므로 나눌 수도 없습니다.
  const row = normalizeSkuDetail({
    item_id: 'ITEM005',
    incoming_qty: '148',
    incoming_window_end: null,
    incoming_in_window_qty: null,
    incoming_after_window_qty: null,
    raw_recommended_qty: null,
    reason_code: 'NO_LEADTIME',
  });

  assert.equal(row.incomingQty, 148);
  assert.equal(row.incomingWindowEnd, null);
  assert.equal(row.incomingInWindowQty, null);
  assert.equal(row.incomingAfterWindowQty, null);
  assert.equal(row.rawRecommendedQty, null);
});

// ── 정책 ──────────────────────────────────────────────────────

test('서비스 수준 이력 한 줄을 읽는다', () => {
  const row = normalizeServiceLevel({
    item_grade: 'A',
    service_level: '0.98',
    z_value: '2.0537',
    effective_from: '2000-01-01',
    updated_at: '2026-09-01T09:00:00Z',
    is_effective: true,
    is_scheduled: false,
  });

  assert.equal(row.itemGrade, 'A');
  assert.equal(row.serviceLevel, 0.98);
  assert.equal(row.zValue, 2.0537);
  assert.equal(row.effectiveFrom, '2000-01-01');
  assert.equal(row.isEffective, true);
  assert.equal(row.isScheduled, false);
});

test('적용 여부는 뷰가 판정하고 화면은 계산하지 않는다', () => {
  // 미래 날짜로 미리 넣어 둔 행. 화면이 오늘과 비교하지 않도록 뷰가 두 값을 내려 줍니다.
  const scheduled = normalizeServiceLevel({
    item_grade: 'B',
    effective_from: '2027-01-01',
    is_effective: false,
    is_scheduled: true,
  });
  assert.equal(scheduled.isEffective, false);
  assert.equal(scheduled.isScheduled, true);

  // 컬럼이 아직 없으면 둘 다 false — "적용 중" 배지를 함부로 붙이지 않습니다.
  const legacy = normalizeServiceLevel({ item_grade: 'C', effective_from: '2000-01-01' });
  assert.equal(legacy.isEffective, false);
  assert.equal(legacy.isScheduled, false);
});

test('MOQ 와 포장 단위가 비면 null 로 남는다 — 0 은 다른 뜻이다', () => {
  const row = normalizeItemPolicy({
    item_id: 'ITEM005',
    item_name: '토너 카트리지',
    item_grade: null,
    moq: null,
    pack_size: null,
    item_service_level: null,
    applied_service_level: '0.95',
    applied_z_value: '1.65',
    service_level_source: 'DEFAULT',
  });

  assert.equal(row.moq, null);
  assert.equal(row.packSize, null);
  assert.equal(row.itemGrade, null);
  assert.equal(row.itemServiceLevel, null);
  assert.equal(row.appliedServiceLevel, 0.95);
  assert.equal(row.serviceLevelSource, 'DEFAULT');
});

// ── Consensus ─────────────────────────────────────────────────

test('Override 가 없는 기간은 증감이 null 이고 has_override 가 false 다', () => {
  const row = normalizeConsensusRow({
    item_id: 'ITEM001',
    period: '2026-10-01',
    ai_qty: '520',
    override_qty: null,
    consensus_qty: '520',
    p80: '610',
    p90: '680',
    has_override: false,
    reason_code: null,
    reason_text: null,
    override_email: null,
  });

  assert.equal(row.overrideQty, null);
  assert.equal(row.hasOverride, false);
  assert.equal(row.consensusQty, 520);
});

test('Override 가 있으면 증감과 사유가 함께 온다', () => {
  const row = normalizeConsensusRow({
    item_id: 'ITEM001',
    period: '2026-11-01',
    ai_qty: '480',
    override_qty: '-80',
    consensus_qty: '400',
    has_override: true,
    // core.forecast_override.reason_code 의 check 제약(sql/15) 8종 중 하나여야 합니다.
    // 저장될 수 없는 코드를 픽스처에 두면 통과하는 테스트가 실제와 다른 값을 검증합니다.
    reason_code: 'PROMOTION',
    reason_text: '분기 프로모션 축소',
    override_email: 'planner@example.com',
  });

  assert.equal(row.overrideQty, -80);
  assert.equal(row.hasOverride, true);
  assert.equal(row.reasonCode, 'PROMOTION');
});

// ── CSV ───────────────────────────────────────────────────────

test('CSV 한 줄의 칸 수가 머리글과 같다', () => {
  const row = recommendationCsvRow(normalizePurchaseRecommendation(recommendationRow));
  assert.equal(row.length, RECOMMENDATION_CSV_HEADER.length);
});

test('CSV 는 값이 없는 칸을 0 으로 채우지 않는다', () => {
  const row = recommendationCsvRow(
    normalizePurchaseRecommendation({
      ...recommendationRow,
      moq: null,
      pack_size: null,
      unit_price: null,
      recommended_amount: null,
    }),
  );

  // '필요량' 다음이 MOQ · 포장 단위 · 추천 수량 · 단가 · 추천 금액입니다.
  const moqIndex = RECOMMENDATION_CSV_HEADER.indexOf('MOQ');
  assert.equal(row[moqIndex], null);
  assert.equal(row[moqIndex + 1], null);
  assert.equal(row[RECOMMENDATION_CSV_HEADER.indexOf('단가')], null);
  assert.equal(row[RECOMMENDATION_CSV_HEADER.indexOf('추천 금액')], null);
});

test('CSV 는 22.3 의 출력 필드를 전부 담는다', () => {
  for (const label of [
    '품목코드',
    '품목명',
    '공급처코드',
    '현재고',
    '입고예정',
    '적용 수요',
    '리드타임(일)',
    '안전재고',
    '결품 예상일',
    '발주 권고일',
    '필요량',
    'MOQ',
    '포장 단위',
    '추천 수량',
    '판정',
    '사유 코드',
    '설명',
  ]) {
    assert.ok(
      RECOMMENDATION_CSV_HEADER.includes(label as never),
      `CSV 머리글에 '${label}' 이 없습니다`,
    );
  }
});
