import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ALLOCATION_CHOICES,
  ALLOCATION_PRIORITY_DEFAULT,
  ALLOCATION_PRIORITY_MAX,
  ALLOCATION_PRIORITY_MIN,
  ALLOCATION_STATUSES,
  ORDER_STATUSES,
  allocationStatusTone,
  describeManualAllocationResult,
  describeOrderEvent,
  describeReviewResult,
  formatOrderDateTime,
  normalizeAllocationQueueRow,
  normalizeItemId,
  normalizeSalesOrderRow,
  orderActionsFor,
  orderStatusTone,
  validateCancelOrder,
  validateConfirmOrder,
  validateCopyOrder,
  validateCreateOrder,
  validateFirmCancel,
  validateManualAllocation,
  validatePriorityChange,
  validateReviewRequest,
} from './model.ts';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const ALLOCATION_ID = '22222222-2222-4222-8222-222222222222';

function migrationSql(): string {
  return readFileSync(
    new URL('../../supabase/migrations/20260911000600_stage1_sales_order_allocation.sql', import.meta.url),
    'utf8',
  );
}

function functionDefinition(sql: string, name: string): string {
  const match = sql.match(new RegExp(`create or replace function core\\.${name}\\s*\\([\\s\\S]*?\\n\\$\\$;`, 'i'));
  assert.ok(match, `core.${name} 함수 정의가 있어야 합니다.`);
  return match[0];
}

function viewDefinition(sql: string, name: string): string {
  const match = sql.match(new RegExp(`create or replace view ${name.replace('.', '\\.')}[\\s\\S]*?;\\n`, 'i'));
  assert.ok(match, `${name} 뷰 정의가 있어야 합니다.`);
  return match[0];
}

// ══ 순수 모델 ══════════════════════════════════════════════════

test('주문 상태 · 배정 방식 · 배정 상태는 브리프의 업무 코드만 쓴다', () => {
  assert.deepEqual(ORDER_STATUSES, [
    'DRAFT', 'REVIEW_REQUESTED', 'PARTIALLY_ALLOCATED', 'WAITING_FULL', 'CONFIRMED', 'EXPIRED', 'CANCELLED',
  ]);
  assert.deepEqual(ALLOCATION_CHOICES, ['PARTIAL', 'WAIT_FULL']);
  assert.deepEqual(ALLOCATION_STATUSES, ['TEMPORARY', 'APPROVAL_HOLD', 'FIRM', 'RELEASED']);
  assert.equal(ALLOCATION_PRIORITY_MIN, 1);
  assert.equal(ALLOCATION_PRIORITY_MAX, 9);
  assert.equal(ALLOCATION_PRIORITY_DEFAULT, 5);
});

test('품목코드는 DB의 core.v_item_master와 같은 규칙으로 정규화한다', () => {
  assert.equal(normalizeItemId(' item-00_1 '), 'ITEM001');
  assert.equal(normalizeItemId('ab c'), 'ABC');
  assert.equal(normalizeItemId(null), '');
});

test('주문 등록은 고객명과 한 줄 이상의 품목·양수 수량을 요구하고 빈 줄은 무시한다', () => {
  assert.deepEqual(
    validateCreateOrder({
      customerId: '  C-01 ',
      customerName: '  고객사 A ',
      note: '   ',
      itemIds: ['item-001', '', 'ITEM002'],
      quantities: ['60', '', '5.5'],
    }),
    {
      ok: true,
      value: {
        customerId: 'C-01',
        customerName: '고객사 A',
        note: null,
        lines: [
          { itemId: 'ITEM001', qty: 60 },
          { itemId: 'ITEM002', qty: 5.5 },
        ],
      },
    },
  );
});

test('주문 등록 입력 오류는 사유 코드로 거절한다', () => {
  const base = { customerId: '', customerName: '고객사 A', note: '', itemIds: ['ITEM001'], quantities: ['1'] };
  assert.equal(validateCreateOrder({ ...base, customerName: '  ' }).ok, false);
  assert.deepEqual(
    validateCreateOrder({ ...base, customerName: '  ' }),
    { ok: false, reasonCode: 'CUSTOMER_NAME_REQUIRED', message: '고객명을 입력하세요.' },
  );
  assert.deepEqual(
    validateCreateOrder({ ...base, itemIds: [''], quantities: [''] }),
    { ok: false, reasonCode: 'ORDER_LINE_REQUIRED', message: '주문 품목을 한 줄 이상 입력하세요.' },
  );
  assert.deepEqual(
    validateCreateOrder({ ...base, itemIds: [''], quantities: ['3'] }),
    { ok: false, reasonCode: 'ORDER_ITEM_REQUIRED', message: '수량을 입력한 줄에는 품목을 선택하세요.' },
  );
  for (const bad of ['0', '-1', 'abc', '']) {
    assert.deepEqual(
      validateCreateOrder({ ...base, quantities: [bad] }),
      { ok: false, reasonCode: 'ORDER_QTY_INVALID', message: '주문 수량은 0보다 큰 숫자여야 합니다.' },
      `수량 ${JSON.stringify(bad)}가 통과했습니다.`,
    );
  }
  assert.deepEqual(
    validateCreateOrder({ ...base, itemIds: ['item-001', 'ITEM001'], quantities: ['1', '2'] }),
    { ok: false, reasonCode: 'ORDER_ITEM_DUPLICATED', message: '같은 품목은 한 줄로 합쳐 입력하세요.' },
  );
});

test('검토 요청은 주문 ID와 PARTIAL 또는 WAIT_FULL 선택을 반드시 요구한다', () => {
  assert.deepEqual(validateReviewRequest({ orderId: ORDER_ID, choice: 'PARTIAL' }), {
    ok: true,
    value: { orderId: ORDER_ID, choice: 'PARTIAL' },
  });
  assert.deepEqual(validateReviewRequest({ orderId: ORDER_ID, choice: null }), {
    ok: false,
    reasonCode: 'ALLOCATION_CHOICE_REQUIRED',
    message: '재고가 부족할 때의 배정 방식(부분 임시배정 또는 전체 배정 대기)을 선택하세요.',
  });
  assert.deepEqual(validateReviewRequest({ orderId: 'order-1', choice: 'PARTIAL' }), {
    ok: false,
    reasonCode: 'ORDER_ID_INVALID',
    message: '올바른 주문 ID가 필요합니다.',
  });
});

test('수주 확정은 최종 승인 주문번호가 필수이며 앞뒤 공백을 지운다', () => {
  assert.deepEqual(validateConfirmOrder({ orderId: ORDER_ID, confirmedOrderNo: '  ERP-2026-001 ' }), {
    ok: true,
    value: { orderId: ORDER_ID, confirmedOrderNo: 'ERP-2026-001' },
  });
  assert.deepEqual(validateConfirmOrder({ orderId: ORDER_ID, confirmedOrderNo: '   ' }), {
    ok: false,
    reasonCode: 'CONFIRMED_ORDER_NO_REQUIRED',
    message: '최종 승인된 주문번호를 입력하세요.',
  });
});

test('우선순위 변경은 1~9 정수와 변경 사유를 요구한다', () => {
  assert.deepEqual(validatePriorityChange({ orderId: ORDER_ID, priority: '2', reason: ' 전략 고객 ' }), {
    ok: true,
    value: { orderId: ORDER_ID, priority: 2, reason: '전략 고객' },
  });
  for (const bad of ['0', '10', '2.5', 'high', '']) {
    assert.equal(
      validatePriorityChange({ orderId: ORDER_ID, priority: bad, reason: '사유' }).ok,
      false,
      `우선순위 ${JSON.stringify(bad)}가 통과했습니다.`,
    );
  }
  assert.deepEqual(validatePriorityChange({ orderId: ORDER_ID, priority: '3', reason: ' ' }), {
    ok: false,
    reasonCode: 'PRIORITY_REASON_REQUIRED',
    message: '우선순위 변경 사유를 입력하세요.',
  });
});

test('수동 배정은 양수 수량을 요구하고 사유는 선택이지만 정규화한다', () => {
  assert.deepEqual(
    validateManualAllocation({ orderId: ORDER_ID, itemId: 'item-001', qty: '20', reason: '  ' }),
    { ok: true, value: { orderId: ORDER_ID, itemId: 'ITEM001', qty: 20, reason: null } },
  );
  assert.deepEqual(
    validateManualAllocation({ orderId: ORDER_ID, itemId: 'ITEM001', qty: '0', reason: '' }),
    { ok: false, reasonCode: 'MANUAL_QTY_INVALID', message: '배정 수량은 0보다 큰 숫자여야 합니다.' },
  );
  assert.deepEqual(
    validateManualAllocation({ orderId: ORDER_ID, itemId: ' ', qty: '1', reason: '' }),
    { ok: false, reasonCode: 'ORDER_ITEM_REQUIRED', message: '배정할 품목이 필요합니다.' },
  );
});

test('확정배정 취소는 배정 ID와 처리 사유가 필수다', () => {
  assert.deepEqual(validateFirmCancel({ allocationId: ALLOCATION_ID, reason: ' 고객 취소 ' }), {
    ok: true,
    value: { allocationId: ALLOCATION_ID, reason: '고객 취소' },
  });
  assert.deepEqual(validateFirmCancel({ allocationId: ALLOCATION_ID, reason: '' }), {
    ok: false,
    reasonCode: 'CANCEL_REASON_REQUIRED',
    message: '확정배정 취소 사유를 입력하세요.',
  });
  assert.deepEqual(validateFirmCancel({ allocationId: 'x', reason: '사유' }), {
    ok: false,
    reasonCode: 'ALLOCATION_ID_INVALID',
    message: '올바른 배정 ID가 필요합니다.',
  });
  assert.deepEqual(validateCopyOrder({ orderId: ORDER_ID }), { ok: true, value: { orderId: ORDER_ID } });
});

test('영업담당자 주문 취소는 주문 ID와 취소 사유가 필수다', () => {
  assert.deepEqual(validateCancelOrder({ orderId: ORDER_ID, reason: ' 고객 요청 철회 ' }), {
    ok: true,
    value: { orderId: ORDER_ID, reason: '고객 요청 철회' },
  });
  assert.deepEqual(validateCancelOrder({ orderId: ORDER_ID, reason: '  ' }), {
    ok: false,
    reasonCode: 'CANCEL_REASON_REQUIRED',
    message: '주문 취소 사유를 입력하세요.',
  });
  assert.deepEqual(validateCancelOrder({ orderId: 'order-1', reason: '사유' }), {
    ok: false,
    reasonCode: 'ORDER_ID_INVALID',
    message: '올바른 주문 ID가 필요합니다.',
  });
});

test('주문 화면 동작은 상태로만 결정한다 — 재등록된 주문은 다시 복사할 수 없다', () => {
  assert.deepEqual(orderActionsFor({ status: 'DRAFT', replacedByOrderId: null, firmAllocatedQty: 0 }), {
    canRequestReview: true, canConfirm: false, canCopy: false, canCancel: true,
  });
  for (const status of ['REVIEW_REQUESTED', 'PARTIALLY_ALLOCATED', 'WAITING_FULL'] as const) {
    assert.deepEqual(orderActionsFor({ status, replacedByOrderId: null, firmAllocatedQty: 0 }), {
      canRequestReview: false, canConfirm: true, canCopy: false, canCancel: true,
    });
  }
  // 확정배정이 있으면 주문 취소가 아니라 확정배정 취소(SCM 품목담당자) 경로다.
  assert.equal(orderActionsFor({ status: 'PARTIALLY_ALLOCATED', replacedByOrderId: null, firmAllocatedQty: 20 }).canCancel, false);
  assert.deepEqual(orderActionsFor({ status: 'CONFIRMED', replacedByOrderId: null, firmAllocatedQty: 50 }), {
    canRequestReview: false, canConfirm: false, canCopy: false, canCancel: false,
  });
  assert.deepEqual(orderActionsFor({ status: 'CANCELLED', replacedByOrderId: null, firmAllocatedQty: 0 }).canCopy, true);
  assert.deepEqual(orderActionsFor({ status: 'CANCELLED', replacedByOrderId: null, firmAllocatedQty: 0 }).canCancel, false);
  assert.deepEqual(orderActionsFor({ status: 'EXPIRED', replacedByOrderId: null, firmAllocatedQty: 0 }).canCopy, true);
  assert.deepEqual(orderActionsFor({ status: 'EXPIRED', replacedByOrderId: ORDER_ID, firmAllocatedQty: 0 }).canCopy, false);
  assert.deepEqual(orderActionsFor({ status: null, replacedByOrderId: null, firmAllocatedQty: null }), {
    canRequestReview: false, canConfirm: false, canCopy: false, canCancel: false,
  });
});

test('analytics.v_my_sales_order 행을 옮기며 수량 문자열을 숫자로, 미정 값은 null로 유지한다', () => {
  const order = normalizeSalesOrderRow({
    order_id: ORDER_ID,
    order_no: 'SO-20260912-000001',
    customer_id: null,
    customer_name: '고객사 A',
    owner_name: '김영업',
    status: 'PARTIALLY_ALLOCATED',
    requested_at: '2026-09-12T00:00:00Z',
    first_review_requested_at: '2026-09-12T01:00:00Z',
    temporary_expires_at: '2026-10-12T01:00:00Z',
    allocation_choice: 'PARTIAL',
    allocation_priority: 5,
    confirmed_order_no: null,
    replaces_order_id: null,
    replaced_by_order_id: null,
    line_count: 1,
    requested_qty: '60',
    temporary_allocated_qty: '40',
    firm_allocated_qty: '0',
    approval_hold_qty: '0',
    shortage_qty: '20',
    lines: [
      {
        line_id: 7, line_no: 1, item_id: 'ITEM001', item_name: '토너',
        requested_qty: 60, temporary_allocated_qty: 40, firm_allocated_qty: 0, approval_hold_qty: 0, shortage_qty: 20,
      },
    ],
    events: [
      {
        event_id: 3, event_type: 'REVIEW_REQUESTED', previous_status: 'DRAFT', next_status: 'PARTIALLY_ALLOCATED',
        actor_name: '김영업', reason: null, payload: { allocation_choice: 'PARTIAL' }, at: '2026-09-12T01:00:00Z',
      },
    ],
  });

  assert.equal(order.orderId, ORDER_ID);
  assert.equal(order.status, 'PARTIALLY_ALLOCATED');
  assert.equal(order.statusLabel, '부분 임시배정');
  assert.equal(order.allocationChoiceLabel, '부분 임시배정');
  assert.equal(order.customerId, null);
  assert.equal(order.confirmedOrderNo, null);
  assert.equal(order.requestedQty, 60);
  assert.equal(order.temporaryAllocatedQty, 40);
  assert.equal(order.shortageQty, 20);
  assert.deepEqual(order.lines, [
    {
      lineId: '7', lineNo: 1, itemId: 'ITEM001', itemName: '토너',
      requestedQty: 60, temporaryAllocatedQty: 40, firmAllocatedQty: 0, approvalHoldQty: 0, shortageQty: 20,
    },
  ]);
  assert.equal(order.events.length, 1);
  assert.equal(order.events[0].eventTypeLabel, '검토 요청');
  assert.equal(order.events[0].nextStatus, 'PARTIALLY_ALLOCATED');
  assert.deepEqual(order.events[0].payload, { allocation_choice: 'PARTIAL' });
});

test('알 수 없는 상태나 누락된 수량을 임의 값으로 채우지 않는다', () => {
  const order = normalizeSalesOrderRow({ order_id: ORDER_ID, status: 'BROKEN', lines: 'not-json', shortage_qty: null });
  assert.equal(order.status, null);
  assert.equal(order.statusLabel, '알 수 없음');
  assert.equal(order.shortageQty, null);
  assert.equal(order.requestedQty, null);
  assert.deepEqual(order.lines, []);
  assert.deepEqual(order.events, []);
});

test('analytics.v_allocation_queue 행은 대기 순번과 활성 배정을 옮기고 미분류 재고는 null과 사유 코드를 유지한다', () => {
  const row = normalizeAllocationQueueRow({
    item_id: 'ITEM001',
    item_name: '토너',
    queue_rank: '2',
    order_id: ORDER_ID,
    order_no: 'SO-20260912-000001',
    order_status: 'CONFIRMED',
    customer_name: '고객사 A',
    owner_name: '김영업',
    line_id: 7,
    requested_qty: 60,
    temporary_allocated_qty: 0,
    firm_allocated_qty: 40,
    approval_hold_qty: 0,
    shortage_qty: 20,
    allocation_choice: 'PARTIAL',
    allocation_priority: 3,
    first_review_requested_at: '2026-09-12T01:00:00Z',
    temporary_expires_at: '2026-10-12T01:00:00Z',
    allocation_mode: 'MANUAL',
    item_available_qty: null,
    reason_code: 'INVENTORY_SCOPE_UNCLASSIFIED',
    active_allocations: [
      { allocation_id: ALLOCATION_ID, status: 'FIRM', qty: '40', source: 'REVIEW_REQUEST', approval_id: null, created_at: '2026-09-12T01:00:00Z', reason: null },
    ],
  });

  assert.equal(row.queueRank, 2);
  assert.equal(row.orderStatusLabel, '수주 확정');
  assert.equal(row.allocationMode, 'MANUAL');
  assert.equal(row.allocationPriority, 3);
  assert.equal(row.itemAvailableQty, null);
  assert.equal(row.reasonCode, 'INVENTORY_SCOPE_UNCLASSIFIED');
  assert.deepEqual(row.activeAllocations, [
    {
      allocationId: ALLOCATION_ID, status: 'FIRM', statusLabel: '확정배정', qty: 40,
      source: 'REVIEW_REQUEST', approvalId: null, createdAt: '2026-09-12T01:00:00Z', reason: null,
    },
  ]);

  const unranked = normalizeAllocationQueueRow({ order_id: ORDER_ID, queue_rank: null, allocation_mode: null, active_allocations: null });
  assert.equal(unranked.queueRank, null);
  assert.equal(unranked.allocationMode, null);
  assert.deepEqual(unranked.activeAllocations, []);
});

test('DB 명령 결과를 화면 문구로 옮긴다 — 계산하지 않고 DB가 돌려준 수량만 쓴다', () => {
  assert.equal(
    describeReviewResult({ status: 'PARTIALLY_ALLOCATED', temporary_allocated_qty: 40, shortage_qty: 20 }),
    '검토 요청을 등록했습니다. 임시배정 40 · 부족 20 (부분 임시배정)',
  );
  assert.equal(
    describeReviewResult({ status: 'WAITING_FULL', temporary_allocated_qty: '0', shortage_qty: '60' }),
    '검토 요청을 등록했습니다. 임시배정 0 · 부족 60 (전체 배정 대기)',
  );
  assert.equal(describeReviewResult(null), '검토 요청을 등록했습니다.');
  assert.equal(
    describeManualAllocationResult({ allocation_status: 'FIRM' }),
    '정상 순서로 확정배정했습니다.',
  );
  assert.equal(
    describeManualAllocationResult({ allocation_status: 'APPROVAL_HOLD' }),
    '대기 순서를 건너뛴 배정이라 SCM팀장 승인을 요청했습니다. 승인 전까지 승인대기 확보수량으로 차감됩니다.',
  );
});

test('주문 이력 문장은 DB 이력 payload에 저장된 값만 옮기고 없는 값은 미상으로 둔다', () => {
  assert.equal(
    describeOrderEvent({ eventType: 'REVIEW_REQUESTED', payload: { allocation_choice: 'PARTIAL', temporary_allocated_qty: 40, shortage_qty: 20 } }),
    '부분 임시배정 선택 · 임시배정 40 · 부족 20',
  );
  assert.equal(
    describeOrderEvent({ eventType: 'CONFIRMED', payload: { confirmed_order_no: 'ERP-001', converted_to_firm_qty: 50, remaining_shortage_qty: 0 } }),
    '최종 승인 주문번호 ERP-001 · 확정 전환 50 · 남은 부족 0',
  );
  assert.equal(describeOrderEvent({ eventType: 'ALLOCATION_CHANGED', payload: { kind: 'PRIORITY_REJECTED', qty: 10 } }), '우선 배정 반려 → 확보 해제 10');
  assert.equal(describeOrderEvent({ eventType: 'ALLOCATION_CHANGED', payload: { kind: 'APPROVAL_HOLD', qty: '30' } }), '순서 건너뜀 승인대기 확보 30');
  assert.equal(describeOrderEvent({ eventType: 'PRIORITY_CHANGED', payload: { previous_priority: 5, priority: 1 } }), '우선순위 5 → 1');
  assert.equal(describeOrderEvent({ eventType: 'CANCELLED', payload: { released_qty: '65' } }), '확정배정 취소로 주문 취소 · 해제 수량 65');
  assert.equal(describeOrderEvent({ eventType: 'CANCELLED', payload: { kind: 'ORDER_CANCELLED', released_qty: 60 } }), '영업담당자 주문 취소 · 해제 수량 60');
  assert.equal(describeOrderEvent({ eventType: 'COPIED', payload: { new_order_no: 'SO-2' } }), '새 주문 SO-2로 재등록');
  assert.equal(describeOrderEvent({ eventType: 'REVIEW_REQUESTED', payload: {} }), '미상 선택 · 임시배정 미상 · 부족 미상');
});

test('상태 배지 색과 일시 표시는 알 수 없는 값을 회색 · null로 둔다', () => {
  assert.equal(orderStatusTone('CONFIRMED'), 'green');
  assert.equal(orderStatusTone('PARTIALLY_ALLOCATED'), 'amber');
  assert.equal(orderStatusTone('CANCELLED'), 'red');
  assert.equal(orderStatusTone(null), 'gray');
  assert.equal(allocationStatusTone('APPROVAL_HOLD'), 'amber');
  assert.equal(allocationStatusTone('FIRM'), 'green');
  assert.equal(allocationStatusTone(null), 'gray');
  assert.equal(formatOrderDateTime(null), null);
  assert.equal(formatOrderDateTime('not-a-date'), null);
  assert.match(formatOrderDateTime('2026-09-12T01:00:00Z') ?? '', /2026/);
});

// ══ SQL 계약 ═══════════════════════════════════════════════════
//
// 행위 검증은 임시 PostgreSQL에서 실제로 실행해 확인했다(Task 5 보고서). 여기서는 다음 사람이
// 마이그레이션을 고치다가 동시성·이력·권한 경계를 조용히 지우지 않도록 핵심 문장만 고정한다.

test('주문·배정 SQL은 브리프의 테이블과 상태 코드를 재실행 안전하게 만든다', () => {
  const sql = migrationSql();
  for (const table of [
    'sales_order', 'sales_order_line', 'stock_allocation', 'allocation_priority',
    'urgent_order', 'sales_order_event', 'stock_allocation_event',
  ]) {
    assert.match(sql, new RegExp(`create table if not exists core\\.${table} \\(`, 'i'), `core.${table}`);
  }
  assert.match(sql, /'DRAFT', 'REVIEW_REQUESTED', 'PARTIALLY_ALLOCATED', 'WAITING_FULL',\s*'CONFIRMED', 'EXPIRED', 'CANCELLED'/);
  assert.match(sql, /'TEMPORARY', 'APPROVAL_HOLD', 'FIRM', 'RELEASED'/);
  assert.match(sql, /allocation_choice in \('PARTIAL', 'WAIT_FULL'\)/);
  assert.match(sql, /allocation_priority\s+integer not null default 5 check \(allocation_priority between 1 and 9\)/);
  assert.match(sql, /replaces_order_id\s+uuid references core\.sales_order\(order_id\)/);
  assert.doesNotMatch(sql, /^\s*create table core\./im, '재실행 안전하지 않은 create table');
  for (const match of sql.matchAll(/^create trigger (\w+)\s+[\s\S]*? on (core\.\w+)/gim)) {
    assert.match(sql, new RegExp(`drop trigger if exists ${match[1]} on ${match[2].replace('.', '\\.')};`, 'i'), `트리거 ${match[1]}`);
  }
  for (const match of sql.matchAll(/^create policy (\w+) on (core\.\w+)/gim)) {
    assert.match(sql, new RegExp(`drop policy if exists ${match[1]} on ${match[2].replace('.', '\\.')};`, 'i'), `정책 ${match[1]}`);
  }
});

test('모든 공개 명령 함수는 스스로 로그인·업무 권한을 검사한다', () => {
  const sql = migrationSql();
  const commands: Array<[string, string]> = [
    ['create_sales_order', 'ORDER_CREATE'],
    ['request_order_review', 'ORDER_REVIEW_REQUEST'],
    ['confirm_sales_order', 'ORDER_CREATE'],
    ['change_allocation_priority', 'ALLOC_PRIORITY_EDIT'],
    ['request_manual_allocation', 'ALLOC_MANUAL'],
    ['cancel_firm_allocation', 'ALLOC_FIRM_CANCEL'],
    ['copy_cancelled_order', 'ORDER_CREATE'],
    ['cancel_sales_order', 'ORDER_CREATE'],
  ];
  for (const [name, permission] of commands) {
    const body = functionDefinition(sql, name);
    assert.match(body, /security definer/i, `${name}는 security definer여야 합니다.`);
    assert.match(body, /auth\.uid\(\)/i, `${name}는 호출자를 확인해야 합니다.`);
    assert.match(body, /core\.is_active_user\(v_actor\)/i, `${name}는 비활성 계정을 거절해야 합니다.`);
    assert.match(body, new RegExp(`core\\.has_permission\\('${permission}', v_actor\\)`), `${name}는 ${permission}을 검사해야 합니다.`);
    assert.match(sql, new RegExp(`grant execute on function core\\.${name}\\([^)]*\\) to authenticated`, 'i'));
  }
});

test('배정을 바꾸는 모든 경로는 core.stock_balance 품목 행을 먼저 FOR UPDATE로 잠근다', () => {
  const sql = migrationSql();
  const lockHelper = functionDefinition(sql, 'lock_stock_balance_items');
  assert.match(lockHelper, /from core\.stock_balance[\s\S]{0,80}for update/i);
  assert.match(lockHelper, /order by 1/i, '교착을 막기 위해 품목코드 순서로 잠가야 합니다.');

  for (const name of [
    'request_order_review', 'confirm_sales_order', 'request_manual_allocation',
    'cancel_firm_allocation', 'change_allocation_priority', 'allocate_to_order_line', 'cancel_sales_order',
  ]) {
    const body = functionDefinition(sql, name);
    const lockAt = body.search(/core\.lock_stock_balance_items\(/i);
    const orderLockAt = body.search(/from core\.sales_order\s+where order_id = [^;]*for update/i);
    assert.ok(lockAt > 0, `${name}는 재고 행을 잠가야 합니다.`);
    assert.ok(orderLockAt > lockAt, `${name}는 재고 행 → 주문 행 순서로 잠가야 합니다.`);
  }

  for (const name of ['create_stock_allocation', 'transition_stock_allocation']) {
    assert.match(functionDefinition(sql, name), /from core\.stock_balance[\s\S]{0,120}for update/i, `${name}`);
  }
  assert.match(
    functionDefinition(sql, 'create_stock_allocation'),
    /v_committed \+ p_qty > v_normal/i,
    '잠금 안에서 정상 창고재고 초과 배정을 다시 막아야 합니다.',
  );
});

test('임시배정 만료는 최초 검토 요청 + 30일로 한 번만 기록하고 트리거가 변경을 막는다', () => {
  const sql = migrationSql();
  assert.match(functionDefinition(sql, 'request_order_review'), /temporary_expires_at = v_now \+ interval '30 days'/i);
  const guard = functionDefinition(sql, 'guard_sales_order_mutation');
  assert.match(guard, /old\.temporary_expires_at is not null\s+and new\.temporary_expires_at is distinct from old\.temporary_expires_at/i);
  assert.match(guard, /raise exception/i);
  assert.match(sql, /create trigger sales_order_guard\s+before update or delete on core\.sales_order/i);
  assert.doesNotMatch(functionDefinition(sql, 'allocate_to_order_line'), /temporary_expires_at\s*=/i, '추가 배정이 만료일을 다시 쓰면 안 됩니다.');
});

test('WAIT_FULL은 부족 품목이 하나라도 있으면 전부 대기하고 PARTIAL은 가능한 수량만 임시배정한다', () => {
  const body = functionDefinition(migrationSql(), 'request_order_review');
  assert.match(body, /p_choice = 'WAIT_FULL' and v_any_shortage/i);
  assert.match(body, /least\(v_line\.requested_qty, greatest\(v_available, 0\)\)/i);
});

test('수동 배정은 대기 순서를 건너뛰면 승인대기 확보와 ALLOC_PRIORITY 승인 요청만 만든다', () => {
  const sql = migrationSql();
  const body = functionDefinition(sql, 'request_manual_allocation');
  assert.match(body, /q\.allocation_priority, q\.first_review_requested_at, q\.order_seq\)\s*<\s*\(v_order\.allocation_priority, v_order\.first_review_requested_at, v_order\.order_seq\)/i);
  assert.match(body, /'APPROVAL_HOLD'/);
  assert.match(body, /core\.request_approval\(\s*'ALLOC_PRIORITY'/i);
  assert.match(body, /PRIORITY_REASON_REQUIRED/);

  const decision = functionDefinition(sql, 'apply_alloc_priority_decision');
  assert.match(decision, /new\.status = 'APPROVED'[\s\S]{0,400}v_allocation\.status <> 'APPROVAL_HOLD'[\s\S]{0,200}raise exception/i, '승인 시 상태를 다시 확인해야 합니다.');
  assert.match(decision, /'FIRM'/);
  assert.match(decision, /'RELEASED'/);
  assert.match(sql, /create trigger alloc_priority_decision_apply\s+after update of status on core\.approval_request/i);
  assert.ok('alloc_priority_decision_apply' < 'approval_notification_sync', '결과 알림 중복 방지를 위해 Task 3 알림 트리거보다 먼저 실행돼야 합니다.');
  assert.match(sql, /create trigger alloc_priority_request_guard\s+before insert on core\.approval_request/i);
});

test('만료 시각이 지난 확정 전 주문은 임시배정 생성 · 확정 전환 · 수주 확정을 거절하고 수동 FIRM · 확보는 막지 않는다', () => {
  const sql = migrationSql();
  const guard = /clock_timestamp\(\) >= [\w.]*temporary_expires_at[\s\S]{0,300}TEMPORARY_ALLOCATION_EXPIRED/;
  for (const name of ['request_order_review', 'confirm_sales_order', 'allocate_to_order_line', 'create_stock_allocation', 'transition_stock_allocation']) {
    assert.match(functionDefinition(sql, name), guard, `${name}는 만료 시각 뒤 임시배정을 만들거나 확정으로 바꾸면 안 됩니다.`);
  }
  assert.match(functionDefinition(sql, 'create_stock_allocation'), /p_status = 'TEMPORARY'[\s\S]{0,300}TEMPORARY_ALLOCATION_EXPIRED/, '생성 차단은 TEMPORARY에만 적용합니다.');
  assert.match(
    functionDefinition(sql, 'transition_stock_allocation'),
    /v_before\.status = 'TEMPORARY' and p_next_status = 'FIRM'[\s\S]{0,400}TEMPORARY_ALLOCATION_EXPIRED/,
    '전환 차단은 TEMPORARY → FIRM에만 적용합니다(해제는 언제든 허용).',
  );
  assert.match(functionDefinition(sql, 'allocate_to_order_line'), /v_order\.status <> 'CONFIRMED'[\s\S]{0,300}TEMPORARY_ALLOCATION_EXPIRED/, '확정 주문의 FIRM 후속 배정은 만료와 무관합니다.');
  assert.match(
    functionDefinition(sql, 'confirm_sales_order'),
    /clock_timestamp\(\) >= v_order\.temporary_expires_at\s+and exists \([\s\S]{0,200}a\.status = 'TEMPORARY'[\s\S]{0,300}TEMPORARY_ALLOCATION_EXPIRED/,
    '수주 확정은 만료 시각 뒤에도 해제되지 않은 임시배정이 남아 있을 때만 거절합니다(FIRM · 확보만 남은 주문은 확정 가능).',
  );
  for (const name of ['request_manual_allocation', 'apply_alloc_priority_decision', 'cancel_sales_order', 'cancel_firm_allocation']) {
    assert.doesNotMatch(functionDefinition(sql, name), /TEMPORARY_ALLOCATION_EXPIRED/, `${name}에는 시간 제한이 없습니다(stage1 §2 68 · 83행).`);
  }
});

test('주문 · 배정 DB 검증 스크립트는 저장소에 있고 로컬 임시 DB에서만 실행된다', () => {
  const base = new URL('../../supabase/tests/sales_order_allocation/', import.meta.url);
  const files = ['README.md', 'lib.sh', 'guard.psql', 'auth-stub.psql', 'bootstrap.sh', 'fixtures.psql', 'scenarios.psql', 'concurrency.sh', 'invariants.psql', 'run-all.sh'];
  for (const file of files) assert.equal(existsSync(new URL(file, base)), true, `${file}가 있어야 합니다.`);
  for (const file of ['auth-stub.psql', 'fixtures.psql', 'scenarios.psql', 'invariants.psql']) {
    assert.match(readFileSync(new URL(file, base), 'utf8'), /^\\ir guard\.psql$/m, `${file}는 먼저 guard.psql로 대상 DB를 확인해야 합니다.`);
  }
  const guardSql = readFileSync(new URL('guard.psql', base), 'utf8');
  assert.match(guardSql, /current_database\(\) like 'scm\\_test\\_%'/);
  assert.match(guardSql, /inet_server_addr\(\)/);
  const lib = readFileSync(new URL('lib.sh', base), 'utf8');
  assert.match(lib, /scm_test_\*\)/);
  assert.match(lib, /PGHOSTADDR/);
  for (const file of files) {
    assert.doesNotMatch(readFileSync(new URL(file, base), 'utf8'), /PGPASSWORD=|password\s*=|supabase\.co|sb_secret_|postgres(ql)?:\/\//i, `${file}에 접속 정보가 있으면 안 됩니다.`);
  }
  const scenarios = readFileSync(new URL('scenarios.psql', base), 'utf8');
  for (const scenario of ['S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10']) assert.match(scenarios, new RegExp(`== ${scenario} `));
  assert.match(scenarios, /TEMPORARY_ALLOCATION_EXPIRED/);
  assert.match(readFileSync(new URL('run-all.sh', base), 'utf8'), /trap cleanup EXIT/);
  // supabase test db(pg_prove)가 이 폴더의 .sql을 테스트로 실행하지 않도록 .sql 파일을 두지 않는다.
  assert.equal(existsSync(new URL('scenarios.sql', base)), false);
});

test('영업담당자 주문 취소는 확정 전 · 확정배정 없는 주문만 해제하고 대기 중인 우선 배정 요청을 취소한다', () => {
  const sql = migrationSql();
  const body = functionDefinition(sql, 'cancel_sales_order');
  assert.match(body, /v_order\.owner_user_id <> v_actor/, '주문 등록자 본인만 취소할 수 있어야 합니다.');
  assert.match(body, /CANCEL_REASON_REQUIRED/);
  assert.match(body, /ORDER_ALREADY_CONFIRMED/);
  assert.match(body, /ORDER_ALREADY_CLOSED/);
  assert.match(body, /a\.status = 'FIRM'[\s\S]{0,200}FIRM_ALLOCATION_EXISTS/, '확정배정이 있으면 해제 전에 거절해야 합니다.');
  assert.ok(body.search(/FIRM_ALLOCATION_EXISTS/) < body.search(/core\.release_order_allocations\(/), '거절 판정은 해제보다 먼저여야 합니다.');
  assert.match(body, /status = 'CANCELLED'/);
  assert.match(body, /core\.cancel_notification_series\('TEMP_ALLOCATION', v_order\.order_id::text\)/i);
  assert.doesNotMatch(body, /'WAITING_FULL'/, '취소한 주문을 대기 상태로 되돌리면 안 됩니다.');

  const release = functionDefinition(sql, 'release_order_allocations');
  assert.match(release, /core\.transition_stock_allocation\(/);
  assert.match(release, /core\.cancel_alloc_priority_approval\(/, '승인대기 확보를 풀 때 연결된 승인 요청도 취소해야 합니다.');
  assert.match(functionDefinition(sql, 'cancel_firm_allocation'), /core\.release_order_allocations\(/);
  assert.match(
    functionDefinition(sql, 'sales_order_transition_allowed'),
    /p_from = 'DRAFT' then p_to in \('REVIEW_REQUESTED', 'CANCELLED'\)/,
  );
});

test('확정배정 취소는 사유를 요구하고 주문 전체를 취소하며 영업담당자에게 알린다', () => {
  const body = functionDefinition(migrationSql(), 'cancel_firm_allocation');
  assert.match(body, /CANCEL_REASON_REQUIRED/);
  assert.match(body, /status = 'CANCELLED'/);
  assert.match(body, /'ALLOC_FIRM_CANCELLED'/);
  assert.match(body, /core\.cancel_notification_series\('TEMP_ALLOCATION', v_order\.order_id::text\)/i);
  assert.doesNotMatch(body, /'WAITING_FULL'/, '취소한 주문을 대기 상태로 되돌리면 안 됩니다.');
});

test('주문·배정 이력은 append-only이고 authenticated는 테이블에 직접 쓰지 못한다', () => {
  const sql = migrationSql();
  for (const table of ['sales_order_event', 'stock_allocation_event', 'allocation_priority']) {
    assert.match(
      sql,
      new RegExp(`before update or delete on core\\.${table}\\s+for each row execute function core\\.reject_order_history_mutation\\(\\)`, 'i'),
      `core.${table}`,
    );
  }
  assert.match(sql, /before update or delete on core\.stock_allocation\s+for each row execute function core\.guard_stock_allocation_mutation\(\)/i);
  assert.match(
    sql,
    /revoke insert, update, delete on core\.sales_order, core\.sales_order_line, core\.stock_allocation,\s*core\.allocation_priority, core\.urgent_order, core\.sales_order_event, core\.stock_allocation_event\s+from authenticated/i,
  );
  assert.match(sql, /revoke all on core\.sales_order, [\s\S]*? from anon, public/i);
});

test('analytics 뷰는 security_invoker이고 raw를 직접 읽지 않으며 Task 4 열 순서를 유지한다', () => {
  const sql = migrationSql();
  for (const view of ['analytics.v_my_sales_order', 'analytics.v_allocation_queue', 'analytics.v_order_available_stock', 'analytics.v_urgent_order', 'analytics.v_available_stock']) {
    assert.match(viewDefinition(sql, view), /with \(security_invoker = true\)/i, view);
  }
  assert.doesNotMatch(sql, /\b(from|join)\s+raw\./i, 'security_invoker 뷰가 raw를 직접 읽으면 permission denied (error.md #22)');

  assert.match(
    viewDefinition(sql, 'analytics.v_order_available_stock'),
    /select\s+im\.item_id,\s+im\.item_name,\s+case[\s\S]*?end as available_qty,\s+case[\s\S]*?end as reason_code\s+from/i,
  );
  const available = viewDefinition(sql, 'analytics.v_available_stock');
  assert.match(available, /as temporary_allocated_qty,[\s\S]*as firm_allocated_qty,[\s\S]*as approval_hold_qty,[\s\S]*as available_qty,\s+po\.open_po_qty,/i);
  assert.doesNotMatch(available, /0::numeric as temporary_allocated_qty/i, 'Task 4의 0 고정을 실제 배정 합계로 바꿔야 합니다.');

  // 영업은 RLS상 남의 주문 배정을 볼 수 없으므로, 가용재고 차감 합계는 소유자 권한 core 집계 뷰에서 읽어야 한다.
  const aggregate = viewDefinition(sql, 'core.v_item_allocation_qty');
  assert.doesNotMatch(aggregate, /security_invoker/i);
  for (const permission of ['ATP_VIEW', 'STOCK_VIEW_ALL', 'STOCK_VIEW_PAPER', 'STOCK_VIEW_SUPPLY', 'ALLOC_VIEW', 'ALLOC_MANUAL']) {
    assert.match(aggregate, new RegExp(`core\\.has_permission\\('${permission}'\\)`), permission);
  }
});

test('운영 테이블에 예시 주문·배정·긴급발주 데이터를 넣지 않는다', () => {
  // 함수 본문의 insert는 업무 명령이다. 함수 밖(파일 최상위)에서 행을 넣는 문장만 금지한다.
  const outsideFunctions = migrationSql().replace(/create or replace function[\s\S]*?\n\$\$;/gi, '');
  assert.doesNotMatch(
    outsideFunctions,
    /insert into core\.(sales_order|sales_order_line|stock_allocation|urgent_order|allocation_priority)\b/i,
  );
});
