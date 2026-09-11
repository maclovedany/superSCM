// 긴급발주 화면 모델 — Task 11
//
// ★ 여기서 배정이나 재고를 계산하지 않는다. core.urgent_order와 analytics.v_urgent_order ·
//   v_urgent_order_history가 이미 계산 · 범위 제한을 끝낸 값을 그대로 옮긴다(AGENTS.md 2번).
// ★ 알 수 없는 값을 임의 값으로 채우지 않는다. null과 reason code를 그대로 둔다(AGENTS.md 5번).

export const URGENT_ORDER_STATUSES = ['REQUESTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type UrgentOrderStatus = (typeof URGENT_ORDER_STATUSES)[number];

export const URGENT_ORDER_STATUS_LABELS: Record<UrgentOrderStatus, string> = {
  REQUESTED: '요청',
  IN_PROGRESS: '처리 중',
  COMPLETED: '완료',
  CANCELLED: '취소',
};

/** 종료 상태 — 이 상태가 되면 core.update_urgent_order · change_urgent_order_status가 더 이상 받지 않는다 */
export const TERMINAL_URGENT_ORDER_STATUSES: readonly UrgentOrderStatus[] = ['COMPLETED', 'CANCELLED'];

export type StatusTone = 'green' | 'amber' | 'red' | 'gray' | 'blue';

export function urgentOrderStatusTone(status: UrgentOrderStatus | null): StatusTone {
  switch (status) {
    case 'COMPLETED': return 'green';
    case 'IN_PROGRESS': return 'blue';
    case 'REQUESTED': return 'amber';
    case 'CANCELLED': return 'red';
    default: return 'gray';
  }
}

const URGENT_ORDER_ACTION_LABELS: Record<string, string> = {
  URGENT_ORDER_CREATED: '등록',
  URGENT_ORDER_UPDATED: '내용 수정',
  URGENT_ORDER_STATUS_CHANGED: '상태 변경',
};

export type UrgentOrderRow = {
  urgentOrderId: string;
  itemId: string;
  itemName: string | null;
  qty: number | null;
  neededBy: string | null;
  reason: string;
  status: UrgentOrderStatus | null;
  statusLabel: string;
  ownerUserId: string | null;
  ownerName: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export type UrgentOrderHistoryRow = {
  id: string;
  at: string | null;
  actorName: string;
  action: string;
  actionLabel: string;
  urgentOrderId: string;
  itemId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export type UrgentOrderActionState = { error: string | null; success: string | null };

type Failure<Code extends string> = { ok: false; reasonCode: Code; message: string };
type Result<T, Code extends string> = { ok: true; value: T } | Failure<Code>;

function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}

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

function trimmed(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

function positiveNumber(input: unknown): number | null {
  const text = trimmed(input);
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isoDate(input: unknown): string | null {
  const text = trimmed(input);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function urgentOrderStatusOrNull(input: unknown): UrgentOrderStatus | null {
  return typeof input === 'string' && (URGENT_ORDER_STATUSES as readonly string[]).includes(input)
    ? (input as UrgentOrderStatus)
    : null;
}

function fail<Code extends string>(reasonCode: Code, message: string): Failure<Code> {
  return { ok: false, reasonCode, message };
}

export function normalizeUrgentOrderRow(row: Record<string, unknown>): UrgentOrderRow {
  const status = urgentOrderStatusOrNull(value(row, ['status']));
  return {
    urgentOrderId: String(value(row, ['urgent_order_id']) ?? ''),
    itemId: String(value(row, ['item_id']) ?? ''),
    itemName: nullableText(value(row, ['item_name'])),
    qty: numberValue(value(row, ['qty'])),
    neededBy: nullableText(value(row, ['needed_by'])),
    reason: String(value(row, ['reason']) ?? ''),
    status,
    statusLabel: status ? URGENT_ORDER_STATUS_LABELS[status] : '알 수 없음',
    ownerUserId: nullableText(value(row, ['owner_user_id'])),
    ownerName: String(value(row, ['owner_name']) ?? ''),
    createdAt: nullableText(value(row, ['created_at'])),
    updatedAt: nullableText(value(row, ['updated_at'])),
  };
}

export function normalizeUrgentOrderHistoryRow(row: Record<string, unknown>): UrgentOrderHistoryRow {
  const action = String(value(row, ['action']) ?? '');
  const before = value(row, ['before']);
  const after = value(row, ['after']);
  return {
    id: String(value(row, ['id']) ?? ''),
    at: nullableText(value(row, ['at'])),
    actorName: String(value(row, ['actor_name']) ?? ''),
    action,
    actionLabel: URGENT_ORDER_ACTION_LABELS[action] ?? action,
    urgentOrderId: String(value(row, ['urgent_order_id']) ?? ''),
    itemId: nullableText(value(row, ['item_id'])),
    before: isRecord(before) ? before : null,
    after: isRecord(after) ? after : null,
  };
}

export function validateCreateUrgentOrder(input: {
  itemId: FormDataEntryValue | null;
  qty: FormDataEntryValue | null;
  neededBy: FormDataEntryValue | null;
  reason: FormDataEntryValue | null;
}): Result<{ itemId: string; qty: number; neededBy: string; reason: string }, 'ITEM_ID_REQUIRED' | 'QTY_INVALID' | 'NEEDED_BY_INVALID' | 'REASON_REQUIRED'> {
  const itemId = trimmed(input.itemId);
  if (!itemId) return fail('ITEM_ID_REQUIRED', '품목코드를 입력하세요.');
  const qty = positiveNumber(input.qty);
  if (qty === null) return fail('QTY_INVALID', '수량은 0보다 큰 숫자여야 합니다.');
  const neededBy = isoDate(input.neededBy);
  if (!neededBy) return fail('NEEDED_BY_INVALID', '필요일을 입력하세요.');
  const reason = trimmed(input.reason);
  if (!reason) return fail('REASON_REQUIRED', '사유를 입력하세요.');
  return { ok: true, value: { itemId, qty, neededBy, reason } };
}

export function validateUpdateUrgentOrder(input: {
  urgentOrderId: FormDataEntryValue | null;
  qty: FormDataEntryValue | null;
  neededBy: FormDataEntryValue | null;
  reason: FormDataEntryValue | null;
  changeReason: FormDataEntryValue | null;
}): Result<
  { urgentOrderId: string; qty: number; neededBy: string; reason: string; changeReason: string },
  'URGENT_ORDER_ID_REQUIRED' | 'QTY_INVALID' | 'NEEDED_BY_INVALID' | 'REASON_REQUIRED' | 'CHANGE_REASON_REQUIRED'
> {
  const urgentOrderId = trimmed(input.urgentOrderId);
  if (!urgentOrderId) return fail('URGENT_ORDER_ID_REQUIRED', '올바른 긴급발주 ID가 필요합니다.');
  const qty = positiveNumber(input.qty);
  if (qty === null) return fail('QTY_INVALID', '수량은 0보다 큰 숫자여야 합니다.');
  const neededBy = isoDate(input.neededBy);
  if (!neededBy) return fail('NEEDED_BY_INVALID', '필요일을 입력하세요.');
  const reason = trimmed(input.reason);
  if (!reason) return fail('REASON_REQUIRED', '사유를 입력하세요.');
  const changeReason = trimmed(input.changeReason);
  if (!changeReason) return fail('CHANGE_REASON_REQUIRED', '변경 사유를 입력하세요.');
  return { ok: true, value: { urgentOrderId, qty, neededBy, reason, changeReason } };
}

export function validateUrgentOrderStatusChange(input: {
  urgentOrderId: FormDataEntryValue | null;
  status: FormDataEntryValue | null;
  reason: FormDataEntryValue | null;
}): Result<{ urgentOrderId: string; status: UrgentOrderStatus; reason: string }, 'URGENT_ORDER_ID_REQUIRED' | 'STATUS_INVALID' | 'REASON_REQUIRED'> {
  const urgentOrderId = trimmed(input.urgentOrderId);
  if (!urgentOrderId) return fail('URGENT_ORDER_ID_REQUIRED', '올바른 긴급발주 ID가 필요합니다.');
  const status = urgentOrderStatusOrNull(trimmed(input.status));
  if (!status) return fail('STATUS_INVALID', '올바른 상태를 선택하세요.');
  const reason = trimmed(input.reason);
  if (!reason) return fail('REASON_REQUIRED', '사유를 입력하세요.');
  return { ok: true, value: { urgentOrderId, status, reason } };
}
