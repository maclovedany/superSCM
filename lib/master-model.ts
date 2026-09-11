// Phase 1 마스터 정규화 — analytics 뷰 한 행을 화면 모델로 옮깁니다.
//
// ★ 여기서 계산하지 않습니다. effective_moq · order_blocked 같은 판정은 전부 뷰가 만든 값입니다.
//   같은 판정을 두 곳에서 하면 언젠가 두 답이 달라집니다.
// ★ 값이 없으면 0 이 아니라 null 입니다.

export type SupplyEntity = {
  entityId: string;
  entityName: string;
  countryCode: string;
  /** 출항 준비기간(일). 아직 못 받았으면 reasonCode 가 PREP_DAYS_UNSET */
  prepDays: number;
  active: boolean;
  validFrom: string | null;
  validTo: string | null;
  note: string | null;
  activeSupplierCount: number;
  reasonCode: string | null;
};

export type Supplier = {
  supplierId: string;
  supplierName: string;
  entityId: string | null;
  entityName: string | null;
  countryCode: string | null;
  leadTimeDays: number | null;
  active: boolean;
  validFrom: string | null;
  validTo: string | null;
  note: string | null;
  departureRuleCount: number;
  reasonCode: string | null;
};

export type SupplierDeparture = {
  departureId: number;
  supplierId: string;
  supplierName: string;
  entityId: string | null;
  /** 0=일 ~ 6=토. day_of_month 와 둘 중 하나만 채워집니다 */
  weekday: number | null;
  dayOfMonth: number | null;
  /** Task 10a — "매월 N번째 요일" 규칙. weekday 와 함께만 채워집니다(§8 "주차 규칙") */
  weekOfMonth: number | null;
  validFrom: string | null;
  validTo: string | null;
  note: string | null;
  /** Task 10a — 규칙 자체를 끈다(기간과 별개). 과거 발주 계산 근거라 행은 지우지 않습니다 */
  active: boolean;
};

export type ItemPolicy = {
  itemId: string;
  targetDosDays: number | null;
  allocationMode: 'AUTO' | 'MANUAL';
  targetStockQty: number | null;
  unitPrice: number | null;
  unitPriceBasis: string | null;
  moq: number | null;
  /** MOQ 미설정이면 1 (stage1 §7) */
  effectiveMoq: number;
  packSize: number | null;
  minOrderAmount: number | null;
  /** 목표 DoS가 승인 이력 없이 비어 있으면 true — 발주 확정을 막습니다 (stage1 §6 · Task 9a) */
  orderBlocked: boolean;
  reasonCode: string | null;
  /** 목표 DoS를 승인한 이력이 있는가. 값이 있어도 승인 이력이 없으면 false입니다(Task 9a) */
  targetDosApproved: boolean;
  updatedAt: string | null;
};

export type MasterReadiness = {
  entities: number;
  prepDaysUnset: number;
  suppliers: number;
  leadtimeUnset: number;
  departureRules: number;
  calendarDays: number;
  itemPolicies: number;
  targetDosUnset: number;
  /** Task 10a — n_calendar_months_ready. v_master_readiness 끝에 덧붙인 열(error.md #16) */
  calendarMonthsReady: number;
};

/** Task 10a — 국가·연·월 단위 영업일 달력 준비 상태(analytics.v_calendar_readiness) */
export type CalendarReadiness = {
  countryCode: string;
  calYear: number;
  calMonth: number;
  ready: boolean;
  note: string | null;
  markedByName: string | null;
  markedAt: string | null;
  holidayCount: number;
};

/** Task 10a — 마스터 변경 이력 한 줄(analytics.v_master_change_history) */
export type MasterHistoryEntry = {
  id: number;
  at: string;
  actorName: string | null;
  action: string;
  targetType: string;
  targetId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

function value(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return null;
}

function numberValue(row: Record<string, unknown>, keys: string[]) {
  const raw = value(row, keys);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(row: Record<string, unknown>, keys: string[]): string | null {
  const raw = value(row, keys);
  return raw === null ? null : String(raw);
}

export function normalizeSupplyEntity(row: Record<string, unknown>): SupplyEntity {
  return {
    entityId: String(value(row, ['entity_id']) ?? '미정'),
    entityName: String(value(row, ['entity_name']) ?? '미정'),
    countryCode: String(value(row, ['country_code']) ?? '미정'),
    prepDays: numberValue(row, ['prep_days']) ?? 0,
    active: row.active !== false,
    validFrom: text(row, ['valid_from']),
    validTo: text(row, ['valid_to']),
    note: text(row, ['note']),
    activeSupplierCount: numberValue(row, ['n_active_suppliers']) ?? 0,
    reasonCode: text(row, ['reason_code']),
  };
}

export function normalizeSupplier(row: Record<string, unknown>): Supplier {
  return {
    supplierId: String(value(row, ['supplier_id']) ?? '미정'),
    supplierName: String(value(row, ['supplier_name']) ?? '미정'),
    entityId: text(row, ['entity_id']),
    entityName: text(row, ['entity_name']),
    countryCode: text(row, ['country_code']),
    leadTimeDays: numberValue(row, ['lead_time_days']),
    active: row.active !== false,
    validFrom: text(row, ['valid_from']),
    validTo: text(row, ['valid_to']),
    note: text(row, ['note']),
    departureRuleCount: numberValue(row, ['n_departure_rules']) ?? 0,
    reasonCode: text(row, ['reason_code']),
  };
}

export function normalizeSupplierDeparture(row: Record<string, unknown>): SupplierDeparture {
  return {
    departureId: numberValue(row, ['departure_id']) ?? 0,
    supplierId: String(value(row, ['supplier_id']) ?? '미정'),
    supplierName: String(value(row, ['supplier_name']) ?? '미정'),
    entityId: text(row, ['entity_id']),
    weekday: numberValue(row, ['weekday']),
    dayOfMonth: numberValue(row, ['day_of_month']),
    weekOfMonth: numberValue(row, ['week_of_month']),
    validFrom: text(row, ['valid_from']),
    validTo: text(row, ['valid_to']),
    note: text(row, ['note']),
    // ★ 구형 뷰(active 없음)는 true 로 본다 — STEP 18 시절 행은 기본값 true 로 이관됐다
    active: row.active !== false,
  };
}

export function normalizeItemPolicy(row: Record<string, unknown>): ItemPolicy {
  const mode = value(row, ['allocation_mode']);
  return {
    itemId: String(value(row, ['item_id']) ?? '미정'),
    targetDosDays: numberValue(row, ['target_dos_days']),
    allocationMode: mode === 'MANUAL' ? 'MANUAL' : 'AUTO',
    targetStockQty: numberValue(row, ['target_stock_qty']),
    unitPrice: numberValue(row, ['unit_price']),
    unitPriceBasis: text(row, ['unit_price_basis']),
    moq: numberValue(row, ['moq']),
    effectiveMoq: numberValue(row, ['effective_moq']) ?? 1,
    packSize: numberValue(row, ['pack_size']),
    minOrderAmount: numberValue(row, ['min_order_amount']),
    orderBlocked: row.order_blocked === true,
    reasonCode: text(row, ['reason_code']),
    // ★ 구형 뷰(target_dos_approved 없음)는 false로 봅니다 — 승인 이력을 임의로 만들지 않습니다.
    targetDosApproved: row.target_dos_approved === true,
    updatedAt: text(row, ['updated_at']),
  };
}

export function normalizeMasterReadiness(row: Record<string, unknown>): MasterReadiness {
  return {
    entities: numberValue(row, ['n_entities']) ?? 0,
    prepDaysUnset: numberValue(row, ['n_prep_days_unset']) ?? 0,
    suppliers: numberValue(row, ['n_suppliers']) ?? 0,
    leadtimeUnset: numberValue(row, ['n_leadtime_unset']) ?? 0,
    departureRules: numberValue(row, ['n_departure_rules']) ?? 0,
    calendarDays: numberValue(row, ['n_calendar_days']) ?? 0,
    itemPolicies: numberValue(row, ['n_item_policies']) ?? 0,
    targetDosUnset: numberValue(row, ['n_target_dos_unset']) ?? 0,
    calendarMonthsReady: numberValue(row, ['n_calendar_months_ready']) ?? 0,
  };
}

export function normalizeCalendarReadiness(row: Record<string, unknown>): CalendarReadiness {
  return {
    countryCode: String(value(row, ['country_code']) ?? '미정'),
    calYear: numberValue(row, ['cal_year']) ?? 0,
    calMonth: numberValue(row, ['cal_month']) ?? 0,
    ready: row.ready === true,
    note: text(row, ['note']),
    markedByName: text(row, ['marked_by_name']),
    markedAt: text(row, ['marked_at']),
    holidayCount: numberValue(row, ['n_holidays']) ?? 0,
  };
}

export function normalizeMasterHistoryEntry(row: Record<string, unknown>): MasterHistoryEntry {
  return {
    id: numberValue(row, ['id']) ?? 0,
    at: String(value(row, ['at']) ?? ''),
    actorName: text(row, ['actor_name']),
    action: String(value(row, ['action']) ?? ''),
    targetType: String(value(row, ['target_type']) ?? ''),
    targetId: String(value(row, ['target_id']) ?? ''),
    before: (row.before as Record<string, unknown> | null) ?? null,
    after: (row.after as Record<string, unknown> | null) ?? null,
  };
}

/** 0=일 ~ 6=토 */
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * 출항일 규칙 한 줄 — 화면과 테스트가 같은 문장을 씁니다.
 *
 * weekOfMonth 는 weekday 와 함께 채워질 때만 의미가 있습니다("매월 N번째 X요일" — §8 주차 규칙).
 * 기존 호출부(週 단위·매월 특정일만 쓰던 곳)가 weekOfMonth 를 안 넘겨도 그대로 동작하도록 선택 항목입니다.
 */
export function departureLabel(rule: {
  weekday: number | null;
  dayOfMonth: number | null;
  weekOfMonth?: number | null;
}): string {
  if (rule.weekday !== null && rule.weekOfMonth) {
    return `매월 ${rule.weekOfMonth}번째 ${WEEKDAY_LABELS[rule.weekday] ?? '?'}요일`;
  }
  if (rule.weekday !== null) return `매주 ${WEEKDAY_LABELS[rule.weekday] ?? '?'}요일`;
  if (rule.dayOfMonth !== null) return `매월 ${rule.dayOfMonth}일`;
  return '규칙 없음';
}

// ══════════════════════════════════════════════════════════════
// Task 10a — 관리자 마스터 편집 입력 검증. 순수 함수만 둔다.
//
// ★ 여기서 권한을 판정하지 않는다. DB 명령 함수(core.upsert_supply_entity 등)가 다시 ADMIN
//   여부를 확인한다. 이 파일은 형식(빈 값·범위·날짜 순서)만 걸러낸다.
// ★ "비활성으로 전환하려면 종료일이 있어야 한다"는 §8 gap 6.1(과거 이력은 지우지 않고 active·
//   종료일로 관리)을 화면에서부터 강제하기 위한 판단이다 — DB 함수도 같은 규칙을 다시 확인한다.
// ══════════════════════════════════════════════════════════════

type Failure<Code extends string> = { ok: false; reasonCode: Code; message: string };
type Result<T, Code extends string> = { ok: true; value: T } | Failure<Code>;

function fail<Code extends string>(reasonCode: Code, message: string): Failure<Code> {
  return { ok: false, reasonCode, message };
}

function trimmed(input: unknown): string {
  if (typeof input === 'string') return input.trim();
  if (typeof input === 'number' && Number.isFinite(input)) return String(input);
  return '';
}

function isTrue(input: unknown): boolean {
  return input === true || input === 'true';
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 빈 값이면 null("기간 제한 없음"). 형식이 아니면 실패 */
function parseOptionalDate(input: unknown): { ok: true; value: string | null } | { ok: false } {
  const raw = trimmed(input);
  if (raw === '') return { ok: true, value: null };
  if (!DATE_PATTERN.test(raw)) return { ok: false };
  return { ok: true, value: raw };
}

/** 빈 값이면 0(음수는 실패) — prepDays 는 0 이 "아직 못 받은 값" 자체의 유효한 상태다 */
function parseNonNegativeIntegerOrZero(input: unknown): { ok: true; value: number } | { ok: false } {
  const raw = trimmed(input);
  if (raw === '') return { ok: true, value: 0 };
  if (!/^\d+$/.test(raw)) return { ok: false };
  return { ok: true, value: Number(raw) };
}

/** 빈 값이면 null("변경하지 않음") */
function parseOptionalNonNegativeInteger(input: unknown): { ok: true; value: number | null } | { ok: false } {
  const raw = trimmed(input);
  if (raw === '') return { ok: true, value: null };
  if (!/^\d+$/.test(raw)) return { ok: false };
  return { ok: true, value: Number(raw) };
}

// ── 해외법인 ─────────────────────────────────────────────────

export type ValidatedSupplyEntityInput = {
  entityId: string;
  entityName: string;
  countryCode: string;
  prepDays: number;
  active: boolean;
  validFrom: string | null;
  validTo: string | null;
  note: string | null;
  reason: string;
};

export type SupplyEntityReasonCode =
  | 'ENTITY_ID_REQUIRED'
  | 'ENTITY_NAME_REQUIRED'
  | 'COUNTRY_CODE_REQUIRED'
  | 'PREP_DAYS_INVALID'
  | 'DATE_INVALID'
  | 'DATE_RANGE_INVALID'
  | 'VALID_TO_REQUIRED_ON_DEACTIVATE'
  | 'REASON_REQUIRED';

export function validateSupplyEntityInput(input: {
  entityId: unknown;
  entityName: unknown;
  countryCode: unknown;
  prepDays: unknown;
  active: unknown;
  validFrom: unknown;
  validTo: unknown;
  note: unknown;
  reason: unknown;
}): Result<ValidatedSupplyEntityInput, SupplyEntityReasonCode> {
  const entityId = trimmed(input.entityId).toUpperCase();
  if (entityId === '') return fail('ENTITY_ID_REQUIRED', '법인 코드를 입력하세요.');

  const entityName = trimmed(input.entityName);
  if (entityName === '') return fail('ENTITY_NAME_REQUIRED', '법인명을 입력하세요.');

  const countryCode = trimmed(input.countryCode).toUpperCase();
  if (countryCode === '') return fail('COUNTRY_CODE_REQUIRED', '국가 코드를 입력하세요.');

  const prepDays = parseNonNegativeIntegerOrZero(input.prepDays);
  if (!prepDays.ok) return fail('PREP_DAYS_INVALID', '출항 준비기간은 0 이상의 정수여야 합니다.');

  const validFrom = parseOptionalDate(input.validFrom);
  if (!validFrom.ok) return fail('DATE_INVALID', '적용 시작일 형식이 올바르지 않습니다(YYYY-MM-DD).');
  const validTo = parseOptionalDate(input.validTo);
  if (!validTo.ok) return fail('DATE_INVALID', '적용 종료일 형식이 올바르지 않습니다(YYYY-MM-DD).');
  if (validFrom.value && validTo.value && validFrom.value > validTo.value) {
    return fail('DATE_RANGE_INVALID', '적용 시작일은 종료일보다 앞서야 합니다.');
  }

  const active = isTrue(input.active);
  if (!active && !validTo.value) {
    return fail('VALID_TO_REQUIRED_ON_DEACTIVATE', '비활성으로 전환하려면 적용 종료일을 입력해야 합니다.');
  }

  const reason = trimmed(input.reason);
  if (reason === '') return fail('REASON_REQUIRED', '변경 사유를 입력하세요.');

  const note = trimmed(input.note);
  return {
    ok: true,
    value: { entityId, entityName, countryCode, prepDays: prepDays.value, active, validFrom: validFrom.value, validTo: validTo.value, note: note === '' ? null : note, reason },
  };
}

// ── 공급처 ───────────────────────────────────────────────────

export type ValidatedSupplierInput = {
  supplierId: string;
  supplierName: string;
  entityId: string;
  leadTimeDays: number | null;
  active: boolean;
  validFrom: string | null;
  validTo: string | null;
  note: string | null;
  reason: string;
};

export type SupplierReasonCode =
  | 'SUPPLIER_ID_REQUIRED'
  | 'SUPPLIER_NAME_REQUIRED'
  | 'ENTITY_ID_REQUIRED'
  | 'LEADTIME_INVALID'
  | 'DATE_INVALID'
  | 'DATE_RANGE_INVALID'
  | 'VALID_TO_REQUIRED_ON_DEACTIVATE'
  | 'REASON_REQUIRED';

export function validateSupplierInput(input: {
  supplierId: unknown;
  supplierName: unknown;
  entityId: unknown;
  leadTimeDays: unknown;
  active: unknown;
  validFrom: unknown;
  validTo: unknown;
  note: unknown;
  reason: unknown;
}): Result<ValidatedSupplierInput, SupplierReasonCode> {
  const supplierId = trimmed(input.supplierId);
  if (supplierId === '') return fail('SUPPLIER_ID_REQUIRED', '공급처 코드를 입력하세요.');

  const supplierName = trimmed(input.supplierName);
  if (supplierName === '') return fail('SUPPLIER_NAME_REQUIRED', '공급처명을 입력하세요.');

  const entityId = trimmed(input.entityId).toUpperCase();
  if (entityId === '') return fail('ENTITY_ID_REQUIRED', '소속 법인을 선택하세요.');

  const leadTimeDays = parseOptionalNonNegativeInteger(input.leadTimeDays);
  if (!leadTimeDays.ok) return fail('LEADTIME_INVALID', '리드타임은 비워두거나 0 이상의 정수여야 합니다.');

  const validFrom = parseOptionalDate(input.validFrom);
  if (!validFrom.ok) return fail('DATE_INVALID', '적용 시작일 형식이 올바르지 않습니다(YYYY-MM-DD).');
  const validTo = parseOptionalDate(input.validTo);
  if (!validTo.ok) return fail('DATE_INVALID', '적용 종료일 형식이 올바르지 않습니다(YYYY-MM-DD).');
  if (validFrom.value && validTo.value && validFrom.value > validTo.value) {
    return fail('DATE_RANGE_INVALID', '적용 시작일은 종료일보다 앞서야 합니다.');
  }

  const active = isTrue(input.active);
  if (!active && !validTo.value) {
    return fail('VALID_TO_REQUIRED_ON_DEACTIVATE', '비활성으로 전환(퇴출)하려면 적용 종료일을 입력해야 합니다.');
  }

  const reason = trimmed(input.reason);
  if (reason === '') return fail('REASON_REQUIRED', '변경 사유를 입력하세요.');

  const note = trimmed(input.note);
  return {
    ok: true,
    value: { supplierId, supplierName, entityId, leadTimeDays: leadTimeDays.value, active, validFrom: validFrom.value, validTo: validTo.value, note: note === '' ? null : note, reason },
  };
}

// ── 출항일 규칙 ───────────────────────────────────────────────

export const DEPARTURE_RULE_TYPES = ['WEEKDAY', 'WEEK_OF_MONTH', 'MONTH_DAY'] as const;
export type DepartureRuleType = (typeof DEPARTURE_RULE_TYPES)[number];

export type ValidatedDepartureRuleInput = {
  departureId: number | null;
  supplierId: string;
  weekday: number | null;
  weekOfMonth: number | null;
  dayOfMonth: number | null;
  validFrom: string | null;
  validTo: string | null;
  note: string | null;
  reason: string;
};

export type DepartureRuleReasonCode =
  | 'SUPPLIER_ID_REQUIRED'
  | 'RULE_TYPE_INVALID'
  | 'WEEKDAY_INVALID'
  | 'WEEK_OF_MONTH_INVALID'
  | 'DAY_OF_MONTH_INVALID'
  | 'DATE_INVALID'
  | 'DATE_RANGE_INVALID'
  | 'REASON_REQUIRED';

function isDepartureRuleType(input: unknown): input is DepartureRuleType {
  return typeof input === 'string' && (DEPARTURE_RULE_TYPES as readonly string[]).includes(input);
}

/**
 * 출항일 규칙 입력 검증 — ruleType 이 화면의 선택(요일 / 주차 / 매월 일자)을 나타내고,
 * 나머지 두 인코딩은 여기서 null 로 비운다. departureId 가 비어 있으면 새 규칙(create),
 * 있으면 그 규칙을 바꾼다(replace) — core.set_supplier_departure_rule 이 판단을 그대로 이어받는다.
 */
export function validateDepartureRuleInput(input: {
  departureId: unknown;
  supplierId: unknown;
  ruleType: unknown;
  weekday: unknown;
  weekOfMonth: unknown;
  dayOfMonth: unknown;
  validFrom: unknown;
  validTo: unknown;
  note: unknown;
  reason: unknown;
}): Result<ValidatedDepartureRuleInput, DepartureRuleReasonCode> {
  const supplierId = trimmed(input.supplierId);
  if (supplierId === '') return fail('SUPPLIER_ID_REQUIRED', '공급처를 선택하세요.');

  if (!isDepartureRuleType(input.ruleType)) return fail('RULE_TYPE_INVALID', '출항일 규칙 종류를 선택하세요.');

  let weekday: number | null = null;
  let weekOfMonth: number | null = null;
  let dayOfMonth: number | null = null;

  if (input.ruleType === 'WEEKDAY' || input.ruleType === 'WEEK_OF_MONTH') {
    const raw = trimmed(input.weekday);
    if (!/^[0-6]$/.test(raw)) return fail('WEEKDAY_INVALID', '요일은 0(일)~6(토) 사이여야 합니다.');
    weekday = Number(raw);
    if (input.ruleType === 'WEEK_OF_MONTH') {
      const rawWeek = trimmed(input.weekOfMonth);
      if (!/^[1-5]$/.test(rawWeek)) return fail('WEEK_OF_MONTH_INVALID', '주차는 1~5 사이여야 합니다.');
      weekOfMonth = Number(rawWeek);
    }
  } else {
    const raw = trimmed(input.dayOfMonth);
    if (!/^([1-9]|[12]\d|3[01])$/.test(raw)) return fail('DAY_OF_MONTH_INVALID', '일자는 1~31 사이여야 합니다.');
    dayOfMonth = Number(raw);
  }

  const validFrom = parseOptionalDate(input.validFrom);
  if (!validFrom.ok) return fail('DATE_INVALID', '적용 시작일 형식이 올바르지 않습니다(YYYY-MM-DD).');
  const validTo = parseOptionalDate(input.validTo);
  if (!validTo.ok) return fail('DATE_INVALID', '적용 종료일 형식이 올바르지 않습니다(YYYY-MM-DD).');
  if (validFrom.value && validTo.value && validFrom.value > validTo.value) {
    return fail('DATE_RANGE_INVALID', '적용 시작일은 종료일보다 앞서야 합니다.');
  }

  const reason = trimmed(input.reason);
  if (reason === '') return fail('REASON_REQUIRED', '변경 사유를 입력하세요.');

  const rawDepartureId = trimmed(input.departureId);
  const departureId = rawDepartureId === '' ? null : Number(rawDepartureId);

  const note = trimmed(input.note);
  return {
    ok: true,
    value: { departureId, supplierId, weekday, weekOfMonth, dayOfMonth, validFrom: validFrom.value, validTo: validTo.value, note: note === '' ? null : note, reason },
  };
}

export type ValidatedDeactivateDepartureRuleInput = { departureId: number; reason: string };
export type DeactivateDepartureRuleReasonCode = 'DEPARTURE_ID_INVALID' | 'REASON_REQUIRED';

export function validateDeactivateDepartureRuleInput(input: {
  departureId: unknown;
  reason: unknown;
}): Result<ValidatedDeactivateDepartureRuleInput, DeactivateDepartureRuleReasonCode> {
  const raw = trimmed(input.departureId);
  if (!/^\d+$/.test(raw)) return fail('DEPARTURE_ID_INVALID', '규칙을 찾을 수 없습니다.');
  const reason = trimmed(input.reason);
  if (reason === '') return fail('REASON_REQUIRED', '변경 사유를 입력하세요.');
  return { ok: true, value: { departureId: Number(raw), reason } };
}

// ── 영업일 달력 ───────────────────────────────────────────────

export type ValidatedHolidayInput = { countryCode: string; calendarDate: string; holidayName: string; reason: string };
export type HolidayReasonCode = 'COUNTRY_CODE_REQUIRED' | 'DATE_INVALID' | 'HOLIDAY_NAME_REQUIRED' | 'REASON_REQUIRED';

export function validateAddHolidayInput(input: {
  countryCode: unknown;
  calendarDate: unknown;
  holidayName: unknown;
  reason: unknown;
}): Result<ValidatedHolidayInput, HolidayReasonCode> {
  const countryCode = trimmed(input.countryCode).toUpperCase();
  if (countryCode === '') return fail('COUNTRY_CODE_REQUIRED', '국가 코드를 입력하세요.');

  const calendarDate = trimmed(input.calendarDate);
  if (!DATE_PATTERN.test(calendarDate)) return fail('DATE_INVALID', '날짜 형식이 올바르지 않습니다(YYYY-MM-DD).');

  const holidayName = trimmed(input.holidayName);
  if (holidayName === '') return fail('HOLIDAY_NAME_REQUIRED', '공휴일 이름을 입력하세요.');

  const reason = trimmed(input.reason);
  if (reason === '') return fail('REASON_REQUIRED', '변경 사유를 입력하세요.');

  return { ok: true, value: { countryCode, calendarDate, holidayName, reason } };
}

export type ValidatedRemoveHolidayInput = { countryCode: string; calendarDate: string; reason: string };
export type RemoveHolidayReasonCode = 'COUNTRY_CODE_REQUIRED' | 'DATE_INVALID' | 'REASON_REQUIRED';

export function validateRemoveHolidayInput(input: {
  countryCode: unknown;
  calendarDate: unknown;
  reason: unknown;
}): Result<ValidatedRemoveHolidayInput, RemoveHolidayReasonCode> {
  const countryCode = trimmed(input.countryCode).toUpperCase();
  if (countryCode === '') return fail('COUNTRY_CODE_REQUIRED', '국가 코드를 입력하세요.');

  const calendarDate = trimmed(input.calendarDate);
  if (!DATE_PATTERN.test(calendarDate)) return fail('DATE_INVALID', '날짜 형식이 올바르지 않습니다(YYYY-MM-DD).');

  const reason = trimmed(input.reason);
  if (reason === '') return fail('REASON_REQUIRED', '변경 사유를 입력하세요.');

  return { ok: true, value: { countryCode, calendarDate, reason } };
}

export type ValidatedCalendarReadinessInput = { countryCode: string; calYear: number; calMonth: number; ready: boolean; reason: string };
export type CalendarReadinessReasonCode = 'COUNTRY_CODE_REQUIRED' | 'YEAR_INVALID' | 'MONTH_INVALID' | 'REASON_REQUIRED';

export function validateCalendarReadinessInput(input: {
  countryCode: unknown;
  calYear: unknown;
  calMonth: unknown;
  ready: unknown;
  reason: unknown;
}): Result<ValidatedCalendarReadinessInput, CalendarReadinessReasonCode> {
  const countryCode = trimmed(input.countryCode).toUpperCase();
  if (countryCode === '') return fail('COUNTRY_CODE_REQUIRED', '국가 코드를 입력하세요.');

  const rawYear = trimmed(input.calYear);
  if (!/^\d{4}$/.test(rawYear)) return fail('YEAR_INVALID', '연도를 올바르게 입력하세요(예: 2026).');
  const calYear = Number(rawYear);

  const rawMonth = trimmed(input.calMonth);
  if (!/^(1[0-2]|[1-9])$/.test(rawMonth)) return fail('MONTH_INVALID', '월은 1~12 사이여야 합니다.');
  const calMonth = Number(rawMonth);

  const reason = trimmed(input.reason);
  if (reason === '') return fail('REASON_REQUIRED', '변경 사유를 입력하세요.');

  return { ok: true, value: { countryCode, calYear, calMonth, ready: isTrue(input.ready), reason } };
}
