// 확정 수요 구성 화면 모델 — Task 8
//
// ★ 여기서 합계를 계산하지 않습니다. analytics.v_approved_demand_monthly가 이미 계산한 합계를
//   그대로 옮겨 담는 일만 합니다(AGENTS.md 2번 "숫자 계산은 SQL이 한다").
// ★ 알 수 없는 값을 임의 값으로 채우지 않습니다. 원천 코드·제외 사유를 그대로 두고, 화면이
//   `EmptyValue`나 한글 라벨로만 바꿔 보여줍니다.

export const APPROVED_DEMAND_SOURCE_CODES = ['CONFIRMED_ORDER', 'SUPPLY_MEETING', 'EVENT_DEMAND'] as const;
export type ApprovedDemandSourceCode = (typeof APPROVED_DEMAND_SOURCE_CODES)[number];

export const APPROVED_DEMAND_SOURCE_LABELS: Record<ApprovedDemandSourceCode, string> = {
  CONFIRMED_ORDER: '수주 확정',
  SUPPLY_MEETING: '수급회의 승인',
  EVENT_DEMAND: '이벤트 추가 수요',
};

export const APPROVED_DEMAND_EXCLUSION_LABELS: Record<string, string> = {
  MEETING_NOT_APPROVED: '수급회의 미승인',
  EVENT_NOT_APPROVED: '이벤트 승인 대기',
  EVENT_REJECTED: '이벤트 반려됨',
};

function isSourceCode(value: unknown): value is ApprovedDemandSourceCode {
  return typeof value === 'string' && (APPROVED_DEMAND_SOURCE_CODES as readonly string[]).includes(value);
}

export type ApprovedDemandDetailRow = {
  sourceCode: ApprovedDemandSourceCode | null;
  sourceLabel: string;
  planMonth: string | null;
  itemId: string | null;
  itemName: string | null;
  qty: number | null;
  counted: boolean;
  exclusionReason: string | null;
  exclusionLabel: string | null;
  referenceId: string | null;
  referenceLabel: string | null;
  customerName: string | null;
  enteredByName: string | null;
  enteredAt: string | null;
  decisionComment: string | null;
  statusLabel: string | null;
};

export type ApprovedDemandMonthlyRow = {
  planMonth: string | null;
  itemId: string | null;
  itemName: string | null;
  approvedQty: number;
  confirmedOrderQty: number;
  supplyMeetingQty: number;
  eventDemandQty: number;
};

function value(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (row[key] !== undefined) return row[key];
  return undefined;
}

function nullableText(input: unknown): string | null {
  return input === null || input === undefined || input === '' ? null : String(input);
}

function numberValue(input: unknown): number | null {
  if (input === null || input === undefined || input === '') return null;
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberOrZero(input: unknown): number {
  return numberValue(input) ?? 0;
}

export function normalizeApprovedDemandDetailRow(row: Record<string, unknown>): ApprovedDemandDetailRow {
  const rawSource = value(row, ['source_code']);
  const sourceCode = isSourceCode(rawSource) ? rawSource : null;
  const exclusionReason = nullableText(value(row, ['exclusion_reason']));
  return {
    sourceCode,
    sourceLabel: sourceCode ? APPROVED_DEMAND_SOURCE_LABELS[sourceCode] : '알 수 없음',
    planMonth: nullableText(value(row, ['plan_month'])),
    itemId: nullableText(value(row, ['item_id'])),
    itemName: nullableText(value(row, ['item_name'])),
    qty: numberValue(value(row, ['qty'])),
    counted: value(row, ['counted']) === true,
    exclusionReason,
    exclusionLabel: exclusionReason ? (APPROVED_DEMAND_EXCLUSION_LABELS[exclusionReason] ?? exclusionReason) : null,
    referenceId: nullableText(value(row, ['reference_id'])),
    referenceLabel: nullableText(value(row, ['reference_label'])),
    customerName: nullableText(value(row, ['customer_name'])),
    enteredByName: nullableText(value(row, ['entered_by_name'])),
    enteredAt: nullableText(value(row, ['entered_at'])),
    decisionComment: nullableText(value(row, ['decision_comment'])),
    statusLabel: nullableText(value(row, ['status_label'])),
  };
}

export function normalizeApprovedDemandMonthlyRow(row: Record<string, unknown>): ApprovedDemandMonthlyRow {
  return {
    planMonth: nullableText(value(row, ['plan_month'])),
    itemId: nullableText(value(row, ['item_id'])),
    itemName: nullableText(value(row, ['item_name'])),
    approvedQty: numberOrZero(value(row, ['approved_qty'])),
    confirmedOrderQty: numberOrZero(value(row, ['confirmed_order_qty'])),
    supplyMeetingQty: numberOrZero(value(row, ['supply_meeting_qty'])),
    eventDemandQty: numberOrZero(value(row, ['event_demand_qty'])),
  };
}

type Failure<Code extends string> = { ok: false; reasonCode: Code; message: string };
type Result<T, Code extends string> = { ok: true; value: T } | Failure<Code>;

function fail<Code extends string>(reasonCode: Code, message: string): Failure<Code> {
  return { ok: false, reasonCode, message };
}

const YEAR_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const YEAR_MONTH_DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function trimmed(input: unknown): string {
  if (typeof input === 'string') return input.trim();
  if (typeof input === 'number' && Number.isFinite(input)) return String(input);
  return '';
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** 'YYYY-MM' 또는 'YYYY-MM-DD'를 'YYYY-MM-01'로 정규화합니다. 형식이 아니면 null */
export function normalizePlanMonth(input: unknown): string | null {
  const raw = trimmed(input);
  const match = YEAR_MONTH_PATTERN.exec(raw) ?? YEAR_MONTH_DAY_PATTERN.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return `${year}-${pad2(month)}-01`;
}

function parsePositiveOrZeroQty(input: unknown): number | null {
  const raw = trimmed(input);
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePositiveQty(input: unknown): number | null {
  const parsed = parsePositiveOrZeroQty(input);
  return parsed !== null && parsed > 0 ? parsed : null;
}

export type ValidatedSupplyMeetingResult = {
  planMonth: string;
  itemId: string;
  qty: number;
  approved: boolean;
  basisSubmissionLineId: string | null;
  reason: string | null;
};

export function validateSetSupplyMeetingResult(input: {
  planMonth: unknown;
  itemId: unknown;
  qty: unknown;
  approved: unknown;
  basisSubmissionLineId?: unknown;
  reason?: unknown;
}):
  Result<ValidatedSupplyMeetingResult, 'PLAN_MONTH_INVALID' | 'ITEM_ID_REQUIRED' | 'QTY_INVALID'> {
  const planMonth = normalizePlanMonth(input.planMonth);
  if (!planMonth) return fail('PLAN_MONTH_INVALID', '계획월은 YYYY-MM 형식이어야 합니다.');

  const itemId = trimmed(input.itemId);
  if (itemId === '') return fail('ITEM_ID_REQUIRED', '품목코드를 입력하세요.');

  const qty = parsePositiveOrZeroQty(input.qty);
  if (qty === null) return fail('QTY_INVALID', '수량은 0 이상의 숫자여야 합니다.');

  const basisSubmissionLineId = trimmed(input.basisSubmissionLineId) || null;
  const reason = trimmed(input.reason) || null;

  return {
    ok: true,
    value: { planMonth, itemId, qty, approved: input.approved === true || input.approved === 'true', basisSubmissionLineId, reason },
  };
}

export type ValidatedEventDemandRequest = {
  planMonth: string;
  itemId: string;
  customerName: string;
  qty: number;
  reason: string;
};

export function validateRequestEventDemand(input: {
  planMonth: unknown;
  itemId: unknown;
  customerName: unknown;
  qty: unknown;
  reason: unknown;
}):
  Result<
    ValidatedEventDemandRequest,
    'PLAN_MONTH_INVALID' | 'EVENT_MODEL_REQUIRED' | 'EVENT_CUSTOMER_REQUIRED' | 'EVENT_QUANTITY_REQUIRED' | 'EVENT_REASON_REQUIRED'
  > {
  const planMonth = normalizePlanMonth(input.planMonth);
  if (!planMonth) return fail('PLAN_MONTH_INVALID', '대상월은 YYYY-MM 형식이어야 합니다.');

  const itemId = trimmed(input.itemId);
  if (itemId === '') return fail('EVENT_MODEL_REQUIRED', '기종(품목코드)을 입력하세요.');

  const customerName = trimmed(input.customerName);
  if (customerName === '') return fail('EVENT_CUSTOMER_REQUIRED', '고객을 입력하세요.');

  const qty = parsePositiveQty(input.qty);
  if (qty === null) return fail('EVENT_QUANTITY_REQUIRED', '수량은 0보다 큰 숫자여야 합니다.');

  const reason = trimmed(input.reason);
  if (reason === '') return fail('EVENT_REASON_REQUIRED', '승인 요청 사유(고객·기종·수량 포함)를 입력하세요.');

  return { ok: true, value: { planMonth, itemId, customerName, qty, reason } };
}
