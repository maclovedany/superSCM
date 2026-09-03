import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOCATION_LABEL,
  ALLOCATION_TONE,
  BUCKET_LABEL,
  FEASIBILITY_LABEL,
  FEASIBILITY_TONE,
  SUPPLY_TONE,
  isExpiringSoon,
  normalizeAtp,
  normalizeFeasibility,
  normalizeInquiryStat,
  normalizePromiseRisk,
  normalizeSalesInquiry,
  normalizeSoftAllocation,
  normalizeSupplyStatus,
  num,
  toAllocationStatus,
  toBucket,
  toFeasibilityStatus,
  toSupplyLabel,
  type SoftAllocation,
} from './atp-model.ts';

// ATP · 가예약 · 영업 문의 — renew.prd 27장 · 28.3
//
// 조회 함수(lib/atp.ts)는 Supabase 를 부르므로 여기서 시험하지 않습니다.
// 이 파일이 보는 것은 "틀리면 조용히 잘못 보이는" 것들입니다.
//   ① renew.prd 27.4 의 응답 상태 4종이 정확히 그 4종이다
//   ② 계산 불가와 0 을 섞지 않는다 (AGENTS.md 규칙 5)
//   ③ BEYOND 구간은 수량이 아니라 날짜로 답한다

/** renew.prd 27.4 */
const PRD_STATUSES = [
  'AVAILABLE',
  'CONDITIONALLY_AVAILABLE',
  'UNAVAILABLE',
  'UNKNOWN',
] as const;

// ── ① 응답 상태 4종 ──────────────────────────────────────────

test('renew.prd 27.4 의 응답 상태가 정확히 4종이다', () => {
  assert.deepEqual(Object.keys(FEASIBILITY_LABEL).sort(), [...PRD_STATUSES].sort());
  assert.deepEqual(Object.keys(FEASIBILITY_TONE).sort(), [...PRD_STATUSES].sort());
});

test('상태 4종이 각각 다른 톤을 갖는다 — 색만 보고도 구별된다', () => {
  const tones = PRD_STATUSES.map((status) => FEASIBILITY_TONE[status]);
  assert.equal(new Set(tones).size, 4);
});

test('모르는 상태 문자열은 UNKNOWN 이 된다 — 지어내지 않는다', () => {
  for (const status of PRD_STATUSES) {
    assert.equal(toFeasibilityStatus(status), status);
  }
  for (const value of ['MAYBE', '', null, undefined, 42, 'available']) {
    assert.equal(toFeasibilityStatus(value), 'UNKNOWN', String(value));
  }
});

test('구간 4종과 가예약 상태 3종의 라벨이 빠짐없이 있다', () => {
  assert.deepEqual(Object.keys(BUCKET_LABEL).sort(), ['1M', '2W', 'BEYOND', 'NOW']);
  assert.deepEqual(Object.keys(ALLOCATION_LABEL).sort(), ['CONFIRMED', 'RELEASED', 'RESERVED']);
  assert.deepEqual(Object.keys(ALLOCATION_TONE).sort(), ['CONFIRMED', 'RELEASED', 'RESERVED']);
  assert.deepEqual(Object.keys(SUPPLY_TONE).sort(), ['불가', '안전', '주의']);
});

test('모르는 구간 · 상태는 안전한 기본값으로 좁혀진다', () => {
  assert.equal(toBucket('BEYOND'), 'BEYOND');
  assert.equal(toBucket('LATER'), 'NOW');
  assert.equal(toAllocationStatus('CONFIRMED'), 'CONFIRMED');
  assert.equal(toAllocationStatus('WHATEVER'), 'RESERVED');
  assert.equal(toSupplyLabel('불가'), '불가');
  assert.equal(toSupplyLabel('위험'), null);
  assert.equal(toSupplyLabel(null), null);
});

// ── ② 정규화 — 계산 불가와 0 을 섞지 않는다 ──────────────────

test('num 은 빈 값을 null 로 두고 0 을 0 으로 둔다', () => {
  assert.equal(num(0), 0);
  assert.equal(num('0'), 0);
  assert.equal(num(null), null);
  assert.equal(num(undefined), null);
  assert.equal(num(''), null);
  assert.equal(num('없음'), null);
  assert.equal(num('1250'), 1250);
});

const ATP_ROW = {
  item_id: 'ITEM012',
  item_name: 'EMI 필터 모듈',
  bucket: '2W',
  bucket_ord: 2,
  bucket_until: '2026-09-17',
  available_now: 553,
  confirmed_incoming: 350,
  committed_demand: 0,
  soft_allocation: 100,
  protected_safety_stock: 292,
  atp_qty: 511,
  earliest_new_supply_date: null,
  lead_time: 16,
  lead_time_confidence: 'HIGH',
  delivery_buffer_days: 5,
  data_snapshot_at: '2026-09-03T00:00:00Z',
  reason: null,
};

test('analytics.v_atp 한 줄을 그대로 옮긴다', () => {
  const row = normalizeAtp(ATP_ROW);
  assert.equal(row.itemId, 'ITEM012');
  assert.equal(row.bucket, '2W');
  assert.equal(row.atpQty, 511);
  assert.equal(row.softAllocation, 100);
  assert.equal(row.protectedSafetyStock, 292);
  assert.equal(row.leadTimeConfidence, 'HIGH');
  assert.equal(row.reason, null);
});

test('★ BEYOND 구간은 수량이 없고 날짜만 있다', () => {
  // "그 이후" 는 지금 있는 재고로 답하는 값이 아니라 "발주하면 언제 확보되는가" 입니다.
  // 숫자를 하나 적어 두면 영업이 그 수량을 약속합니다 (sql/23 §5 주석).
  const row = normalizeAtp({
    ...ATP_ROW,
    bucket: 'BEYOND',
    bucket_ord: 4,
    bucket_until: null,
    atp_qty: null,
    earliest_new_supply_date: '2026-09-24',
  });
  assert.equal(row.bucket, 'BEYOND');
  assert.equal(row.bucketUntil, null);
  assert.equal(row.atpQty, null);
  assert.equal(row.earliestNewSupplyDate, '2026-09-24');
});

test('산출 불가 행은 수량이 null 이고 사유 코드가 붙는다', () => {
  const row = normalizeAtp({
    ...ATP_ROW,
    available_now: null,
    atp_qty: null,
    protected_safety_stock: null,
    reason: 'NO_INVENTORY_DATA',
  });
  assert.equal(row.atpQty, null);
  assert.equal(row.availableNow, null);
  assert.equal(row.reason, 'NO_INVENTORY_DATA');
});

test('알 수 없는 사유 문자열은 null 이 된다 — 화면이 모르는 코드를 그리지 않는다', () => {
  assert.equal(normalizeAtp({ ...ATP_ROW, reason: 'SOMETHING_NEW' }).reason, null);
  // NO_USAGE 는 옛 뷰의 표기입니다. lib/status.ts 가 받아 줍니다.
  assert.equal(normalizeAtp({ ...ATP_ROW, reason: 'NO_USAGE' }).reason, 'NO_USAGE_HISTORY');
});

test('core.check_order_feasibility 의 jsonb 를 좁힌다 (renew.prd 27.5 의 키)', () => {
  const data = normalizeFeasibility({
    status: 'CONDITIONALLY_AVAILABLE',
    feasible: true,
    available_qty: 620,
    requested_qty: 500,
    projected_inventory_after_order: 240,
    safety_stock: 180,
    risk: 'WARNING',
    earliest_safe_date: '2026-10-10',
    lead_time_used: 44,
    lead_time_confidence: 'HIGH',
    data_snapshot_at: '2026-10-01T09:00:00Z',
    reason: null,
    item_id: 'ITEM012',
    item_name: 'EMI 필터 모듈',
    bucket: '1M',
    bucket_until: '2026-10-15',
    target_date: '2026-10-10',
    atp_now: 180,
    atp_2w: 300,
    atp_1m: 620,
    confirmed_incoming: 440,
    committed_demand: 0,
    soft_allocation: 0,
    earliest_new_supply_date: '2026-11-20',
    delivery_buffer_days: 5,
    projection_horizon_end: '2026-11-14',
  });

  assert.equal(data.status, 'CONDITIONALLY_AVAILABLE');
  assert.equal(data.feasible, true);
  assert.equal(data.availableQty, 620);
  assert.equal(data.requestedQty, 500);
  assert.equal(data.projectedInventoryAfterOrder, 240);
  assert.equal(data.safetyStock, 180);
  assert.equal(data.risk, 'WARNING');
  assert.equal(data.earliestSafeDate, '2026-10-10');
  assert.equal(data.leadTimeUsed, 44);
  assert.equal(data.atpNow, 180);
  assert.equal(data.atp1m, 620);
  assert.equal(data.projectionHorizonEnd, '2026-11-14');
});

test('판정 불가 응답은 수량이 전부 null 이고 risk 가 CALCULATION_UNAVAILABLE 이다', () => {
  const data = normalizeFeasibility({
    status: 'UNKNOWN',
    feasible: false,
    available_qty: null,
    requested_qty: 500,
    projected_inventory_after_order: null,
    safety_stock: null,
    risk: 'CALCULATION_UNAVAILABLE',
    earliest_safe_date: null,
    lead_time_used: null,
    lead_time_confidence: null,
    data_snapshot_at: null,
    reason: 'NO_INVENTORY_DATA',
  });

  assert.equal(data.status, 'UNKNOWN');
  assert.equal(data.feasible, false);
  assert.equal(data.availableQty, null);
  assert.equal(data.risk, 'CALCULATION_UNAVAILABLE');
  assert.equal(data.reason, 'NO_INVENTORY_DATA');
});

test('feasible 은 참일 때만 참이다 — 없으면 false 로 둡니다', () => {
  assert.equal(normalizeFeasibility({ feasible: true }).feasible, true);
  assert.equal(normalizeFeasibility({ feasible: 'true' }).feasible, true);
  assert.equal(normalizeFeasibility({ feasible: false }).feasible, false);
  assert.equal(normalizeFeasibility({}).feasible, false);
});

test('영업용 수급 상태를 좁힌다 — 판정 불가는 status 가 null 이다', () => {
  const row = normalizeSupplyStatus({
    item_id: 'ITEM020',
    item_name: '세라믹 지그',
    status: null,
    risk_status: 'CALCULATION_UNAVAILABLE',
    reason: 'NO_FORECAST',
    atp_now: null,
    atp_2w: null,
    atp_1m: null,
    earliest_new_supply_date: '2026-09-28',
    lead_time: 23,
    data_snapshot_at: null,
  });
  assert.equal(row.status, null);
  assert.equal(row.riskStatus, 'CALCULATION_UNAVAILABLE');
  assert.equal(row.reason, 'NO_FORECAST');
  assert.equal(row.atpNow, null);
  // 판정을 못 해도 "발주하면 언제" 는 답할 수 있습니다.
  assert.equal(row.earliestNewSupplyDate, '2026-09-28');
});

test('★ 수급이 불가여도 즉시 수량이 남아 있을 수 있다', () => {
  // status 는 앞으로의 전망(리드타임 안에 결품)이고 atp_now 는 지금 약속 가능한 수량입니다.
  // 둘을 같은 것으로 접으면 팔 수 있는 재고를 못 팝니다 (sql/23 의 v_sales_supply_status 주석).
  const row = normalizeSupplyStatus({
    item_id: 'ITEM019',
    status: '불가',
    risk_status: 'CRITICAL',
    reason: null,
    atp_now: 565,
  });
  assert.equal(row.status, '불가');
  assert.equal(row.atpNow, 565);
});

test('납기 위험 수주를 좁힌다', () => {
  const row = normalizePromiseRisk({
    so_no: 'SO-1001',
    item_id: 'ITEM012',
    item_name: 'EMI 필터 모듈',
    customer: '가나상사',
    due_date: '2026-09-20',
    qty: 500,
    cumulative_committed_qty: 900,
    supply_by_due_date: 620,
    shortfall_qty: 280,
    days_to_due: 17,
    atp_now: 0,
    earliest_new_supply_date: '2026-10-22',
  });
  assert.equal(row.soNo, 'SO-1001');
  assert.equal(row.shortfallQty, 280);
  assert.equal(row.daysToDue, 17);
  assert.equal(row.atpNow, 0);
});

test('가예약 한 줄을 좁힌다', () => {
  const row = normalizeSoftAllocation({
    allocation_id: 7,
    item_id: 'ITEM017',
    item_name: '동선 0.3mm',
    qty: 100,
    status: 'RESERVED',
    customer: '가나상사',
    valid_until: '2026-09-10',
    days_left: 7,
    requested_email: 'sales@example.com',
    created_at: '2026-09-03T00:00:00Z',
    released_at: null,
  });
  assert.equal(row.allocationId, 7);
  assert.equal(row.status, 'RESERVED');
  assert.equal(row.daysLeft, 7);
  assert.equal(row.releasedAt, null);
});

test('문의 이력에서 "아직 답이 없다" 와 "판단 불가로 답했다" 를 구별한다', () => {
  const pending = normalizeSalesInquiry({ inquiry_id: 1, item_id: 'ITEM012', answer_status: null });
  assert.equal(pending.answerStatus, null);

  const unknown = normalizeSalesInquiry({
    inquiry_id: 2,
    item_id: 'ITEM012',
    answer_status: 'UNKNOWN',
  });
  assert.equal(unknown.answerStatus, 'UNKNOWN');

  const converted = normalizeSalesInquiry({
    inquiry_id: 3,
    item_id: 'ITEM012',
    answer_status: 'AVAILABLE',
    converted_to_order: true,
  });
  assert.equal(converted.answerStatus, 'AVAILABLE');
  assert.equal(converted.convertedToOrder, true);
  assert.equal(pending.convertedToOrder, false);
});

test('문의 통계의 전환율은 비율이다 (0~1)', () => {
  const row = normalizeInquiryStat({
    item_id: 'ITEM012',
    item_name: 'EMI 필터 모듈',
    n_inquiries: 12,
    n_unavailable: 4,
    n_available: 6,
    n_converted: 3,
    conversion_rate: 0.25,
    last_asked_at: '2026-09-03T00:00:00Z',
  });
  assert.equal(row.inquiries, 12);
  assert.equal(row.unavailable, 4);
  assert.equal(row.conversionRate, 0.25);
});

// ── ③ 만료 임박 ───────────────────────────────────────────────

function allocation(patch: Partial<SoftAllocation>): SoftAllocation {
  return normalizeSoftAllocation({
    allocation_id: 1,
    item_id: 'ITEM012',
    qty: 100,
    status: 'RESERVED',
    valid_until: '2026-09-10',
    days_left: 7,
    ...Object.fromEntries(
      Object.entries({
        status: patch.status,
        days_left: patch.daysLeft,
      }).filter(([, value]) => value !== undefined),
    ),
  });
}

test('만료 임박은 RESERVED 이고 남은 일수가 기준 이하일 때만이다', () => {
  assert.equal(isExpiringSoon(allocation({ daysLeft: 3 }), 3), true);
  assert.equal(isExpiringSoon(allocation({ daysLeft: 0 }), 3), true);
  assert.equal(isExpiringSoon(allocation({ daysLeft: -2 }), 3), true, '이미 만료된 것도 임박입니다');
  assert.equal(isExpiringSoon(allocation({ daysLeft: 4 }), 3), false);
});

test('확정되었거나 해제된 가예약은 만료 임박이 아니다', () => {
  assert.equal(isExpiringSoon(allocation({ status: 'CONFIRMED', daysLeft: 1 }), 3), false);
  assert.equal(isExpiringSoon(allocation({ status: 'RELEASED', daysLeft: 1 }), 3), false);
});

test('남은 일수를 모르면 임박으로 보지 않는다 — 모른다를 경고로 접지 않는다', () => {
  assert.equal(isExpiringSoon(allocation({ daysLeft: null }), 3), false);
});
