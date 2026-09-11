import assert from 'node:assert/strict';
import test from 'node:test';

import { isAuthorizedCronRequest } from './cron.ts';

test('Cron은 정확한 Bearer 비밀값 또는 전용 헤더만 허용한다', () => {
  const secret = 'cron-secret-value';
  assert.equal(isAuthorizedCronRequest(new Headers({ authorization: `Bearer ${secret}` }), secret), true);
  assert.equal(isAuthorizedCronRequest(new Headers({ 'x-cron-secret': secret }), secret), true);
  assert.equal(isAuthorizedCronRequest(new Headers({ authorization: 'Bearer wrong' }), secret), false);
  assert.equal(isAuthorizedCronRequest(new Headers(), secret), false);
});

test('서버 비밀값이 비어 있으면 어떤 요청도 허용하지 않는다', () => {
  assert.equal(isAuthorizedCronRequest(new Headers({ authorization: 'Bearer ' }), ''), false);
});
