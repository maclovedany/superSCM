import type { Permission } from '../permission.ts';

export const APPROVAL_TYPES = ['ITEM_POLICY', 'ALLOC_PRIORITY', 'EVENT_ORDER', 'PURCHASE_PLAN'] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];
export type ApprovalPermission = Extract<Permission, 'ITEM_POLICY_APPROVE' | 'ALLOC_PRIORITY_APPROVE' | 'EVENT_ORDER_APPROVE' | 'PLAN_APPROVE'>;
export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export const APPROVAL_DECISIONS = ['APPROVED', 'REJECTED'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
  ITEM_POLICY: '품목 정책',
  ALLOC_PRIORITY: '우선 배정',
  EVENT_ORDER: '이벤트 추가 수요',
  PURCHASE_PLAN: '최종 발주계획',
};

export const APPROVAL_PERMISSION_BY_TYPE: Record<ApprovalType, ApprovalPermission> = {
  ITEM_POLICY: 'ITEM_POLICY_APPROVE',
  ALLOC_PRIORITY: 'ALLOC_PRIORITY_APPROVE',
  EVENT_ORDER: 'EVENT_ORDER_APPROVE',
  PURCHASE_PLAN: 'PLAN_APPROVE',
};

export type ApprovalPayload = Record<string, unknown>;

export type ApprovalRow = Record<string, unknown> & {
  approvalId: string;
  approvalType: ApprovalType;
  approvalTypeLabel: string;
  targetType: string;
  targetId: string;
  payload: ApprovalPayload;
  status: ApprovalStatus;
  reasonCode: string | null;
  reasonText: string | null;
  requestedBy: string;
  requesterName: string;
  requestedAt: string;
  decidedBy: string | null;
  deciderName: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
};

export type ApprovalMutationResult = {
  approvalId: string | null;
  error: string | null;
};

export type ApprovalActionState = {
  error: string | null;
  success: string | null;
};

export type ValidatedApprovalDecision = {
  approvalId: string;
  decision: ApprovalDecision;
  decisionComment: string | null;
};

function value(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (row[key] !== undefined) return row[key];
  return undefined;
}

function nullableString(input: unknown): string | null {
  return input === null || input === undefined || input === '' ? null : String(input);
}

function objectValue(input: unknown): ApprovalPayload {
  return input !== null && typeof input === 'object' && !Array.isArray(input) ? input as ApprovalPayload : {};
}

export function isApprovalType(value: unknown): value is ApprovalType {
  return typeof value === 'string' && (APPROVAL_TYPES as readonly string[]).includes(value);
}

export function permissionForApprovalType(type: ApprovalType): ApprovalPermission {
  return APPROVAL_PERMISSION_BY_TYPE[type];
}

export function validateApprovalDecision(input: {
  approvalId: unknown;
  decision: unknown;
  decisionComment: unknown;
}):
  | { ok: true; value: ValidatedApprovalDecision }
  | {
      ok: false;
      reasonCode: 'APPROVAL_ID_INVALID' | 'APPROVAL_DECISION_INVALID' | 'REJECTION_COMMENT_REQUIRED';
      message: string;
    } {
  const approvalId = typeof input.approvalId === 'string' ? input.approvalId.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(approvalId)) {
    return { ok: false, reasonCode: 'APPROVAL_ID_INVALID', message: '올바른 승인 요청 ID가 필요합니다.' };
  }
  if (typeof input.decision !== 'string'
    || !(APPROVAL_DECISIONS as readonly string[]).includes(input.decision)) {
    return { ok: false, reasonCode: 'APPROVAL_DECISION_INVALID', message: '승인 또는 반려만 선택할 수 있습니다.' };
  }

  const decision = input.decision as ApprovalDecision;
  const decisionComment = typeof input.decisionComment === 'string'
    ? input.decisionComment.trim() || null
    : null;
  if (decision === 'REJECTED' && decisionComment === null) {
    return { ok: false, reasonCode: 'REJECTION_COMMENT_REQUIRED', message: '반려 의견을 입력하세요.' };
  }
  return { ok: true, value: { approvalId, decision, decisionComment } };
}

export function validateApprovalRequest(input: { approvalType: unknown; payload: unknown }):
  | { ok: true }
  | { ok: false; reasonCode: 'APPROVAL_TYPE_INVALID' | 'EVENT_CUSTOMER_REQUIRED' | 'EVENT_MODEL_REQUIRED' | 'EVENT_QUANTITY_REQUIRED' } {
  if (!isApprovalType(input.approvalType)) return { ok: false, reasonCode: 'APPROVAL_TYPE_INVALID' };
  if (input.approvalType !== 'EVENT_ORDER') return { ok: true };

  const payload = objectValue(input.payload);
  if (typeof payload.customer !== 'string' || payload.customer.trim() === '') return { ok: false, reasonCode: 'EVENT_CUSTOMER_REQUIRED' };
  if (typeof payload.model !== 'string' || payload.model.trim() === '') return { ok: false, reasonCode: 'EVENT_MODEL_REQUIRED' };
  if (typeof payload.quantity !== 'number' || !Number.isFinite(payload.quantity) || payload.quantity <= 0) {
    return { ok: false, reasonCode: 'EVENT_QUANTITY_REQUIRED' };
  }
  return { ok: true };
}

export function normalizeApprovalRow(row: Record<string, unknown>): ApprovalRow {
  const rawType = value(row, ['approval_type', '승인유형']);
  const approvalType = isApprovalType(rawType) ? rawType : 'ITEM_POLICY';
  const rawStatus = value(row, ['status', '상태']);
  const status = typeof rawStatus === 'string' && (APPROVAL_STATUSES as readonly string[]).includes(rawStatus)
    ? rawStatus as ApprovalStatus
    : 'PENDING';

  return {
    approvalId: String(value(row, ['approval_id', '승인ID']) ?? ''),
    approvalType,
    approvalTypeLabel: APPROVAL_TYPE_LABELS[approvalType],
    targetType: String(value(row, ['target_type', '대상유형']) ?? ''),
    targetId: String(value(row, ['target_id', '대상ID']) ?? ''),
    payload: objectValue(value(row, ['payload', '요청내용'])),
    status,
    reasonCode: nullableString(value(row, ['reason_code', '사유코드'])),
    reasonText: nullableString(value(row, ['reason_text', '요청사유'])),
    requestedBy: String(value(row, ['requested_by', '요청자']) ?? ''),
    requesterName: String(value(row, ['requester_name', '요청자명']) ?? ''),
    requestedAt: String(value(row, ['requested_at', '요청일시']) ?? ''),
    decidedBy: nullableString(value(row, ['decided_by', '처리자'])),
    deciderName: nullableString(value(row, ['decider_name', '처리자명'])),
    decidedAt: nullableString(value(row, ['decided_at', '처리일시'])),
    decisionComment: nullableString(value(row, ['decision_comment', '처리의견'])),
  };
}

export function formatApprovalPayload(payload: ApprovalPayload): string {
  const entries = Object.entries(payload);
  if (entries.length === 0) return '상세 내용 없음';
  return entries.map(([key, item]) => {
    if (item === null || item === undefined || item === '') return `${key}: 미입력`;
    if (Array.isArray(item)) return `${key}: ${item.map(String).join(', ')}`;
    if (typeof item === 'object') return `${key}: ${JSON.stringify(item)}`;
    return `${key}: ${String(item)}`;
  }).join(' · ');
}
