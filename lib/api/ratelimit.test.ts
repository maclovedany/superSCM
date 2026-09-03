// 호출 제한 — renew.prd 9.2

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRateLimit, LIMIT_PER_IP, LIMIT_PER_KEY, resetRateLimits } from './ratelimit.ts';

test('분당 한도 안에서는 통과한다', () => {
  resetRateLimits();
  const now = 1_000_000;

  for (let i = 0; i < 60; i += 1) {
    const result = checkRateLimit('key_a', now + i);
    assert.equal(result.allowed, true, `${i + 1}번째 호출`);
    assert.equal(result.remaining, 59 - i);
  }
});

test('한도를 넘으면 429 와 Retry-After 를 준다', () => {
  resetRateLimits();
  const now = 2_000_000;

  for (let i = 0; i < 60; i += 1) checkRateLimit('key_b', now);

  const over = checkRateLimit('key_b', now);
  assert.equal(over.allowed, false);
  assert.equal(over.remaining, 0);
  assert.ok(over.retryAfterSeconds >= 1 && over.retryAfterSeconds <= 60);
});

test('창이 지나면 다시 열린다', () => {
  resetRateLimits();
  const now = 3_000_000;

  for (let i = 0; i < 61; i += 1) checkRateLimit('key_c', now);
  assert.equal(checkRateLimit('key_c', now).allowed, false);

  const later = checkRateLimit('key_c', now + 60_001);
  assert.equal(later.allowed, true);
  assert.equal(later.remaining, 59);
});

test('키마다 따로 센다', () => {
  resetRateLimits();
  const now = 4_000_000;

  for (let i = 0; i < 61; i += 1) checkRateLimit('key_d', now);
  assert.equal(checkRateLimit('key_d', now).allowed, false);
  assert.equal(checkRateLimit('key_e', now).allowed, true, '다른 키는 영향을 받지 않는다');
});

test('IP 겹이 키 겹보다 넉넉하다 — 정상 트래픽이 인증 전에 걸리면 안 됩니다', () => {
  assert.ok(LIMIT_PER_IP > LIMIT_PER_KEY);
});

test('상한을 인자로 받아 겹마다 다르게 셀 수 있다', () => {
  resetRateLimits();
  const now = 5_000_000;

  for (let i = 0; i < LIMIT_PER_IP; i += 1) {
    assert.equal(checkRateLimit('ip:1.2.3.4', now, LIMIT_PER_IP).allowed, true, `${i + 1}번째`);
  }
  assert.equal(checkRateLimit('ip:1.2.3.4', now, LIMIT_PER_IP).allowed, false);

  // 같은 창에서 키 통은 아직 열려 있습니다 — 통이 다릅니다
  assert.equal(checkRateLimit('key:key_a', now, LIMIT_PER_KEY).allowed, true);
});
