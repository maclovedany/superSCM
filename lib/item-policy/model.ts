// 품목 정책 변경 요청 화면 모델 — Task 9a (stage1 §2 line 89-90 · §6 line 171-172 · §9)
//
// ★ 여기서 승인 여부를 판정하지 않는다. core.request_item_policy_change가 승인 요청을 만들고,
//   실제 운영값 반영은 core.decide_approval(ITEM_POLICY)이 여는 같은 트랜잭션 안에서 DB 트리거가
//   처리한다(승인함 /approvals가 그대로 재사용된다 — 이 도메인에 별도의 승인 액션을 두지 않는다).
// ★ MOQ 미설정은 계산에서 1로 적용하지만(그 판단은 analytics.v_item_policy가 한다) 테이블에는 절대
//   1을 써 넣지 않는다. 목표 DoS 미설정은 "승인 이력이 없다"는 뜻이며 임의값을 만들지 않는다.
// ★ target_dos_approved는 값의 존재 여부가 아니라 승인 이력의 존재 여부다 — 마이그레이션 전에
//   이미 채워져 있던 값이라도 승인 흐름을 거치지 않았으면 false다(Task 9b가 발주 확정을 막는다).

import { normalizeItemPolicy as normalizeMasterItemPolicy, type ItemPolicy as MasterItemPolicy } from '../master-model.ts';

export const ITEM_POLICY_ALLOCATION_MODES = ['AUTO', 'MANUAL'] as const;
export type ItemPolicyAllocationMode = (typeof ITEM_POLICY_ALLOCATION_MODES)[number];

export const ITEM_POLICY_REVISION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type ItemPolicyRevisionStatus = (typeof ITEM_POLICY_REVISION_STATUSES)[number];

/** analytics.v_item_policy 한 행. lib/master-model의 정의를 그대로 쓴다(같은 뷰, 같은 판정) */
export type ItemPolicy = MasterItemPolicy;

/** target_dos_approved가 없는(구형) 행은 false로 본다 — 승인 이력을 임의로 만들지 않는다 */
export function normalizeItemPolicy(row: Record<string, unknown>): ItemPolicy {
  const base = normalizeMasterItemPolicy(row);
  return { ...base, targetDosApproved: row.target_dos_approved === true };
}

export type ItemPolicyRevision = {
  revisionId: string;
  itemId: string;
  itemName: string | null;
  proposedTargetDosDays: number | null;
  proposedAllocationMode: ItemPolicyAllocationMode;
  proposedTargetStockQty: number | null;
  proposedUnitPrice: number | null;
  proposedMoq: number | null;
  proposedPackSize: number | null;
  proposedMinOrderAmount: number | null;
  previousTargetDosDays: number | null;
  previousAllocationMode: ItemPolicyAllocationMode | null;
  previousTargetStockQty: number | null;
  previousUnitPrice: number | null;
  previousMoq: number | null;
  previousPackSize: number | null;
  previousMinOrderAmount: number | null;
  reason: string;
  requestedBy: string;
  requesterName: string;
  requestedAt: string;
  approvalId: string | null;
  status: ItemPolicyRevisionStatus;
  decidedBy: string | null;
  deciderName: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
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

function isAllocationMode(input: unknown): input is ItemPolicyAllocationMode {
  return typeof input === 'string' && (ITEM_POLICY_ALLOCATION_MODES as readonly string[]).includes(input);
}

function isRevisionStatus(input: unknown): input is ItemPolicyRevisionStatus {
  return typeof input === 'string' && (ITEM_POLICY_REVISION_STATUSES as readonly string[]).includes(input);
}

export function normalizeItemPolicyRevisionRow(row: Record<string, unknown>): ItemPolicyRevision {
  const rawProposedMode = value(row, ['proposed_allocation_mode']);
  const rawPreviousMode = value(row, ['previous_allocation_mode']);
  const rawStatus = value(row, ['status']);
  return {
    revisionId: String(value(row, ['revision_id']) ?? ''),
    itemId: String(value(row, ['item_id']) ?? ''),
    itemName: nullableText(value(row, ['item_name'])),
    proposedTargetDosDays: numberValue(value(row, ['proposed_target_dos_days'])),
    proposedAllocationMode: isAllocationMode(rawProposedMode) ? rawProposedMode : 'AUTO',
    proposedTargetStockQty: numberValue(value(row, ['proposed_target_stock_qty'])),
    proposedUnitPrice: numberValue(value(row, ['proposed_unit_price'])),
    proposedMoq: numberValue(value(row, ['proposed_moq'])),
    proposedPackSize: numberValue(value(row, ['proposed_pack_size'])),
    proposedMinOrderAmount: numberValue(value(row, ['proposed_min_order_amount'])),
    previousTargetDosDays: numberValue(value(row, ['previous_target_dos_days'])),
    previousAllocationMode: isAllocationMode(rawPreviousMode) ? rawPreviousMode : null,
    previousTargetStockQty: numberValue(value(row, ['previous_target_stock_qty'])),
    previousUnitPrice: numberValue(value(row, ['previous_unit_price'])),
    previousMoq: numberValue(value(row, ['previous_moq'])),
    previousPackSize: numberValue(value(row, ['previous_pack_size'])),
    previousMinOrderAmount: numberValue(value(row, ['previous_min_order_amount'])),
    reason: String(value(row, ['reason']) ?? ''),
    requestedBy: String(value(row, ['requested_by']) ?? ''),
    requesterName: String(value(row, ['requester_name']) ?? ''),
    requestedAt: String(value(row, ['requested_at']) ?? ''),
    approvalId: nullableText(value(row, ['approval_id'])),
    status: isRevisionStatus(rawStatus) ? rawStatus : 'PENDING',
    decidedBy: nullableText(value(row, ['decided_by'])),
    deciderName: nullableText(value(row, ['decider_name'])),
    decidedAt: nullableText(value(row, ['decided_at'])),
    decisionComment: nullableText(value(row, ['decision_comment'])),
  };
}

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

type OptionalNumberResult = { ok: true; value: number | null } | { ok: false };

/** 빈 값이면 "변경하지 않음"(null). 숫자가 아니거나 음수면 실패 */
function parseOptionalNonNegative(input: unknown): OptionalNumberResult {
  const raw = trimmed(input);
  if (raw === '') return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(raw)) return { ok: false };
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false };
}

/** 빈 값이면 "변경하지 않음"(null). 숫자가 아니거나 0 이하면 실패 */
function parseOptionalPositive(input: unknown): OptionalNumberResult {
  const parsed = parseOptionalNonNegative(input);
  if (!parsed.ok) return parsed;
  if (parsed.value !== null && parsed.value <= 0) return { ok: false };
  return parsed;
}

export type ValidatedItemPolicyChangeRequest = {
  itemId: string;
  targetDosDays: number | null;
  allocationMode: ItemPolicyAllocationMode;
  targetStockQty: number | null;
  unitPrice: number | null;
  moq: number | null;
  packSize: number | null;
  minOrderAmount: number | null;
  reason: string;
};

export type ItemPolicyChangeReasonCode =
  | 'ITEM_ID_REQUIRED'
  | 'ALLOCATION_MODE_INVALID'
  | 'TARGET_DOS_DAYS_INVALID'
  | 'TARGET_STOCK_QTY_INVALID'
  | 'UNIT_PRICE_INVALID'
  | 'MOQ_INVALID'
  | 'PACK_SIZE_INVALID'
  | 'MIN_ORDER_AMOUNT_INVALID'
  | 'REASON_REQUIRED';

/**
 * 품목 정책 변경 요청 입력 검증 — 순수 함수.
 *
 * ★ 값을 비워두면 "그 항목은 변경하지 않는다"(null)다. core.request_item_policy_change가
 *   null을 그대로 제안값으로 저장하므로, DB의 previous_* 스냅샷과 비교해 실제로 바뀐 항목만
 *   승인 화면에서 알아볼 수 있다 — 여기서 기존값으로 채워 넣지 않는다(그 값은 서버만 안다).
 */
export function validateRequestItemPolicyChange(input: {
  itemId: unknown;
  targetDosDays: unknown;
  allocationMode: unknown;
  targetStockQty: unknown;
  unitPrice: unknown;
  moq: unknown;
  packSize: unknown;
  minOrderAmount: unknown;
  reason: unknown;
}): Result<ValidatedItemPolicyChangeRequest, ItemPolicyChangeReasonCode> {
  const itemId = trimmed(input.itemId);
  if (itemId === '') return fail('ITEM_ID_REQUIRED', '품목코드를 입력하세요.');

  if (!isAllocationMode(input.allocationMode)) {
    return fail('ALLOCATION_MODE_INVALID', '배정 방식은 자동 또는 수동이어야 합니다.');
  }

  const targetDosDays = parseOptionalPositive(input.targetDosDays);
  if (!targetDosDays.ok) return fail('TARGET_DOS_DAYS_INVALID', '목표 DoS 일수는 비워두거나 0보다 큰 숫자여야 합니다.');

  const targetStockQty = parseOptionalNonNegative(input.targetStockQty);
  if (!targetStockQty.ok) return fail('TARGET_STOCK_QTY_INVALID', '목표 재고는 비워두거나 0 이상의 숫자여야 합니다.');

  const unitPrice = parseOptionalNonNegative(input.unitPrice);
  if (!unitPrice.ok) return fail('UNIT_PRICE_INVALID', '단가는 비워두거나 0 이상의 숫자여야 합니다.');

  const moq = parseOptionalPositive(input.moq);
  if (!moq.ok) return fail('MOQ_INVALID', '최소주문수량은 비워두거나 0보다 큰 숫자여야 합니다.');

  const packSize = parseOptionalPositive(input.packSize);
  if (!packSize.ok) return fail('PACK_SIZE_INVALID', '포장단위는 비워두거나 0보다 큰 숫자여야 합니다.');

  const minOrderAmount = parseOptionalNonNegative(input.minOrderAmount);
  if (!minOrderAmount.ok) return fail('MIN_ORDER_AMOUNT_INVALID', '최소주문금액은 비워두거나 0 이상의 숫자여야 합니다.');

  const reason = trimmed(input.reason);
  if (reason === '') return fail('REASON_REQUIRED', '변경 사유를 입력하세요.');

  return {
    ok: true,
    value: {
      itemId,
      targetDosDays: targetDosDays.value,
      allocationMode: input.allocationMode,
      targetStockQty: targetStockQty.value,
      unitPrice: unitPrice.value,
      moq: moq.value,
      packSize: packSize.value,
      minOrderAmount: minOrderAmount.value,
      reason,
    },
  };
}

// ══ 변경안 취소 — 요청자 본인(fix round 1) ═══════════════════════

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ValidatedCancelItemPolicyChange = {
  revisionId: string;
  reason: string;
};

export type CancelItemPolicyChangeReasonCode = 'REVISION_ID_INVALID' | 'REASON_REQUIRED';

/**
 * 대기 중인 품목 정책 변경안 취소 입력 검증 — 순수 함수.
 *
 * ★ 소유권(요청자 본인인가) · 상태(PENDING인가)는 여기서 판정하지 않는다. DB 명령 함수
 *   (core.cancel_item_policy_change)가 다시 확인한다 — 화면은 형식만 걸러낸다.
 */
export function validateCancelItemPolicyChange(input: {
  revisionId: unknown;
  reason: unknown;
}): Result<ValidatedCancelItemPolicyChange, CancelItemPolicyChangeReasonCode> {
  const revisionId = trimmed(input.revisionId);
  if (!UUID_PATTERN.test(revisionId)) return fail('REVISION_ID_INVALID', '올바른 변경안 ID가 필요합니다.');

  const reason = trimmed(input.reason);
  if (reason === '') return fail('REASON_REQUIRED', '취소 사유를 입력하세요.');

  return { ok: true, value: { revisionId, reason } };
}
