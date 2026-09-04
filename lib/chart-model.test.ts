import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAlertTypeMix,
  normalizeApprovalMonthly,
  normalizeDemandTrend,
  normalizeSupplierAmount,
  pivotAlertTypeMix,
  pivotApprovalMonthly,
  riskMixFromKpi,
  toAccuracyBars,
} from './chart-model.ts';
import type { AccuracyRankingRow } from './dashboard-model.ts';

// 차트 정규화 — spec §3.4
// 여기서 지키는 것: ① 모양만 바꾼다(합계·평균 없음) ② null 은 null 로 남는다 ③ 실제 컬럼명을 쓴다

test('normalizeDemandTrend — 기간별 한 행으로 피벗하고 마지막 실적을 예측 시작점으로 공유한다', () => {
  const rows = normalizeDemandTrend([
    { period: '2026-01-01', kind: 'ACTUAL', qty: '100', n_items: 20 },
    { period: '2026-02-01', kind: 'ACTUAL', qty: '120', n_items: 20 },
    { period: '2026-03-01', kind: 'FORECAST', qty: '130', n_items: 19 },
    { period: '2026-04-01', kind: 'FORECAST', qty: null, n_items: 0 },
  ]);
  assert.deepEqual(rows.map((r) => r.period), ['2026-01', '2026-02', '2026-03', '2026-04']);
  assert.equal(rows[0].actual, 100);
  assert.equal(rows[0].forecast, null);
  // 마지막 실적(2월)을 예측 선의 시작점으로도 넣습니다 — 값을 지어내는 것이 아니라 한 점을 공유합니다
  assert.equal(rows[1].forecast, 120);
  assert.equal(rows[2].actual, null);
  assert.equal(rows[2].forecast, 130);
  assert.equal(rows[3].forecast, null);
  assert.equal(rows[2].nItems, 19);
});

test('normalizeDemandTrend — 빈 입력은 빈 배열', () => {
  assert.deepEqual(normalizeDemandTrend([]), []);
});

test('riskMixFromKpi — 네 상태를 순서대로, 라벨과 함께', () => {
  const mix = riskMixFromKpi({ criticalCount: 3, warningCount: 5, safeCount: 10, unknownCount: 2 });
  assert.deepEqual(mix.map((s) => s.key), ['CRITICAL', 'WARNING', 'SAFE', 'UNKNOWN']);
  assert.deepEqual(mix.map((s) => s.n), [3, 5, 10, 2]);
  assert.equal(mix[0].label, '위험');
  assert.equal(mix[3].label, '미판정');
});

test('normalizeSupplierAmount — 실제 컬럼명, 금액 null 은 null', () => {
  const row = normalizeSupplierAmount({
    supplier_id: 'SUP001', supplier_name: '도쿄공장', n_items: 4, n_urgent: 1,
    total_qty: '1200', total_amount: null, n_missing_price: 4,
  });
  assert.equal(row.supplierId, 'SUP001');
  assert.equal(row.supplierName, '도쿄공장');
  assert.equal(row.nItems, 4);
  assert.equal(row.nUrgent, 1);
  assert.equal(row.totalQty, 1200);
  assert.equal(row.totalAmount, null);
  assert.equal(row.nMissingPrice, 4);
});

test('pivotAlertTypeMix — 유형별 한 행, 심각도가 열, total 내림차순', () => {
  const rows = [
    { type: 'STOCKOUT', type_label: '결품 위험', severity: 'CRITICAL', n_open: 2, n_unacknowledged: 1 },
    { type: 'STOCKOUT', type_label: '결품 위험', severity: 'WARNING', n_open: 3, n_unacknowledged: 3 },
    { type: 'EXCESS_INVENTORY', type_label: '과잉 재고', severity: 'INFO', n_open: 7, n_unacknowledged: 0 },
  ].map(normalizeAlertTypeMix);
  const stacks = pivotAlertTypeMix(rows);
  assert.deepEqual(stacks.map((s) => s.type), ['EXCESS_INVENTORY', 'STOCKOUT']);
  assert.deepEqual(stacks[1], { type: 'STOCKOUT', typeLabel: '결품 위험', CRITICAL: 2, WARNING: 3, INFO: 0, total: 5 });
});

test('pivotApprovalMonthly — 월 오름차순, 결정 넷이 열', () => {
  const rows = [
    { month: '2026-08-01', decision: 'APPROVED', n: 4 },
    { month: '2026-08-01', decision: 'ADJUSTED', n: 1 },
    { month: '2026-08-01', decision: 'REJECTED', n: 0 },
    { month: '2026-08-01', decision: 'DEFERRED', n: 2 },
    { month: '2026-07-01', decision: 'APPROVED', n: 1 },
    { month: '2026-07-01', decision: 'ADJUSTED', n: 0 },
    { month: '2026-07-01', decision: 'REJECTED', n: 0 },
    { month: '2026-07-01', decision: 'DEFERRED', n: 0 },
  ].map(normalizeApprovalMonthly);
  const stacks = pivotApprovalMonthly(rows);
  assert.deepEqual(stacks.map((s) => s.month), ['2026-07', '2026-08']);
  assert.deepEqual(stacks[1], { month: '2026-08', APPROVED: 4, ADJUSTED: 1, REJECTED: 0, DEFERRED: 2 });
});

test('toAccuracyBars — 좋은 5 다음 나쁜 5, 순위대로, wape null 은 그대로', () => {
  const base: AccuracyRankingRow = {
    itemId: 'X', itemName: null, championModelId: 'MA3', modelName: 'MA3', wape: 0.1, bias: 0,
    selectionMethod: 'AUTO', rankBest: null, rankWorst: null, nRanked: 12, barPct: 10,
  };
  const rows: AccuracyRankingRow[] = [
    { ...base, itemId: 'B', itemName: '나', rankBest: 2, wape: 0.05 },
    { ...base, itemId: 'A', itemName: '가', rankBest: 1, wape: 0.04 },
    { ...base, itemId: 'Z', itemName: null, rankWorst: 1, wape: null },
    { ...base, itemId: 'Y', rankWorst: 2, wape: 0.6 },
  ];
  const bars = toAccuracyBars(rows);
  assert.deepEqual(bars.map((b) => `${b.side}:${b.itemId}:${b.rank}`), ['best:A:1', 'best:B:2', 'worst:Z:1', 'worst:Y:2']);
  assert.equal(bars[0].label, '가');
  assert.equal(bars[2].label, 'Z');
  assert.equal(bars[2].wape, null);
});
