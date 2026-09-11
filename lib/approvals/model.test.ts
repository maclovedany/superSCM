import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPROVAL_TYPES,
  formatApprovalPayload,
  isApprovalType,
  normalizeApprovalRow,
  permissionForApprovalType,
  validateApprovalDecision,
  validateApprovalRequest,
} from './model.ts';

test('승인 타입은 네 업무 코드만 허용한다', () => {
  assert.deepEqual(APPROVAL_TYPES, ['ITEM_POLICY', 'ALLOC_PRIORITY', 'EVENT_ORDER', 'PURCHASE_PLAN']);
  for (const type of APPROVAL_TYPES) assert.equal(isApprovalType(type), true);
  assert.equal(isApprovalType('ITEM_SUBSTITUTE'), false);
  assert.equal(isApprovalType(''), false);
  assert.equal(isApprovalType(null), false);
});

test('승인 타입마다 결정에 필요한 업무 권한을 돌려준다', () => {
  assert.equal(permissionForApprovalType('ITEM_POLICY'), 'ITEM_POLICY_APPROVE');
  assert.equal(permissionForApprovalType('ALLOC_PRIORITY'), 'ALLOC_PRIORITY_APPROVE');
  assert.equal(permissionForApprovalType('EVENT_ORDER'), 'EVENT_ORDER_APPROVE');
  assert.equal(permissionForApprovalType('PURCHASE_PLAN'), 'PLAN_APPROVE');
});

test('이벤트 추가 수요는 고객, 기종, 양수 수량이 모두 있어야 요청할 수 있다', () => {
  assert.deepEqual(
    validateApprovalRequest({ approvalType: 'EVENT_ORDER', payload: { customer: '고객사 A', model: 'Apeos C7070', quantity: 12 } }),
    { ok: true },
  );
  assert.deepEqual(
    validateApprovalRequest({ approvalType: 'EVENT_ORDER', payload: { model: 'Apeos C7070', quantity: 12 } }),
    { ok: false, reasonCode: 'EVENT_CUSTOMER_REQUIRED' },
  );
  assert.deepEqual(
    validateApprovalRequest({ approvalType: 'EVENT_ORDER', payload: { customer: '고객사 A', quantity: 12 } }),
    { ok: false, reasonCode: 'EVENT_MODEL_REQUIRED' },
  );
  assert.deepEqual(
    validateApprovalRequest({ approvalType: 'EVENT_ORDER', payload: { customer: '고객사 A', model: 'Apeos C7070', quantity: 0 } }),
    { ok: false, reasonCode: 'EVENT_QUANTITY_REQUIRED' },
  );
});

test('이벤트 외 승인 요청은 빈 객체 payload도 허용한다', () => {
  assert.deepEqual(validateApprovalRequest({ approvalType: 'ITEM_POLICY', payload: {} }), { ok: true });
});

test('알 수 없는 승인 타입은 요청 단계에서 거절한다', () => {
  assert.deepEqual(
    validateApprovalRequest({ approvalType: 'UNKNOWN', payload: {} }),
    { ok: false, reasonCode: 'APPROVAL_TYPE_INVALID' },
  );
});

test('승인 결정 입력은 UUID와 허용된 결정값을 검증하고 의견을 정규화한다', () => {
  assert.deepEqual(
    validateApprovalDecision({
      approvalId: '11111111-1111-4111-8111-111111111111',
      decision: 'APPROVED',
      decisionComment: '  검토 완료  ',
    }),
    {
      ok: true,
      value: {
        approvalId: '11111111-1111-4111-8111-111111111111',
        decision: 'APPROVED',
        decisionComment: '검토 완료',
      },
    },
  );
  assert.deepEqual(
    validateApprovalDecision({
      approvalId: '11111111-1111-4111-8111-111111111111',
      decision: 'APPROVED',
      decisionComment: '   ',
    }),
    {
      ok: true,
      value: {
        approvalId: '11111111-1111-4111-8111-111111111111',
        decision: 'APPROVED',
        decisionComment: null,
      },
    },
  );
});

test('승인 결정 입력은 알 수 없는 결정값과 UUID가 아닌 ID를 거절한다', () => {
  assert.deepEqual(
    validateApprovalDecision({ approvalId: 'approval-1', decision: 'APPROVED', decisionComment: '' }),
    { ok: false, reasonCode: 'APPROVAL_ID_INVALID', message: '올바른 승인 요청 ID가 필요합니다.' },
  );
  assert.deepEqual(
    validateApprovalDecision({
      approvalId: '11111111-1111-4111-8111-111111111111',
      decision: 'CANCELLED',
      decisionComment: '',
    }),
    { ok: false, reasonCode: 'APPROVAL_DECISION_INVALID', message: '승인 또는 반려만 선택할 수 있습니다.' },
  );
});

test('반려 결정에는 공백이 아닌 의견이 반드시 있어야 한다', () => {
  assert.deepEqual(
    validateApprovalDecision({
      approvalId: '11111111-1111-4111-8111-111111111111',
      decision: 'REJECTED',
      decisionComment: '   ',
    }),
    { ok: false, reasonCode: 'REJECTION_COMMENT_REQUIRED', message: '반려 의견을 입력하세요.' },
  );
});

test('analytics 승인함 행을 화면 모델로 옮기며 미결정 값은 null로 유지한다', () => {
  const row = normalizeApprovalRow({
    approval_id: 'approval-1',
    approval_type: 'PURCHASE_PLAN',
    target_type: 'purchase_plan',
    target_id: 'PLAN-2026-09',
    payload: { plan_month: '2026-09' },
    status: 'PENDING',
    reason_code: null,
    reason_text: '9월 계획 승인 요청',
    requested_by: 'user-1',
    requester_name: '김담당',
    requested_at: '2026-09-11T03:00:00Z',
    decided_by: null,
    decider_name: null,
    decided_at: null,
    decision_comment: null,
  });

  assert.deepEqual(row, {
    approvalId: 'approval-1',
    approvalType: 'PURCHASE_PLAN',
    approvalTypeLabel: '최종 발주계획',
    targetType: 'purchase_plan',
    targetId: 'PLAN-2026-09',
    payload: { plan_month: '2026-09' },
    status: 'PENDING',
    reasonCode: null,
    reasonText: '9월 계획 승인 요청',
    requestedBy: 'user-1',
    requesterName: '김담당',
    requestedAt: '2026-09-11T03:00:00Z',
    decidedBy: null,
    deciderName: null,
    decidedAt: null,
    decisionComment: null,
  });
});

test('한국어 컬럼 별칭과 잘못된 payload를 안전한 기본값으로 읽는다', () => {
  const row = normalizeApprovalRow({
    승인ID: 27,
    승인유형: 'ITEM_SUBSTITUTE',
    대상유형: 'item_policy',
    대상ID: 'ITEM001',
    요청내용: '잘못된 JSON',
    상태: 'BROKEN',
    요청자: 'user-2',
    요청일시: '2026-09-11',
  });

  assert.equal(row.approvalId, '27');
  assert.equal(row.approvalType, 'ITEM_POLICY');
  assert.equal(row.approvalTypeLabel, '품목 정책');
  assert.equal(row.status, 'PENDING');
  assert.deepEqual(row.payload, {});
  assert.equal(row.decidedAt, null);
});

test('승인 payload는 화면에서 확인할 수 있는 항목 목록으로 표시한다', () => {
  assert.equal(formatApprovalPayload({ customer: '고객사 A', model: 'Apeos C7070', quantity: 12 }), 'customer: 고객사 A · model: Apeos C7070 · quantity: 12');
  assert.equal(formatApprovalPayload({}), '상세 내용 없음');
  assert.equal(formatApprovalPayload({ memo: null, flags: ['긴급', '월말'] }), 'memo: 미입력 · flags: 긴급, 월말');
});
