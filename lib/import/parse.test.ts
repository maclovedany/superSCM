import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { detectSourceType, parseFile } from './parse.ts';
import { parseDate } from './validate.ts';

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

test('확장자로 형식을 판별한다', () => {
  assert.equal(detectSourceType('demand.csv'), 'MANUAL_CSV');
  assert.equal(detectSourceType('DEMAND.XLSX'), 'MANUAL_EXCEL');
  assert.equal(detectSourceType('demand.json'), 'MANUAL_JSON');
  assert.equal(detectSourceType('demand.pdf'), null);
});

test('BOM 이 붙은 CSV 의 첫 컬럼명이 깨지지 않는다', () => {
  const csv = '﻿품목코드,출고일,출고수량\nITEM001,2026-08-22,30\n';
  const result = parseFile(toArrayBuffer(Buffer.from(csv, 'utf-8')), 'MANUAL_CSV');
  assert.equal(result.error, null);
  assert.deepEqual(result.columns, ['품목코드', '출고일', '출고수량']);
});

test('엑셀 날짜 셀이 Date 로 넘어온다', () => {
  // raw:false 로 두면 '8/30/26' 같은 서식 문자열이 되어 날짜 파서가 전부 오류로 판정합니다.
  const sheet = XLSX.utils.json_to_sheet([
    { 품목코드: 'ITEM016', 출고일: new Date(Date.UTC(2026, 7, 30)), 출고수량: 55 },
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, '수요');
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  const result = parseFile(toArrayBuffer(buffer), 'MANUAL_EXCEL');
  assert.equal(result.error, null);
  assert.equal(parseDate(result.rows[0]['출고일']), '2026-08-30');
});

test('JSON 은 배열과 { data: [...] } 를 모두 받는다', () => {
  const body = JSON.stringify({ mode: 'append', data: [{ item_id: 'ITEM014', qty: 88 }] });
  const result = parseFile(toArrayBuffer(Buffer.from(body, 'utf-8')), 'MANUAL_JSON');
  assert.equal(result.error, null);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.columns.sort(), ['item_id', 'qty']);
});
