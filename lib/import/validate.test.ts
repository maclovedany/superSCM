import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, parseNumber, validate } from './validate.ts';
import { autoMap, TABLE_SPECS } from './schema.ts';

const ctx = {
  knownItemIds: new Set(['ITEM001', 'ITEM002']),
  knownSupplierIds: new Set(['SUP001']),
  targetColumns: new Set(['item_id', 'use_date', 'qty', 'note']),
};

test('날짜는 허용 형식만 통과한다', () => {
  assert.equal(parseDate('2025-03-14'), '2025-03-14');
  assert.equal(parseDate('2025/03/14'), '2025-03-14');
  assert.equal(parseDate('20250314'), '2025-03-14');
  // renew.prd 8.3 의 예시 — 13월은 오류입니다
  assert.equal(parseDate('2025/13/01'), null);
  // 2월 30일처럼 존재하지 않는 날짜도 걸러냅니다
  assert.equal(parseDate('2025-02-30'), null);
  assert.equal(parseDate('14/03/2025'), null);
  assert.equal(parseDate(''), null);
});

test('숫자는 쉼표만 허용하고 나머지 문자는 오류다', () => {
  assert.equal(parseNumber('1,234'), 1234);
  assert.equal(parseNumber('-5'), -5);
  assert.equal(parseNumber('3.5'), 3.5);
  assert.equal(parseNumber('62개'), null);
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber(''), null);
});

test('한국어 컬럼명을 자동으로 매핑한다', () => {
  const mapping = autoMap(TABLE_SPECS.DEMAND, ['품목코드', '출고일', '출고수량', '비고']);
  assert.deepEqual(mapping, {
    품목코드: 'item_id',
    출고일: 'use_date',
    출고수량: 'qty',
    비고: 'note',
  });
});

test('마스터에 없는 품목코드를 오류로 남긴다', () => {
  const result = validate(
    'DEMAND',
    [{ item_id: 'ITEM999', use_date: '2025-03-14', qty: '62' }],
    { item_id: 'item_id', use_date: 'use_date', qty: 'qty' },
    ctx,
  );

  assert.equal(result.errorRows, 1);
  const issue = result.issues.find((i) => i.code === 'UNKNOWN_ITEM');
  assert.ok(issue);
  assert.equal(issue.rowNumber, 1);
  assert.match(issue.message, /ITEM999/);
});

test('오류가 있어도 정상 행은 그대로 통과한다 — 부분 성공', () => {
  const result = validate(
    'DEMAND',
    [
      { item_id: 'ITEM001', use_date: '2025-03-14', qty: '62' },
      { item_id: 'ITEM999', use_date: '2025-03-14', qty: '10' },
      { item_id: 'ITEM002', use_date: '2025/13/01', qty: '5' },
    ],
    { item_id: 'item_id', use_date: 'use_date', qty: 'qty' },
    ctx,
  );

  assert.equal(result.totalRows, 3);
  assert.equal(result.errorRows, 2);
  assert.equal(result.successRows, 1);
  assert.deepEqual(result.rowValid, [true, false, false]);
});

test('필수 컬럼이 매핑되지 않으면 파일 단위 오류로 남긴다', () => {
  const result = validate('DEMAND', [{ item_id: 'ITEM001' }], { item_id: 'item_id' }, ctx);
  const issue = result.issues.find((i) => i.code === 'MISSING_COLUMN');
  assert.ok(issue);
  // 행 번호 0 = 파일 단위 오류
  assert.equal(issue.rowNumber, 0);
});

test('빈 값은 보정하지 않고 오류로 남긴다', () => {
  const result = validate(
    'DEMAND',
    [{ item_id: 'ITEM001', use_date: '2025-03-14', qty: '' }],
    { item_id: 'item_id', use_date: 'use_date', qty: 'qty' },
    ctx,
  );
  // 0 으로 채우지 않습니다 (AGENTS.md 규칙 5)
  assert.equal(result.rows[0].qty, null);
  assert.equal(result.errorRows, 1);
  assert.ok(result.issues.some((i) => i.code === 'REQUIRED'));
});

test('수량 컬럼의 음수를 오류로 남긴다', () => {
  const result = validate(
    'SALES_ORDER',
    [{ so_no: 'SO1', item_id: 'ITEM001', qty: '-15' }],
    { so_no: 'so_no', item_id: 'item_id', qty: 'qty' },
    { ...ctx, targetColumns: new Set(['so_no', 'item_id', 'qty']) },
  );
  assert.ok(result.issues.some((i) => i.code === 'NEGATIVE'));
});

test('납기일이 발주일보다 빠르면 논리 오류다', () => {
  const result = validate(
    'PURCHASE_ORDER',
    [{ po_no: 'PO1', item_id: 'ITEM001', order_date: '2025-05-10', due_date: '2025-05-01', qty: '10' }],
    {
      po_no: 'po_no',
      item_id: 'item_id',
      order_date: 'order_date',
      due_date: 'due_date',
      qty: 'qty',
    },
    { ...ctx, targetColumns: new Set(['po_no', 'item_id', 'order_date', 'due_date', 'qty']) },
  );
  assert.ok(result.issues.some((i) => i.code === 'DATE_ORDER'));
});

test('같은 키가 두 번 나오면 경고를 남긴다', () => {
  const result = validate(
    'DEMAND',
    [
      { item_id: 'ITEM001', use_date: '2025-03-14', qty: '10' },
      { item_id: 'ITEM001', use_date: '2025-03-14', qty: '20' },
    ],
    { item_id: 'item_id', use_date: 'use_date', qty: 'qty' },
    ctx,
  );

  const issue = result.issues.find((i) => i.code === 'DUPLICATE');
  assert.ok(issue);
  assert.equal(issue.severity, 'WARNING');
  // 경고는 적재를 막지 않습니다
  assert.deepEqual(result.rowValid, [true, true]);
});

test('사용 실적의 음수는 반품이므로 적재를 막지 않는다', () => {
  // 학습에서 빼는 일은 core.outlier_rule 과 core.v_train_demand 가 합니다.
  const result = validate(
    'DEMAND',
    [{ item_id: 'ITEM001', use_date: '2025-04-06', qty: '-15' }],
    { item_id: 'item_id', use_date: 'use_date', qty: 'qty' },
    ctx,
  );
  assert.equal(result.errorRows, 0);
  assert.equal(result.rows[0].qty, -15);
  assert.ok(!result.issues.some((i) => i.code === 'NEGATIVE'));
});
