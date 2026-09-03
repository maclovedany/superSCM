import test from 'node:test';
import assert from 'node:assert/strict';
import { isRedactedKey, isSalesDepartment, stripForSales, stripToolResult, isSalesActor } from './redact.ts';

// 정보 접근 범위 — renew.prd 4.5
//
// 여기서 지키는 것 셋.
//   ① 영업 판정이 department 규칙 하나로만 이루어진다 (core.is_sales() 와 같은 규칙)
//   ② 영업에게는 단가 · 공급처 · 리드타임 통계 · 정확도가 사라진다
//   ③ SCM 담당자와 관리자에게는 아무것도 사라지지 않는다
//
// ③이 ②만큼 중요합니다. 가리기가 너무 넓으면 SCM 화면과 AI 답변의 숫자가 갈라집니다
// (renew.prd 32).

const SALES = { role: 'USER' as const, department: '영업1팀' };
const SCM = { role: 'USER' as const, department: 'SCM' };
const ADMIN_SALES = { role: 'ADMIN' as const, department: '영업1팀' };

// ── ① 영업 판정 ───────────────────────────────────────────────

test('department 가 영업으로 시작하거나 SALES 를 포함하면 영업이다', () => {
  for (const value of ['영업', '영업1팀', '영업기획', '영업 지원']) {
    assert.equal(isSalesDepartment(value), true, value);
  }
  for (const value of ['SALES', 'Sales Planning', 'sales', '해외SALES']) {
    assert.equal(isSalesDepartment(value), true, value);
  }
});

test('구매 · SCM · 빈 값은 영업이 아니다', () => {
  for (const value of ['구매팀', 'SCM', 'Supply Chain', '경영기획', '', '   ']) {
    assert.equal(isSalesDepartment(value), false, JSON.stringify(value));
  }
  assert.equal(isSalesDepartment(null), false);
  assert.equal(isSalesDepartment(undefined), false);
});

test('앞뒤 공백은 판정에 영향을 주지 않는다', () => {
  assert.equal(isSalesDepartment('  영업2팀  '), true);
  assert.equal(isSalesDepartment('  SCM  '), false);
});

// ── ② 가릴 키 ─────────────────────────────────────────────────

test('단가 · 금액 · 공급처 · 리드타임 통계 · 정확도 키를 가린다', () => {
  const blocked = [
    // 조달 단가 · 발주 금액
    'unit_price',
    'unitPrice',
    'recommended_amount',
    'recommendedAmount',
    'total_amount',
    'unit_cost',
    // 공급처 상세
    'supplier_id',
    'supplier_name',
    'supplierName',
    'country',
    // 리드타임 통계
    'p50_days',
    'p80_days',
    'p90_days',
    'std_days',
    'std_lead_time',
    'lead_time_sd',
    'n_samples',
    'sample_count',
    'mean_days',
    'max_days',
    // 신뢰도는 표본 수에서 나온 등급입니다 (리뷰 Minor 8)
    'lead_time_confidence',
    'leadTimeConfidence',
    // 예측 정확도
    'wape',
    'mape',
    'rmse',
    'mae',
    'bias',
    'champion_wape',
    'championBias',
    'baseline_improvement',
    'metric_value',
    'sigma_dlt',
    'sigma_d',
  ];
  for (const key of blocked) {
    assert.equal(isRedactedKey(key), true, `가려야 하는 키: ${key}`);
  }
});

test('Guardrail 의 접두사 붙은 키도 같이 가려진다', () => {
  // lib/agent/guardrail.ts 의 collectToolNumbers 가 `툴이름.행키.필드` 로 이어 붙입니다.
  // 접두사가 붙었다고 단가가 살아남으면 가리기가 무의미합니다.
  assert.equal(isRedactedKey('calcOrderQuantity..unit_price'), true);
  assert.equal(isRedactedKey('ITEM012.unit_price'), true);
  assert.equal(isRedactedKey('getLeadtimeStats.SUP001.p80_days'), true);
  assert.equal(isRedactedKey('getForecastAccuracy.MA3.wape'), true);
});

test('영업이 봐야 하는 키는 가리지 않는다', () => {
  const allowed = [
    // renew.prd 4.5 — 납기 가능 여부 · ATP · 예상 입고일 · 대체품 ○
    'atp_qty',
    'available_now',
    'confirmed_incoming',
    'committed_demand',
    'soft_allocation',
    'protected_safety_stock',
    'safety_stock',
    'earliest_safe_date',
    'earliest_new_supply_date',
    // 적용 중인 리드타임과 여유일은 남깁니다 (renew.prd 4.5 "예상 입고일 ○")
    'lead_time',
    'lead_time_used',
    'delivery_buffer_days',
    // 재고 총량 · 상태
    'current_stock',
    'closing_qty',
    'stockout_days',
    'item_id',
    'item_name',
    'status',
    'priority',
    'data_snapshot_at',
    // 수요 예측 자체는 정확도 지표가 아닙니다
    'forecast_qty',
    'consensus_qty',
    'p80',
    'p90',
  ];
  for (const key of allowed) {
    assert.equal(isRedactedKey(key), false, `가리면 안 되는 키: ${key}`);
  }
});

// ── ③ 깊이 훑기 ───────────────────────────────────────────────

const SKU = {
  itemId: 'ITEM012',
  itemName: 'EMI 필터 모듈',
  supplierId: 'SUP001',
  supplierName: '인도 법인',
  currentInventory: 1250,
  unitPrice: 12500,
  recommendedAmount: 8750000,
  leadTime: 42,
  leadTimeConfidence: 'HIGH',
  championWape: 0.124,
  safetyStock: 400,
  suppliers: [
    { supplierId: 'SUP001', p80Days: 44, nSamples: 120, effectiveLeadTime: 44 },
    { supplierId: 'SUP002', p80Days: 30, nSamples: 12, effectiveLeadTime: 30 },
  ],
  items: [
    { itemId: 'ITEM012', unitPrice: 12500, atpQty: 620, leadTime: 42 },
    { itemId: 'ITEM013', unitPrice: 4300, atpQty: 0, leadTime: 30 },
  ],
};

test('영업에게는 단가 · 공급처 · 정확도가 사라지고 ATP 재료는 남는다', () => {
  const out = stripForSales(SKU, SALES) as Record<string, unknown>;

  for (const key of ['unitPrice', 'recommendedAmount', 'supplierId', 'supplierName', 'championWape']) {
    assert.equal(key in out, false, `남아 있으면 안 되는 키: ${key}`);
  }
  assert.equal(out.itemId, 'ITEM012');
  assert.equal(out.currentInventory, 1250);
  assert.equal(out.leadTime, 42);
  assert.equal('leadTimeConfidence' in out, false, '신뢰도가 남았습니다 (리뷰 Minor 8)');
  assert.equal(out.safetyStock, 400);
});

test('배열 안쪽까지 훑는다 — 목록 툴이 가장 많이 흘린다', () => {
  const out = stripForSales(SKU, SALES) as { items: Record<string, unknown>[] };
  assert.equal(out.items.length, 2);
  for (const row of out.items) {
    assert.equal('unitPrice' in row, false, '배열 안의 단가가 남았습니다');
    assert.equal(typeof row.itemId, 'string');
    assert.equal(typeof row.atpQty, 'number');
    assert.equal(typeof row.leadTime, 'number');
  }
});

test('공급처 목록은 통째로 사라진다 — 담는 키 이름 자체가 공급처 상세다', () => {
  // getLeadtimeStats 는 { suppliers: [...] } 를 돌려줍니다. 안쪽 필드만 지우고
  // 껍데기를 남기면 "공급처가 두 곳" 이라는 사실이 그대로 새어 나갑니다.
  const out = stripForSales(SKU, SALES) as Record<string, unknown>;
  assert.equal('suppliers' in out, false);
});

test('키를 null 로 바꾸지 않고 통째로 없앤다', () => {
  // null 로 두면 화면과 모델이 "산출할 수 없는 값" 으로 읽습니다 (design.md §8.2).
  // 영업에게 단가는 산출 불가가 아니라 보여 주지 않기로 한 값입니다.
  const out = stripForSales({ unitPrice: 12500 }, SALES);
  assert.deepEqual(out, {});
});

test('SCM 사용자에게는 아무것도 사라지지 않는다', () => {
  const out = stripForSales(SKU, SCM);
  assert.deepEqual(out, SKU);
  // 복사조차 하지 않습니다 — SCM 응답 경로에 비용을 얹지 않습니다.
  assert.equal(out, SKU);
});

test('사용자를 모르면 가리지 않는다 — SCM 담당자를 영업으로 오인하지 않는다', () => {
  assert.equal(stripForSales(SKU, null), SKU);
  assert.equal(stripForSales(SKU, undefined), SKU);
  assert.equal(stripForSales(SKU, { role: 'USER', department: null }), SKU);
});

test('관리자는 부서가 영업이어도 가리지 않는다 (renew.prd 4.2)', () => {
  assert.equal(stripForSales(SKU, ADMIN_SALES), SKU);
});

test('원본을 바꾸지 않는다', () => {
  stripForSales(SKU, SALES);
  assert.equal(SKU.unitPrice, 12500);
  assert.equal(SKU.suppliers[0].p80Days, 44);
});

// ── 툴 결과 (data + numbers) ──────────────────────────────────

const TOOL_RESULT = {
  ok: true,
  data: { itemId: 'ITEM012', unitPrice: 12500, finalRecommendedQty: 700 },
  numbers: {
    'calcOrderQuantity..unit_price': 12500,
    'calcOrderQuantity..recommended_amount': 8750000,
    'calcOrderQuantity..champion_wape': 0.124,
    'calcOrderQuantity..final_recommended_qty': 700,
    'calcOrderQuantity..lead_time': 42,
  },
  dataAsOf: '2026-09-01T00:00:00Z',
};

test('★ numbers 까지 가린다 — Guardrail 이 단가를 인용하도록 허가하지 않는다', () => {
  const out = stripToolResult(TOOL_RESULT, SALES);

  // Guardrail 은 numbers 에 있는 값만 답변에 허용합니다. 여기 단가가 남아 있으면
  // 모델이 "12,500원" 이라고 써도 검사를 통과합니다.
  assert.deepEqual(Object.keys(out.numbers).sort(), [
    'calcOrderQuantity..final_recommended_qty',
    'calcOrderQuantity..lead_time',
  ]);
  assert.equal(out.numbers['calcOrderQuantity..final_recommended_qty'], 700);
  assert.equal('unitPrice' in (out.data as Record<string, unknown>), false);
  assert.equal(out.ok, true);
  assert.equal(out.dataAsOf, '2026-09-01T00:00:00Z');
});

test('SCM 사용자의 툴 결과는 그대로다', () => {
  assert.equal(stripToolResult(TOOL_RESULT, SCM), TOOL_RESULT);
  assert.equal(stripToolResult(TOOL_RESULT, ADMIN_SALES), TOOL_RESULT);
});

test('null · 원시값 · 빈 객체를 만나도 죽지 않는다', () => {
  assert.equal(stripForSales(null, SALES), null);
  assert.equal(stripForSales(42, SALES), 42);
  assert.equal(stripForSales('문자열', SALES), '문자열');
  assert.deepEqual(stripForSales({}, SALES), {});
  assert.deepEqual(stripForSales([], SALES), []);
  assert.deepEqual(
    stripToolResult({ ok: false, data: null, numbers: {} }, SALES),
    { ok: false, data: null, numbers: {} },
  );
});

// ── isSalesActor — 역할이 부서를 이깁니다 ────────────────────────
//
// 화면·메뉴·필드가 전부 이 판정을 거칩니다. STEP 17 검토에서 화면 계층만
// 역할 검사를 빠뜨려 "영업 부서 관리자가 화면을 잃는" 상태가 발견됐으므로,
// 그 회귀를 여기서 붙잡습니다.

test('isSalesActor: 영업 부서의 USER 는 영업이다', () => {
  assert.equal(isSalesActor({ role: 'USER', department: '영업1팀' }), true);
  assert.equal(isSalesActor({ role: 'USER', department: 'Sales Planning' }), true);
});

test('isSalesActor: 영업 부서여도 ADMIN 은 영업이 아니다 (renew.prd 4.2)', () => {
  assert.equal(isSalesActor({ role: 'ADMIN', department: '영업1팀' }), false);
  assert.equal(isSalesActor({ role: 'ADMIN', department: 'SALES' }), false);
});

test('isSalesActor: 영업이 아닌 부서와 빈 값은 영업이 아니다', () => {
  assert.equal(isSalesActor({ role: 'USER', department: '구매팀' }), false);
  assert.equal(isSalesActor({ role: 'USER', department: null }), false);
  assert.equal(isSalesActor(null), false);
});
