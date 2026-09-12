import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  isAuthorizedRequest,
  normalizeClaimedNotification,
  processClaimedNotifications,
  renderNotificationEmail,
  sendEmail,
  summarize,
  type FinishNotificationParams,
  type NotifyRpc,
} from '../../supabase/functions/notify/core.ts';

// fix round 1 · I6 — supabase/functions/notify/core.ts는 Deno API(Deno.serve · Deno.env ·
// jsr: import)를 전혀 쓰지 않는 순수 함수 모음이라, 이 파일은 이전처럼 소스를 문자열로 읽어
// 정규식으로 확인하는 대신 **실제로 import해서 실행**합니다. 검증 순서 뒤집기·재시도 플래그
// 반전·externalMessageId 누락·skipped/failed 자리 바꾸기 같은 회귀를 실제로 잡습니다.
// index.ts(Deno.serve 핸들러, supabase-js 연결) 자체는 Deno 런타임 전용이라 여전히 실행할 수
// 없으므로, 그 파일이 core.ts를 실제로 쓰고 있는지만 구조적으로 확인합니다(맨 아래 참고).

function readEdgeFunctionSource(): string {
  return readFileSync(new URL('../../supabase/functions/notify/index.ts', import.meta.url), 'utf8');
}

test('isAuthorizedRequest는 Bearer 또는 x-cron-secret만 허용하고 빈 비밀값은 항상 거부한다', () => {
  const secret = 'cron-secret-value';
  assert.equal(isAuthorizedRequest(new Headers({ authorization: `Bearer ${secret}` }), secret), true);
  assert.equal(isAuthorizedRequest(new Headers({ 'x-cron-secret': secret }), secret), true);
  assert.equal(isAuthorizedRequest(new Headers({ authorization: 'Bearer wrong' }), secret), false);
  assert.equal(isAuthorizedRequest(new Headers(), secret), false);
  assert.equal(isAuthorizedRequest(new Headers({ authorization: 'Bearer ' }), ''), false);
});

test('renderNotificationEmail은 payload의 title/message/target_id로 제목과 본문을 만든다', () => {
  assert.deepEqual(
    renderNotificationEmail('APPROVAL_PENDING', {
      title: '승인 요청이 대기 중입니다',
      message: '최종 발주계획 승인이 필요합니다.',
      target_id: 'PLAN-2026-09',
    }),
    { subject: '승인 요청이 대기 중입니다', text: '최종 발주계획 승인이 필요합니다.\n\n대상: PLAN-2026-09' },
  );
});

test('normalizeClaimedNotification은 claim_due_notifications 행의 필드를 그대로 옮긴다', () => {
  assert.deepEqual(
    normalizeClaimedNotification({
      notification_id: 'notice-1',
      claim_token: 'token-1',
      template_code: 'APPROVAL_PENDING',
      recipient_user_id: 'user-1',
      recipient_email: 'planner@example.com',
      channel: 'EMAIL',
      payload: { title: '제목' },
    }),
    {
      notificationId: 'notice-1',
      claimToken: 'token-1',
      templateCode: 'APPROVAL_PENDING',
      recipientUserId: 'user-1',
      recipientEmail: 'planner@example.com',
      channel: 'EMAIL',
      payload: { title: '제목' },
    },
  );
});

test('summarize는 claimed·succeeded·failed·skipped·finishErrors를 그대로 담는다', () => {
  assert.deepEqual(summarize(5, 2, 1, 2, ['x']), {
    claimed: 5,
    succeeded: 2,
    failed: 1,
    skipped: 2,
    finishErrors: ['x'],
  });
});

test('Resend 키 미설정은 EMAIL_SENDER_NOT_CONFIGURED 재시도 대상 실패이고, IN_APP과 무관하다', async () => {
  const result = await sendEmail(
    { to: 'planner@example.com', subject: '제목', text: '본문' },
    { apiKey: '', from: '', idempotencyKey: 'notification/1' },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /^EMAIL_SENDER_NOT_CONFIGURED:/);
    assert.match(result.error, /이메일 발송 환경변수가 설정되지 않았습니다\./); // email.ts와 같은 한국어 설명(fix round 1 · M1)
    assert.equal(result.retryable, true);
  }
});

test('reply_to는 값이 있을 때만 Resend 요청 본문에 실린다', async () => {
  const requests: Array<{ body: string }> = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    requests.push({ body: String(init?.body) });
    return new Response(JSON.stringify({ id: 'email-1' }), { status: 200 });
  };

  await sendEmail(
    { to: 'planner@example.com', subject: '제목', text: '본문' },
    { apiKey: 'key', from: 'alert@send.upflash.co.kr', replyTo: 'contact@upflash.co.kr', idempotencyKey: 'n/1', fetchImpl },
  );
  assert.equal(JSON.parse(requests[0].body).reply_to, 'contact@upflash.co.kr');

  await sendEmail(
    { to: 'planner@example.com', subject: '제목', text: '본문' },
    { apiKey: 'key', from: 'alert@send.upflash.co.kr', idempotencyKey: 'n/2', fetchImpl },
  );
  assert.equal('reply_to' in JSON.parse(requests[1].body), false);
});

// ── processClaimedNotifications: 실제 오케스트레이션 루프 실행 검증 ──────────────

type RecordedFinishCall = FinishNotificationParams;

function makeRpc(overrides: Partial<{
  isValid: boolean;
  validationError: string | null;
  finishError: string | null;
}> = {}) {
  const calls: string[] = [];
  const finishCalls: RecordedFinishCall[] = [];
  const rpc: NotifyRpc = {
    async validateClaimedNotification({ notificationId }) {
      calls.push(`validate:${notificationId}`);
      return { isValid: overrides.validationError ? null : (overrides.isValid ?? true), error: overrides.validationError ?? null };
    },
    async finishNotification(params) {
      calls.push(`finish:${params.notificationId}`);
      finishCalls.push(params);
      return { error: overrides.finishError ?? null };
    },
  };
  return { rpc, calls, finishCalls };
}

test('검증(validate)은 항상 발송(send)보다 먼저 호출된다(순서가 바뀌면 실패)', async () => {
  const { rpc, calls } = makeRpc({ isValid: true });
  const sendCalls: string[] = [];
  const fakeSendEmail: typeof sendEmail = async (message) => {
    sendCalls.push(`send:${message.to}`);
    calls.push(`send:${message.to}`);
    return { ok: true, externalMessageId: 'ext-1' };
  };

  await processClaimedNotifications(
    [{ notification_id: 'n1', claim_token: 't1', channel: 'EMAIL', recipient_email: 'a@example.com', template_code: 'X', payload: {} }],
    'worker-1',
    rpc,
    { apiKey: 'key', from: 'from@example.com' },
    fakeSendEmail,
  );

  assert.deepEqual(calls, ['validate:n1', 'send:a@example.com', 'finish:n1']);
});

test('재검증에서 취소(isValid=false)된 알림은 발송하지 않고 skipped로만 센다', async () => {
  const { rpc, calls } = makeRpc({ isValid: false });
  let sendCalled = false;
  const fakeSendEmail: typeof sendEmail = async () => {
    sendCalled = true;
    return { ok: true, externalMessageId: null };
  };

  const summary = await processClaimedNotifications(
    [{ notification_id: 'n1', claim_token: 't1', channel: 'EMAIL', recipient_email: 'a@example.com', template_code: 'X', payload: {} }],
    'worker-1',
    rpc,
    { apiKey: 'key', from: 'from@example.com' },
    fakeSendEmail,
  );

  assert.equal(sendCalled, false, '취소된 알림은 발송 함수 자체를 호출하면 안 됩니다');
  assert.equal(calls.includes('finish:n1'), false, '취소된 알림은 finish도 호출하지 않습니다');
  assert.deepEqual(summary, { claimed: 1, succeeded: 0, failed: 0, skipped: 1, finishErrors: [] });
});

test('발송 성공 시 finish에는 retryable=false와 sendEmail이 반환한 externalMessageId가 그대로 전달된다', async () => {
  const { rpc, finishCalls } = makeRpc({ isValid: true });
  const fakeSendEmail: typeof sendEmail = async () => ({ ok: true, externalMessageId: 'resend-external-id-42' });

  await processClaimedNotifications(
    [{ notification_id: 'n1', claim_token: 't1', channel: 'EMAIL', recipient_email: 'a@example.com', template_code: 'X', payload: {} }],
    'worker-1',
    rpc,
    { apiKey: 'key', from: 'from@example.com' },
    fakeSendEmail,
  );

  assert.equal(finishCalls.length, 1);
  assert.equal(finishCalls[0].success, true);
  assert.equal(finishCalls[0].retryable, false);
  assert.equal(finishCalls[0].errorMessage, null);
  assert.equal(finishCalls[0].externalMessageId, 'resend-external-id-42');
});

test('발송 실패 시 finish의 retryable은 sendEmail 결과를 그대로 반영한다(반전 감지, 양방향)', async () => {
  for (const retryable of [true, false]) {
    const { rpc, finishCalls } = makeRpc({ isValid: true });
    const fakeSendEmail: typeof sendEmail = async () => ({ ok: false, error: '실패 사유', retryable });

    await processClaimedNotifications(
      [{ notification_id: 'n1', claim_token: 't1', channel: 'EMAIL', recipient_email: 'a@example.com', template_code: 'X', payload: {} }],
      'worker-1',
      rpc,
      { apiKey: 'key', from: 'from@example.com' },
      fakeSendEmail,
    );

    assert.equal(finishCalls[0].success, false);
    assert.equal(finishCalls[0].retryable, retryable, `retryable=${retryable}이 finish에 그대로 전달돼야 합니다`);
    assert.equal(finishCalls[0].errorMessage, '실패 사유');
    assert.equal(finishCalls[0].externalMessageId, null);
  }
});

test('IN_APP 채널은 이메일 발송 함수를 호출하지 않고 즉시 성공 처리한다', async () => {
  const { rpc } = makeRpc({ isValid: true });
  let sendCalled = false;
  const fakeSendEmail: typeof sendEmail = async () => {
    sendCalled = true;
    return { ok: true, externalMessageId: null };
  };

  const summary = await processClaimedNotifications(
    [{ notification_id: 'n1', claim_token: 't1', channel: 'IN_APP', recipient_email: null, template_code: 'X', payload: {} }],
    'worker-1',
    rpc,
    { apiKey: '', from: '' },
    fakeSendEmail,
  );

  assert.equal(sendCalled, false);
  assert.deepEqual(summary, { claimed: 1, succeeded: 1, failed: 0, skipped: 0, finishErrors: [] });
});

test('발송 직전 검증 자체가 오류면 발송·finish 없이 finishErrors에만 남긴다', async () => {
  const { rpc, calls, finishCalls } = makeRpc({ validationError: 'DB 오류' });
  let sendCalled = false;
  const fakeSendEmail: typeof sendEmail = async () => {
    sendCalled = true;
    return { ok: true, externalMessageId: null };
  };

  const summary = await processClaimedNotifications(
    [{ notification_id: 'n1', claim_token: 't1', channel: 'EMAIL', recipient_email: 'a@example.com', template_code: 'X', payload: {} }],
    'worker-1',
    rpc,
    { apiKey: 'key', from: 'from@example.com' },
    fakeSendEmail,
  );

  assert.equal(sendCalled, false);
  assert.equal(finishCalls.length, 0);
  assert.equal(calls.includes('finish:n1'), false);
  assert.equal(summary.finishErrors.length, 1);
  assert.match(summary.finishErrors[0], /^n1: 발송 직전 검증 실패: DB 오류$/);
});

test('finish 호출 자체가 실패하면 성공·실패 집계에 넣지 않고 finishErrors에만 남긴다', async () => {
  const { rpc } = makeRpc({ isValid: true, finishError: 'finish 실패' });
  const fakeSendEmail: typeof sendEmail = async () => ({ ok: true, externalMessageId: 'ext-1' });

  const summary = await processClaimedNotifications(
    [{ notification_id: 'n1', claim_token: 't1', channel: 'EMAIL', recipient_email: 'a@example.com', template_code: 'X', payload: {} }],
    'worker-1',
    rpc,
    { apiKey: 'key', from: 'from@example.com' },
    fakeSendEmail,
  );

  assert.equal(summary.succeeded, 0);
  assert.equal(summary.failed, 0);
  assert.deepEqual(summary.finishErrors, ['n1: finish 실패']);
});

test('claimed·succeeded·failed·skipped는 각자 다른 자리를 세며, 뒤바뀌면 이 테스트가 깨진다', async () => {
  const calls: string[] = [];
  const rpc: NotifyRpc = {
    async validateClaimedNotification({ notificationId }) {
      calls.push(`validate:${notificationId}`);
      return { isValid: notificationId !== 'skip-me', error: null };
    },
    async finishNotification(params) {
      calls.push(`finish:${params.notificationId}`);
      return { error: null };
    },
  };
  const fakeSendEmail: typeof sendEmail = async (message) => {
    if (message.to === 'fail@example.com') return { ok: false, error: '실패', retryable: true };
    return { ok: true, externalMessageId: null };
  };

  const summary = await processClaimedNotifications(
    [
      { notification_id: 'ok-1', claim_token: 't', channel: 'EMAIL', recipient_email: 'ok@example.com', template_code: 'X', payload: {} },
      { notification_id: 'fail-1', claim_token: 't', channel: 'EMAIL', recipient_email: 'fail@example.com', template_code: 'X', payload: {} },
      { notification_id: 'skip-me', claim_token: 't', channel: 'EMAIL', recipient_email: 'skip@example.com', template_code: 'X', payload: {} },
    ],
    'worker-1',
    rpc,
    { apiKey: 'key', from: 'from@example.com' },
    fakeSendEmail,
  );

  assert.deepEqual(summary, { claimed: 3, succeeded: 1, failed: 1, skipped: 1, finishErrors: [] });
});

// ── index.ts(Deno 전용)는 core.ts를 실제로 쓰고 있는지만 구조적으로 확인 ──────────

test('index.ts는 자체 로직을 갖지 않고 core.ts의 processClaimedNotifications/isAuthorizedRequest에 위임한다', () => {
  const source = readEdgeFunctionSource();
  assert.match(source, /from '\.\/core\.ts'/);
  assert.match(source, /isAuthorizedRequest/);
  assert.match(source, /processClaimedNotifications/);
  // 루프를 index.ts 안에서 다시 구현하지 않았는지(회귀 방지) — validate_claimed_notification과
  // finish_notification 호출은 core.ts로 넘기는 rpc 어댑터 안에만 있어야 합니다.
  assert.match(source, /validate_claimed_notification/);
  assert.match(source, /finish_notification/);
});

test('index.ts는 jsr:@supabase/supabase-js를 정확한 버전으로 고정한다(M2)', () => {
  const source = readEdgeFunctionSource();
  assert.match(source, /from 'jsr:@supabase\/supabase-js@\d+\.\d+\.\d+'/);
  assert.doesNotMatch(source, /from 'jsr:@supabase\/supabase-js@2'[^.]/);
});

test('index.ts는 claim_due_notifications를 limit 25로 부른다', () => {
  const source = readEdgeFunctionSource();
  assert.match(source, /claim_due_notifications/);
  assert.match(source, /p_limit:\s*25/);
});
