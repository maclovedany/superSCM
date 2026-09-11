// 발주 일정 · 입고 차이 계산 모델 — Task 10b (stage1 §8)
//
// ★ 이 파일의 계산 함수는 supabase/migrations/20260911001000_stage1_procurement_schedule.sql의
//   core.build_procurement_schedule 계산 순서를 그대로 옮긴 거울이다. 규칙을 단위 테스트(model.test.ts)로
//   고정하는 용도일 뿐이며, 화면은 이 함수로 다시 계산하지 않고 analytics.v_procurement_schedule /
//   analytics.v_receipt_gap_*에 저장 · 집계된 값을 그대로 보여준다.
// ★ 계산식(브리프 그대로):
//     기준 발주일   = 공급처 출항일 − 해외법인 출항 준비기간
//     요청 발주일   = 기준 발주일이 휴일이면 이전 영업일
//     계획 입고일   = 요청 발주일 + 7일
//     확정 계획 입고일 = 계획 입고일이 휴일이면 이전 영업일
//     입고 차이     = 실제 입고일 − 확정 계획 입고일 (부호 있는 일수, 조기/지연 상태 코드 없음)
// ★ 컨트롤러 판정 — 주문일 · 입고일 모두 KR 영업일 달력을 쓰고, 그 달이 core.business_calendar_readiness에서
//   "준비됨"으로 표시되지 않으면 주말만으로 추정하지 않고 CALENDAR_NOT_READY + null을 돌려준다.

// ══ 날짜 기본 연산 — 로컬 타임존에 영향받지 않도록 UTC epoch-day로 계산한다 ══

function parseIsoDate(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

function toEpochDay(iso: string): number {
  const { y, m, d } = parseIsoDate(iso);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function fromEpochDay(epochDay: number): string {
  const date = new Date(epochDay * 86_400_000);
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 날짜에 일수를 더한다(음수면 뺀다). 월 · 연 경계를 자동으로 넘는다 */
export function addDays(iso: string, days: number): string {
  return fromEpochDay(toEpochDay(iso) + days);
}

/** Postgres extract(dow)와 같다 — 0=일 ~ 6=토 */
export function dayOfWeek(iso: string): number {
  const { y, m, d } = parseIsoDate(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isWeekend(iso: string): boolean {
  const dow = dayOfWeek(iso);
  return dow === 0 || dow === 6;
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** a ≤ b 인 두 날짜 사이의 월(YYYY-MM) 목록(양끝 포함) */
export function monthsBetweenInclusive(a: string, b: string): string[] {
  const months: string[] = [];
  const { y: ay, m: am } = parseIsoDate(a);
  const { y: by, m: bm } = parseIsoDate(b);
  let year = ay;
  let month = am;
  while (year < by || (year === by && month <= bm)) {
    months.push(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

// ══ 출항일 규칙 ═══════════════════════════════════════════════════

/** core.supplier_departure 한 행. weekday · day_of_month 중 정확히 하나만, week_of_month는 weekday와 함께만 채워진다(Task 10a) */
export type DepartureRule = {
  departureId: string;
  weekday: number | null;
  weekOfMonth: number | null;
  dayOfMonth: number | null;
  active: boolean;
  validFrom: string | null;
  validTo: string | null;
};

/** 이 날짜가 규칙의 반복 패턴(요일 · 요일+주차 · 매월 일자)과 맞는가 — active · 적용기간은 보지 않는다 */
export function ruleMatchesDate(rule: DepartureRule, iso: string): boolean {
  const { d } = parseIsoDate(iso);
  if (rule.dayOfMonth !== null) return d === rule.dayOfMonth;
  if (rule.weekday !== null) {
    if (dayOfWeek(iso) !== rule.weekday) return false;
    if (rule.weekOfMonth !== null) return Math.floor((d - 1) / 7) + 1 === rule.weekOfMonth;
    return true;
  }
  return false;
}

/** 이 날짜에 규칙이 켜져 있는가 — active와 valid_from/valid_to만 본다(패턴 일치는 별도) */
export function ruleActiveOn(rule: DepartureRule, iso: string): boolean {
  return rule.active
    && (rule.validFrom === null || rule.validFrom <= iso)
    && (rule.validTo === null || rule.validTo >= iso);
}

export type DepartureDateResult =
  | { departureDate: string; reasonCode: null }
  | { departureDate: null; reasonCode: 'DEPARTURE_RULE_UNSET' | 'DEPARTURE_RULE_AMBIGUOUS' };

/**
 * 공급처 출항일 — 기준월 1일 이후 첫 날짜 중, 그 날짜에 활성이고 패턴이 맞는 규칙이 정확히 하나인 날.
 * 0개면 DEPARTURE_RULE_UNSET, 2개 이상이면 DEPARTURE_RULE_AMBIGUOUS(어느 쪽도 고르지 않는다).
 */
export function findDepartureDate(rules: readonly DepartureRule[], monthStart: string, maxDays = 400): DepartureDateResult {
  for (let i = 0; i < maxDays; i += 1) {
    const candidate = addDays(monthStart, i);
    const matching = rules.filter((rule) => ruleActiveOn(rule, candidate) && ruleMatchesDate(rule, candidate));
    if (matching.length === 1) return { departureDate: candidate, reasonCode: null };
    if (matching.length > 1) return { departureDate: null, reasonCode: 'DEPARTURE_RULE_AMBIGUOUS' };
  }
  return { departureDate: null, reasonCode: 'DEPARTURE_RULE_UNSET' };
}

// ══ KR 영업일 조정 ════════════════════════════════════════════════

/**
 * core.previous_business_day의 거울. overrides에 명시된 날짜는 그 값을 따르고(true=영업일 강제,
 * false=공휴일), 없는 날짜는 주말이 아닌지로만 판정한다(core.is_business_day와 같다). 최대 30일 거슬러
 * 올라가고 그 안에 영업일이 없으면 null이다.
 */
export function previousBusinessDay(iso: string, overrides: ReadonlyMap<string, boolean>, maxTries = 30): string | null {
  let current = iso;
  let tries = 0;
  const isBusinessDay = (day: string) => overrides.get(day) ?? !isWeekend(day);
  while (!isBusinessDay(current)) {
    current = addDays(current, -1);
    tries += 1;
    if (tries > maxTries) return null;
  }
  return current;
}

export type KrConfirmResult = { date: string; reasonCode: null } | { date: null; reasonCode: 'CALENDAR_NOT_READY' };

/**
 * KR 영업일로 확정 — previousBusinessDay로 당긴 뒤, 원래 날짜부터 당겨진 날짜까지 걸친 모든 달이
 * "준비됨"으로 표시돼 있어야 한다(컨트롤러 판정 1). 하나라도 준비 안 됐으면 CALENDAR_NOT_READY + null —
 * "행 없음 = 평일"이라는 core.is_business_day의 기본 판정을 여기서는 그대로 믿지 않는다.
 */
export function confirmedKrDate(iso: string, overrides: ReadonlyMap<string, boolean>, readyMonths: ReadonlySet<string>): KrConfirmResult {
  const adjusted = previousBusinessDay(iso, overrides);
  if (adjusted === null) return { date: null, reasonCode: 'CALENDAR_NOT_READY' };
  const months = monthsBetweenInclusive(adjusted, iso);
  if (!months.every((month) => readyMonths.has(month))) return { date: null, reasonCode: 'CALENDAR_NOT_READY' };
  return { date: adjusted, reasonCode: null };
}

// ══ ISO 주차 번들 키 ══════════════════════════════════════════════

/** ISO-8601 주차(월요일 시작, 그 주의 목요일이 속한 연도가 ISO 연도) */
export function isoWeekOf(iso: string): { isoYear: number; isoWeek: number } {
  const { y, m, d } = parseIsoDate(iso);
  const date = new Date(Date.UTC(y, m - 1, d));
  const isoDow = (date.getUTCDay() + 6) % 7; // 월=0 ~ 일=6
  date.setUTCDate(date.getUTCDate() - isoDow + 3); // 그 주의 목요일
  const isoYear = date.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Dow = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Dow);
  const isoWeek = Math.round((date.getTime() - week1Monday.getTime()) / (7 * 86_400_000)) + 1;
  return { isoYear, isoWeek };
}

/** 공급처 출항일을 ISO 주차로 묶는 표시 키(stage1 §8 "출항일을 주차별로 묶는다") */
export function bundleKey(iso: string): string {
  const { isoYear, isoWeek } = isoWeekOf(iso);
  return `${isoYear}-W${String(isoWeek).padStart(2, '0')}`;
}

// ══ 사유 코드 ═════════════════════════════════════════════════════

export const SCHEDULE_REASON_CODES = [
  'SUPPLIER_UNSET',
  'DEPARTURE_RULE_UNSET',
  'DEPARTURE_RULE_AMBIGUOUS',
  'SUPPLIER_INACTIVE',
  'PREP_DAYS_UNSET',
  'CALENDAR_NOT_READY',
] as const;
export type ScheduleReasonCode = (typeof SCHEDULE_REASON_CODES)[number];

/** analytics.v_procurement_schedule.gap_reason_code — 위 제외 사유들 + 계산은 됐지만 실제 입고일이 아직 없는 경우 */
export const GAP_REASON_CODES = [...SCHEDULE_REASON_CODES, 'ACTUAL_RECEIPT_UNSET'] as const;
export type GapReasonCode = (typeof GAP_REASON_CODES)[number];

export const SCHEDULE_REASON_LABELS: Record<GapReasonCode, string> = {
  SUPPLIER_UNSET: '품목에 매핑된 공급처가 없습니다',
  DEPARTURE_RULE_UNSET: '공급처 출항일 규칙이 없습니다',
  DEPARTURE_RULE_AMBIGUOUS: '적용되는 출항일 규칙이 두 개 이상이라 하나를 고를 수 없습니다',
  SUPPLIER_INACTIVE: '출항일 기준 공급처가 비활성이거나 적용 기간 밖입니다',
  PREP_DAYS_UNSET: '해외법인 출항 준비기간이 설정되지 않았습니다',
  CALENDAR_NOT_READY: 'KR 영업일 달력이 아직 준비되지 않았습니다',
  ACTUAL_RECEIPT_UNSET: '실제 입고일이 아직 입력되지 않았습니다',
};

export function scheduleReasonLabel(code: string | null): string | null {
  if (code === null) return null;
  return (SCHEDULE_REASON_LABELS as Record<string, string>)[code] ?? code;
}

export const CALCULATION_STATUSES = ['SCHEDULED', 'EXCLUDED'] as const;
export type ScheduleCalculationStatus = (typeof CALCULATION_STATUSES)[number];

// ══ 전체 파이프라인 ═══════════════════════════════════════════════

export type ScheduleSupplierInput = {
  supplierId: string;
  entityId: string | null;
  active: boolean;
  validFrom: string | null;
  validTo: string | null;
};

export type ScheduleEntityInput = { entityId: string; prepDays: number };

export type ScheduleComputationInput = {
  /** core.v_item_master.supplier_id — null이면 매핑 자체가 없다 */
  itemSupplierId: string | null;
  /** itemSupplierId로 core.supplier를 찾은 결과 — 없으면 null(SUPPLIER_UNSET) */
  supplier: ScheduleSupplierInput | null;
  /** 그 공급처의 모든 출항일 규칙(활성 · 비활성 모두) */
  departureRules: readonly DepartureRule[];
  /** supplier.entityId로 core.supply_entity를 찾은 결과 — 없으면 null */
  entity: ScheduleEntityInput | null;
  /** 발주계획 기준월 1일(YYYY-MM-01) */
  planMonthStart: string;
  /** KR core.business_calendar 명시 행(true=영업일 강제, false=공휴일) */
  calendarOverrides: ReadonlyMap<string, boolean>;
  /** KR core.business_calendar_readiness에서 ready=true인 월(YYYY-MM) 집합 */
  readyMonths: ReadonlySet<string>;
};

export type ScheduleComputationResult = {
  supplierId: string | null;
  entityId: string | null;
  departureDate: string | null;
  prepDays: number | null;
  baseOrderDate: string | null;
  requestedOrderDate: string | null;
  plannedReceiptDate: string | null;
  confirmedReceiptDate: string | null;
  bundleIsoYear: number | null;
  bundleIsoWeek: number | null;
  calculationStatus: ScheduleCalculationStatus;
  reasonCode: ScheduleReasonCode | null;
};

/**
 * core.build_procurement_schedule 한 라인의 거울 — 확인 순서: 공급처 매핑 → 출항일 규칙 →
 * 출항일 기준 공급처 유효성 → 준비기간 → 기준 발주일의 KR 영업일 확정 → 계획 입고일의 KR 영업일 확정.
 * 중간에 막히면 그때까지 계산된 값(출항일 등)은 남기고 이후 값은 null이다 — "제외됐다"는 사실이
 * 화면에서 사라지지 않게 하기 위해서다(컨트롤러 판정 2 "visible as an exclusion row").
 */
export function computeProcurementScheduleLine(input: ScheduleComputationInput): ScheduleComputationResult {
  const excluded = (reasonCode: ScheduleReasonCode, partial: Partial<ScheduleComputationResult> = {}): ScheduleComputationResult => ({
    supplierId: input.supplier?.supplierId ?? null,
    entityId: null,
    departureDate: null,
    prepDays: null,
    baseOrderDate: null,
    requestedOrderDate: null,
    plannedReceiptDate: null,
    confirmedReceiptDate: null,
    bundleIsoYear: null,
    bundleIsoWeek: null,
    calculationStatus: 'EXCLUDED',
    reasonCode,
    ...partial,
  });

  if (input.itemSupplierId === null || input.supplier === null) {
    return excluded('SUPPLIER_UNSET');
  }

  const departure = findDepartureDate(input.departureRules, input.planMonthStart);
  if (departure.departureDate === null) {
    return excluded(departure.reasonCode);
  }
  const { departureDate } = departure;
  const bundle = isoWeekOf(departureDate);

  const supplierValidOnDeparture = input.supplier.active
    && (input.supplier.validFrom === null || input.supplier.validFrom <= departureDate)
    && (input.supplier.validTo === null || input.supplier.validTo >= departureDate);
  if (!supplierValidOnDeparture) {
    return excluded('SUPPLIER_INACTIVE', { departureDate, bundleIsoYear: bundle.isoYear, bundleIsoWeek: bundle.isoWeek });
  }

  if (input.entity === null || input.entity.prepDays === 0) {
    return excluded('PREP_DAYS_UNSET', {
      entityId: input.entity?.entityId ?? null,
      departureDate,
      prepDays: input.entity?.prepDays ?? null,
      bundleIsoYear: bundle.isoYear,
      bundleIsoWeek: bundle.isoWeek,
    });
  }

  const baseOrderDate = addDays(departureDate, -input.entity.prepDays);
  const orderConfirm = confirmedKrDate(baseOrderDate, input.calendarOverrides, input.readyMonths);
  if (orderConfirm.date === null) {
    return excluded('CALENDAR_NOT_READY', {
      entityId: input.entity.entityId,
      departureDate,
      prepDays: input.entity.prepDays,
      baseOrderDate,
      bundleIsoYear: bundle.isoYear,
      bundleIsoWeek: bundle.isoWeek,
    });
  }
  const requestedOrderDate = orderConfirm.date;
  const plannedReceiptDate = addDays(requestedOrderDate, 7);
  const receiptConfirm = confirmedKrDate(plannedReceiptDate, input.calendarOverrides, input.readyMonths);
  if (receiptConfirm.date === null) {
    return excluded('CALENDAR_NOT_READY', {
      entityId: input.entity.entityId,
      departureDate,
      prepDays: input.entity.prepDays,
      baseOrderDate,
      requestedOrderDate,
      plannedReceiptDate,
      bundleIsoYear: bundle.isoYear,
      bundleIsoWeek: bundle.isoWeek,
    });
  }

  return {
    supplierId: input.supplier.supplierId,
    entityId: input.entity.entityId,
    departureDate,
    prepDays: input.entity.prepDays,
    baseOrderDate,
    requestedOrderDate,
    plannedReceiptDate,
    confirmedReceiptDate: receiptConfirm.date,
    bundleIsoYear: bundle.isoYear,
    bundleIsoWeek: bundle.isoWeek,
    calculationStatus: 'SCHEDULED',
    reasonCode: null,
  };
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
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function validateBuildScheduleInput(input: { planId: unknown }): Result<{ planId: string }, 'PLAN_ID_INVALID'> {
  const planId = trimmed(input.planId);
  if (!UUID_PATTERN.test(planId)) return fail('PLAN_ID_INVALID', '올바른 발주계획 ID가 필요합니다.');
  return { ok: true, value: { planId } };
}

export type RecordActualReceiptReasonCode = 'SCHEDULE_ID_INVALID' | 'ACTUAL_RECEIPT_DATE_INVALID';

/** 실제 입고일 입력 — 빈 문자열은 "지운다(null로 되돌린다)"는 뜻이다 */
export function validateRecordActualReceiptInput(input: {
  scheduleId: unknown;
  actualReceiptDate: unknown;
  note: unknown;
}): Result<{ scheduleId: string; actualReceiptDate: string | null; note: string | null }, RecordActualReceiptReasonCode> {
  const scheduleId = trimmed(input.scheduleId);
  if (!UUID_PATTERN.test(scheduleId)) return fail('SCHEDULE_ID_INVALID', '올바른 일정 ID가 필요합니다.');
  const rawDate = trimmed(input.actualReceiptDate);
  if (rawDate !== '' && !DATE_PATTERN.test(rawDate)) {
    return fail('ACTUAL_RECEIPT_DATE_INVALID', '실제 입고일은 YYYY-MM-DD 형식이어야 합니다.');
  }
  const note = trimmed(input.note);
  return { ok: true, value: { scheduleId, actualReceiptDate: rawDate === '' ? null : rawDate, note: note === '' ? null : note } };
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

export type ProcurementScheduleRow = {
  scheduleId: string;
  planId: string | null;
  planMonth: string | null;
  itemId: string | null;
  itemName: string | null;
  finalOrderQty: number | null;
  supplierId: string | null;
  supplierName: string | null;
  entityId: string | null;
  entityName: string | null;
  departureDate: string | null;
  prepDays: number | null;
  baseOrderDate: string | null;
  requestedOrderDate: string | null;
  plannedReceiptDate: string | null;
  confirmedReceiptDate: string | null;
  bundleIsoYear: number | null;
  bundleIsoWeek: number | null;
  bundleKey: string | null;
  calculationStatus: ScheduleCalculationStatus;
  reasonCode: string | null;
  actualReceiptDate: string | null;
  gapDays: number | null;
  gapReasonCode: string | null;
};

/** analytics.v_procurement_schedule 한 행 */
export function normalizeScheduleRow(row: Record<string, unknown>): ProcurementScheduleRow {
  return {
    scheduleId: String(value(row, ['schedule_id']) ?? ''),
    planId: text(value(row, ['plan_id'])),
    planMonth: text(value(row, ['plan_month'])),
    itemId: text(value(row, ['item_id'])),
    itemName: text(value(row, ['item_name'])),
    finalOrderQty: numberOrNull(value(row, ['final_order_qty'])),
    supplierId: text(value(row, ['supplier_id'])),
    supplierName: text(value(row, ['supplier_name'])),
    entityId: text(value(row, ['entity_id'])),
    entityName: text(value(row, ['entity_name'])),
    departureDate: text(value(row, ['departure_date'])),
    prepDays: numberOrNull(value(row, ['prep_days'])),
    baseOrderDate: text(value(row, ['base_order_date'])),
    requestedOrderDate: text(value(row, ['requested_order_date'])),
    plannedReceiptDate: text(value(row, ['planned_receipt_date'])),
    confirmedReceiptDate: text(value(row, ['confirmed_receipt_date'])),
    bundleIsoYear: numberOrNull(value(row, ['bundle_iso_year'])),
    bundleIsoWeek: numberOrNull(value(row, ['bundle_iso_week'])),
    bundleKey: text(value(row, ['bundle_key'])),
    // 알 수 없는 상태는 계산된 것으로 보이지 않게 EXCLUDED로 둔다
    calculationStatus: (CALCULATION_STATUSES as readonly string[]).includes(value(row, ['calculation_status']) as string)
      ? (value(row, ['calculation_status']) as ScheduleCalculationStatus)
      : 'EXCLUDED',
    reasonCode: text(value(row, ['reason_code'])),
    actualReceiptDate: text(value(row, ['actual_receipt_date'])),
    gapDays: numberOrNull(value(row, ['gap_days'])),
    gapReasonCode: text(value(row, ['gap_reason_code'])),
  };
}

export type ReceiptGapRow = {
  nTotal: number;
  nActualRecorded: number;
  nActualUnset: number;
  avgGapDays: number | null;
  sumGapDays: number | null;
};

export type ReceiptGapEntityRow = ReceiptGapRow & { entityId: string; entityName: string | null };
export type ReceiptGapItemRow = ReceiptGapRow & { itemId: string; itemName: string | null };
export type ReceiptGapMonthRow = ReceiptGapRow & { targetMonth: string };

function normalizeGapCounts(row: Record<string, unknown>): ReceiptGapRow {
  return {
    nTotal: count(value(row, ['n_total'])),
    nActualRecorded: count(value(row, ['n_actual_recorded'])),
    nActualUnset: count(value(row, ['n_actual_unset'])),
    avgGapDays: numberOrNull(value(row, ['avg_gap_days'])),
    sumGapDays: numberOrNull(value(row, ['sum_gap_days'])),
  };
}

/** analytics.v_receipt_gap_entity 한 행 */
export function normalizeReceiptGapEntityRow(row: Record<string, unknown>): ReceiptGapEntityRow {
  return { entityId: String(value(row, ['entity_id']) ?? ''), entityName: text(value(row, ['entity_name'])), ...normalizeGapCounts(row) };
}

/** analytics.v_receipt_gap_item 한 행 */
export function normalizeReceiptGapItemRow(row: Record<string, unknown>): ReceiptGapItemRow {
  return { itemId: String(value(row, ['item_id']) ?? ''), itemName: text(value(row, ['item_name'])), ...normalizeGapCounts(row) };
}

/** analytics.v_receipt_gap_month 한 행 */
export function normalizeReceiptGapMonthRow(row: Record<string, unknown>): ReceiptGapMonthRow {
  return { targetMonth: String(value(row, ['target_month']) ?? ''), ...normalizeGapCounts(row) };
}
