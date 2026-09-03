// ATP · 가예약 · 영업 문의의 타입과 정규화 — renew.prd 27장 · 28.3
//
// 계산은 SQL 이 끝냈습니다 (sql/23-atp-sales.sql). 여기서는 뷰 한 줄과 함수 응답을
// 화면이 쓰는 모양으로 바꾸기만 합니다 (AGENTS.md 규칙 2 · 코드 구조 2번).
//
// 조회 함수는 lib/atp.ts 에 있습니다. 이 파일을 나눈 이유는 lib/scm-model.ts 와
// lib/scm.ts 를 나눈 이유와 같습니다 — 순수 함수만 모아 두면 Supabase 클라이언트
// 없이 테스트할 수 있습니다.
//
// 상대 import 에 .ts 를 붙이는 이유는 error.md #17 입니다.

import { toReasonCode, type ReasonCode, type RiskStatus, type Tone } from './status.ts';

/** renew.prd 27.3 의 4구간 */
export type AtpBucket = 'NOW' | '2W' | '1M' | 'BEYOND';

/** renew.prd 27.4 의 응답 상태 */
export type FeasibilityStatus =
  | 'AVAILABLE'
  | 'CONDITIONALLY_AVAILABLE'
  | 'UNAVAILABLE'
  | 'UNKNOWN';

/** renew.prd 28.3 — 영업이 읽는 수급 표현 */
export type SalesSupplyLabel = '안전' | '주의' | '불가';

/** 가예약 상태 (core.soft_allocation.status) */
export type AllocationStatus = 'RESERVED' | 'CONFIRMED' | 'RELEASED';

export const BUCKET_LABEL: Record<AtpBucket, string> = {
  NOW: '즉시',
  '2W': '2주 내',
  '1M': '1개월 내',
  BEYOND: '신규 발주 시',
};

export const FEASIBILITY_LABEL: Record<FeasibilityStatus, string> = {
  AVAILABLE: '가능',
  CONDITIONALLY_AVAILABLE: '조건부 가능',
  UNAVAILABLE: '불가',
  UNKNOWN: '판단 불가',
};

export const FEASIBILITY_TONE: Record<FeasibilityStatus, Tone> = {
  AVAILABLE: 'safe',
  CONDITIONALLY_AVAILABLE: 'warn',
  UNAVAILABLE: 'crit',
  UNKNOWN: 'unknown',
};

export const SUPPLY_TONE: Record<SalesSupplyLabel, Tone> = {
  안전: 'safe',
  주의: 'warn',
  불가: 'crit',
};

export const ALLOCATION_LABEL: Record<AllocationStatus, string> = {
  RESERVED: '가예약',
  CONFIRMED: '수주 확정',
  RELEASED: '해제',
};

export const ALLOCATION_TONE: Record<AllocationStatus, Tone> = {
  RESERVED: 'info',
  CONFIRMED: 'safe',
  RELEASED: 'plain',
};

// ── 정규화 도구 ───────────────────────────────────────────────

export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function text(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : String(value);
}

export function bool(value: unknown): boolean {
  return value === true || value === 'true';
}

/**
 * enum 성격의 컬럼은 작은 함수로 좁힙니다.
 * 삼항으로 좁히면 `.map()` 콜백 안에서 타입이 string 으로 넓어집니다 (error.md #12).
 */
export function toBucket(value: unknown): AtpBucket {
  switch (value) {
    case 'NOW':
    case '2W':
    case '1M':
    case 'BEYOND':
      return value;
    default:
      return 'NOW';
  }
}

/** 모르는 문자열은 UNKNOWN 입니다. 지어내지 않습니다 (AGENTS.md 규칙 5) */
export function toFeasibilityStatus(value: unknown): FeasibilityStatus {
  switch (value) {
    case 'AVAILABLE':
    case 'CONDITIONALLY_AVAILABLE':
    case 'UNAVAILABLE':
      return value;
    default:
      return 'UNKNOWN';
  }
}

export function toSupplyLabel(value: unknown): SalesSupplyLabel | null {
  switch (value) {
    case '안전':
    case '주의':
    case '불가':
      return value;
    default:
      return null;
  }
}

export function toAllocationStatus(value: unknown): AllocationStatus {
  switch (value) {
    case 'CONFIRMED':
    case 'RELEASED':
      return value;
    default:
      return 'RESERVED';
  }
}

function toRisk(value: unknown): RiskStatus {
  if (value === 'SAFE' || value === 'WARNING' || value === 'CRITICAL') return value;
  return 'CALCULATION_UNAVAILABLE';
}

// ── 타입 ──────────────────────────────────────────────────────

/** analytics.v_atp 한 줄 = 한 품목의 한 구간 (renew.prd 27.3) */
export type AtpRow = {
  itemId: string;
  itemName: string | null;
  bucket: AtpBucket;
  bucketOrd: number | null;
  /** BEYOND 는 상한이 없으므로 null 입니다 */
  bucketUntil: string | null;
  availableNow: number | null;
  confirmedIncoming: number | null;
  committedDemand: number | null;
  softAllocation: number | null;
  protectedSafetyStock: number | null;
  /** ★ BEYOND 는 항상 null 입니다. 그 구간은 수량이 아니라 날짜로 답합니다 */
  atpQty: number | null;
  earliestNewSupplyDate: string | null;
  leadTime: number | null;
  leadTimeConfidence: string | null;
  deliveryBufferDays: number | null;
  dataSnapshotAt: string | null;
  reason: ReasonCode | null;
};

/** core.check_order_feasibility 의 반환 (renew.prd 27.5 의 키 + 설명용 몇 개) */
export type Feasibility = {
  status: FeasibilityStatus;
  feasible: boolean;
  availableQty: number | null;
  requestedQty: number | null;
  projectedInventoryAfterOrder: number | null;
  safetyStock: number | null;
  risk: RiskStatus;
  earliestSafeDate: string | null;
  leadTimeUsed: number | null;
  leadTimeConfidence: string | null;
  dataSnapshotAt: string | null;
  reason: ReasonCode | null;
  // 설명에 필요한 값들. 영업 금지 항목(단가 · 공급처)은 없습니다 (renew.prd 4.5).
  itemId: string | null;
  itemName: string | null;
  bucket: AtpBucket;
  bucketUntil: string | null;
  targetDate: string | null;
  atpNow: number | null;
  atp2w: number | null;
  atp1m: number | null;
  confirmedIncoming: number | null;
  committedDemand: number | null;
  softAllocation: number | null;
  earliestNewSupplyDate: string | null;
  deliveryBufferDays: number | null;
  projectionHorizonEnd: string | null;
};

/** analytics.v_sales_supply_status (renew.prd 28.3) */
export type SalesSupplyStatus = {
  itemId: string;
  itemName: string | null;
  status: SalesSupplyLabel | null;
  riskStatus: RiskStatus;
  reason: ReasonCode | null;
  atpNow: number | null;
  atp2w: number | null;
  atp1m: number | null;
  earliestNewSupplyDate: string | null;
  leadTime: number | null;
  dataSnapshotAt: string | null;
};

/** analytics.v_sales_promise_risk */
export type SalesPromiseRisk = {
  soNo: string;
  itemId: string;
  itemName: string | null;
  customer: string | null;
  dueDate: string | null;
  qty: number | null;
  cumulativeCommittedQty: number | null;
  supplyByDueDate: number | null;
  shortfallQty: number | null;
  daysToDue: number | null;
  atpNow: number | null;
  earliestNewSupplyDate: string | null;
};

/** analytics.v_soft_allocation */
export type SoftAllocation = {
  allocationId: number;
  itemId: string;
  itemName: string | null;
  qty: number | null;
  status: AllocationStatus;
  customer: string | null;
  validUntil: string | null;
  /** 유효기간까지 남은 일수. 음수면 이미 지났습니다 */
  daysLeft: number | null;
  requestedEmail: string | null;
  createdAt: string | null;
  releasedAt: string | null;
};

/** analytics.v_sales_inquiry (renew.prd 27.7) */
export type SalesInquiry = {
  inquiryId: number;
  askedEmail: string | null;
  askedAt: string | null;
  itemId: string | null;
  itemName: string | null;
  requestedQty: number | null;
  requestedDate: string | null;
  question: string | null;
  answerStatus: FeasibilityStatus | null;
  softAllocationId: number | null;
  convertedToOrder: boolean;
};

/** analytics.v_sales_inquiry_stats */
export type SalesInquiryStat = {
  itemId: string;
  itemName: string | null;
  inquiries: number | null;
  unavailable: number | null;
  available: number | null;
  converted: number | null;
  /** 비율입니다 (0~1). 백분율이 아닙니다 */
  conversionRate: number | null;
  lastAskedAt: string | null;
};

// ── 정규화 ────────────────────────────────────────────────────

type Row = Record<string, unknown>;

export function normalizeAtp(row: Row): AtpRow {
  return {
    itemId: String(row.item_id ?? ''),
    itemName: text(row.item_name),
    bucket: toBucket(row.bucket),
    bucketOrd: num(row.bucket_ord),
    bucketUntil: text(row.bucket_until),
    availableNow: num(row.available_now),
    confirmedIncoming: num(row.confirmed_incoming),
    committedDemand: num(row.committed_demand),
    softAllocation: num(row.soft_allocation),
    protectedSafetyStock: num(row.protected_safety_stock),
    atpQty: num(row.atp_qty),
    earliestNewSupplyDate: text(row.earliest_new_supply_date),
    leadTime: num(row.lead_time),
    leadTimeConfidence: text(row.lead_time_confidence),
    deliveryBufferDays: num(row.delivery_buffer_days),
    dataSnapshotAt: text(row.data_snapshot_at),
    reason: toReasonCode(row.reason),
  };
}

/**
 * core.check_order_feasibility 의 jsonb 를 좁힙니다.
 *
 * status 는 renew.prd 27.4 의 네 값 중 하나로 반드시 좁혀집니다 — 모르는 문자열은
 * UNKNOWN 입니다. 화면과 AI 가 "그 밖의 상태" 를 만나지 않게 하려는 것입니다.
 */
export function normalizeFeasibility(row: Row): Feasibility {
  return {
    status: toFeasibilityStatus(row.status),
    feasible: bool(row.feasible),
    availableQty: num(row.available_qty),
    requestedQty: num(row.requested_qty),
    projectedInventoryAfterOrder: num(row.projected_inventory_after_order),
    safetyStock: num(row.safety_stock),
    risk: toRisk(row.risk),
    earliestSafeDate: text(row.earliest_safe_date),
    leadTimeUsed: num(row.lead_time_used),
    leadTimeConfidence: text(row.lead_time_confidence),
    dataSnapshotAt: text(row.data_snapshot_at),
    reason: toReasonCode(row.reason),
    itemId: text(row.item_id),
    itemName: text(row.item_name),
    bucket: toBucket(row.bucket),
    bucketUntil: text(row.bucket_until),
    targetDate: text(row.target_date),
    atpNow: num(row.atp_now),
    atp2w: num(row.atp_2w),
    atp1m: num(row.atp_1m),
    confirmedIncoming: num(row.confirmed_incoming),
    committedDemand: num(row.committed_demand),
    softAllocation: num(row.soft_allocation),
    earliestNewSupplyDate: text(row.earliest_new_supply_date),
    deliveryBufferDays: num(row.delivery_buffer_days),
    projectionHorizonEnd: text(row.projection_horizon_end),
  };
}

export function normalizeSupplyStatus(row: Row): SalesSupplyStatus {
  return {
    itemId: String(row.item_id ?? ''),
    itemName: text(row.item_name),
    status: toSupplyLabel(row.status),
    riskStatus: toRisk(row.risk_status),
    reason: toReasonCode(row.reason),
    atpNow: num(row.atp_now),
    atp2w: num(row.atp_2w),
    atp1m: num(row.atp_1m),
    earliestNewSupplyDate: text(row.earliest_new_supply_date),
    leadTime: num(row.lead_time),
    dataSnapshotAt: text(row.data_snapshot_at),
  };
}

export function normalizePromiseRisk(row: Row): SalesPromiseRisk {
  return {
    soNo: String(row.so_no ?? ''),
    itemId: String(row.item_id ?? ''),
    itemName: text(row.item_name),
    customer: text(row.customer),
    dueDate: text(row.due_date),
    qty: num(row.qty),
    cumulativeCommittedQty: num(row.cumulative_committed_qty),
    supplyByDueDate: num(row.supply_by_due_date),
    shortfallQty: num(row.shortfall_qty),
    daysToDue: num(row.days_to_due),
    atpNow: num(row.atp_now),
    earliestNewSupplyDate: text(row.earliest_new_supply_date),
  };
}

export function normalizeSoftAllocation(row: Row): SoftAllocation {
  return {
    allocationId: Number(row.allocation_id ?? 0),
    itemId: String(row.item_id ?? ''),
    itemName: text(row.item_name),
    qty: num(row.qty),
    status: toAllocationStatus(row.status),
    customer: text(row.customer),
    validUntil: text(row.valid_until),
    daysLeft: num(row.days_left),
    requestedEmail: text(row.requested_email),
    createdAt: text(row.created_at),
    releasedAt: text(row.released_at),
  };
}

export function normalizeSalesInquiry(row: Row): SalesInquiry {
  const status = text(row.answer_status);
  return {
    inquiryId: Number(row.inquiry_id ?? 0),
    askedEmail: text(row.asked_email),
    askedAt: text(row.asked_at),
    itemId: text(row.item_id),
    itemName: text(row.item_name),
    requestedQty: num(row.requested_qty),
    requestedDate: text(row.requested_date),
    question: text(row.question),
    // 아직 판정하지 못한 문의는 null 입니다. UNKNOWN 으로 접지 않습니다 —
    // "판단 불가로 답했다" 와 "아직 답이 없다" 는 다릅니다.
    answerStatus: status === null ? null : toFeasibilityStatus(status),
    softAllocationId: num(row.soft_allocation_id),
    convertedToOrder: bool(row.converted_to_order),
  };
}

export function normalizeInquiryStat(row: Row): SalesInquiryStat {
  return {
    itemId: String(row.item_id ?? ''),
    itemName: text(row.item_name),
    inquiries: num(row.n_inquiries),
    unavailable: num(row.n_unavailable),
    available: num(row.n_available),
    converted: num(row.n_converted),
    conversionRate: num(row.conversion_rate),
    lastAskedAt: text(row.last_asked_at),
  };
}

/**
 * 가예약이 곧 만료되는가.
 *
 * 화면 KPI 카드("만료 임박")와 목록 필터가 같은 판정을 쓰도록 여기 한 곳에 둡니다.
 * 남은 일수를 모르면(null) 임박으로 보지 않습니다 — 모른다를 경고로 접지 않습니다.
 */
export function isExpiringSoon(row: SoftAllocation, withinDays = 3): boolean {
  if (row.status !== 'RESERVED') return false;
  if (row.daysLeft === null) return false;
  return row.daysLeft <= withinDays;
}
