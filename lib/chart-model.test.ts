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

// ── Plan B — 분석 · 예측 화면 ──────────────────────────────────

import {
  demandTypeMixFromKpi,
  normalizeChampionShare,
  normalizeHeatmapCell,
  pivotHeatmap,
  toErrorPoints,
  toImprovementBars,
  toLeadtimeBars,
  toMetricBars,
  toQuadrantPoints,
  toReasonBars,
  toStockoutBars,
  toWapeBars,
} from './chart-model.ts';
import type { SkuDemandProfile } from './demand-profile.ts';
import type { ChampionModel, ModelPerformance } from './backtest.ts';
import type { LeadtimeGap, StockoutRisk } from './scm-model.ts';
import type { ValueAddByReason, ValueAddRow } from './override-model.ts';

const profile = (over: Partial<SkuDemandProfile>): SkuDemandProfile =>
  ({
    itemId: 'X', itemName: null, supplierId: null, firstPeriod: null, lastPeriod: null, periods: 12,
    activePeriods: 12, zeroPeriods: 0, totalQty: 0, meanQty: null, sdQty: null, cv: null, cvSquared: null,
    adi: null, zeroDemandRate: null, trendPctPerPeriod: null, recentChangePct: null, peakMonth: null,
    peakQty: null, demandType: null, demandTypeReason: null, seasonalityIndex: null, seasonalityReason: null,
    stability: null, ...over,
  }) as SkuDemandProfile;

test('toQuadrantPoints — ADI · CV² 가 둘 다 있는 행만', () => {
  const pts = toQuadrantPoints([
    profile({ itemId: 'A', itemName: '가', adi: 1.1, cvSquared: 0.2, demandType: 'SMOOTH' }),
    profile({ itemId: 'B', adi: null, cvSquared: 0.2 }),
    profile({ itemId: 'C', adi: 2, cvSquared: 0.9, demandType: 'LUMPY' }),
  ]);
  assert.deepEqual(pts.map((p) => p.itemId), ['A', 'C']);
  assert.equal(pts[0].label, '가');
  assert.equal(pts[1].label, 'C');
  assert.equal(pts[1].cv2, 0.9);
});

test('demandTypeMixFromKpi — 여섯 구간 순서와 라벨', () => {
  const mix = demandTypeMixFromKpi({
    items: 10, smooth: 4, intermittent: 2, erratic: 1, lumpy: 1, noDemand: 1, unclassified: 1,
    crostonNeeded: 3, avgCv: null, avgAdi: null, trainPeriods: 12,
  });
  assert.deepEqual(mix.map((s) => s.key), ['SMOOTH', 'INTERMITTENT', 'ERRATIC', 'LUMPY', 'NO_DEMAND', 'UNCLASSIFIED']);
  assert.deepEqual(mix.map((s) => s.n), [4, 2, 1, 1, 1, 1]);
  assert.equal(mix[5].label, '판정 불가');
});

test('pivotHeatmap — 품목별 행, 기간 열, max 는 색용', () => {
  const cells = [
    { item_id: 'A', item_name: '가', period: '2026-01-01', qty: '10' },
    { item_id: 'A', item_name: '가', period: '2026-02-01', qty: '30' },
    { item_id: 'B', item_name: null, period: '2026-02-01', qty: null },
  ].map(normalizeHeatmapCell);
  const grid = pivotHeatmap(cells);
  assert.deepEqual(grid.periods, ['2026-01', '2026-02']);
  assert.equal(grid.rows.length, 2);
  assert.deepEqual(grid.rows[0].cells.map((c) => c.qty), [10, 30]);
  assert.equal(grid.rows[0].max, 30);
  assert.deepEqual(grid.rows[1].cells.map((c) => c.qty), [null, null]);
  assert.equal(grid.rows[1].max, null);
  assert.equal(grid.rows[1].label, 'B');
});

test('toLeadtimeBars — 표본 30 미만 표시, 값은 그대로', () => {
  const bars = toLeadtimeBars([
    { supplier: 'S1', country: 'JP', masterLeadTime: 30, sampleCount: 12, actualAverage: 35, p80: 41, gap: 11 },
    { supplier: 'S2', country: 'CN', masterLeadTime: null, sampleCount: 40, actualAverage: 20, p80: 25, gap: null },
  ] as LeadtimeGap[]);
  assert.equal(bars[0].lowSample, true);
  assert.equal(bars[1].lowSample, false);
  assert.equal(bars[1].master, null);
  assert.equal(bars[0].gap, 11);
});

test('toStockoutBars — 일수 null 은 뒤로, limit 까지', () => {
  const risk = (id: string, days: number | null, status: string) =>
    ({ itemId: id, itemName: null, stockoutDays: days, plannedLeadTime: 30, riskStatus: status }) as unknown as StockoutRisk;
  const bars = toStockoutBars([risk('A', null, 'CALCULATION_UNAVAILABLE'), risk('B', 5, 'CRITICAL'), risk('C', 40, 'SAFE')], 2);
  assert.deepEqual(bars.map((b) => b.itemId), ['B', 'C']);
  assert.equal(bars[0].status, 'CRITICAL');
  assert.equal(bars[0].leadTime, 30);
});

test('toWapeBars — WAPE 내림차순, null 뒤, 수동 표시', () => {
  const ch = (id: string, wape: number | null, method: 'AUTO' | 'MANUAL') =>
    ({ itemId: id, itemName: null, wape, baselineImprovement: 0.1, selectionMethod: method, modelName: 'MA3' }) as unknown as ChampionModel;
  const bars = toWapeBars([ch('A', 0.1, 'AUTO'), ch('B', null, 'AUTO'), ch('C', 0.5, 'MANUAL')]);
  assert.deepEqual(bars.map((b) => b.itemId), ['C', 'A', 'B']);
  assert.equal(bars[0].manual, true);
  assert.equal(bars[2].wape, null);
});

test('toImprovementBars — 개선율 있는 행만, 값 그대로', () => {
  const ch = (id: string, imp: number | null) =>
    ({ itemId: id, itemName: id, wape: 0.1, baselineImprovement: imp, selectionMethod: 'AUTO', modelName: null }) as unknown as ChampionModel;
  const bars = toImprovementBars([ch('A', 0.2), ch('B', null), ch('C', -0.1)]);
  assert.deepEqual(bars.map((b) => `${b.itemId}:${b.improvement}`), ['A:0.2', 'C:-0.1']);
});

test('normalizeChampionShare — 실제 컬럼명', () => {
  const row = normalizeChampionShare({ model_id: 'MA3', model_name: '이동평균 3', n_items: 7, n_manual: 1, avg_wape: '0.1234' });
  assert.deepEqual(row, { modelId: 'MA3', modelName: '이동평균 3', nItems: 7, nManual: 1, avgWape: 0.1234 });
});

test('toMetricBars — 모델별 WAPE · Bias, Champion 표시', () => {
  const perf = (id: string, wape: number | null, bias: number | null, champ: boolean) =>
    ({ modelId: id, modelName: id, wape, bias, isChampion: champ }) as unknown as ModelPerformance;
  const bars = toMetricBars([perf('MA3', 0.2, -0.05, true), perf('SN', null, null, false)]);
  assert.equal(bars[0].isChampion, true);
  assert.equal(bars[1].wape, null);
  assert.equal(bars[0].bias, -0.05);
});

test('toReasonBars — 사유 라벨을 함수로 받는다', () => {
  const bars = toReasonBars(
    [{ reasonCode: 'PROMOTION', n: 3, aiWape: 0.3, consensusWape: 0.2, improvementPct: 0.33 }] as ValueAddByReason[],
    (code) => (code === 'PROMOTION' ? '프로모션' : code),
  );
  assert.deepEqual(bars, [{ reasonCode: 'PROMOTION', label: '프로모션', n: 3, aiWape: 0.3, consensusWape: 0.2 }]);
});

test('toErrorPoints — 두 오차가 다 있는 행만', () => {
  const row = (id: string, ai: number | null, cons: number | null, improved: boolean | null) =>
    ({ itemId: id, period: '2026-01-01', aiAbsError: ai, consensusAbsError: cons, improved }) as unknown as ValueAddRow;
  const pts = toErrorPoints([row('A', 10, 5, true), row('B', null, 5, null), row('C', 3, 8, false)]);
  assert.deepEqual(pts.map((p) => p.itemId), ['A', 'C']);
  assert.equal(pts[0].period, '2026-01');
  assert.equal(pts[1].improved, false);
});
