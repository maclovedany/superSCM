import test from 'node:test';
import assert from 'node:assert/strict';
import { kstDate, kstMinute, kstStamp } from './time.ts';

test('UTC ISO 문자열을 한국 시간으로 (UTC 10:12 = KST 19:12)', () => {
  assert.equal(kstMinute('2026-09-05T10:12:33+00:00'), '2026-09-05 19:12');
  assert.equal(kstStamp('2026-09-05T10:12:33Z'), '2026-09-05 19:12:33');
  assert.equal(kstDate('2026-09-05T16:30:00Z'), '2026-09-06'); // 자정을 넘어갑니다
});

test('빈 값 · 이상한 값은 null', () => {
  assert.equal(kstMinute(null), null);
  assert.equal(kstMinute(''), null);
  assert.equal(kstMinute('not a date'), null);
});
