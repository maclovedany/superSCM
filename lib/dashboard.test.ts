import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  bool,
  count,
  monthLabel,
  normalizeAccuracyRanking,
  normalizeDashboardKpi,
  normalizeOpenPoRisk,
  normalizePurchasePriority,
  normalizeRecentApproval,
  normalizeSparklinePoint,
  num,
  percentText,
  railSentences,
  signedPercentText,
  text,
  toSparklineKind,
} from './dashboard-model.ts';

// 대시보드 — renew.prd 28장
//
// 여기서 지키는 것은 네 가지입니다.
//   ① renew.prd 28.1 의 12종이 전부 뷰에서 온다 (화면이 만들어 내지 않는다)
//   ② 계산 불가와 0 을 섞지 않는다 (AGENTS.md 규칙 5 · renew.prd 31.5)
//   ③ 비율에 100 을 두 번 곱하지 않는다
//   ④ 우측 레일 문장이 LLM 없이 조립된다 (renew.prd 31.4)

/**
 * analytics.v_dashboard_kpi 가 내리는 renew.prd 28.1 의 12종입니다.
 * sql/21-dashboard.sql §2 의 select 목록과 같아야 합니다 —
 * 뷰가 컬럼 이름을 바꾸면 화면이 조용히 null 을 그립니다.
 */
const PRD_28_1_COLUMNS = [
  'forecast_accuracy',
  'forecast_bias',
  'n_risk_items',
  'n_stockout_30d',
  'n_stockout_60d',
  'n_excess_inventory',
  'n_delayed_open_po',
  'n_recommendations',
  'n_urgent_orders',
  'total_recommended_qty',
  'total_recommended_amount',
  'n_pending_approval',
];

const KPI_FIELD_OF: Record<string, string> = {
  forecast_accuracy: 'forecastAccuracy',
  forecast_bias: 'forecastBias',
  n_risk_items: 'nRiskItems',
  n_stockout_30d: 'nStockout30d',
  n_stockout_60d: 'nStockout60d',
  n_excess_inventory: 'nExcessInventory',
  n_delayed_open_po: 'nDelayedOpenPo',
  n_recommendations: 'nRecommendations',
  n_urgent_orders: 'nUrgentOrders',
  total_recommended_qty: 'totalRecommendedQty',
  total_recommended_amount: 'totalRecommendedAmount',
  n_pending_approval: 'nPendingApproval',
};

test('renew.prd 28.1 의 KPI 12종이 전부 뷰 컬럼에서 온다', () => {
  assert.equal(PRD_28_1_COLUMNS.length, 12);

  // 컬럼마다 서로 다른 값을 넣어, 어느 하나가 다른 컬럼을 읽고 있으면 드러나게 합니다.
  const row: Record<string, unknown> = {};
  PRD_28_1_COLUMNS.forEach((column, index) => {
    row[column] = index + 1;
  });

  const kpi = normalizeDashboardKpi(row) as unknown as Record<string, unknown>;
  PRD_28_1_COLUMNS.forEach((column, index) => {
    assert.equal(kpi[KPI_FIELD_OF[column]], index + 1, `${column} 이 어긋납니다`);
  });
});

test('KPI 가 비어 오면 0 이 아니라 null 이다', () => {
  const kpi = normalizeDashboardKpi({});

  // 조회에 실패했는데 "위험 0건" 이라고 말하면 안 됩니다 (renew.prd 31.5).
  assert.equal(kpi.forecastAccuracy, null);
  assert.equal(kpi.forecastBias, null);
  assert.equal(kpi.nRiskItems, null);
  assert.equal(kpi.nStockout30d, null);
  assert.equal(kpi.nExcessInventory, null);
  assert.equal(kpi.nRecommendations, null);
  assert.equal(kpi.totalRecommendedAmount, null);
  assert.equal(kpi.nPendingApproval, null);
  assert.equal(kpi.forecastIsStale, null);
  assert.equal(kpi.dataEnd, null);
});

test('KPI 의 보조 값과 stale 판정을 읽는다', () => {
  const kpi = normalizeDashboardKpi({
    avg_wape: '0.13',
    n_champions: 20,
    n_bias_items: 18,
    n_critical_items: 3,
    n_warning_items: 4,
    n_items: 20,
    n_missing_price: 2,
    n_open_alerts: 7,
    n_unacknowledged_alerts: 5,
    last_scan_at: '2025-01-02T03:04:05Z',
    forecast_run_id: 'RUN-2025-01',
    last_forecast_run_at: '2025-01-01T00:00:00Z',
    forecast_is_stale: true,
    data_end: '2024-12-31',
  });

  assert.equal(kpi.avgWape, 0.13);
  assert.equal(kpi.nChampions, 20);
  assert.equal(kpi.nBiasItems, 18);
  assert.equal(kpi.nCriticalItems, 3);
  assert.equal(kpi.nWarningItems, 4);
  assert.equal(kpi.nItems, 20);
  assert.equal(kpi.nMissingPrice, 2);
  assert.equal(kpi.nOpenAlerts, 7);
  assert.equal(kpi.nUnacknowledgedAlerts, 5);
  assert.equal(kpi.forecastRunId, 'RUN-2025-01');
  assert.equal(kpi.forecastIsStale, true);
  assert.equal(kpi.dataEnd, '2024-12-31');
});

test('0 은 값이다 — null 로 접지 않는다', () => {
  const kpi = normalizeDashboardKpi({
    n_risk_items: 0,
    n_urgent_orders: 0,
    total_recommended_qty: 0,
    forecast_bias: 0,
  });

  assert.equal(kpi.nRiskItems, 0);
  assert.equal(kpi.nUrgentOrders, 0);
  assert.equal(kpi.totalRecommendedQty, 0);
  assert.equal(kpi.forecastBias, 0);
});

test('num · text · count · bool 의 세 상태', () => {
  assert.equal(num(null), null);
  assert.equal(num('12.5'), 12.5);
  assert.equal(num('abc'), null);

  assert.equal(text('  '), null);
  assert.equal(text(' A-1 '), 'A-1');

  // count 는 정수 자리입니다. bigint 가 문자열로 와도 숫자로 받습니다.
  assert.equal(count('42'), 42);
  assert.equal(count(null), null);
  assert.equal(count(3.9), 3);

  // 3상태 — null 을 false 로 접으면 "모름" 이 "아니다" 가 됩니다.
  assert.equal(bool(null), null);
  assert.equal(bool(true), true);
  assert.equal(bool('false'), false);
  assert.equal(bool(0), null);
});

test('비율에 100 을 두 번 곱하지 않는다', () => {
  // WAPE 도 정확도도 비율입니다 (sql/13 §5 — Σ|A−F| / ΣA).
  assert.equal(percentText(0.873), '87.3%');
  assert.equal(percentText(0.1), '10.0%');
  assert.equal(percentText(0), '0.0%');
  // 값이 없으면 0% 를 지어내지 않습니다.
  assert.equal(percentText(null), null);
});

test('Bias 는 부호를 잃지 않는다', () => {
  // + 는 과대예측, − 는 과소예측입니다 (sql/13 §5 — bias = Σ(F−A)/ΣA).
  // 부호를 지우면 어느 쪽으로 치우쳤는지가 사라집니다.
  assert.equal(signedPercentText(0.052), '+5.2');
  assert.equal(signedPercentText(-0.052), '-5.2');
  assert.equal(signedPercentText(0), '0.0');
  assert.equal(signedPercentText(null), null);
});

test('스파크라인의 기간 라벨은 잘라 쓴다', () => {
  // new Date('2025-01-01') 은 UTC 자정이라 한국 시간대에서 한 달 밀립니다.
  assert.equal(monthLabel('2025-01-01'), '2025-01');
  assert.equal(monthLabel('2025-01'), '2025-01');
  assert.equal(monthLabel(''), '');

  assert.equal(toSparklineKind('FORECAST'), 'FORECAST');
  assert.equal(toSparklineKind('ACTUAL'), 'ACTUAL');
  // 모르는 값을 예측으로 올리지 않습니다 — 실적인 척하는 예측이 더 나쁩니다.
  assert.equal(toSparklineKind(null), 'ACTUAL');
});

test('발주 우선순위 한 줄을 정규화한다', () => {
  const row = normalizePurchasePriority({
    item_id: 'ITEM-1',
    item_name: '부품 A',
    supplier_id: 'SUP-1',
    supplier_name: '공급처 A',
    risk: 'CRITICAL',
    reason_code: 'NO_LEADTIME',
    required_order_date: '2025-02-01',
    is_urgent: true,
    stockout_date: '2025-03-01',
    final_recommended_qty: '1200',
    unit_price: '3.5',
    recommended_amount: '4200',
  });

  assert.equal(row.itemId, 'ITEM-1');
  assert.equal(row.risk, 'CRITICAL');
  assert.equal(row.reasonCode, 'NO_LEADTIME');
  assert.equal(row.isUrgent, true);
  assert.equal(row.finalRecommendedQty, 1200);
  assert.equal(row.recommendedAmount, 4200);
});

test('발주 권고일이 없으면 is_urgent 는 false 가 아니라 null 이다', () => {
  // STEP 10 보고서 §9 — 권고일을 못 낸 품목은 "긴급이 아니다" 가 아니라 "모른다" 입니다.
  const row = normalizePurchasePriority({
    item_id: 'ITEM-2',
    risk: 'CALCULATION_UNAVAILABLE',
    reason_code: 'NO_FORECAST',
    required_order_date: null,
    is_urgent: null,
    final_recommended_qty: null,
  });

  assert.equal(row.isUrgent, null);
  assert.equal(row.requiredOrderDate, null);
  assert.equal(row.finalRecommendedQty, null);
  assert.equal(row.risk, 'CALCULATION_UNAVAILABLE');
});

test('정확도 랭킹은 순위와 막대 폭을 뷰에서 받는다', () => {
  const row = normalizeAccuracyRanking({
    item_id: 'ITEM-3',
    item_name: '부품 C',
    champion_model_id: 'ETS',
    model_name: 'ETS',
    wape: '0.12',
    bias: '-0.03',
    selection_method: 'AUTO',
    rank_best: 1,
    rank_worst: 20,
    n_ranked: 20,
    bar_pct: '30.0',
  });

  // 화면은 이 순위로 자르기만 합니다. 정렬 기준을 다시 만들지 않습니다.
  assert.equal(row.rankBest, 1);
  assert.equal(row.rankWorst, 20);
  assert.equal(row.nRanked, 20);
  assert.equal(row.barPct, 30);
  assert.equal(row.wape, 0.12);
  assert.equal(row.bias, -0.03);
});

test('Open PO 위험은 지난 일수와 남은 일수를 부호로 구분한다', () => {
  const late = normalizeOpenPoRisk({
    item_id: 'ITEM-4',
    supplier_id: 'SUP-2',
    n_shipments: 2,
    earliest_due_date: '2025-01-05',
    days_late: 9,
    open_qty: '500',
    is_late: true,
  });
  assert.equal(late.daysLate, 9);
  assert.equal(late.isLate, true);

  const soon = normalizeOpenPoRisk({
    item_id: 'ITEM-5',
    days_late: -3,
    is_late: false,
  });
  assert.equal(soon.daysLate, -3);
  assert.equal(soon.isLate, false);
});

test('최근 승인은 결정과 조정량을 그대로 받는다', () => {
  const row = normalizeRecentApproval({
    approval_id: 17,
    item_id: 'ITEM-6',
    item_name: '부품 F',
    decision: 'APPROVED',
    reason_code: 'AS_RECOMMENDED',
    recommended_qty: '1000',
    approved_qty: '800',
    adjustment: '-200',
    approved_email: 'a@b.c',
    approved_at: '2025-01-02T00:00:00Z',
    status: 'ACTIVE',
    is_active: true,
  });

  assert.equal(row.approvalId, 17);
  assert.equal(row.decision, 'APPROVED');
  assert.equal(row.approvedQty, 800);
  assert.equal(row.adjustment, -200);
  assert.equal(row.isActive, true);
});

test('스파크라인 한 점을 정규화한다', () => {
  const point = normalizeSparklinePoint({
    item_id: 'ITEM-7',
    period: '2024-12-01',
    kind: 'FORECAST',
    qty: '310',
  });

  assert.equal(point.itemId, 'ITEM-7');
  assert.equal(point.period, '2024-12-01');
  assert.equal(point.kind, 'FORECAST');
  assert.equal(point.qty, 310);
});

test('우측 레일 문장은 LLM 없이 숫자만으로 조립된다', () => {
  // renew.prd 31.4 — AI 가 응답하지 못해도 대시보드는 그대로 동작해야 합니다.
  const lines = railSentences({
    urgentItemName: '부품 A',
    urgentOrderDate: '2025-02-01',
    nUrgentOrders: 3,
    nPendingApproval: 4,
  });

  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes('부품 A'));
  assert.ok(lines[0].includes('2025-02-01'));
  assert.ok(lines[1].includes('4'));
});

test('레일 문장은 재료가 없으면 지어내지 않는다', () => {
  assert.deepEqual(
    railSentences({
      urgentItemName: null,
      urgentOrderDate: null,
      nUrgentOrders: null,
      nPendingApproval: null,
    }),
    [],
  );

  // 0 은 "없다" 는 사실이므로 문장이 나옵니다.
  const zero = railSentences({
    urgentItemName: null,
    urgentOrderDate: null,
    nUrgentOrders: 0,
    nPendingApproval: 0,
  });
  assert.equal(zero.length, 2);
  assert.ok(zero[1].includes('없습니다'));
});

test('권고일을 못 낸 품목도 레일 문장에서 숫자를 지어내지 않는다', () => {
  const lines = railSentences({
    urgentItemName: '부품 B',
    urgentOrderDate: null,
    nUrgentOrders: 1,
    nPendingApproval: 2,
  });

  assert.ok(lines[0].includes('권고일 미산출'));
});


// ── Bias 부호는 프로젝트 전체에서 한 방향이어야 합니다 ─────────
//
// sql/13-backtest.sql §5 의 정의가 기준입니다.
//
//   bias = Σ(예측 − 실적) / Σ실적
//
// 예측이 실적보다 크면 양수이므로 **+ 가 과대예측**입니다.
// 화면 문구가 이것과 반대로 적히면 숫자는 맞는데 읽는 사람이 반대로 판단합니다 —
// 과잉 재고를 만드는 모델을 "덜 예측한다" 고 읽는 쪽이 조용한 오류라 더 위험합니다.
//
// 한 화면만 반대로 적히는 일이 실제로 있었으므로(STEP 15 Critical 1) 여기서 막습니다.

const SCAN_SKIP = new Set(['node_modules', '.next', '.git', 'logs']);
const SCAN_EXT = ['.ts', '.tsx', '.sql'];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SCAN_SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (SCAN_EXT.some((ext) => entry.endsWith(ext))) out.push(path);
  }
  return out;
}

test('Bias 는 어디서나 + 가 과대예측이다 (sql/13 의 정의)', () => {
  // 반대로 적은 문구들. "양수는 과소예측" · "양수면 과소예측" · "+ 는 과소예측"
  const backwards = /(양수(는|면)\s*과소예측)|(\+\s*는\s*과소예측)|(음수(는|면)\s*과대예측)/;

  // 이 파일 자신은 뺍니다 — 위 정규식이 반대 문구를 글자 그대로 담고 있어
  // 스스로를 걸러 버립니다. 검사 대상은 실제 화면 · lib · SQL 입니다.
  const SELF = join('lib', 'dashboard.test.ts');

  const offenders: string[] = [];
  for (const dir of ['app', 'lib', 'sql']) {
    for (const path of sourceFiles(dir)) {
      if (path === SELF) continue;
      if (backwards.test(readFileSync(path, 'utf-8'))) offenders.push(path);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'Bias 부호 설명이 sql/13 의 정의와 반대입니다.\n' +
      'bias = Σ(예측−실적) / Σ실적 이므로 + 가 과대예측입니다.\n' +
      '모델 평가 · 모델 비교 · SKU Detail · 대시보드가 같은 문구를 씁니다:\n' +
      '  "+ 는 과대예측 · − 는 과소예측"\n\n' +
      offenders.join('\n'),
  );
});
