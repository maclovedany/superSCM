import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// supabase/functions/notify/index.ts는 Deno 런타임 전용(Deno.serve, jsr: import)이라
// `npm test`(node --test)로 직접 import해서 실행할 수 없습니다. 이 파일은 그 소스를 문자열로
// 읽어 app/api/cron/notifications/route.ts와 같은 계약을 지키는지 확인합니다 — 기존
// lib/notifications/cron.test.ts가 SQL 마이그레이션을 같은 방식으로 검증하는 것과 동일한 접근입니다.
// 실제 Deno 런타임 동작(HTTP 요청·환경변수 읽기)은 배포 후 수동 검증이 필요합니다
// (cron-edge-report.md 참고).

function readEdgeFunctionSource(): string {
  return readFileSync(new URL('../../supabase/functions/notify/index.ts', import.meta.url), 'utf8');
}

test('Edge Function은 route.ts와 같은 인증 계약(Bearer 또는 x-cron-secret, 빈 비밀값 거부)을 포함한다', () => {
  const source = readEdgeFunctionSource();
  assert.match(source, /function isAuthorizedRequest/);
  assert.match(source, /expectedSecret\.trim\(\)\s*===\s*''/);
  assert.match(source, /startsWith\('Bearer '\)/);
  assert.match(source, /headers\.get\('x-cron-secret'\)/);
  assert.match(source, /Deno\.env\.get\('CRON_SECRET'\)/);
});

test('Edge Function은 npm 의존성 없이 fetch와 jsr: supabase-js만 사용한다', () => {
  const source = readEdgeFunctionSource();
  assert.match(source, /from 'jsr:@supabase\/supabase-js@2'/);
  assert.doesNotMatch(source, /from 'npm:/);
  assert.doesNotMatch(source, /from '@supabase\/supabase-js'/);
});

test('Edge Function은 route.ts와 같은 claim → 발송 직전 재검증 → finish 루프를 따른다', () => {
  const source = readEdgeFunctionSource();
  assert.match(source, /p_limit:\s*25/);
  assert.match(source, /claim_due_notifications/);
  assert.match(source, /validate_claimed_notification/);
  assert.match(source, /p_worker_id:\s*workerId/);
  assert.match(source, /p_claim_token:\s*notice\.claimToken/);
  assert.match(source, /finish_notification/);
  assert.match(source, /idempotencyKey:\s*`notification\/\$\{notice\.notificationId\}`/);
});

test('Edge Function은 DB 완료 기록 실패를 성공으로 집계하지 않고 비정상 응답한다', () => {
  const source = readEdgeFunctionSource();
  assert.match(source, /finishErrors\.length\s*>\s*0\s*\?\s*500\s*:\s*200/);
  assert.match(source, /if \(finishError\)[\s\S]{0,200}continue/);
});

test('Edge Function 요약에는 claimed·succeeded·failed·skipped가 모두 있다', () => {
  const source = readEdgeFunctionSource();
  assert.match(source, /claimed:\s*number/);
  assert.match(source, /succeeded:\s*number/);
  assert.match(source, /failed:\s*number/);
  assert.match(source, /skipped:\s*number/);
});

test('Resend 키 미설정은 EMAIL 채널만 재시도 대상 실패로 남기고 IN_APP은 그대로 성공 처리한다', () => {
  const source = readEdgeFunctionSource();
  assert.match(source, /EMAIL_SENDER_NOT_CONFIGURED/);
  assert.match(
    source,
    /apiKey\.trim\(\)\s*===\s*''\s*\|\|\s*options\.from\.trim\(\)\s*===\s*''[\s\S]{0,80}return\s*\{\s*ok:\s*false,\s*error:\s*'EMAIL_SENDER_NOT_CONFIGURED',\s*retryable:\s*true\s*\}/,
  );
  assert.match(source, /notice\.channel\s*===\s*'EMAIL'[\s\S]{0,600}:\s*\{\s*ok:\s*true,\s*externalMessageId:\s*null\s*\}/);
});

test('RESEND_REPLY_TO가 설정되면 Resend 요청 본문에 reply_to를 싣고, 없으면 필드 자체를 넣지 않는다', () => {
  const source = readEdgeFunctionSource();
  assert.match(source, /Deno\.env\.get\('RESEND_REPLY_TO'\)/);
  assert.match(source, /replyTo:\s*resendReplyTo/);
  assert.match(
    source,
    /options\.replyTo\?\.trim\(\)\s*\?\s*\{\s*reply_to:\s*options\.replyTo\.trim\(\)\s*\}\s*:\s*\{\}/,
  );
});

test('이메일 재시도 판정은 email.ts와 동일하게 409는 일시 잠금만, 그 외 408/425/429/5xx를 재시도 대상으로 본다', () => {
  const source = readEdgeFunctionSource();
  assert.match(source, /concurrent_idempotent_requests/);
  assert.match(source, /resource_locked/);
  assert.match(source, /status === 408 \|\| status === 425 \|\| status === 429 \|\| status >= 500/);
});
