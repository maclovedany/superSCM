// 발주계획 계산 모델 — Task 9b (stage1 §4 · §5 · §6 · §7 · §9)
//
// ★ 이 파일의 계산 함수는 supabase/migrations/20260911000900_stage1_procurement_plan.sql의
//   core.calculate_procurement_plan_month · core.build_procurement_plan 규칙을 그대로 옮긴 거울이다.
//   규칙을 단위 테스트(model.test.ts)로 고정하는 용도일 뿐이며, 화면은 이 함수로 다시 계산하지 않고
//   DB에 저장된 라인 값(analytics.v_procurement_plan_line)을 그대로 보여준다. 두 곳의 규칙을 바꿀
//   때는 반드시 함께 바꾼다.
// ★ 필수 근거가 없으면 수량을 만들지 않는다 — null과 사유 코드를 돌려준다(AGENTS.md 5번).
// ★ Forecast와 최종 발주량은 다른 값이다. 이 모델은 Forecast를 입력으로만 받고 바꾸지 않는다.

export const PLAN_HORIZON_MONTHS = 6;

export const PLAN_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SUPERSEDED'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  DRAFT: '작성 · 미확정',
  PENDING_APPROVAL: '확정 · 팀장 승인 대기',
  APPROVED: '승인 완료 · 최종본',
  REJECTED: '반려 · 미확정',
  SUPERSEDED: '새 버전으로 대체',
};

export const SOURCE_STATUSES = ['VERIFIED', 'FORECAST_SOURCE_UNVERIFIED', 'FORECAST_RUN_STALE', 'FORECAST_WINDOW_CHANGED'] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const CALCULATION_STATUSES = ['CALCULATED', 'CALCULATION_UNAVAILABLE'] as const;
export type CalculationStatus = (typeof CALCULATION_STATUSES)[number];

export const SELECTION_REASONS = ['STOCKOUT_PREVENTION', 'DOS_TARGET', 'INVENTORY_VALUE_MIN'] as const;
export type SelectionReason = (typeof SELECTION_REASONS)[number];

export const SELECTION_REASON_LABELS: Record<SelectionReason, string> = {
  STOCKOUT_PREVENTION: '품절 방지 수량',
  DOS_TARGET: '목표 DoS 충족 최소수량',
  INVENTORY_VALUE_MIN: '두 기준 동일 · 월말 재고금액 최소',
};

export const CANDIDATE_SOURCES = ['DEPARTMENT_AGREED', 'BASE_FORECAST'] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

/**
 * 사유 코드 우선순위. DB 함수가 사유를 확인하는 순서와 같다 — 라인의 대표 사유(reason_code)는
 * 이 순서에서 가장 앞선 코드다. 확정 차단 사유 목록도 이 순서로 정렬한다.
 */
export const PLAN_REASON_PRIORITY = [
  'FORECAST_SOURCE_UNVERIFIED',
  'FORECAST_RUN_STALE',
  'FORECAST_WINDOW_CHANGED',
  'CHAMPION_UNAVAILABLE',
  'BASE_FORECAST_UNAVAILABLE',
  'AVG_USAGE_UNAVAILABLE',
  'INVENTORY_SCOPE_UNCLASSIFIED',
  'AVAILABLE_STOCK_UNAVAILABLE',
  'PRIOR_MONTH_UNAVAILABLE',
  'ITEM_POLICY_MISSING',
  'UNIT_PRICE_UNSET',
  'TARGET_DOS_UNSET',
  'AVG_USAGE_ZERO',
  'PLAN_HAS_NO_LINES',
] as const;

export const PLAN_REASON_LABELS: Record<(typeof PLAN_REASON_PRIORITY)[number], string> = {
  FORECAST_SOURCE_UNVERIFIED: 'Forecast 학습 데이터가 검증된 적재 배치에서 오지 않았습니다',
  FORECAST_RUN_STALE: 'Forecast 실행 이후 사용 이력이 바뀌었습니다(stale)',
  FORECAST_WINDOW_CHANGED: 'Forecast 실행 뒤 학습 기간 설정이 바뀌었습니다',
  CHAMPION_UNAVAILABLE: '이 Forecast 실행의 Champion 모델이 없습니다',
  BASE_FORECAST_UNAVAILABLE: '해당 월 기준 Forecast가 없습니다',
  AVG_USAGE_UNAVAILABLE: '최근 6개월 월평균사용량을 계산할 수 없습니다',
  INVENTORY_SCOPE_UNCLASSIFIED: '재고 분류가 확정되지 않았습니다',
  AVAILABLE_STOCK_UNAVAILABLE: '가용재고를 조회할 수 없습니다',
  PRIOR_MONTH_UNAVAILABLE: '전월 계산 불가로 시작재고가 없습니다',
  ITEM_POLICY_MISSING: '품목 정책이 없습니다',
  UNIT_PRICE_UNSET: '단가가 설정되지 않았습니다',
  TARGET_DOS_UNSET: '목표 DoS가 승인되지 않았습니다',
  AVG_USAGE_ZERO: '월평균사용량이 0이라 예상 DoS를 계산할 수 없습니다',
  PLAN_HAS_NO_LINES: '계산 대상 품목이 없습니다',
};

export function planReasonLabel(code: string | null): string | null {
  if (code === null) return null;
  return (PLAN_REASON_LABELS as Record<string, string>)[code] ?? code;
}

/** 확정 차단에서 제외하는 정보성 사유 — 계산은 됐고 예상 DoS만 비어 있다 */
const INFORMATIONAL_REASONS: readonly string[] = ['AVG_USAGE_ZERO'];

// ══ 계산 규칙 ═════════════════════════════════════════════════════

/** 1개월차 ±20%, 2~3개월차 ±30%, 4~6개월차 미적용(null) — stage1 §4 · 컨트롤러 판정 3 */
export function flexBandForMonth(monthNo: number): number | null {
  if (monthNo === 1) return 0.2;
  if (monthNo === 2 || monthNo === 3) return 0.3;
  return null;
}

/** MOQ 미설정이면 1 — stage1 §7 */
export function effectiveMoq(moq: number | null): number {
  return moq ?? 1;
}

/** ceil(selected / MOQ) × MOQ — 120, MOQ 50 → 150 */
export function roundUpToMoq(selectedQty: number, moq: number | null): number {
  const unit = effectiveMoq(moq);
  return Math.ceil(selectedQty / unit) * unit;
}

export type PlanMonthCalculationInput = {
  monthNo: number;
  baseForecastQty: number;
  departmentAgreedQty: number | null;
  approvedAddedQty: number;
  startStockQty: number;
  targetDosDays: number;
  avgUsage6m: number;
  moq: number | null;
  unitPrice: number;
};

export type DemandSide = {
  candidateSource: CandidateSource;
  candidateQty: number;
  flexMinQty: number | null;
  flexMaxQty: number | null;
  flexApplied: boolean;
  adjustedDemandQty: number;
  demandQty: number;
};

export type PlanMonthCalculation = DemandSide & {
  stockoutPreventionQty: number;
  dosRequiredQty: number;
  selectedQty: number;
  selectionReason: SelectionReason;
  effectiveMoq: number;
  finalOrderQty: number;
  projectedMonthEndQty: number;
  projectedDosDays: number | null;
  projectedInventoryValue: number;
  dosReasonCode: 'AVG_USAGE_ZERO' | null;
};

/** 조정 후보(부서 합의 수량 → 없으면 기준 Forecast)를 Flex 범위로 클램프한 뒤 승인 추가 수요를 더한다 */
export function calculateDemandSide(input: {
  monthNo: number;
  baseForecastQty: number;
  departmentAgreedQty: number | null;
  approvedAddedQty: number;
}): DemandSide {
  const band = flexBandForMonth(input.monthNo);
  const candidateSource: CandidateSource = input.departmentAgreedQty === null ? 'BASE_FORECAST' : 'DEPARTMENT_AGREED';
  const candidateQty = input.departmentAgreedQty ?? input.baseForecastQty;
  if (band === null) {
    return {
      candidateSource, candidateQty, flexMinQty: null, flexMaxQty: null, flexApplied: false,
      adjustedDemandQty: candidateQty, demandQty: candidateQty + input.approvedAddedQty,
    };
  }
  const lower = input.baseForecastQty * (1 - band);
  const upper = input.baseForecastQty * (1 + band);
  const flexMinQty = Math.min(lower, upper);
  const flexMaxQty = Math.max(lower, upper);
  const adjustedDemandQty = Math.min(Math.max(candidateQty, flexMinQty), flexMaxQty);
  return {
    candidateSource, candidateQty, flexMinQty, flexMaxQty,
    flexApplied: candidateQty < flexMinQty || candidateQty > flexMaxQty,
    adjustedDemandQty,
    // ★ 승인된 추가 수요는 클램프 뒤에 더한다 — 이벤트성 대량 거래는 조정 범위를 벗어날 수 있다(stage1 §5)
    demandQty: adjustedDemandQty + input.approvedAddedQty,
  };
}

/** core.calculate_procurement_plan_month의 거울 — 모든 필수 입력이 있을 때만 부른다 */
export function calculatePlanMonth(input: PlanMonthCalculationInput): PlanMonthCalculation {
  const demand = calculateDemandSide(input);
  const stockoutPreventionQty = Math.max(0, demand.demandQty - input.startStockQty);
  const dosRequiredQty = Math.max(0, demand.demandQty + (input.targetDosDays * input.avgUsage6m) / 30 - input.startStockQty);
  const selectedQty = Math.max(stockoutPreventionQty, dosRequiredQty);
  const selectionReason: SelectionReason = stockoutPreventionQty > dosRequiredQty
    ? 'STOCKOUT_PREVENTION'
    : dosRequiredQty > stockoutPreventionQty ? 'DOS_TARGET' : 'INVENTORY_VALUE_MIN';
  const finalOrderQty = roundUpToMoq(selectedQty, input.moq);
  const projectedMonthEndQty = input.startStockQty + finalOrderQty - demand.demandQty;
  return {
    ...demand,
    stockoutPreventionQty,
    dosRequiredQty,
    selectedQty,
    selectionReason,
    effectiveMoq: effectiveMoq(input.moq),
    finalOrderQty,
    projectedMonthEndQty,
    projectedDosDays: input.avgUsage6m > 0 ? Math.round((projectedMonthEndQty / input.avgUsage6m) * 30 * 10) / 10 : null,
    projectedInventoryValue: projectedMonthEndQty * input.unitPrice,
    dosReasonCode: input.avgUsage6m === 0 ? 'AVG_USAGE_ZERO' : null,
  };
}

export type PlanItemInput = {
  sourceStatus: SourceStatus;
  hasPolicy: boolean;
  /** 승인값만 넘긴다(approvedPolicyValue). 직접 넣은 운영값은 승인이 아니다 */
  targetDosDays: number | null;
  unitPrice: number | null;
  moq: number | null;
  championModelId: string | null;
  avgUsage6m: number | null;
  /** null = 가용재고 행 자체가 없다 */
  startStock: { availableQty: number | null; reasonCode: string | null } | null;
  months: Array<{ monthNo: number; baseForecastQty: number | null; departmentAgreedQty: number | null; approvedAddedQty: number }>;
};

export type PlanItemLine = {
  monthNo: number;
  calculationStatus: CalculationStatus;
  reasonCode: string | null;
  reasonCodes: string[];
  baseForecastQty: number | null;
  avgUsage6m: number | null;
  candidateSource: CandidateSource | null;
  candidateQty: number | null;
  flexMinQty: number | null;
  flexMaxQty: number | null;
  flexApplied: boolean;
  adjustedDemandQty: number | null;
  demandQty: number | null;
  startStockQty: number | null;
  stockoutPreventionQty: number | null;
  dosRequiredQty: number | null;
  selectedQty: number | null;
  selectionReason: SelectionReason | null;
  effectiveMoq: number;
  finalOrderQty: number | null;
  projectedMonthEndQty: number | null;
  projectedDosDays: number | null;
  projectedInventoryValue: number | null;
};

/**
 * 한 품목의 6개월 라인 — core.build_procurement_plan의 품목 루프와 같은 순서로 사유를 확인한다.
 * k개월차 시작재고는 k−1개월차 예상 월말재고이며, 전월이 계산 불가면 이번 달도 계산 불가다.
 */
export function buildPlanItemLines(input: PlanItemInput): PlanItemLine[] {
  const verified = input.sourceStatus === 'VERIFIED';
  let startStockQty: number | null = input.startStock?.availableQty ?? null;

  return input.months.map((month) => {
    const reasons: string[] = [];
    let unavailable = false;
    const block = (code: string) => {
      reasons.push(code);
      unavailable = true;
    };

    if (!verified) {
      block(input.sourceStatus);
    } else {
      if (input.championModelId === null) block('CHAMPION_UNAVAILABLE');
      else if (month.baseForecastQty === null) block('BASE_FORECAST_UNAVAILABLE');
      if (input.avgUsage6m === null || input.avgUsage6m < 0) block('AVG_USAGE_UNAVAILABLE');
    }

    if (month.monthNo === 1) {
      if (input.startStock === null) block('AVAILABLE_STOCK_UNAVAILABLE');
      else if (input.startStock.availableQty === null) block(input.startStock.reasonCode ?? 'AVAILABLE_STOCK_UNAVAILABLE');
    } else if (startStockQty === null) {
      block('PRIOR_MONTH_UNAVAILABLE');
    }

    if (!input.hasPolicy) {
      block('ITEM_POLICY_MISSING');
    } else {
      if (input.unitPrice === null) block('UNIT_PRICE_UNSET');
      if (input.targetDosDays === null) block('TARGET_DOS_UNSET');
    }

    const baseForecastQty = verified && input.championModelId !== null ? month.baseForecastQty : null;
    const demand = baseForecastQty === null
      ? null
      : calculateDemandSide({ monthNo: month.monthNo, baseForecastQty, departmentAgreedQty: month.departmentAgreedQty, approvedAddedQty: month.approvedAddedQty });

    const line: PlanItemLine = {
      monthNo: month.monthNo,
      calculationStatus: unavailable ? 'CALCULATION_UNAVAILABLE' : 'CALCULATED',
      reasonCode: null,
      reasonCodes: reasons,
      baseForecastQty,
      avgUsage6m: verified ? input.avgUsage6m : null,
      candidateSource: demand?.candidateSource ?? null,
      candidateQty: demand?.candidateQty ?? null,
      flexMinQty: demand?.flexMinQty ?? null,
      flexMaxQty: demand?.flexMaxQty ?? null,
      flexApplied: demand?.flexApplied ?? false,
      adjustedDemandQty: demand?.adjustedDemandQty ?? null,
      demandQty: demand?.demandQty ?? null,
      startStockQty,
      stockoutPreventionQty: null,
      dosRequiredQty: null,
      selectedQty: null,
      selectionReason: null,
      effectiveMoq: effectiveMoq(input.moq),
      finalOrderQty: null,
      projectedMonthEndQty: null,
      projectedDosDays: null,
      projectedInventoryValue: null,
    };

    if (!unavailable && baseForecastQty !== null && startStockQty !== null
        && input.targetDosDays !== null && input.avgUsage6m !== null && input.unitPrice !== null) {
      const result = calculatePlanMonth({
        monthNo: month.monthNo, baseForecastQty, departmentAgreedQty: month.departmentAgreedQty,
        approvedAddedQty: month.approvedAddedQty, startStockQty, targetDosDays: input.targetDosDays,
        avgUsage6m: input.avgUsage6m, moq: input.moq, unitPrice: input.unitPrice,
      });
      if (result.dosReasonCode) reasons.push(result.dosReasonCode);
      Object.assign(line, {
        stockoutPreventionQty: result.stockoutPreventionQty,
        dosRequiredQty: result.dosRequiredQty,
        selectedQty: result.selectedQty,
        selectionReason: result.selectionReason,
        finalOrderQty: result.finalOrderQty,
        projectedMonthEndQty: result.projectedMonthEndQty,
        projectedDosDays: result.projectedDosDays,
        projectedInventoryValue: result.projectedInventoryValue,
      });
      startStockQty = result.projectedMonthEndQty;
    } else {
      startStockQty = null;
    }

    line.reasonCode = reasons[0] ?? null;
    return line;
  });
}

// ══ 승인된 정책 값 ════════════════════════════════════════════════

/**
 * 한 정책 필드의 승인값 — 그 필드를 제안한(proposed 값이 null이 아닌) APPROVED 변경안 중 가장 최근에 결정된 것의 값.
 * analytics.v_item_policy의 approved_* 열과 같은 규칙이다. core.item_policy에 직접 들어간 운영값은 승인이 아니다
 * (Task 9a의 target_dos_approved와 같은 판단).
 */
export function approvedPolicyValue(
  revisions: Array<{ status: string; decidedAt: string | null; proposedValue: number | null }>,
): number | null {
  const approved = revisions
    .filter((revision) => revision.status === 'APPROVED' && revision.proposedValue !== null && revision.decidedAt !== null)
    .sort((left, right) => Date.parse(right.decidedAt ?? '') - Date.parse(left.decidedAt ?? ''));
  return approved[0]?.proposedValue ?? null;
}

// ══ 학습 데이터 · 확정 근거 · 원천 게이트 ═══════════════════════════

function monthIndex(isoDate: string): number {
  const [year, month] = isoDate.split('-').map(Number);
  return year * 12 + (month - 1);
}

function monthStart(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}

/**
 * 최근 6개월 월평균사용량 — 학습 기간(core.v_train_demand)의 마지막 6개월만 쓴다.
 * 학습 종료일 뒤(test Actual) 행은 보지 않는다. 원본 null이 하나라도 있으면 0으로 바꾸지 않고 null이다.
 * 기록이 없는 달은 0이다(STEP 5 · 6 월별 grid와 같은 규칙).
 */
export function averageUsage6m(input: {
  trainStart: string;
  trainEnd: string;
  rows: Array<{ useDate: string; qty: number | null }>;
}): number | null {
  const lastMonth = monthIndex(input.trainEnd);
  const firstMonth = lastMonth - 5;
  if (monthIndex(input.trainStart) > firstMonth) return null;
  const windowStart = monthStart(firstMonth);
  const inWindow = input.rows.filter((row) => row.useDate >= windowStart && row.useDate >= input.trainStart && row.useDate <= input.trainEnd);
  if (inWindow.some((row) => row.qty === null)) return null;
  return inWindow.reduce((sum, row) => sum + (row.qty ?? 0), 0) / 6;
}

const APPROVED_DEMAND_SOURCES: readonly string[] = ['CONFIRMED_ORDER', 'SUPPLY_MEETING', 'EVENT_DEMAND'];

/** 승인 추가 수요 — 확정 수주 · 승인된 수급회의 · 승인된 이벤트만(Task 8). 영업 확률은 보지 않는다 */
export function approvedAddedDemand(rows: Array<{ sourceCode: string; counted: boolean; qty: number }>): number {
  return rows
    .filter((row) => row.counted && APPROVED_DEMAND_SOURCES.includes(row.sourceCode))
    .reduce((sum, row) => sum + row.qty, 0);
}

type ProvenanceRow = { batchStatus: string | null; importType: string | null; sourceType: string | null };

/**
 * Forecast 원천 게이트 — core.procurement_forecast_source_status의 거울(컨트롤러 판정 1 · pre-review fix).
 * 확인 순서: 실행 성공 여부 → 학습 기간 일치 → Champion을 채점한 Backtest의 검증 기간 일치 →
 * 모든 학습 행과 test 기간 행의 적재 출처 → stale.
 */
export function forecastSourceStatus(input: {
  runStatus: string | null;
  granularity: string | null;
  windowMatches: boolean;
  testWindowMatches: boolean;
  isStale: boolean;
  rolledBackAfterSnapshot: boolean;
  snapshotAt: string | null;
  trainingRows: Array<ProvenanceRow & { loadedAt: string | null }>;
  testRows: ProvenanceRow[];
}): SourceStatus {
  if (input.runStatus !== 'SUCCESS' || input.granularity !== 'MONTH') return 'FORECAST_SOURCE_UNVERIFIED';
  if (!input.windowMatches || !input.testWindowMatches) return 'FORECAST_WINDOW_CHANGED';
  const verifiedRow = (row: ProvenanceRow) =>
    row.batchStatus === 'IMPORTED' && row.importType === 'usage_history' && row.sourceType === 'FILE_UPLOAD';
  if (input.trainingRows.length === 0 || !input.trainingRows.every(verifiedRow) || !input.testRows.every(verifiedRow)) {
    return 'FORECAST_SOURCE_UNVERIFIED';
  }
  const snapshot = input.snapshotAt === null ? null : Date.parse(input.snapshotAt);
  const loadedAfterSnapshot = input.trainingRows.some((row) => row.loadedAt === null || snapshot === null || Date.parse(row.loadedAt) > snapshot);
  if (input.isStale || input.rolledBackAfterSnapshot || loadedAfterSnapshot) return 'FORECAST_RUN_STALE';
  return 'VERIFIED';
}

export type PlanConfirmBlocker = { reasonCode: string; lineCount: number; itemCount: number };

/** 확정 차단 사유 — 계산 불가 라인 또는 TARGET_DOS_UNSET 라인의 사유별 라인 · 품목 수(컨트롤러 판정 6) */
export function planConfirmBlockers(
  lines: Array<{ itemId: string; calculationStatus: string; reasonCodes: readonly string[] }>,
): PlanConfirmBlocker[] {
  if (lines.length === 0) return [{ reasonCode: 'PLAN_HAS_NO_LINES', lineCount: 0, itemCount: 0 }];
  const byReason = new Map<string, { lines: number; items: Set<string> }>();
  for (const line of lines) {
    const blocking = line.calculationStatus === 'CALCULATION_UNAVAILABLE' || line.reasonCodes.includes('TARGET_DOS_UNSET');
    if (!blocking) continue;
    for (const code of line.reasonCodes) {
      if (INFORMATIONAL_REASONS.includes(code)) continue;
      const entry = byReason.get(code) ?? { lines: 0, items: new Set<string>() };
      entry.lines += 1;
      entry.items.add(line.itemId);
      byReason.set(code, entry);
    }
  }
  const rank = (code: string) => {
    const index = (PLAN_REASON_PRIORITY as readonly string[]).indexOf(code);
    return index === -1 ? PLAN_REASON_PRIORITY.length : index;
  };
  return Array.from(byReason, ([reasonCode, entry]) => ({ reasonCode, lineCount: entry.lines, itemCount: entry.items.size }))
    .sort((left, right) => rank(left.reasonCode) - rank(right.reasonCode) || left.reasonCode.localeCompare(right.reasonCode));
}

// ══ 입력 검증 ═════════════════════════════════════════════════════

type Failure<Code extends string> = { ok: false; reasonCode: Code; message: string };
type Result<T, Code extends string> = { ok: true; value: T } | Failure<Code>;

function fail<Code extends string>(reasonCode: Code, message: string): Failure<Code> {
  return { ok: false, reasonCode, message };
}

function trimmed(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BuildPlanInputReasonCode = 'PLAN_MONTH_INVALID' | 'FORECAST_RUN_ID_INVALID';

/** 계획 생성 입력 — 기준월(YYYY-MM 또는 YYYY-MM-DD)은 그달 1일로, Forecast Run은 비우면 최신 성공 실행 */
export function validateBuildPlanInput(input: {
  planMonth: unknown;
  forecastRunId: unknown;
}): Result<{ planMonth: string; forecastRunId: string | null }, BuildPlanInputReasonCode> {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(trimmed(input.planMonth));
  const month = match ? Number(match[2]) : 0;
  const day = match?.[3] === undefined ? 1 : Number(match[3]);
  if (!match || month < 1 || month > 12 || day < 1 || day > 31) {
    return fail('PLAN_MONTH_INVALID', '기준월은 YYYY-MM 형식이어야 합니다.');
  }
  const runId = trimmed(input.forecastRunId);
  if (runId !== '' && !UUID_PATTERN.test(runId)) {
    return fail('FORECAST_RUN_ID_INVALID', 'Forecast Run을 목록에서 선택하세요.');
  }
  return { ok: true, value: { planMonth: `${match[1]}-${match[2]}-01`, forecastRunId: runId === '' ? null : runId } };
}

export function validatePlanId(input: unknown): Result<string, 'PLAN_ID_INVALID'> {
  const planId = trimmed(input);
  return UUID_PATTERN.test(planId) ? { ok: true, value: planId } : fail('PLAN_ID_INVALID', '올바른 발주계획 ID가 필요합니다.');
}

export function validatePlanDecision(input: {
  planId: unknown;
  approvalId: unknown;
  decision: unknown;
  comment: unknown;
}): Result<{ planId: string; approvalId: string; decision: 'APPROVED' | 'REJECTED'; comment: string | null }, 'PLAN_ID_INVALID' | 'APPROVAL_ID_INVALID' | 'DECISION_INVALID' | 'COMMENT_REQUIRED'> {
  const planId = trimmed(input.planId);
  if (!UUID_PATTERN.test(planId)) return fail('PLAN_ID_INVALID', '올바른 발주계획 ID가 필요합니다.');
  const approvalId = trimmed(input.approvalId);
  if (!UUID_PATTERN.test(approvalId)) return fail('APPROVAL_ID_INVALID', '승인 요청을 찾을 수 없습니다.');
  if (input.decision !== 'APPROVED' && input.decision !== 'REJECTED') return fail('DECISION_INVALID', '승인 또는 반려를 선택하세요.');
  const comment = trimmed(input.comment);
  if (input.decision === 'REJECTED' && comment === '') return fail('COMMENT_REQUIRED', '반려 의견을 입력하세요.');
  return { ok: true, value: { planId, approvalId, decision: input.decision, comment: comment === '' ? null : comment } };
}

// ══ 조회 행 정규화 ════════════════════════════════════════════════

function value(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (row[key] !== undefined) return row[key];
  return undefined;
}

function text(input: unknown): string | null {
  return input === null || input === undefined || input === '' ? null : String(input);
}

function numberOrNull(input: unknown): number | null {
  if (input === null || input === undefined || input === '') return null;
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : null;
}

function count(input: unknown): number {
  return numberOrNull(input) ?? 0;
}

function oneOf<T extends string>(input: unknown, allowed: readonly T[]): T | null {
  return typeof input === 'string' && (allowed as readonly string[]).includes(input) ? (input as T) : null;
}

/** 상태 배지 색 — 승인본만 초록, 승인 대기는 주황, 반려는 빨강, 나머지는 회색 */
export function planStatusTone(status: PlanStatus): 'green' | 'amber' | 'red' | 'gray' {
  if (status === 'APPROVED') return 'green';
  if (status === 'PENDING_APPROVAL') return 'amber';
  if (status === 'REJECTED') return 'red';
  return 'gray';
}

export type ProcurementPlan = {
  planId: string;
  planMonth: string;
  version: number;
  status: PlanStatus;
  confirmedBy: string | null;
  forecastRunId: string | null;
  forecastTrainStart: string | null;
  forecastTrainEnd: string | null;
  forecastDataSnapshotAt: string | null;
  sourceStatus: string | null;
  builtByName: string | null;
  builtAt: string | null;
  confirmedByName: string | null;
  confirmedAt: string | null;
  approvalId: string | null;
  deciderName: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  supersededByPlanId: string | null;
  supersededAt: string | null;
  isFinal: boolean;
  isLatestVersion: boolean;
  isLatestApproved: boolean;
  confirmable: boolean;
  nItems: number;
  nLines: number;
  nCalculatedLines: number;
  nUnavailableLines: number;
  nTargetDosUnsetItems: number;
};

export function normalizePlanRow(row: Record<string, unknown>): ProcurementPlan {
  return {
    planId: String(value(row, ['plan_id']) ?? ''),
    planMonth: String(value(row, ['plan_month']) ?? ''),
    version: count(value(row, ['version'])),
    // 알 수 없는 상태는 최종본으로 보이지 않게 미확정(DRAFT)으로 둔다
    status: oneOf(value(row, ['status']), PLAN_STATUSES) ?? 'DRAFT',
    confirmedBy: text(value(row, ['confirmed_by'])),
    forecastRunId: text(value(row, ['forecast_run_id'])),
    forecastTrainStart: text(value(row, ['forecast_train_start'])),
    forecastTrainEnd: text(value(row, ['forecast_train_end'])),
    forecastDataSnapshotAt: text(value(row, ['forecast_data_snapshot_at'])),
    sourceStatus: text(value(row, ['source_status'])),
    builtByName: text(value(row, ['built_by_name'])),
    builtAt: text(value(row, ['built_at'])),
    confirmedByName: text(value(row, ['confirmed_by_name'])),
    confirmedAt: text(value(row, ['confirmed_at'])),
    approvalId: text(value(row, ['approval_id'])),
    deciderName: text(value(row, ['decider_name'])),
    decidedAt: text(value(row, ['decided_at'])),
    decisionComment: text(value(row, ['decision_comment'])),
    supersededByPlanId: text(value(row, ['superseded_by_plan_id'])),
    supersededAt: text(value(row, ['superseded_at'])),
    isFinal: value(row, ['is_final']) === true,
    isLatestVersion: value(row, ['is_latest_version']) === true,
    isLatestApproved: value(row, ['is_latest_approved']) === true,
    confirmable: value(row, ['confirmable']) === true,
    nItems: count(value(row, ['n_items'])),
    nLines: count(value(row, ['n_lines'])),
    nCalculatedLines: count(value(row, ['n_calculated_lines'])),
    nUnavailableLines: count(value(row, ['n_unavailable_lines'])),
    nTargetDosUnsetItems: count(value(row, ['n_target_dos_unset_items'])),
  };
}

export type ProcurementPlanLine = {
  lineId: string;
  planId: string;
  itemId: string;
  itemName: string | null;
  monthNo: number;
  targetMonth: string;
  championModelId: string | null;
  baseForecastQty: number | null;
  departmentAgreedQty: number | null;
  candidateSource: CandidateSource | null;
  candidateQty: number | null;
  flexMinQty: number | null;
  flexMaxQty: number | null;
  flexApplied: boolean;
  adjustedDemandQty: number | null;
  confirmedOrderQty: number | null;
  meetingQty: number | null;
  eventQty: number | null;
  approvedAddedQty: number | null;
  demandQty: number | null;
  normalStockQty: number | null;
  allocatedQty: number | null;
  availableQty: number | null;
  stockSnapshotAt: string | null;
  startStockQty: number | null;
  targetDosDays: number | null;
  targetDosApproved: boolean;
  unitPrice: number | null;
  moq: number | null;
  packSize: number | null;
  minOrderAmount: number | null;
  avgUsage6m: number | null;
  stockoutPreventionQty: number | null;
  dosRequiredQty: number | null;
  selectedQty: number | null;
  selectionReason: SelectionReason | null;
  effectiveMoq: number | null;
  finalOrderQty: number | null;
  projectedMonthEndQty: number | null;
  projectedDosDays: number | null;
  projectedInventoryValue: number | null;
  calculationStatus: CalculationStatus;
  reasonCode: string | null;
  reasonCodes: string[];
};

export function normalizePlanLineRow(row: Record<string, unknown>): ProcurementPlanLine {
  const reasonCodes = value(row, ['reason_codes']);
  return {
    lineId: String(value(row, ['line_id']) ?? ''),
    planId: String(value(row, ['plan_id']) ?? ''),
    itemId: String(value(row, ['item_id']) ?? ''),
    itemName: text(value(row, ['item_name'])),
    monthNo: count(value(row, ['month_no'])),
    targetMonth: String(value(row, ['target_month']) ?? ''),
    championModelId: text(value(row, ['champion_model_id'])),
    baseForecastQty: numberOrNull(value(row, ['base_forecast_qty'])),
    departmentAgreedQty: numberOrNull(value(row, ['department_agreed_qty'])),
    candidateSource: oneOf(value(row, ['candidate_source']), CANDIDATE_SOURCES),
    candidateQty: numberOrNull(value(row, ['candidate_qty'])),
    flexMinQty: numberOrNull(value(row, ['flex_min_qty'])),
    flexMaxQty: numberOrNull(value(row, ['flex_max_qty'])),
    flexApplied: value(row, ['flex_applied']) === true,
    adjustedDemandQty: numberOrNull(value(row, ['adjusted_demand_qty'])),
    confirmedOrderQty: numberOrNull(value(row, ['confirmed_order_qty'])),
    meetingQty: numberOrNull(value(row, ['meeting_qty'])),
    eventQty: numberOrNull(value(row, ['event_qty'])),
    approvedAddedQty: numberOrNull(value(row, ['approved_added_qty'])),
    demandQty: numberOrNull(value(row, ['demand_qty'])),
    normalStockQty: numberOrNull(value(row, ['normal_stock_qty'])),
    allocatedQty: numberOrNull(value(row, ['allocated_qty'])),
    availableQty: numberOrNull(value(row, ['available_qty'])),
    stockSnapshotAt: text(value(row, ['stock_snapshot_at'])),
    startStockQty: numberOrNull(value(row, ['start_stock_qty'])),
    targetDosDays: numberOrNull(value(row, ['target_dos_days'])),
    targetDosApproved: value(row, ['target_dos_approved']) === true,
    unitPrice: numberOrNull(value(row, ['unit_price'])),
    moq: numberOrNull(value(row, ['moq'])),
    packSize: numberOrNull(value(row, ['pack_size'])),
    minOrderAmount: numberOrNull(value(row, ['min_order_amount'])),
    avgUsage6m: numberOrNull(value(row, ['avg_usage_6m'])),
    stockoutPreventionQty: numberOrNull(value(row, ['stockout_prevention_qty'])),
    dosRequiredQty: numberOrNull(value(row, ['dos_required_qty'])),
    selectedQty: numberOrNull(value(row, ['selected_qty'])),
    selectionReason: oneOf(value(row, ['selection_reason']), SELECTION_REASONS),
    effectiveMoq: numberOrNull(value(row, ['effective_moq'])),
    finalOrderQty: numberOrNull(value(row, ['final_order_qty'])),
    projectedMonthEndQty: numberOrNull(value(row, ['projected_month_end_qty'])),
    projectedDosDays: numberOrNull(value(row, ['projected_dos_days'])),
    projectedInventoryValue: numberOrNull(value(row, ['projected_inventory_value'])),
    // 알 수 없는 상태는 계산된 값으로 보이지 않게 계산 불가로 둔다
    calculationStatus: oneOf(value(row, ['calculation_status']), CALCULATION_STATUSES) ?? 'CALCULATION_UNAVAILABLE',
    reasonCode: text(value(row, ['reason_code'])),
    reasonCodes: Array.isArray(reasonCodes) ? reasonCodes.map(String) : [],
  };
}

export type ProcurementPlanKpi = {
  planId: string;
  monthNo: number;
  targetMonth: string;
  nItems: number;
  nCalculatedLines: number;
  nUnavailableLines: number;
  totalFinalOrderQty: number | null;
  totalProjectedMonthEndQty: number | null;
  totalProjectedInventoryValue: number | null;
  kpiReasonCode: string | null;
};

export function normalizePlanKpiRow(row: Record<string, unknown>): ProcurementPlanKpi {
  return {
    planId: String(value(row, ['plan_id']) ?? ''),
    monthNo: count(value(row, ['month_no'])),
    targetMonth: String(value(row, ['target_month']) ?? ''),
    nItems: count(value(row, ['n_items'])),
    nCalculatedLines: count(value(row, ['n_calculated_lines'])),
    nUnavailableLines: count(value(row, ['n_unavailable_lines'])),
    totalFinalOrderQty: numberOrNull(value(row, ['total_final_order_qty'])),
    totalProjectedMonthEndQty: numberOrNull(value(row, ['total_projected_month_end_qty'])),
    totalProjectedInventoryValue: numberOrNull(value(row, ['total_projected_inventory_value'])),
    kpiReasonCode: text(value(row, ['kpi_reason_code'])),
  };
}

export const PLAN_EVENT_LABELS: Record<string, string> = {
  BUILT: '계산 · 생성',
  SUPERSEDED: '새 버전으로 대체',
  CONFIRM_BLOCKED: '확정 차단',
  CONFIRMED: '확정 · 승인 요청',
  APPROVED: '팀장 승인',
  REJECTED: '팀장 반려',
  APPROVAL_CANCELLED: '승인 요청 취소',
};

export type ProcurementPlanEvent = {
  eventId: string;
  eventType: string;
  previousStatus: string | null;
  nextStatus: string | null;
  actorName: string | null;
  comment: string | null;
  payload: Record<string, unknown>;
  at: string;
};

export function normalizePlanEventRow(row: Record<string, unknown>): ProcurementPlanEvent {
  const payload = value(row, ['payload']);
  return {
    eventId: String(value(row, ['event_id']) ?? ''),
    eventType: String(value(row, ['event_type']) ?? ''),
    previousStatus: text(value(row, ['previous_status'])),
    nextStatus: text(value(row, ['next_status'])),
    actorName: text(value(row, ['actor_name'])),
    comment: text(value(row, ['comment'])),
    payload: payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {},
    at: String(value(row, ['at']) ?? ''),
  };
}

/** analytics.v_procurement_plan_blocker 한 행 */
export function normalizePlanBlockerRow(row: Record<string, unknown>): PlanConfirmBlocker {
  return {
    reasonCode: String(value(row, ['reason_code']) ?? ''),
    lineCount: count(value(row, ['line_count'])),
    itemCount: count(value(row, ['item_count'])),
  };
}

export type ForecastRunOption = {
  runId: string;
  trainStart: string | null;
  trainEnd: string | null;
  finishedAt: string | null;
  isStale: boolean;
};

/** analytics.v_forecast_run 한 행 — 계획 생성 폼의 Run 선택지 */
export function normalizeForecastRunOption(row: Record<string, unknown>): ForecastRunOption {
  return {
    runId: String(value(row, ['run_id']) ?? ''),
    trainStart: text(value(row, ['train_start'])),
    trainEnd: text(value(row, ['train_end'])),
    finishedAt: text(value(row, ['finished_at'])),
    isStale: value(row, ['is_stale']) === true,
  };
}

/** core.confirm_procurement_plan 결과(jsonb) — 확정되면 승인 요청 ID, 막히면 차단 사유 목록 */
export type ConfirmPlanResult = {
  status: 'PENDING_APPROVAL' | 'BLOCKED';
  approvalId: string | null;
  blockingReasons: PlanConfirmBlocker[];
};

export function normalizeConfirmResult(data: unknown): ConfirmPlanResult {
  const row = data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const reasons = Array.isArray(row.blocking_reasons) ? row.blocking_reasons : [];
  return {
    status: row.status === 'PENDING_APPROVAL' ? 'PENDING_APPROVAL' : 'BLOCKED',
    approvalId: text(row.approval_id),
    blockingReasons: reasons.map((reason) => {
      const entry = (reason ?? {}) as Record<string, unknown>;
      return { reasonCode: String(entry.reason_code ?? ''), lineCount: count(entry.line_count), itemCount: count(entry.item_count) };
    }),
  };
}
