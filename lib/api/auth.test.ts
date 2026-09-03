// lib/api/auth-model.ts 의 순수 함수 — 해시 · Bearer 파싱 · scope 판정
//
// Supabase 를 부르는 lib/api/auth.ts 는 여기서 import 하지 않습니다 (error.md #17).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  API_SCOPES,
  hasScope,
  hashKey,
  isApiScope,
  keyPrefix,
  page,
  parseBearer,
  readPaging,
  type ApiIdentity,
} from './auth-model.ts';

function identity(scope: string[]): ApiIdentity {
  return { keyId: 'key_abc', integrationName: 'ERP', scope, keyHash: 'x'.repeat(64) };
}

test('parseBearer — 올바른 헤더에서 원문을 꺼낸다', () => {
  assert.equal(parseBearer('Bearer sk_scm_abc'), 'sk_scm_abc');
  assert.equal(parseBearer('  Bearer   sk_scm_abc  '), 'sk_scm_abc');
});

test('parseBearer — 형식이 다르면 null 이다', () => {
  assert.equal(parseBearer(null), null);
  assert.equal(parseBearer(undefined), null);
  assert.equal(parseBearer(''), null);
  assert.equal(parseBearer('sk_scm_abc'), null, '스킴이 없으면 통과시키지 않는다');
  assert.equal(parseBearer('bearer sk_scm_abc'), null, '소문자 스킴은 받지 않는다');
  assert.equal(parseBearer('Basic sk_scm_abc'), null);
  assert.equal(parseBearer('Bearer'), null);
  assert.equal(parseBearer('Bearer '), null);
  assert.equal(parseBearer('Bearer a b'), null, '토큰에 공백이 있으면 거부');
});

test('hashKey — sha256 hex 64자이며 재현 가능하다', () => {
  const hash = hashKey('sk_scm_TESTPLAINTEXT');
  assert.equal(hash.length, 64);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, createHash('sha256').update('sk_scm_TESTPLAINTEXT', 'utf8').digest('hex'));
  assert.equal(hash, hashKey('sk_scm_TESTPLAINTEXT'));
  assert.notEqual(hash, hashKey('sk_scm_TESTPLAINTEXU'));
});

test('hashKey — 원문이 해시에 남지 않는다', () => {
  const plaintext = 'sk_scm_SECRETVALUE';
  assert.ok(!hashKey(plaintext).includes(plaintext));
  assert.ok(!hashKey(plaintext).includes('SECRET'));
});

test('keyPrefix — 앞 8자만 남는다', () => {
  assert.equal(keyPrefix('sk_scm_ABCDEFGHIJK'), 'sk_scm_A');
  assert.equal(keyPrefix('sk_scm_ABCDEFGHIJK').length, 8);
});

test('hasScope — 가진 권한만 통과한다', () => {
  const key = identity(['demand:write', 'forecast:read']);
  assert.equal(hasScope(key, 'demand:write'), true);
  assert.equal(hasScope(key, 'forecast:read'), true);
  assert.equal(hasScope(key, 'inventory:write'), false);
  assert.equal(hasScope(key, 'alert:read'), false);
});

test('hasScope — 없는 값 · 빈 배열 · 잘못된 모양은 전부 거부한다', () => {
  assert.equal(hasScope(null, 'demand:write'), false);
  assert.equal(hasScope(undefined, 'demand:write'), false);
  assert.equal(hasScope(identity([]), 'demand:write'), false);
  // scope 가 배열이 아닌 값으로 왔을 때 (DB 가 null 을 줄 수 있습니다)
  const broken = { keyId: 'k', integrationName: 'x', scope: null, keyHash: 'h' } as unknown as ApiIdentity;
  assert.equal(hasScope(broken, 'demand:write'), false);
});

test('isApiScope — renew.prd 9.3 의 6종만 인정한다', () => {
  assert.equal(API_SCOPES.length, 6);
  for (const scope of API_SCOPES) assert.equal(isApiScope(scope), true);
  assert.equal(isApiScope('admin'), false);
  assert.equal(isApiScope('demand:read'), false);
  assert.equal(isApiScope(''), false);
});

test('readPaging — 기본 100 · 최대 1000', () => {
  assert.deepEqual(readPaging(new URLSearchParams('')), { limit: 100, offset: 0 });
  assert.deepEqual(readPaging(new URLSearchParams('limit=25&offset=50')), { limit: 25, offset: 50 });
  assert.deepEqual(readPaging(new URLSearchParams('limit=99999')), { limit: 1000, offset: 0 });
  assert.deepEqual(readPaging(new URLSearchParams('limit=0')), { limit: 100, offset: 0 });
  assert.deepEqual(readPaging(new URLSearchParams('limit=abc&offset=-5')), { limit: 100, offset: 0 });
});

test('page — 잘라내기만 한다', () => {
  const rows = [1, 2, 3, 4, 5];
  assert.deepEqual(page(rows, 2, 0), { total: 5, limit: 2, offset: 0, data: [1, 2] });
  assert.deepEqual(page(rows, 2, 3), { total: 5, limit: 2, offset: 3, data: [4, 5] });
  assert.deepEqual(page(rows, 2, 99), { total: 5, limit: 2, offset: 99, data: [] });
});
