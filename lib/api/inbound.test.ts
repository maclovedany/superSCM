// lib/api/inbound-model.ts 의 순수 부분 —
// 요청 본문 읽기 · 자동 매핑 · strict 판정 · 응답 조립
//
// ★ 검증 자체는 lib/import/validate.ts 가 합니다. 여기서는 그 결과를
//   renew.prd 9.1 의 응답 모양으로 옮기는 부분만 봅니다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../import/validate.ts';
import type { ValidationContext, ValidationResult } from '../import/types.ts';
import {
  buildInboundResponse,
  buildMapping,
  collectColumns,
  hasRequestLevelError,
  isBlocked,
  MAX_RESPONSE_ERRORS,
  parseInboundBody,
  stageableRows,
  toInboundErrors,
} from './inbound-model.ts';

const CONTEXT: ValidationContext = {
  knownItemIds: new Set(['ITEM001', 'ITEM012']),
  knownSupplierIds: new Set(['SUP01']),
  targetColumns: new Set(['item_id', 'use_date', 'qty', 'note']),
};

// ── parseInboundBody ─────────────────────────────────────────

test('parseInboundBody — renew.prd 9.1 의 본문을 읽는다', () => {
  const parsed = parseInboundBody({
    mode: 'upsert',
    strict: false,
    data: [{ item_id: 'ITEM012', date: '2025-03-14', quantity: 62 }],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.request.mode, 'upsert');
  assert.equal(parsed.request.strict, false);
  assert.equal(parsed.request.data.length, 1);
});

test('parseInboundBody — mode 를 빼면 append 이다', () => {
  const parsed = parseInboundBody({ data: [] });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.request.mode, 'append');
  assert.equal(parsed.request.strict, false);
});

test('parseInboundBody — 잘못된 본문은 사유와 함께 거부한다', () => {
  assert.equal(parseInboundBody(null).ok, false);
  assert.equal(parseInboundBody([]).ok, false);
  assert.equal(parseInboundBody('x').ok, false);
  assert.equal(parseInboundBody({}).ok, false, 'data 가 없으면 거부');
  assert.equal(parseInboundBody({ data: {} }).ok, false, 'data 가 배열이 아니면 거부');
  assert.equal(parseInboundBody({ data: [1] }).ok, false, 'data 항목이 객체가 아니면 거부');
  assert.equal(parseInboundBody({ data: [], mode: 'merge' }).ok, false, '모르는 mode 는 거부');
  assert.equal(parseInboundBody({ data: [], strict: 'yes' }).ok, false, 'strict 는 boolean');
});

// ── 자동 매핑 ────────────────────────────────────────────────

test('collectColumns — 처음 나온 순서로 모은다', () => {
  assert.deepEqual(
    collectColumns([{ a: 1, b: 2 }, { b: 3, c: 4 }]),
    ['a', 'b', 'c'],
  );
});

test('buildMapping — 논리 필드명과 별칭을 모두 받는다 (파일 업로드와 같은 규칙)', () => {
  // renew.prd 9.1 의 예시 본문은 date · quantity 를 씁니다
  const mapping = buildMapping('DEMAND', [{ item_id: 'ITEM012', date: '2025-03-14', quantity: 62 }]);
  assert.equal(mapping.item_id, 'item_id');
  assert.equal(mapping.date, 'use_date');
  assert.equal(mapping.quantity, 'qty');

  const identity = buildMapping('DEMAND', [{ item_id: 'A', use_date: '2025-01-01', qty: 1 }]);
  assert.equal(identity.use_date, 'use_date');
  assert.equal(identity.qty, 'qty');
});

// ── strict 판정 · 부분 성공 ──────────────────────────────────

function demandResult(rows: Record<string, unknown>[]): ValidationResult {
  return validate('DEMAND', rows, buildMapping('DEMAND', rows), CONTEXT);
}

test('부분 성공 — strict 가 아니면 정상 행만 적재한다', () => {
  const result = demandResult([
    { item_id: 'ITEM012', date: '2025-03-14', quantity: 62 },
    { item_id: 'ITEM999', date: '2025-03-15', quantity: 10 },
  ]);

  assert.equal(result.totalRows, 2);
  assert.equal(result.errorRows, 1, '마스터에 없는 품목은 오류');
  assert.equal(isBlocked(result, false), false);
  assert.deepEqual(stageableRows(result, false), [true, false]);
});

test('strict — 오류가 하나라도 있으면 한 행도 적재하지 않는다 (renew.prd 9.1)', () => {
  const result = demandResult([
    { item_id: 'ITEM012', date: '2025-03-14', quantity: 62 },
    { item_id: 'ITEM999', date: '2025-03-15', quantity: 10 },
  ]);

  assert.equal(isBlocked(result, true), true);
  assert.deepEqual(stageableRows(result, true), [false, false]);
});

test('strict — 오류가 없으면 전부 적재한다', () => {
  const result = demandResult([
    { item_id: 'ITEM012', date: '2025-03-14', quantity: 62 },
    { item_id: 'ITEM001', date: '2025-03-15', quantity: 10 },
  ]);

  assert.equal(result.errorRows, 0);
  assert.equal(isBlocked(result, true), false);
  assert.deepEqual(stageableRows(result, true), [true, true]);
});

test('요청 단위 오류는 strict 가 아니어도 전량 거부한다', () => {
  // qty 를 아예 보내지 않으면 필수 컬럼이 매핑되지 않습니다.
  // 이때 각 행은 "오류 없음" 으로 보이지만 필수 값이 비어 있으므로 적재하면 안 됩니다.
  const result = demandResult([{ item_id: 'ITEM012', date: '2025-03-14' }]);

  assert.equal(hasRequestLevelError(result), true);
  assert.equal(result.errorRows, 0, '행 단위로는 오류가 잡히지 않는다');
  assert.equal(isBlocked(result, false), true, '그래도 전량 거부여야 한다');
  assert.deepEqual(stageableRows(result, false), [false]);
});

// ── 응답 조립 ────────────────────────────────────────────────

test('toInboundErrors — 행 번호를 0부터의 index 로 바꾼다', () => {
  const errors = toInboundErrors([
    { rowNumber: 2, column: 'item_id', severity: 'ERROR', code: 'UNKNOWN_ITEM', message: '없습니다' },
    { rowNumber: 0, column: 'qty', severity: 'ERROR', code: 'MISSING_COLUMN', message: '컬럼 없음' },
  ]);

  assert.equal(errors[0].index, 1, '2행 → index 1');
  assert.equal(errors[0].field, 'item_id');
  assert.equal(errors[1].index, null, '요청 단위 오류는 index 가 없다');
});

test('buildInboundResponse — renew.prd 9.1 의 응답 모양', () => {
  const result = demandResult([
    { item_id: 'ITEM012', date: '2025-03-14', quantity: 62 },
    { item_id: 'ITEM999', date: '2025-03-15', quantity: 10 },
  ]);

  const body = buildInboundResponse({
    batchId: 'b_api_20250314_0001',
    received: 2,
    accepted: 1,
    issues: result.issues,
  });

  assert.equal(body.batch_id, 'b_api_20250314_0001');
  assert.equal(body.received, 2);
  assert.equal(body.accepted, 1);
  assert.equal(body.rejected, 1);
  assert.ok(body.errors.length >= 1);
  assert.equal(body.errors[0].index, 1);
  assert.equal(body.errors[0].field, 'item_id');
  assert.equal(body.errors[0].code, 'UNKNOWN_ITEM');
});

test('buildInboundResponse — 전량 거부는 accepted 0 · rejected 전체', () => {
  const result = demandResult([
    { item_id: 'ITEM012', date: '2025-03-14', quantity: 62 },
    { item_id: 'ITEM999', date: '2025-03-15', quantity: 10 },
  ]);

  const body = buildInboundResponse({
    batchId: 'b_api_x',
    received: 2,
    accepted: 0,
    issues: result.issues,
  });

  assert.equal(body.accepted, 0);
  assert.equal(body.rejected, 2);
});

test('buildInboundResponse — accepted 가 received 를 넘지 않는다', () => {
  const body = buildInboundResponse({ batchId: 'b', received: 2, accepted: 5, issues: [] });
  assert.equal(body.accepted, 2);
  assert.equal(body.rejected, 0);

  const negative = buildInboundResponse({ batchId: 'b', received: 2, accepted: -1, issues: [] });
  assert.equal(negative.accepted, 0);
  assert.equal(negative.rejected, 2);
});

test('오류가 1,000건을 넘으면 자르고 전체 수를 알려준다', () => {
  const issues = Array.from({ length: 1500 }, (_, i) => ({
    rowNumber: i + 1,
    column: 'item_id',
    severity: (i % 3 === 0 ? 'WARNING' : 'ERROR') as 'ERROR' | 'WARNING',
    code: 'UNKNOWN_ITEM' as const,
    message: '없습니다',
  }));

  const body = buildInboundResponse({ batchId: 'b', received: 1500, accepted: 0, issues });

  assert.equal(body.errors.length, MAX_RESPONSE_ERRORS);
  assert.equal(body.errors_total, 1500);
  // 잘릴 때 경고가 오류를 밀어내지 않아야 합니다
  assert.ok(body.errors.every((error) => error.severity === 'ERROR'));
});

test('오류가 상한 안이면 자르지 않고 errors_total 도 없다', () => {
  const body = buildInboundResponse({
    batchId: 'b',
    received: 1,
    accepted: 0,
    issues: [{ rowNumber: 1, column: 'qty', severity: 'ERROR', code: 'NEGATIVE', message: '음수' }],
  });

  assert.equal(body.errors.length, 1);
  assert.equal(body.errors_total, undefined);
});

// ── mode: 'replace' — 지울 기간을 반드시 받습니다 (renew.prd 8.4) ──

test("replace — period_from · period_to 가 없으면 사유와 함께 거절한다", () => {
  const parsed = parseInboundBody({ mode: 'replace', data: [] });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.message, /period_from/);
  assert.match(parsed.message, /되돌릴 수 없습니다/, '되돌릴 수 없다는 것을 알려야 합니다');
});

test('replace — 기간을 주면 통과하고 그대로 실린다', () => {
  const parsed = parseInboundBody({
    mode: 'replace',
    data: [],
    period_from: '2025-03-01',
    period_to: '2025-03-31',
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.request.periodFrom, '2025-03-01');
  assert.equal(parsed.request.periodTo, '2025-03-31');
});

test('replace — 형식이 틀리거나 순서가 뒤집히면 거절한다', () => {
  assert.equal(
    parseInboundBody({ mode: 'replace', data: [], period_from: '2025/03/01', period_to: '2025-03-31' }).ok,
    false,
  );
  const reversed = parseInboundBody({
    mode: 'replace',
    data: [],
    period_from: '2025-03-31',
    period_to: '2025-03-01',
  });
  assert.equal(reversed.ok, false);
  if (reversed.ok) return;
  assert.match(reversed.message, /늦습니다/);
});

test('replace 가 아닌데 기간을 주면 조용히 무시하지 않고 거절한다', () => {
  const parsed = parseInboundBody({ mode: 'append', data: [], period_from: '2025-03-01' });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.message, /replace/);
});

test('append · upsert 는 기간이 null 이다', () => {
  for (const mode of ['append', 'upsert']) {
    const parsed = parseInboundBody({ mode, data: [] });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.request.periodFrom, null);
    assert.equal(parsed.request.periodTo, null);
  }
});
