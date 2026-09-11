import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('Cron은 제한된 배치를 claim하고 발송 직전 유효성을 재검증한다', () => {
  const route = readFileSync(
    new URL('../../app/api/cron/notifications/route.ts', import.meta.url),
    'utf8',
  );

  assert.match(route, /p_limit:\s*25/);
  assert.match(route, /validate_claimed_notification/);
  assert.match(route, /p_worker_id:\s*workerId/);
  assert.match(route, /p_claim_token:\s*notice\.claimToken/);
});

test('Cron은 DB 완료 기록 실패를 성공으로 집계하지 않고 비정상 응답한다', () => {
  const route = readFileSync(
    new URL('../../app/api/cron/notifications/route.ts', import.meta.url),
    'utf8',
  );

  assert.match(route, /finishErrors\.length\s*>\s*0/);
  assert.match(route, /status:\s*500/);
  assert.match(route, /if \(finishError\)[\s\S]{0,250}continue/);
});
