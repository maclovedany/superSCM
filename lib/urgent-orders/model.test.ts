import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  TERMINAL_URGENT_ORDER_STATUSES,
  URGENT_ORDER_STATUSES,
  URGENT_ORDER_STATUS_LABELS,
  normalizeUrgentOrderHistoryRow,
  normalizeUrgentOrderRow,
  urgentOrderStatusTone,
  validateCreateUrgentOrder,
  validateUpdateUrgentOrder,
  validateUrgentOrderStatusChange,
} from './model.ts';

function migrationSql(): string {
  return readFileSync(
    new URL('../../supabase/migrations/20260911001100_stage1_department_screens.sql', import.meta.url),
    'utf8',
  );
}

function functionDefinition(sql: string, name: string): string {
  const match = sql.match(new RegExp(`create or replace function core\\.${name}\\s*\\([\\s\\S]*?\\n\\$\\$;`, 'i'));
  assert.ok(match, `core.${name} 함수 정의가 있어야 합니다.`);
  return match[0];
}

// ══ 순수 모델 ══════════════════════════════════════════════════

test('긴급발주 상태 코드는 4가지이며 종료 상태는 COMPLETED · CANCELLED뿐이다', () => {
  assert.deepEqual(URGENT_ORDER_STATUSES, ['REQUESTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
  assert.deepEqual(TERMINAL_URGENT_ORDER_STATUSES, ['COMPLETED', 'CANCELLED']);
  for (const status of URGENT_ORDER_STATUSES) assert.ok(URGENT_ORDER_STATUS_LABELS[status]);
});

test('상태 톤은 완료는 초록, 취소는 빨강이다', () => {
  assert.equal(urgentOrderStatusTone('COMPLETED'), 'green');
  assert.equal(urgentOrderStatusTone('CANCELLED'), 'red');
  assert.equal(urgentOrderStatusTone('REQUESTED'), 'amber');
  assert.equal(urgentOrderStatusTone(null), 'gray');
});

test('등록 입력 검증 — 품목 · 수량 · 필요일 · 사유가 모두 필요하다', () => {
  const ok = validateCreateUrgentOrder({ itemId: 'CONS001', qty: '10', neededBy: '2026-09-30', reason: '재고 부족' });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.value, { itemId: 'CONS001', qty: 10, neededBy: '2026-09-30', reason: '재고 부족' });

  const noItem = validateCreateUrgentOrder({ itemId: '', qty: '10', neededBy: '2026-09-30', reason: '사유' });
  assert.equal(noItem.ok, false);
  if (!noItem.ok) assert.equal(noItem.reasonCode, 'ITEM_ID_REQUIRED');

  const badQty = validateCreateUrgentOrder({ itemId: 'CONS001', qty: '0', neededBy: '2026-09-30', reason: '사유' });
  assert.equal(badQty.ok, false);
  if (!badQty.ok) assert.equal(badQty.reasonCode, 'QTY_INVALID');

  const negativeQty = validateCreateUrgentOrder({ itemId: 'CONS001', qty: '-5', neededBy: '2026-09-30', reason: '사유' });
  assert.equal(negativeQty.ok, false);

  const noDate = validateCreateUrgentOrder({ itemId: 'CONS001', qty: '10', neededBy: '', reason: '사유' });
  assert.equal(noDate.ok, false);
  if (!noDate.ok) assert.equal(noDate.reasonCode, 'NEEDED_BY_INVALID');

  const noReason = validateCreateUrgentOrder({ itemId: 'CONS001', qty: '10', neededBy: '2026-09-30', reason: '  ' });
  assert.equal(noReason.ok, false);
  if (!noReason.ok) assert.equal(noReason.reasonCode, 'REASON_REQUIRED');
});

test('수정 입력 검증 — 변경 사유가 없으면 거절한다(요청 사유와는 다른 항목)', () => {
  const ok = validateUpdateUrgentOrder({
    urgentOrderId: 'u1', qty: '20', neededBy: '2026-10-01', reason: '재고 부족', changeReason: '수량 조정',
  });
  assert.equal(ok.ok, true);

  const noChangeReason = validateUpdateUrgentOrder({
    urgentOrderId: 'u1', qty: '20', neededBy: '2026-10-01', reason: '재고 부족', changeReason: '',
  });
  assert.equal(noChangeReason.ok, false);
  if (!noChangeReason.ok) assert.equal(noChangeReason.reasonCode, 'CHANGE_REASON_REQUIRED');
});

test('상태 변경 입력 검증 — 알 수 없는 상태와 빈 사유를 거절한다', () => {
  const ok = validateUrgentOrderStatusChange({ urgentOrderId: 'u1', status: 'IN_PROGRESS', reason: '처리 시작' });
  assert.equal(ok.ok, true);

  const badStatus = validateUrgentOrderStatusChange({ urgentOrderId: 'u1', status: 'DONE', reason: '사유' });
  assert.equal(badStatus.ok, false);
  if (!badStatus.ok) assert.equal(badStatus.reasonCode, 'STATUS_INVALID');

  const noReason = validateUrgentOrderStatusChange({ urgentOrderId: 'u1', status: 'COMPLETED', reason: '' });
  assert.equal(noReason.ok, false);
  if (!noReason.ok) assert.equal(noReason.reasonCode, 'REASON_REQUIRED');
});

test('analytics.v_urgent_order 행을 정규화한다 — 알 수 없는 상태는 null', () => {
  const row = normalizeUrgentOrderRow({
    urgent_order_id: 'u1', item_id: 'CONS001', item_name: '소모품A', qty: 10, needed_by: '2026-09-30',
    reason: '재고 부족', status: 'REQUESTED', owner_user_id: 'owner1', owner_name: '홍길동',
    created_at: '2026-09-12T00:00:00Z', updated_at: '2026-09-12T00:00:00Z',
  });
  assert.equal(row.itemId, 'CONS001');
  assert.equal(row.status, 'REQUESTED');
  assert.equal(row.statusLabel, '요청');

  const unknown = normalizeUrgentOrderRow({ urgent_order_id: 'u2', item_id: 'X', status: 'WEIRD' });
  assert.equal(unknown.status, null, '모르는 상태값을 임의로 매핑하면 안 됩니다.');
  assert.equal(unknown.statusLabel, '알 수 없음');
});

test('analytics.v_urgent_order_history 행을 정규화한다 — before/after가 객체가 아니면 null', () => {
  const row = normalizeUrgentOrderHistoryRow({
    id: '1', at: '2026-09-12T00:00:00Z', actor_name: '홍길동', action: 'URGENT_ORDER_CREATED',
    urgent_order_id: 'u1', item_id: 'CONS001', before: null, after: { status: 'REQUESTED' },
  });
  assert.equal(row.actionLabel, '등록');
  assert.equal(row.before, null);
  assert.deepEqual(row.after, { status: 'REQUESTED' });
});

// ══ DB 함수 — 컨트롤러 판정 1 (SCM 품목담당자만 쓰기, append-only 이력) ═══════════════

test('긴급발주 등록 · 수정 · 상태 변경 함수는 모두 ALLOC_MANUAL을 요구한다', () => {
  const sql = migrationSql();
  for (const name of ['create_urgent_order', 'update_urgent_order', 'change_urgent_order_status']) {
    const body = functionDefinition(sql, name);
    assert.match(body, /core\.has_permission\('ALLOC_MANUAL'\)/, `${name}는 ALLOC_MANUAL을 확인해야 합니다.`);
    assert.match(body, /security definer/i);
  }
});

test('긴급발주 쓰기 함수는 anon · public에서 막고 authenticated에만 연다', () => {
  const sql = migrationSql();
  for (const signature of [
    'create_urgent_order(text, numeric, date, text)',
    'update_urgent_order(uuid, numeric, date, text, text)',
    'change_urgent_order_status(uuid, text, text)',
  ]) {
    assert.match(sql, new RegExp(`revoke all on function core\\.${signature.replace(/[()]/g, '\\$&')} from public, anon`));
    assert.match(sql, new RegExp(`grant execute on function core\\.${signature.replace(/[()]/g, '\\$&')} to authenticated`));
  }
});

test('종료(COMPLETED · CANCELLED) 상태에서는 수정·상태 변경을 거절한다', () => {
  const sql = migrationSql();
  const update = functionDefinition(sql, 'update_urgent_order');
  assert.match(update, /status in \('COMPLETED', 'CANCELLED'\)[\s\S]{0,120}raise exception/i);
  const status = functionDefinition(sql, 'change_urgent_order_status');
  assert.match(status, /status in \('COMPLETED', 'CANCELLED'\)[\s\S]{0,120}raise exception/i);
});

test('세 함수 모두 core.audit_log(target_type=urgent_order)에 append-only 이력을 남긴다', () => {
  const sql = migrationSql();
  for (const name of ['create_urgent_order', 'update_urgent_order', 'change_urgent_order_status']) {
    const body = functionDefinition(sql, name);
    assert.match(body, /insert into core\.audit_log/i, `${name}는 이력을 남겨야 합니다.`);
    assert.match(body, /'urgent_order'/, `${name}의 target_type은 urgent_order여야 합니다.`);
  }
  // update · delete 문이 core.audit_log를 직접 건드리지 않는다(append-only) — 세 함수 밖에서도 확인.
  assert.doesNotMatch(sql, /update core\.audit_log|delete from core\.audit_log/i);
});

test('core.urgent_order 표의 직접 쓰기는 authenticated에 열리지 않는다 — SECURITY DEFINER 함수만 쓴다', () => {
  const sql = migrationSql();
  assert.match(sql, /revoke insert, update, delete on core\.urgent_order from authenticated/);
});

test('긴급발주 이력 조회 뷰는 SCM(STOCK_VIEW_ALL)은 전체, 서비스부(URGENT_ORDER_VIEW)는 소모품만 본다', () => {
  const sql = migrationSql();
  assert.match(sql, /create or replace view analytics\.v_urgent_order_history/i);
  assert.match(sql, /core\.has_permission\('STOCK_VIEW_ALL'\)[\s\S]{0,200}core\.has_permission\('URGENT_ORDER_VIEW'\)[\s\S]{0,80}'CONSUMABLE'/);
});
