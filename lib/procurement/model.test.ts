import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PLAN_HORIZON_MONTHS,
  PLAN_REASON_LABELS,
  approvedAddedDemand,
  approvedPolicyValue,
  buildPlanItemLines,
  calculatePlanMonth,
  effectiveMoq,
  flexBandForMonth,
  forecastSourceStatus,
  normalizeConfirmResult,
  normalizeForecastRunOption,
  normalizePlanBlockerRow,
  normalizePlanLineRow,
  normalizePlanRow,
  planConfirmBlockers,
  planStatusTone,
  roundUpToMoq,
  validateBuildPlanInput,
  validatePlanDecision,
  validatePlanId,
  usageTotal6m,
  type InputFingerprint,
  type PlanItemInput,
} from './model.ts';

// ★ 이 파일은 supabase/migrations/20260911000900_stage1_procurement_plan.sql의 계산 규칙을 그대로
//   옮긴 순수 모델을 검증한다. 화면은 이 모델이 아니라 DB에 저장된 라인 값을 보여준다.

const months = (overrides: Partial<PlanItemInput['months'][number]>[] = []): PlanItemInput['months'] =>
  Array.from({ length: PLAN_HORIZON_MONTHS }, (_, index) => ({
    monthNo: index + 1,
    baseForecastQty: 100,
    departmentAgreedQty: null,
    approvedAddedQty: 0,
    ...(overrides[index] ?? {}),
  }));

function item(overrides: Partial<PlanItemInput> = {}): PlanItemInput {
  return {
    sourceStatus: 'VERIFIED',
    hasPolicy: true,
    targetDosDays: 30,
    unitPrice: 1000,
    moq: 50,
    championModelId: 'MA_3M',
    usage6mTotal: 600,
    startStock: { availableQty: 80, reasonCode: null },
    months: months(),
    ...overrides,
  };
}

// ══ MOQ 올림 (stage1 §7) ═══════════════════════════════════════

test('필요량 120, MOQ 50이면 최종 발주량 150', () => {
  assert.equal(roundUpToMoq(120, 50), 150);
  const [first] = buildPlanItemLines(item());
  assert.equal(first.selectedQty, 120);
  assert.equal(first.selectionReason, 'DOS_TARGET');
  assert.equal(first.effectiveMoq, 50);
  assert.equal(first.finalOrderQty, 150);
  assert.equal(first.projectedMonthEndQty, 130);
  assert.equal(first.projectedDosDays, 39);
  assert.equal(first.projectedInventoryValue, 130000);
});

test('MOQ null이면 1을 적용한다', () => {
  assert.equal(effectiveMoq(null), 1);
  assert.equal(roundUpToMoq(120.5, null), 121);
  const [first] = buildPlanItemLines(item({ moq: null, usage6mTotal: 603 }));
  assert.equal(first.avgUsage6m, 100.5);
  assert.equal(first.effectiveMoq, 1);
  assert.equal(first.selectedQty, 120.5);
  assert.equal(first.finalOrderQty, 121);
  assert.equal(first.projectedMonthEndQty, 101);
  // 예상 DoS는 반올림하지 않고 저장한다(표시할 때만 반올림) — 101 × 180 ÷ 603
  assert.equal(first.projectedDosDays, (101 * 180) / 603);
});

// ══ 정밀도 (fix round 1) ═══════════════════════════════════════════

function exactFinalOrderQty(demand: number, target: number, total: number, moq: number): number {
  // 필요량 = (수요 × 180 + 목표 × 6개월 합) ÷ 180 — 정수 산술로 올림한 뒤 MOQ 배수
  const numerator = demand * 180 + target * total;
  const denominator = 180 * moq;
  return ((numerator - (numerator % denominator)) / denominator + (numerator % denominator === 0 ? 0 : 1)) * moq;
}

function monthResult(demand: number, target: number, total: number, moq: number | null) {
  return calculatePlanMonth({
    monthNo: 4, baseForecastQty: demand, departmentAgreedQty: null, approvedAddedQty: 0,
    startStockQty: 0, targetDosDays: target, usage6mTotal: total, moq, unitPrice: 1,
  });
}

test('반복소수 평균이어도 정수 필요량은 MOQ 올림으로 한 단위 더 붙지 않는다', () => {
  // 목표 45 · 6개월 합 100(평균 16.666…) · 수요 75 · 시작 0 → 필요량 정확히 100
  const example = monthResult(75, 45, 100, null);
  assert.equal(example.dosRequiredQty, 100);
  assert.equal(example.finalOrderQty, 100);
  // 합 10 · 목표 108 → 필요량 정확히 6
  assert.equal(monthResult(0, 108, 10, null).finalOrderQty, 6);
});

test('합 1~1000 × 목표 5종 × MOQ 3종 × 수요 2종 — 정수 산술 기대값과 모두 같다', () => {
  const mismatches: string[] = [];
  for (let total = 1; total <= 1000; total += 1) {
    for (const target of [30, 45, 60, 90, 108]) {
      for (const moq of [1, 10, 50]) {
        for (const demand of [0, 75]) {
          const actual = monthResult(demand, target, total, moq).finalOrderQty;
          const expected = exactFinalOrderQty(demand, target, total, moq);
          if (actual !== expected) mismatches.push(`${total}/${target}/${moq}/${demand}: ${actual} ≠ ${expected}`);
        }
      }
    }
  }
  assert.deepEqual(mismatches.slice(0, 5), []);
});

// ══ 목표 DoS 미승인 → 확정 차단 (stage1 §6) ═══════════════════════

test('목표 DoS null이면 라인은 계산 불가이고 확정이 차단된다', () => {
  const lines = buildPlanItemLines(item({ targetDosDays: null }));
  assert.equal(lines[0].calculationStatus, 'CALCULATION_UNAVAILABLE');
  assert.equal(lines[0].reasonCode, 'TARGET_DOS_UNSET');
  assert.equal(lines[0].finalOrderQty, null);
  const blockers = planConfirmBlockers(lines.map((line) => ({ itemId: 'A', ...line })));
  assert.ok(blockers.some((blocker) => blocker.reasonCode === 'TARGET_DOS_UNSET'));
});

// ══ 승인된 정책 값만 (pre-review fix) ═══════════════════════════════

const approvedRevision = (decidedAt: string, proposedValue: number | null) => ({ status: 'APPROVED', decidedAt, proposedValue });

test('정책 값은 그 필드를 제안한 최신 승인 변경안의 값이다 — 반려 · 대기 · 미제안 변경안은 보지 않는다', () => {
  assert.equal(approvedPolicyValue([]), null);
  assert.equal(approvedPolicyValue([
    approvedRevision('2026-09-01T00:00:00Z', 30),
    approvedRevision('2026-09-05T00:00:00Z', null),
    { status: 'REJECTED', decidedAt: '2026-09-06T00:00:00Z', proposedValue: 45 },
    { status: 'PENDING', decidedAt: null, proposedValue: 60 },
  ]), 30);
  assert.equal(approvedPolicyValue([approvedRevision('2026-09-03T00:00:00Z', 20), approvedRevision('2026-09-01T00:00:00Z', 30)]), 20);
});

test('목표 DoS를 승인 없이 직접 넣었으면 승인값이 없어 계산 불가이고 확정이 차단된다', () => {
  const lines = buildPlanItemLines(item({ targetDosDays: approvedPolicyValue([]) }));
  assert.equal(lines[0].calculationStatus, 'CALCULATION_UNAVAILABLE');
  assert.equal(lines[0].reasonCode, 'TARGET_DOS_UNSET');
  assert.equal(lines[0].finalOrderQty, null);
  assert.deepEqual(planConfirmBlockers(lines.map((line) => ({ itemId: 'A', ...line }))), [
    { reasonCode: 'PRIOR_MONTH_UNAVAILABLE', lineCount: 5, itemCount: 1 },
    { reasonCode: 'TARGET_DOS_UNSET', lineCount: 6, itemCount: 1 },
  ]);
});

test('단가를 승인 없이 직접 넣었으면 UNIT_PRICE_UNSET, 승인된 단가가 있으면 그 값을 쓴다', () => {
  assert.equal(buildPlanItemLines(item({ unitPrice: approvedPolicyValue([]) }))[0].reasonCode, 'UNIT_PRICE_UNSET');
  const [first] = buildPlanItemLines(item({ unitPrice: approvedPolicyValue([approvedRevision('2026-09-01T00:00:00Z', 300)]) }));
  assert.equal(first.calculationStatus, 'CALCULATED');
  assert.equal(first.projectedInventoryValue, 130 * 300);
});

test('MOQ를 승인 없이 직접 넣었으면 승인값이 없어 1을 적용한다', () => {
  const [first] = buildPlanItemLines(item({ moq: approvedPolicyValue([]) }));
  assert.equal(first.effectiveMoq, 1);
  assert.equal(first.finalOrderQty, 120);
});

test('모든 라인이 계산되고 목표 DoS가 승인됐으면 확정 차단 사유가 없다', () => {
  const lines = buildPlanItemLines(item());
  assert.deepEqual(planConfirmBlockers(lines.map((line) => ({ itemId: 'A', ...line }))), []);
});

test('라인이 하나도 없으면 PLAN_HAS_NO_LINES로 확정을 막는다', () => {
  assert.deepEqual(planConfirmBlockers([]), [{ reasonCode: 'PLAN_HAS_NO_LINES', lineCount: 0, itemCount: 0 }]);
});

// ══ Flex 조정 범위 (stage1 §4) ═══════════════════════════════════

test('Flex 폭은 1개월차 ±20%, 2~3개월차 ±30%, 4~6개월차 미적용', () => {
  assert.equal(flexBandForMonth(1), 0.2);
  assert.equal(flexBandForMonth(2), 0.3);
  assert.equal(flexBandForMonth(3), 0.3);
  assert.equal(flexBandForMonth(4), null);
  assert.equal(flexBandForMonth(6), null);
});

test('1차 Forecast가 ±20% 범위를 벗어나면 범위 안에서 선택한다', () => {
  const high = buildPlanItemLines(item({ months: months([{ departmentAgreedQty: 150 }]) }))[0];
  assert.equal(high.candidateSource, 'DEPARTMENT_AGREED');
  assert.equal(high.candidateQty, 150);
  assert.equal(high.flexMinQty, 80);
  assert.equal(high.flexMaxQty, 120);
  assert.equal(high.adjustedDemandQty, 120);
  assert.equal(high.flexApplied, true);

  const low = buildPlanItemLines(item({ months: months([{ departmentAgreedQty: 50 }]) }))[0];
  assert.equal(low.adjustedDemandQty, 80);
  assert.equal(low.flexApplied, true);

  const inside = buildPlanItemLines(item({ months: months([{ departmentAgreedQty: 110 }]) }))[0];
  assert.equal(inside.adjustedDemandQty, 110);
  assert.equal(inside.flexApplied, false);
});

test('2차 Forecast가 ±30% 범위를 벗어나면 범위 안에서 선택한다', () => {
  const lines = buildPlanItemLines(item({ months: months([{}, { departmentAgreedQty: 200 }, { departmentAgreedQty: 60 }]) }));
  assert.equal(lines[1].flexMinQty, 70);
  assert.equal(lines[1].flexMaxQty, 130);
  assert.equal(lines[1].adjustedDemandQty, 130);
  assert.equal(lines[1].flexApplied, true);
  assert.equal(lines[2].adjustedDemandQty, 70);
  assert.equal(lines[2].flexApplied, true);
});

test('4~6개월은 Flex를 적용하지 않는다', () => {
  const lines = buildPlanItemLines(item({ months: months([{}, {}, {}, { departmentAgreedQty: 300 }, { departmentAgreedQty: 10 }]) }));
  for (const line of lines.slice(3)) {
    assert.equal(line.flexMinQty, null);
    assert.equal(line.flexMaxQty, null);
    assert.equal(line.flexApplied, false);
  }
  assert.equal(lines[3].adjustedDemandQty, 300);
  assert.equal(lines[4].adjustedDemandQty, 10);
  assert.equal(lines[5].candidateSource, 'BASE_FORECAST');
  assert.equal(lines[5].adjustedDemandQty, 100);
});

test('승인된 추가 수요는 Flex 클램프 뒤에 더하고 클램프하지 않는다', () => {
  const [first] = buildPlanItemLines(item({ months: months([{ departmentAgreedQty: 150, approvedAddedQty: 50 }]) }));
  assert.equal(first.adjustedDemandQty, 120);
  assert.equal(first.demandQty, 170);
});

// ══ 재고 전개 · 선택 기준 ═════════════════════════════════════════

test('k개월차 시작재고는 k−1개월차 예상 월말재고다', () => {
  const lines = buildPlanItemLines(item());
  assert.equal(lines[1].startStockQty, lines[0].projectedMonthEndQty);
  assert.equal(lines[1].stockoutPreventionQty, 0);
  assert.equal(lines[1].dosRequiredQty, 70);
  assert.equal(lines[1].finalOrderQty, 100);
  assert.equal(lines[1].projectedMonthEndQty, 130);
});

test('평균사용량이 0이면 두 기준이 같아 INVENTORY_VALUE_MIN이고 예상 DoS는 null + AVG_USAGE_ZERO', () => {
  const [first] = buildPlanItemLines(item({ usage6mTotal: 0 }));
  assert.equal(first.calculationStatus, 'CALCULATED');
  assert.equal(first.stockoutPreventionQty, 20);
  assert.equal(first.dosRequiredQty, 20);
  assert.equal(first.selectionReason, 'INVENTORY_VALUE_MIN');
  assert.equal(first.projectedDosDays, null);
  assert.ok(first.reasonCodes.includes('AVG_USAGE_ZERO'));
});

test('시작재고가 수요보다 충분하면 두 기준 모두 0이다', () => {
  const [first] = buildPlanItemLines(item({ startStock: { availableQty: 1000, reasonCode: null } }));
  assert.equal(first.selectedQty, 0);
  assert.equal(first.finalOrderQty, 0);
  assert.equal(first.selectionReason, 'INVENTORY_VALUE_MIN');
});

test('재고 분류 불가면 1개월차는 그 사유로, 이후 달은 PRIOR_MONTH_UNAVAILABLE로 계산 불가', () => {
  const lines = buildPlanItemLines(item({ startStock: { availableQty: null, reasonCode: 'INVENTORY_SCOPE_UNCLASSIFIED' } }));
  assert.equal(lines[0].reasonCode, 'INVENTORY_SCOPE_UNCLASSIFIED');
  assert.equal(lines[0].startStockQty, null);
  assert.equal(lines[1].calculationStatus, 'CALCULATION_UNAVAILABLE');
  assert.equal(lines[1].reasonCode, 'PRIOR_MONTH_UNAVAILABLE');
  assert.equal(lines[1].demandQty, 100);
});

test('단가 · 평균사용량 · Champion · 기준 Forecast가 없으면 임의 수량을 만들지 않는다', () => {
  assert.equal(buildPlanItemLines(item({ unitPrice: null }))[0].reasonCode, 'UNIT_PRICE_UNSET');
  assert.equal(buildPlanItemLines(item({ usage6mTotal: null }))[0].reasonCode, 'AVG_USAGE_UNAVAILABLE');
  assert.equal(buildPlanItemLines(item({ usage6mTotal: -18 }))[0].reasonCode, 'AVG_USAGE_UNAVAILABLE');
  assert.equal(buildPlanItemLines(item({ championModelId: null }))[0].reasonCode, 'CHAMPION_UNAVAILABLE');
  assert.equal(buildPlanItemLines(item({ hasPolicy: false }))[0].reasonCode, 'ITEM_POLICY_MISSING');
  const missingBase = buildPlanItemLines(item({ months: months([{ baseForecastQty: null }]) }));
  assert.equal(missingBase[0].reasonCode, 'BASE_FORECAST_UNAVAILABLE');
  assert.equal(missingBase[0].finalOrderQty, null);
  assert.equal(missingBase[0].selectedQty, null);
  assert.equal(missingBase[1].reasonCode, 'PRIOR_MONTH_UNAVAILABLE');
});

// ══ 학습 데이터만 · 확정 근거만 ══════════════════════════════════

const trainRows = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'].map((month) => ({ useDate: `${month}-15`, qty: 100 }));

test('월평균사용량 근거는 학습 기간의 최근 6개월 합이다(평균 = 합 ÷ 6)', () => {
  assert.equal(usageTotal6m({ trainStart: '2026-01-01', trainEnd: '2026-06-30', rows: trainRows }), 600);
  assert.equal(usageTotal6m({ trainStart: '2026-01-01', trainEnd: '2026-06-30', rows: trainRows.slice(1) }), 500);
  assert.equal(buildPlanItemLines(item({ usage6mTotal: 500 }))[0].avgUsage6m, 500 / 6);
});

test('test Actual을 바꿔도 계획의 학습 Forecast 근거가 변하지 않는다', () => {
  const before = usageTotal6m({ trainStart: '2026-01-01', trainEnd: '2026-06-30', rows: trainRows });
  const withTestActual = usageTotal6m({
    trainStart: '2026-01-01',
    trainEnd: '2026-06-30',
    rows: [...trainRows, { useDate: '2026-07-15', qty: 9999 }, { useDate: '2026-08-15', qty: null }],
  });
  assert.equal(withTestActual, before);
  assert.deepEqual(buildPlanItemLines(item({ usage6mTotal: withTestActual })), buildPlanItemLines(item({ usage6mTotal: before })));
});

test('원본 null 사용량은 0으로 바꾸지 않고 계산 불가다', () => {
  assert.equal(usageTotal6m({ trainStart: '2026-01-01', trainEnd: '2026-06-30', rows: [...trainRows, { useDate: '2026-03-02', qty: null }] }), null);
});

test('학습 기간이 6개월보다 짧으면 평균사용량을 계산하지 않는다', () => {
  assert.equal(usageTotal6m({ trainStart: '2026-02-01', trainEnd: '2026-06-30', rows: trainRows.slice(1) }), null);
});

test('영업 확률을 바꿔도 최종 발주량이 변하지 않는다', () => {
  const confirmedOnly = [
    { sourceCode: 'CONFIRMED_ORDER', counted: true, qty: 20 },
    { sourceCode: 'EVENT_DEMAND', counted: false, qty: 500 },
  ];
  const withPipeline = [...confirmedOnly, { sourceCode: 'SALES_PIPELINE', counted: true, qty: 400, probability: 0.95 }];
  assert.equal(approvedAddedDemand(confirmedOnly), 20);
  assert.equal(approvedAddedDemand(withPipeline), 20);
  const before = buildPlanItemLines(item({ months: months([{ approvedAddedQty: approvedAddedDemand(confirmedOnly) }]) }));
  const after = buildPlanItemLines(item({ months: months([{ approvedAddedQty: approvedAddedDemand(withPipeline) }]) }));
  assert.equal(after[0].finalOrderQty, before[0].finalOrderQty);
});

// ══ 원천 게이트 (컨트롤러 판정 1) ═════════════════════════════════

const importedRow = { batchStatus: 'IMPORTED', importType: 'usage_history', sourceType: 'FILE_UPLOAD' };
const trainPrint: InputFingerprint = { rowCount: 24, qtySum: 2400, maxLoadedAt: '2026-07-01T00:00:00Z', md5: 'a1' };
const testPrint: InputFingerprint = { rowCount: 1, qtySum: 100, maxLoadedAt: '2026-07-01T00:00:00Z', md5: 'b2' };
const verifiedRun = {
  runStatus: 'SUCCESS',
  granularity: 'MONTH',
  windowMatches: true,
  testWindowMatches: true,
  trainingRows: [importedRow],
  testRows: [importedRow],
  trainFingerprint: { stored: trainPrint, current: trainPrint },
  testFingerprints: [{ stored: testPrint, current: testPrint }],
};

test('모든 학습 행이 IMPORTED 적재 배치에서 왔으면 VERIFIED', () => {
  assert.equal(forecastSourceStatus(verifiedRun), 'VERIFIED');
});

test('출처 없는 학습 행이 하나라도 있으면 FORECAST_SOURCE_UNVERIFIED — 모든 라인이 계산 불가', () => {
  const status = forecastSourceStatus({
    ...verifiedRun,
    trainingRows: [importedRow, { batchStatus: null, importType: null, sourceType: null }],
  });
  assert.equal(status, 'FORECAST_SOURCE_UNVERIFIED');
  const lines = buildPlanItemLines(item({ sourceStatus: status }));
  assert.equal(lines.length, 6);
  for (const line of lines) {
    assert.equal(line.calculationStatus, 'CALCULATION_UNAVAILABLE');
    assert.equal(line.reasonCode, 'FORECAST_SOURCE_UNVERIFIED');
    assert.equal(line.baseForecastQty, null);
    assert.equal(line.avgUsage6m, null);
    assert.equal(line.finalOrderQty, null);
  }
});

test('학습 행이 모두 검증됐어도 Champion 채점에 쓴 test 기간 행이 하나라도 출처 없으면 FORECAST_SOURCE_UNVERIFIED', () => {
  const status = forecastSourceStatus({ ...verifiedRun, testRows: [importedRow, { batchStatus: null, importType: null, sourceType: null }] });
  assert.equal(status, 'FORECAST_SOURCE_UNVERIFIED');
  const lines = buildPlanItemLines(item({ sourceStatus: status }));
  assert.ok(lines.every((line) => line.calculationStatus === 'CALCULATION_UNAVAILABLE' && line.finalOrderQty === null));
  assert.equal(
    forecastSourceStatus({ ...verifiedRun, testRows: [{ ...importedRow, importType: 'sales_order' }] }),
    'FORECAST_SOURCE_UNVERIFIED',
  );
});

test('Backtest 이후 검증 기간 설정이 바뀌었으면 FORECAST_WINDOW_CHANGED', () => {
  assert.equal(forecastSourceStatus({ ...verifiedRun, testWindowMatches: false }), 'FORECAST_WINDOW_CHANGED');
});

test('학습 행이 없거나 실행이 SUCCESS가 아니면 FORECAST_SOURCE_UNVERIFIED', () => {
  assert.equal(forecastSourceStatus({ ...verifiedRun, trainingRows: [] }), 'FORECAST_SOURCE_UNVERIFIED');
  assert.equal(forecastSourceStatus({ ...verifiedRun, runStatus: null }), 'FORECAST_SOURCE_UNVERIFIED');
  assert.equal(forecastSourceStatus({ ...verifiedRun, trainingRows: [{ ...importedRow, batchStatus: 'ROLLED_BACK' }] }), 'FORECAST_SOURCE_UNVERIFIED');
});

test('학습 기간이 바뀌었으면 FORECAST_WINDOW_CHANGED', () => {
  assert.equal(forecastSourceStatus({ ...verifiedRun, windowMatches: false }), 'FORECAST_WINDOW_CHANGED');
});

// ══ 입력 지문 (fix round 1) ════════════════════════════════════════

test('실행 · Backtest에 입력 지문이 없으면 FORECAST_INPUT_UNTRACED(다시 실행해야 한다)', () => {
  assert.equal(forecastSourceStatus({ ...verifiedRun, trainFingerprint: { stored: null, current: trainPrint } }), 'FORECAST_INPUT_UNTRACED');
  assert.equal(forecastSourceStatus({ ...verifiedRun, testFingerprints: [{ stored: null, current: testPrint }] }), 'FORECAST_INPUT_UNTRACED');
  assert.equal(buildPlanItemLines(item({ sourceStatus: 'FORECAST_INPUT_UNTRACED' }))[0].reasonCode, 'FORECAST_INPUT_UNTRACED');
});

test('실행 이후 학습 · 검증 기간 행이 바뀌면(삭제 · 추가 · 수정) FORECAST_INPUT_CHANGED', () => {
  const deletedDummy = { ...trainPrint, rowCount: 23, md5: 'c3' };
  assert.equal(forecastSourceStatus({ ...verifiedRun, trainFingerprint: { stored: trainPrint, current: deletedDummy } }), 'FORECAST_INPUT_CHANGED');
  assert.equal(
    forecastSourceStatus({ ...verifiedRun, testFingerprints: [{ stored: testPrint, current: { ...testPrint, qtySum: 99999, md5: 'd4' } }] }),
    'FORECAST_INPUT_CHANGED',
  );
  assert.equal(
    forecastSourceStatus({ ...verifiedRun, trainFingerprint: { stored: trainPrint, current: { ...trainPrint, maxLoadedAt: '2026-07-02T00:00:00Z' } } }),
    'FORECAST_INPUT_CHANGED',
  );
  const lines = buildPlanItemLines(item({ sourceStatus: 'FORECAST_INPUT_CHANGED' }));
  assert.ok(lines.every((line) => line.calculationStatus === 'CALCULATION_UNAVAILABLE' && line.reasonCode === 'FORECAST_INPUT_CHANGED'));
});

test('지문 비교는 시각 표기가 달라도 같은 시각이면 같다', () => {
  assert.equal(
    forecastSourceStatus({ ...verifiedRun, trainFingerprint: { stored: trainPrint, current: { ...trainPrint, maxLoadedAt: '2026-06-30T17:00:00-07:00' } } }),
    'VERIFIED',
  );
});

// ══ 입력 검증 · 정규화 ═══════════════════════════════════════════

test('계획 생성 입력 — 기준월은 YYYY-MM, Forecast Run은 비우거나 UUID', () => {
  assert.deepEqual(validateBuildPlanInput({ planMonth: '2026-10', forecastRunId: '' }), {
    ok: true,
    value: { planMonth: '2026-10-01', forecastRunId: null },
  });
  const runId = '00000000-0000-4000-8000-000000000001';
  assert.deepEqual(validateBuildPlanInput({ planMonth: '2026-10-01', forecastRunId: runId }), {
    ok: true,
    value: { planMonth: '2026-10-01', forecastRunId: runId },
  });
  assert.equal(validateBuildPlanInput({ planMonth: '2026-13', forecastRunId: '' }).ok, false);
  assert.equal(validateBuildPlanInput({ planMonth: '2026-10', forecastRunId: 'abc' }).ok, false);
  assert.equal(validatePlanId('not-a-uuid').ok, false);
  assert.equal(validatePlanId(runId).ok, true);
});

test('계획 행 정규화 — 승인본만 최종본이다', () => {
  const plan = normalizePlanRow({ plan_id: 'p', plan_month: '2026-10-01', version: 2, status: 'PENDING_APPROVAL', is_final: false, n_lines: '12' });
  assert.equal(plan.version, 2);
  assert.equal(plan.isFinal, false);
  assert.equal(plan.nLines, 12);
  assert.equal(normalizePlanRow({ status: 'UNKNOWN' }).status, 'DRAFT');
});

test('확정 결과 정규화 — BLOCKED면 사유 목록, PENDING_APPROVAL이면 승인 요청 ID', () => {
  const blocked = normalizeConfirmResult({
    status: 'BLOCKED',
    blocking_reasons: [{ reason_code: 'TARGET_DOS_UNSET', line_count: 6, item_count: 1 }],
  });
  assert.deepEqual(blocked, { status: 'BLOCKED', approvalId: null, blockingReasons: [{ reasonCode: 'TARGET_DOS_UNSET', lineCount: 6, itemCount: 1 }] });
  assert.equal(normalizeConfirmResult({ status: 'PENDING_APPROVAL', approval_id: 'a-1' }).approvalId, 'a-1');
  assert.equal(normalizeConfirmResult(null).status, 'BLOCKED');
  assert.deepEqual(normalizePlanBlockerRow({ reason_code: 'UNIT_PRICE_UNSET', line_count: '12', item_count: 2 }), {
    reasonCode: 'UNIT_PRICE_UNSET', lineCount: 12, itemCount: 2,
  });
});

test('승인 · 반려 입력 — 반려는 의견이 필수다', () => {
  const planId = '00000000-0000-4000-8000-000000000001';
  const approvalId = '00000000-0000-4000-8000-000000000002';
  assert.deepEqual(validatePlanDecision({ planId, approvalId, decision: 'APPROVED', comment: ' ' }), {
    ok: true, value: { planId, approvalId, decision: 'APPROVED', comment: null },
  });
  assert.equal(validatePlanDecision({ planId, approvalId, decision: 'REJECTED', comment: '' }).ok, false);
  assert.equal(validatePlanDecision({ planId, approvalId, decision: 'HOLD', comment: 'x' }).ok, false);
});

test('상태 배지 색 — 승인본만 초록이다', () => {
  assert.equal(planStatusTone('APPROVED'), 'green');
  assert.equal(planStatusTone('PENDING_APPROVAL'), 'amber');
  assert.equal(planStatusTone('REJECTED'), 'red');
  assert.equal(planStatusTone('DRAFT'), 'gray');
  assert.equal(normalizeForecastRunOption({ run_id: 'r', is_stale: true }).isStale, true);
});

test('라인 정규화 — null 수량은 null로 두고 사유 코드 배열을 유지한다', () => {
  const line = normalizePlanLineRow({
    line_id: 'l', plan_id: 'p', item_id: 'A', month_no: 1, target_month: '2026-10-01',
    final_order_qty: null, calculation_status: 'CALCULATION_UNAVAILABLE',
    reason_code: 'FORECAST_SOURCE_UNVERIFIED', reason_codes: ['FORECAST_SOURCE_UNVERIFIED'], flex_applied: false,
  });
  assert.equal(line.finalOrderQty, null);
  assert.deepEqual(line.reasonCodes, ['FORECAST_SOURCE_UNVERIFIED']);
  assert.equal(PLAN_REASON_LABELS.FORECAST_SOURCE_UNVERIFIED.length > 0, true);
});
