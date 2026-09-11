import assert from 'node:assert/strict';
import test from 'node:test';

import {
  diffQty,
  formatBaseMonthDotted,
  formatBaseMonthKorean,
  inventoryQtyReasonCode,
  inventoryValueReasonCode,
  inventoryDiffReasonCode,
  normalizeCurrentPlanningCycle,
  normalizeInventoryPerformanceKpiRow,
  normalizeInventoryPerformanceRow,
} from './model.ts';

// ★ 기준월 표시 — supabase/migrations/20260911001150_stage1_inventory_kpi.sql의
//   analytics.v_current_planning_cycle.plan_month(YYYY-MM-DD, 항상 그 달 1일)를 대시보드 ·
//   사이드바 · 상단바가 같은 문구로 보여줄 수 있도록 이 두 형식만 쓴다.
test('formatBaseMonthDotted — YYYY-MM-DD를 YYYY.MM으로', () => {
  assert.equal(formatBaseMonthDotted('2026-09-01'), '2026.09');
  assert.equal(formatBaseMonthDotted('2027-01-01'), '2027.01');
});

test('formatBaseMonthDotted — null이면 null(빈 문자열로 채우지 않는다)', () => {
  assert.equal(formatBaseMonthDotted(null), null);
});

test('formatBaseMonthKorean — YYYY-MM-DD를 YYYY년 MM월로', () => {
  assert.equal(formatBaseMonthKorean('2026-09-01'), '2026년 09월');
});

test('formatBaseMonthKorean — null이면 null', () => {
  assert.equal(formatBaseMonthKorean(null), null);
});

// ★ 사유 코드 우선순위 — 마이그레이션 4절의 analytics.v_inventory_performance CASE 식과 같은 순서다.
//   품목 자체가 core.stock_balance에 없으면(hasStockBalance=false) 항상 INVENTORY_SCOPE_UNCLASSIFIED가
//   이긴다 — 그 달에 스냅샷이 있어도(이론상 불가능하지만) 우선순위는 분류 불가가 먼저다.
test('inventoryQtyReasonCode — 품목이 한 번도 분류된 적 없으면 INVENTORY_SCOPE_UNCLASSIFIED', () => {
  assert.equal(inventoryQtyReasonCode({ hasStockBalance: false, actualQty: null }), 'INVENTORY_SCOPE_UNCLASSIFIED');
});

test('inventoryQtyReasonCode — 분류는 되지만 이 달 스냅샷이 없으면 MONTH_END_SNAPSHOT_MISSING', () => {
  assert.equal(inventoryQtyReasonCode({ hasStockBalance: true, actualQty: null }), 'MONTH_END_SNAPSHOT_MISSING');
});

test('inventoryQtyReasonCode — 실제 수량이 있으면 사유 없음(null)', () => {
  assert.equal(inventoryQtyReasonCode({ hasStockBalance: true, actualQty: 120 }), null);
});

test('inventoryValueReasonCode — 수량이 없으면 수량 사유가 우선한다', () => {
  assert.equal(
    inventoryValueReasonCode({ hasStockBalance: false, actualQty: null, unitPrice: 500 }),
    'INVENTORY_SCOPE_UNCLASSIFIED',
  );
  assert.equal(
    inventoryValueReasonCode({ hasStockBalance: true, actualQty: null, unitPrice: 500 }),
    'MONTH_END_SNAPSHOT_MISSING',
  );
});

test('inventoryValueReasonCode — 수량은 있지만 승인 단가가 없으면 UNIT_PRICE_UNSET', () => {
  assert.equal(
    inventoryValueReasonCode({ hasStockBalance: true, actualQty: 120, unitPrice: null }),
    'UNIT_PRICE_UNSET',
  );
});

test('inventoryValueReasonCode — 수량 · 단가가 모두 있으면 사유 없음', () => {
  assert.equal(inventoryValueReasonCode({ hasStockBalance: true, actualQty: 120, unitPrice: 500 }), null);
});

test('inventoryDiffReasonCode — 목표재고 미승인이면 TARGET_STOCK_UNSET(수량은 있을 때)', () => {
  assert.equal(
    inventoryDiffReasonCode({ hasStockBalance: true, actualQty: 120, targetStockQty: null }),
    'TARGET_STOCK_UNSET',
  );
});

test('inventoryDiffReasonCode — 수량이 없으면 수량 사유가 우선한다', () => {
  assert.equal(
    inventoryDiffReasonCode({ hasStockBalance: true, actualQty: null, targetStockQty: 100 }),
    'MONTH_END_SNAPSHOT_MISSING',
  );
});

// ★ 차이 = 실제 − 목표(컨트롤러 판정 2). 둘 중 하나라도 없으면 null — 0으로 채우지 않는다.
test('diffQty — 실제와 목표가 모두 있으면 뺄셈', () => {
  assert.equal(diffQty(120, 100), 20);
  assert.equal(diffQty(80, 100), -20);
});

test('diffQty — 실제 또는 목표가 없으면 null', () => {
  assert.equal(diffQty(null, 100), null);
  assert.equal(diffQty(120, null), null);
  assert.equal(diffQty(null, null), null);
});

// ══ 조회 행 정규화 ════════════════════════════════════════════════

test('normalizeCurrentPlanningCycle — 활성 주기가 있으면 값을 그대로 옮긴다', () => {
  const result = normalizeCurrentPlanningCycle({
    cycle_id: 'c1',
    plan_month: '2026-09-01',
    status: 'OPEN',
    submission_deadline: '2026-08-30',
    is_active: true,
    opened_at: '2026-08-01T00:00:00Z',
    reason_code: null,
  });
  assert.deepEqual(result, {
    cycleId: 'c1',
    planMonth: '2026-09-01',
    status: 'OPEN',
    submissionDeadline: '2026-08-30',
    isActive: true,
    openedAt: '2026-08-01T00:00:00Z',
    reasonCode: null,
  });
});

test('normalizeCurrentPlanningCycle — 활성 주기가 없으면 null + PLANNING_CYCLE_NOT_OPEN', () => {
  const result = normalizeCurrentPlanningCycle({
    cycle_id: null,
    plan_month: null,
    status: null,
    submission_deadline: null,
    is_active: null,
    opened_at: null,
    reason_code: 'PLANNING_CYCLE_NOT_OPEN',
  });
  assert.equal(result.planMonth, null);
  assert.equal(result.reasonCode, 'PLANNING_CYCLE_NOT_OPEN');
});

test('normalizeInventoryPerformanceRow — analytics.v_inventory_performance 한 행', () => {
  const row = normalizeInventoryPerformanceRow({
    plan_month: '2026-09-01',
    item_id: 'ITEM001',
    item_name: '용지 A',
    actual_qty: '120',
    snapshot_at: '2026-09-28T00:00:00Z',
    qty_reason_code: null,
    unit_price: '500',
    actual_value: '60000',
    value_reason_code: null,
    target_stock_qty: '100',
    target_stock_reason_code: null,
    diff_qty: '20',
    diff_reason_code: null,
  });
  assert.deepEqual(row, {
    planMonth: '2026-09-01',
    itemId: 'ITEM001',
    itemName: '용지 A',
    actualQty: 120,
    snapshotAt: '2026-09-28T00:00:00Z',
    qtyReasonCode: null,
    unitPrice: 500,
    actualValue: 60000,
    valueReasonCode: null,
    targetStockQty: 100,
    targetStockReasonCode: null,
    diffQty: 20,
    diffReasonCode: null,
  });
});

test('normalizeInventoryPerformanceRow — null 값은 0으로 채우지 않고 그대로 null', () => {
  const row = normalizeInventoryPerformanceRow({
    plan_month: '2026-09-01',
    item_id: 'ITEM020',
    item_name: null,
    actual_qty: null,
    snapshot_at: null,
    qty_reason_code: 'MONTH_END_SNAPSHOT_MISSING',
    unit_price: null,
    actual_value: null,
    value_reason_code: 'MONTH_END_SNAPSHOT_MISSING',
    target_stock_qty: null,
    target_stock_reason_code: 'TARGET_STOCK_UNSET',
    diff_qty: null,
    diff_reason_code: 'MONTH_END_SNAPSHOT_MISSING',
  });
  assert.equal(row.actualQty, null);
  assert.equal(row.actualValue, null);
  assert.equal(row.diffQty, null);
  assert.equal(row.qtyReasonCode, 'MONTH_END_SNAPSHOT_MISSING');
});

test('normalizeInventoryPerformanceKpiRow — 합계와 제외 건수를 그대로 옮긴다', () => {
  const kpi = normalizeInventoryPerformanceKpiRow({
    plan_month: '2026-09-01',
    n_items: '20',
    n_qty_available: '0',
    n_month_end_snapshot_missing: '18',
    n_inventory_scope_unclassified: '2',
    total_actual_qty: null,
    n_value_available: '0',
    n_unit_price_unset: '0',
    total_actual_value: null,
    n_target_available: '0',
    n_target_stock_unset: '20',
    total_target_stock_qty: null,
    total_diff_qty: null,
    n_diff_available: '0',
  });
  assert.deepEqual(kpi, {
    planMonth: '2026-09-01',
    nItems: 20,
    nQtyAvailable: 0,
    nMonthEndSnapshotMissing: 18,
    nInventoryScopeUnclassified: 2,
    totalActualQty: null,
    nValueAvailable: 0,
    nUnitPriceUnset: 0,
    totalActualValue: null,
    nTargetAvailable: 0,
    nTargetStockUnset: 20,
    totalTargetStockQty: null,
    totalDiffQty: null,
    nDiffAvailable: 0,
  });
});
