// 영업 주문 · 재고 배정 화면 모델 — Task 5
//
// ★ 여기서 배정 수량을 계산하지 않습니다. 가용재고 차감 · 대기 순번 · 부족수량은 모두
//   DB 함수(core.request_order_review 등)와 analytics 뷰가 계산한 값입니다. 이 파일은 입력을
//   검증하고 뷰 행을 화면 타입으로 옮기기만 합니다.
// ★ 알 수 없는 값을 임의 값으로 채우지 않습니다. null 과 reason_code 를 그대로 둡니다
//   (AGENTS.md 5번).

export const ORDER_STATUSES = [
  'DRAFT', 'REVIEW_REQUESTED', 'PARTIALLY_ALLOCATED', 'WAITING_FULL', 'CONFIRMED', 'EXPIRED', 'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  DRAFT: '작성 중',
  REVIEW_REQUESTED: '검토 요청',
  PARTIALLY_ALLOCATED: '부분 임시배정',
  WAITING_FULL: '전체 배정 대기',
  CONFIRMED: '수주 확정',
  EXPIRED: '만료',
  CANCELLED: '취소',
};

export const ALLOCATION_CHOICES = ['PARTIAL', 'WAIT_FULL'] as const;
export type AllocationChoice = (typeof ALLOCATION_CHOICES)[number];

export const ALLOCATION_CHOICE_LABELS: Record<AllocationChoice, string> = {
  PARTIAL: '부분 임시배정',
  WAIT_FULL: '전체 배정 대기',
};

export const ALLOCATION_STATUSES = ['TEMPORARY', 'APPROVAL_HOLD', 'FIRM', 'RELEASED'] as const;
export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];

export const ALLOCATION_STATUS_LABELS: Record<AllocationStatus, string> = {
  TEMPORARY: '임시배정',
  APPROVAL_HOLD: '승인대기 확보',
  FIRM: '확정배정',
  RELEASED: '해제',
};

/** 사업강화부 우선순위. 작을수록 먼저 배정합니다. DB 기본값(core.sales_order.allocation_priority)과 같습니다 */
export const ALLOCATION_PRIORITY_MIN = 1;
export const ALLOCATION_PRIORITY_MAX = 9;
export const ALLOCATION_PRIORITY_DEFAULT = 5;

export const ORDER_EVENT_LABELS: Record<string, string> = {
  CREATED: '주문 등록',
  REVIEW_REQUESTED: '검토 요청',
  ALLOCATION_CHANGED: '배정 변경',
  PRIORITY_CHANGED: '우선순위 변경',
  CONFIRMED: '수주 확정',
  CANCELLED: '주문 취소',
  EXPIRED: '임시배정 만료',
  COPIED: '재등록',
};

export type OrderActionState = { error: string | null; success: string | null };

type Failure<Code extends string> = { ok: false; reasonCode: Code; message: string };
type Result<T, Code extends string> = { ok: true; value: T } | Failure<Code>;

export type SalesOrderLine = {
  lineId: string;
  lineNo: number | null;
  itemId: string;
  itemName: string | null;
  requestedQty: number | null;
  temporaryAllocatedQty: number | null;
  firmAllocatedQty: number | null;
  approvalHoldQty: number | null;
  shortageQty: number | null;
};

export type SalesOrderEvent = {
  eventId: string;
  eventType: string;
  eventTypeLabel: string;
  previousStatus: OrderStatus | null;
  nextStatus: OrderStatus | null;
  actorName: string;
  reason: string | null;
  payload: Record<string, unknown>;
  at: string | null;
};

export type SalesOrder = {
  orderId: string;
  orderNo: string;
  customerId: string | null;
  customerName: string;
  ownerName: string;
  status: OrderStatus | null;
  statusLabel: string;
  requestedAt: string | null;
  firstReviewRequestedAt: string | null;
  temporaryExpiresAt: string | null;
  allocationChoice: AllocationChoice | null;
  allocationChoiceLabel: string | null;
  allocationPriority: number | null;
  confirmedOrderNo: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  expiredAt: string | null;
  replacesOrderId: string | null;
  replacesOrderNo: string | null;
  replacedByOrderId: string | null;
  replacedByOrderNo: string | null;
  note: string | null;
  lineCount: number | null;
  requestedQty: number | null;
  temporaryAllocatedQty: number | null;
  firmAllocatedQty: number | null;
  approvalHoldQty: number | null;
  shortageQty: number | null;
  lines: SalesOrderLine[];
  events: SalesOrderEvent[];
};

export type ActiveAllocation = {
  allocationId: string;
  status: AllocationStatus | null;
  statusLabel: string;
  qty: number | null;
  source: string | null;
  approvalId: string | null;
  createdAt: string | null;
  reason: string | null;
};

export type AllocationQueueRow = {
  itemId: string;
  itemName: string | null;
  /** 같은 품목에서 부족수량이 남은 주문의 대기 순번. 부족수량이 없으면 null */
  queueRank: number | null;
  orderId: string;
  orderNo: string;
  orderStatus: OrderStatus | null;
  orderStatusLabel: string;
  customerName: string;
  ownerName: string;
  lineId: string;
  requestedQty: number | null;
  temporaryAllocatedQty: number | null;
  firmAllocatedQty: number | null;
  approvalHoldQty: number | null;
  shortageQty: number | null;
  allocationChoice: AllocationChoice | null;
  allocationPriority: number | null;
  firstReviewRequestedAt: string | null;
  temporaryExpiresAt: string | null;
  allocationMode: 'AUTO' | 'MANUAL' | null;
  /** 품목 가용재고. 정상 창고재고가 확정되지 않았으면 null (reasonCode 동반) */
  itemAvailableQty: number | null;
  reasonCode: string | null;
  activeAllocations: ActiveAllocation[];
};

/** core.list_manual_allocation_candidates(item_id) 한 행 — Task 11, MANUAL 품목 대기 순번 전용(계산 없음) */
export type ManualAllocationCandidateRow = {
  queueRank: number | null;
  orderId: string;
  orderNo: string;
  lineId: string;
  customerName: string;
  ownerName: string;
  allocationPriority: number | null;
  firstReviewRequestedAt: string | null;
  shortageQty: number | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function value(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (row[key] !== undefined) return row[key];
  return undefined;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}

function trimmed(input: unknown): string {
  if (typeof input === 'string') return input.trim();
  if (typeof input === 'number' && Number.isFinite(input)) return String(input);
  return '';
}

function nullableText(input: unknown): string | null {
  return input === null || input === undefined || input === '' ? null : String(input);
}

function numberValue(input: unknown): number | null {
  if (input === null || input === undefined || input === '') return null;
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : null;
}

function arrayValue(input: unknown): Record<string, unknown>[] {
  return Array.isArray(input) ? input.filter(isRecord) : [];
}

function positiveNumber(input: unknown): number | null {
  const text = trimmed(input);
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function fail<Code extends string>(reasonCode: Code, message: string): Failure<Code> {
  return { ok: false, reasonCode, message };
}

function orderStatusOrNull(input: unknown): OrderStatus | null {
  return typeof input === 'string' && (ORDER_STATUSES as readonly string[]).includes(input) ? input as OrderStatus : null;
}

function allocationChoiceOrNull(input: unknown): AllocationChoice | null {
  return typeof input === 'string' && (ALLOCATION_CHOICES as readonly string[]).includes(input) ? input as AllocationChoice : null;
}

function allocationStatusOrNull(input: unknown): AllocationStatus | null {
  return typeof input === 'string' && (ALLOCATION_STATUSES as readonly string[]).includes(input) ? input as AllocationStatus : null;
}

function orderIdFailure(): Failure<'ORDER_ID_INVALID'> {
  return fail('ORDER_ID_INVALID', '올바른 주문 ID가 필요합니다.');
}

/** core.normalize_item_id 와 같은 규칙 — 공백 · 하이픈 · 밑줄을 지우고 대문자로 */
export function normalizeItemId(input: unknown): string {
  return typeof input === 'string' ? input.replace(/[\s\-_]/g, '').toUpperCase() : '';
}

export function validateCreateOrder(input: {
  customerId: unknown;
  customerName: unknown;
  note: unknown;
  itemIds: unknown[];
  quantities: unknown[];
}): Result<
  { customerId: string | null; customerName: string; note: string | null; lines: Array<{ itemId: string; qty: number }> },
  'CUSTOMER_NAME_REQUIRED' | 'ORDER_LINE_REQUIRED' | 'ORDER_ITEM_REQUIRED' | 'ORDER_QTY_INVALID' | 'ORDER_ITEM_DUPLICATED'
> {
  const customerName = trimmed(input.customerName);
  if (customerName === '') return fail('CUSTOMER_NAME_REQUIRED', '고객명을 입력하세요.');

  const lines: Array<{ itemId: string; qty: number }> = [];
  const rowCount = Math.max(input.itemIds.length, input.quantities.length);
  for (let index = 0; index < rowCount; index += 1) {
    const rawItem = trimmed(input.itemIds[index]);
    const rawQty = trimmed(input.quantities[index]);
    if (rawItem === '' && rawQty === '') continue;

    const itemId = normalizeItemId(rawItem);
    if (itemId === '') return fail('ORDER_ITEM_REQUIRED', '수량을 입력한 줄에는 품목을 선택하세요.');
    const qty = positiveNumber(rawQty);
    if (qty === null) return fail('ORDER_QTY_INVALID', '주문 수량은 0보다 큰 숫자여야 합니다.');
    if (lines.some((line) => line.itemId === itemId)) {
      return fail('ORDER_ITEM_DUPLICATED', '같은 품목은 한 줄로 합쳐 입력하세요.');
    }
    lines.push({ itemId, qty });
  }
  if (lines.length === 0) return fail('ORDER_LINE_REQUIRED', '주문 품목을 한 줄 이상 입력하세요.');

  return {
    ok: true,
    value: {
      customerId: trimmed(input.customerId) || null,
      customerName,
      note: trimmed(input.note) || null,
      lines,
    },
  };
}

export function validateReviewRequest(input: { orderId: unknown; choice: unknown }):
  Result<{ orderId: string; choice: AllocationChoice }, 'ORDER_ID_INVALID' | 'ALLOCATION_CHOICE_REQUIRED'> {
  const orderId = trimmed(input.orderId);
  if (!UUID_PATTERN.test(orderId)) return orderIdFailure();
  const choice = allocationChoiceOrNull(input.choice);
  if (choice === null) {
    return fail('ALLOCATION_CHOICE_REQUIRED', '재고가 부족할 때의 배정 방식(부분 임시배정 또는 전체 배정 대기)을 선택하세요.');
  }
  return { ok: true, value: { orderId, choice } };
}

export function validateConfirmOrder(input: { orderId: unknown; confirmedOrderNo: unknown }):
  Result<{ orderId: string; confirmedOrderNo: string }, 'ORDER_ID_INVALID' | 'CONFIRMED_ORDER_NO_REQUIRED'> {
  const orderId = trimmed(input.orderId);
  if (!UUID_PATTERN.test(orderId)) return orderIdFailure();
  const confirmedOrderNo = trimmed(input.confirmedOrderNo);
  if (confirmedOrderNo === '') return fail('CONFIRMED_ORDER_NO_REQUIRED', '최종 승인된 주문번호를 입력하세요.');
  return { ok: true, value: { orderId, confirmedOrderNo } };
}

export function validatePriorityChange(input: { orderId: unknown; priority: unknown; reason: unknown }):
  Result<{ orderId: string; priority: number; reason: string }, 'ORDER_ID_INVALID' | 'PRIORITY_INVALID' | 'PRIORITY_REASON_REQUIRED'> {
  const orderId = trimmed(input.orderId);
  if (!UUID_PATTERN.test(orderId)) return orderIdFailure();
  const rawPriority = trimmed(input.priority);
  const priority = /^\d+$/.test(rawPriority) ? Number(rawPriority) : Number.NaN;
  if (!(priority >= ALLOCATION_PRIORITY_MIN && priority <= ALLOCATION_PRIORITY_MAX)) {
    return fail('PRIORITY_INVALID', `우선순위는 ${ALLOCATION_PRIORITY_MIN}(최우선)부터 ${ALLOCATION_PRIORITY_MAX}(최후순) 사이의 정수여야 합니다.`);
  }
  const reason = trimmed(input.reason);
  if (reason === '') return fail('PRIORITY_REASON_REQUIRED', '우선순위 변경 사유를 입력하세요.');
  return { ok: true, value: { orderId, priority, reason } };
}

export function validateManualAllocation(input: { orderId: unknown; itemId: unknown; qty: unknown; reason: unknown }):
  Result<
    { orderId: string; itemId: string; qty: number; reason: string | null },
    'ORDER_ID_INVALID' | 'ORDER_ITEM_REQUIRED' | 'MANUAL_QTY_INVALID'
  > {
  const orderId = trimmed(input.orderId);
  if (!UUID_PATTERN.test(orderId)) return orderIdFailure();
  const itemId = normalizeItemId(input.itemId);
  if (itemId === '') return fail('ORDER_ITEM_REQUIRED', '배정할 품목이 필요합니다.');
  const qty = positiveNumber(input.qty);
  if (qty === null) return fail('MANUAL_QTY_INVALID', '배정 수량은 0보다 큰 숫자여야 합니다.');
  return { ok: true, value: { orderId, itemId, qty, reason: trimmed(input.reason) || null } };
}

export function validateFirmCancel(input: { allocationId: unknown; reason: unknown }):
  Result<{ allocationId: string; reason: string }, 'ALLOCATION_ID_INVALID' | 'CANCEL_REASON_REQUIRED'> {
  const allocationId = trimmed(input.allocationId);
  if (!UUID_PATTERN.test(allocationId)) return fail('ALLOCATION_ID_INVALID', '올바른 배정 ID가 필요합니다.');
  const reason = trimmed(input.reason);
  if (reason === '') return fail('CANCEL_REASON_REQUIRED', '확정배정 취소 사유를 입력하세요.');
  return { ok: true, value: { allocationId, reason } };
}

export function validateCopyOrder(input: { orderId: unknown }): Result<{ orderId: string }, 'ORDER_ID_INVALID'> {
  const orderId = trimmed(input.orderId);
  if (!UUID_PATTERN.test(orderId)) return orderIdFailure();
  return { ok: true, value: { orderId } };
}

export function validateCancelOrder(input: { orderId: unknown; reason: unknown }):
  Result<{ orderId: string; reason: string }, 'ORDER_ID_INVALID' | 'CANCEL_REASON_REQUIRED'> {
  const orderId = trimmed(input.orderId);
  if (!UUID_PATTERN.test(orderId)) return orderIdFailure();
  const reason = trimmed(input.reason);
  if (reason === '') return fail('CANCEL_REASON_REQUIRED', '주문 취소 사유를 입력하세요.');
  return { ok: true, value: { orderId, reason } };
}

/** 주문 상세 화면에서 보일 명령. 실제 허용 여부는 DB 함수가 다시 판정합니다 */
export function orderActionsFor(order: {
  status: OrderStatus | null;
  replacedByOrderId: string | null;
  firmAllocatedQty: number | null;
}) {
  const status = order.status;
  const inReview = status === 'REVIEW_REQUESTED' || status === 'PARTIALLY_ALLOCATED' || status === 'WAITING_FULL';
  const hasFirmAllocation = order.firmAllocatedQty !== null && order.firmAllocatedQty > 0;
  return {
    canRequestReview: status === 'DRAFT',
    canConfirm: inReview,
    canCopy: (status === 'CANCELLED' || status === 'EXPIRED') && order.replacedByOrderId === null,
    // 확정배정이 있으면 주문 취소가 아니라 SCM 품목담당자의 확정배정 취소 경로다.
    canCancel: (status === 'DRAFT' || inReview) && !hasFirmAllocation,
  };
}

function normalizeLine(row: Record<string, unknown>): SalesOrderLine {
  return {
    lineId: String(value(row, ['line_id']) ?? ''),
    lineNo: numberValue(value(row, ['line_no'])),
    itemId: String(value(row, ['item_id', '품목코드']) ?? ''),
    itemName: nullableText(value(row, ['item_name', '품목명'])),
    requestedQty: numberValue(value(row, ['requested_qty', '요청수량'])),
    temporaryAllocatedQty: numberValue(value(row, ['temporary_allocated_qty', '임시배정수량'])),
    firmAllocatedQty: numberValue(value(row, ['firm_allocated_qty', '확정배정수량'])),
    approvalHoldQty: numberValue(value(row, ['approval_hold_qty', '승인대기확보수량'])),
    shortageQty: numberValue(value(row, ['shortage_qty', '부족수량'])),
  };
}

function normalizeEvent(row: Record<string, unknown>): SalesOrderEvent {
  const eventType = String(value(row, ['event_type']) ?? '');
  const payload = value(row, ['payload']);
  return {
    eventId: String(value(row, ['event_id']) ?? ''),
    eventType,
    eventTypeLabel: ORDER_EVENT_LABELS[eventType] ?? eventType,
    previousStatus: orderStatusOrNull(value(row, ['previous_status'])),
    nextStatus: orderStatusOrNull(value(row, ['next_status'])),
    actorName: String(value(row, ['actor_name']) ?? ''),
    reason: nullableText(value(row, ['reason'])),
    payload: isRecord(payload) ? payload : {},
    at: nullableText(value(row, ['at'])),
  };
}

export function normalizeSalesOrderRow(row: Record<string, unknown>): SalesOrder {
  const status = orderStatusOrNull(value(row, ['status', '상태']));
  const allocationChoice = allocationChoiceOrNull(value(row, ['allocation_choice', '배정방식']));
  return {
    orderId: String(value(row, ['order_id', '주문ID']) ?? ''),
    orderNo: String(value(row, ['order_no', '주문번호']) ?? ''),
    customerId: nullableText(value(row, ['customer_id', '고객코드'])),
    customerName: String(value(row, ['customer_name', '고객명']) ?? ''),
    ownerName: String(value(row, ['owner_name', '영업담당자']) ?? ''),
    status,
    statusLabel: status ? ORDER_STATUS_LABELS[status] : '알 수 없음',
    requestedAt: nullableText(value(row, ['requested_at', '등록일시'])),
    firstReviewRequestedAt: nullableText(value(row, ['first_review_requested_at', '최초검토요청일시'])),
    temporaryExpiresAt: nullableText(value(row, ['temporary_expires_at', '임시배정만료일시'])),
    allocationChoice,
    allocationChoiceLabel: allocationChoice ? ALLOCATION_CHOICE_LABELS[allocationChoice] : null,
    allocationPriority: numberValue(value(row, ['allocation_priority', '우선순위'])),
    confirmedOrderNo: nullableText(value(row, ['confirmed_order_no', '최종승인주문번호'])),
    confirmedAt: nullableText(value(row, ['confirmed_at'])),
    cancelledAt: nullableText(value(row, ['cancelled_at'])),
    cancelReason: nullableText(value(row, ['cancel_reason'])),
    expiredAt: nullableText(value(row, ['expired_at'])),
    replacesOrderId: nullableText(value(row, ['replaces_order_id'])),
    replacesOrderNo: nullableText(value(row, ['replaces_order_no'])),
    replacedByOrderId: nullableText(value(row, ['replaced_by_order_id'])),
    replacedByOrderNo: nullableText(value(row, ['replaced_by_order_no'])),
    note: nullableText(value(row, ['note', '비고'])),
    lineCount: numberValue(value(row, ['line_count'])),
    requestedQty: numberValue(value(row, ['requested_qty', '요청수량'])),
    temporaryAllocatedQty: numberValue(value(row, ['temporary_allocated_qty', '임시배정수량'])),
    firmAllocatedQty: numberValue(value(row, ['firm_allocated_qty', '확정배정수량'])),
    approvalHoldQty: numberValue(value(row, ['approval_hold_qty', '승인대기확보수량'])),
    shortageQty: numberValue(value(row, ['shortage_qty', '부족수량'])),
    lines: arrayValue(value(row, ['lines'])).map(normalizeLine),
    events: arrayValue(value(row, ['events'])).map(normalizeEvent),
  };
}

function normalizeActiveAllocation(row: Record<string, unknown>): ActiveAllocation {
  const status = allocationStatusOrNull(value(row, ['status']));
  return {
    allocationId: String(value(row, ['allocation_id']) ?? ''),
    status,
    statusLabel: status ? ALLOCATION_STATUS_LABELS[status] : '알 수 없음',
    qty: numberValue(value(row, ['qty'])),
    source: nullableText(value(row, ['source'])),
    approvalId: nullableText(value(row, ['approval_id'])),
    createdAt: nullableText(value(row, ['created_at'])),
    reason: nullableText(value(row, ['reason'])),
  };
}

export function normalizeAllocationQueueRow(row: Record<string, unknown>): AllocationQueueRow {
  const orderStatus = orderStatusOrNull(value(row, ['order_status', '주문상태']));
  const rawMode = value(row, ['allocation_mode', '배정방식설정']);
  return {
    itemId: String(value(row, ['item_id', '품목코드']) ?? ''),
    itemName: nullableText(value(row, ['item_name', '품목명'])),
    queueRank: numberValue(value(row, ['queue_rank', '대기순번'])),
    orderId: String(value(row, ['order_id', '주문ID']) ?? ''),
    orderNo: String(value(row, ['order_no', '주문번호']) ?? ''),
    orderStatus,
    orderStatusLabel: orderStatus ? ORDER_STATUS_LABELS[orderStatus] : '알 수 없음',
    customerName: String(value(row, ['customer_name', '고객명']) ?? ''),
    ownerName: String(value(row, ['owner_name', '영업담당자']) ?? ''),
    lineId: String(value(row, ['line_id']) ?? ''),
    requestedQty: numberValue(value(row, ['requested_qty', '요청수량'])),
    temporaryAllocatedQty: numberValue(value(row, ['temporary_allocated_qty', '임시배정수량'])),
    firmAllocatedQty: numberValue(value(row, ['firm_allocated_qty', '확정배정수량'])),
    approvalHoldQty: numberValue(value(row, ['approval_hold_qty', '승인대기확보수량'])),
    shortageQty: numberValue(value(row, ['shortage_qty', '부족수량'])),
    allocationChoice: allocationChoiceOrNull(value(row, ['allocation_choice', '배정방식'])),
    allocationPriority: numberValue(value(row, ['allocation_priority', '우선순위'])),
    firstReviewRequestedAt: nullableText(value(row, ['first_review_requested_at', '최초검토요청일시'])),
    temporaryExpiresAt: nullableText(value(row, ['temporary_expires_at', '임시배정만료일시'])),
    allocationMode: rawMode === 'AUTO' || rawMode === 'MANUAL' ? rawMode : null,
    itemAvailableQty: numberValue(value(row, ['item_available_qty', '가용재고'])),
    reasonCode: nullableText(value(row, ['reason_code', '사유코드'])),
    activeAllocations: arrayValue(value(row, ['active_allocations'])).map(normalizeActiveAllocation),
  };
}

/** core.list_manual_allocation_candidates가 돌려준 한 행 — 순번 · 시각 계산은 DB가 이미 끝냈다 */
export function normalizeManualAllocationCandidateRow(row: Record<string, unknown>): ManualAllocationCandidateRow {
  return {
    queueRank: numberValue(value(row, ['queue_rank'])),
    orderId: String(value(row, ['order_id']) ?? ''),
    orderNo: String(value(row, ['order_no']) ?? ''),
    lineId: String(value(row, ['line_id']) ?? ''),
    customerName: String(value(row, ['customer_name']) ?? ''),
    ownerName: String(value(row, ['owner_name']) ?? ''),
    allocationPriority: numberValue(value(row, ['allocation_priority'])),
    firstReviewRequestedAt: nullableText(value(row, ['first_review_requested_at'])),
    shortageQty: numberValue(value(row, ['shortage_qty'])),
  };
}

function formatQty(input: number): string {
  return input.toLocaleString('ko-KR');
}

/** core.request_order_review 가 돌려준 jsonb를 문구로 옮깁니다 */
export function describeReviewResult(result: unknown): string {
  const base = '검토 요청을 등록했습니다.';
  if (!isRecord(result)) return base;
  const status = orderStatusOrNull(result.status);
  const temporaryQty = numberValue(result.temporary_allocated_qty);
  const shortageQty = numberValue(result.shortage_qty);
  if (status === null || temporaryQty === null || shortageQty === null) return base;
  return `${base} 임시배정 ${formatQty(temporaryQty)} · 부족 ${formatQty(shortageQty)} (${ORDER_STATUS_LABELS[status]})`;
}

/** core.request_manual_allocation 이 돌려준 jsonb를 문구로 옮깁니다 */
export function describeManualAllocationResult(result: unknown): string {
  const status = isRecord(result) ? allocationStatusOrNull(result.allocation_status) : null;
  if (status === 'FIRM') return '정상 순서로 확정배정했습니다.';
  if (status === 'APPROVAL_HOLD') {
    return '대기 순서를 건너뛴 배정이라 SCM팀장 승인을 요청했습니다. 승인 전까지 승인대기 확보수량으로 차감됩니다.';
  }
  return '수동 배정을 처리했습니다.';
}

export type StatusTone = 'green' | 'amber' | 'red' | 'gray' | 'blue';

/** 상태 배지 색 — styles/components.css 의 .tag 변형 이름 */
export function orderStatusTone(status: OrderStatus | null): StatusTone {
  switch (status) {
    case 'CONFIRMED': return 'green';
    case 'REVIEW_REQUESTED': return 'blue';
    case 'PARTIALLY_ALLOCATED':
    case 'WAITING_FULL': return 'amber';
    case 'EXPIRED':
    case 'CANCELLED': return 'red';
    default: return 'gray';
  }
}

export function allocationStatusTone(status: AllocationStatus | null): StatusTone {
  switch (status) {
    case 'FIRM': return 'green';
    case 'TEMPORARY': return 'blue';
    case 'APPROVAL_HOLD': return 'amber';
    default: return 'gray';
  }
}

/** 한국 시간 일시. 값이 없거나 날짜가 아니면 null — 화면이 '—' 등으로 표시합니다 */
export function formatOrderDateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

const ALLOCATION_EVENT_KIND_LABELS: Record<string, string> = {
  MANUAL_FIRM: '수동 확정배정',
  APPROVAL_HOLD: '순서 건너뜀 승인대기 확보',
  PRIORITY_APPROVED: '우선 배정 승인 → 확정배정',
  PRIORITY_REJECTED: '우선 배정 반려 → 확보 해제',
  APPROVAL_CANCELLED: '우선 배정 요청 취소 → 확보 해제',
  ADDITIONAL_ALLOCATION: '후속 배정',
};

function qtyText(input: unknown): string {
  const parsed = numberValue(input);
  return parsed === null ? '미상' : formatQty(parsed);
}

function payloadText(input: unknown): string {
  return typeof input === 'string' && input.trim() !== '' ? input : typeof input === 'number' ? String(input) : '미상';
}

/** 주문 이력 한 줄. DB가 이력 payload에 저장한 값만 옮기며 계산하지 않습니다 */
export function describeOrderEvent(event: Pick<SalesOrderEvent, 'eventType' | 'payload'>): string {
  const payload = event.payload;
  switch (event.eventType) {
    case 'CREATED':
      return `품목 ${Array.isArray(payload.lines) ? payload.lines.length : 0}줄 등록`;
    case 'REVIEW_REQUESTED': {
      const choice = allocationChoiceOrNull(payload.allocation_choice);
      return `${choice ? ALLOCATION_CHOICE_LABELS[choice] : '미상'} 선택 · 임시배정 ${qtyText(payload.temporary_allocated_qty)} · 부족 ${qtyText(payload.shortage_qty)}`;
    }
    case 'CONFIRMED':
      return `최종 승인 주문번호 ${payloadText(payload.confirmed_order_no)} · 확정 전환 ${qtyText(payload.converted_to_firm_qty)} · 남은 부족 ${qtyText(payload.remaining_shortage_qty)}`;
    case 'ALLOCATION_CHANGED': {
      const kind = typeof payload.kind === 'string' ? payload.kind : '';
      return `${ALLOCATION_EVENT_KIND_LABELS[kind] ?? '배정 변경'} ${qtyText(payload.qty)}`;
    }
    case 'PRIORITY_CHANGED':
      return `우선순위 ${payloadText(payload.previous_priority)} → ${payloadText(payload.priority)}`;
    case 'CANCELLED':
      return payload.kind === 'ORDER_CANCELLED'
        ? `영업담당자 주문 취소 · 해제 수량 ${qtyText(payload.released_qty)}`
        : `확정배정 취소로 주문 취소 · 해제 수량 ${qtyText(payload.released_qty)}`;
    case 'EXPIRED':
      return '임시배정 만료';
    case 'COPIED':
      return `새 주문 ${payloadText(payload.new_order_no)}로 재등록`;
    default:
      return '';
  }
}
