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
  validFrom: string | null;
  validTo: string | null;
  note: string | null;
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
    validFrom: text(row, ['valid_from']),
    validTo: text(row, ['valid_to']),
    note: text(row, ['note']),
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
  };
}

/** 0=일 ~ 6=토 */
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

/** 출항일 규칙 한 줄 — 화면과 테스트가 같은 문장을 씁니다 */
export function departureLabel(rule: Pick<SupplierDeparture, 'weekday' | 'dayOfMonth'>): string {
  if (rule.weekday !== null) return `매주 ${WEEKDAY_LABELS[rule.weekday] ?? '?'}요일`;
  if (rule.dayOfMonth !== null) return `매월 ${rule.dayOfMonth}일`;
  return '규칙 없음';
}
