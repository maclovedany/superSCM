import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { renderNotificationEmail, sendEmail } from './email.ts';
import { normalizeDeliveryRow, normalizeNotificationRow } from './types.ts';

test('알림 payload를 제목과 본문이 있는 이메일로 만든다', () => {
  assert.deepEqual(
    renderNotificationEmail('APPROVAL_PENDING', {
      title: '승인 요청이 대기 중입니다',
      message: '최종 발주계획 승인이 필요합니다.',
      target_id: 'PLAN-2026-09',
    }),
    {
      subject: '승인 요청이 대기 중입니다',
      text: '최종 발주계획 승인이 필요합니다.\n\n대상: PLAN-2026-09',
    },
  );
});

test('Resend 성공 응답의 외부 메시지 식별자를 반환한다', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ id: 'email-42' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const result = await sendEmail(
    { to: 'planner@example.com', subject: '승인 알림', text: '확인해 주세요.' },
    {
      apiKey: 'server-secret',
      from: 'SCM <scm@example.com>',
      idempotencyKey: 'notification/notice-42',
      fetchImpl,
    },
  );

  assert.deepEqual(result, { ok: true, externalMessageId: 'email-42' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.resend.com/emails');
  assert.equal(new Headers(requests[0].init.headers).get('authorization'), 'Bearer server-secret');
  assert.equal(new Headers(requests[0].init.headers).get('idempotency-key'), 'notification/notice-42');
  assert.deepEqual(JSON.parse(String(requests[0].init.body)), {
    from: 'SCM <scm@example.com>',
    to: ['planner@example.com'],
    subject: '승인 알림',
    text: '확인해 주세요.',
  });
});

test('Resend 실패는 오류 본문을 보존하며 성공으로 처리하지 않는다', async () => {
  const result = await sendEmail(
    { to: 'planner@example.com', subject: '승인 알림', text: '확인해 주세요.' },
    {
      apiKey: 'server-secret',
      from: 'SCM <scm@example.com>',
      fetchImpl: async () => new Response(JSON.stringify({ message: '수신 주소가 올바르지 않습니다.' }), { status: 422 }),
    },
  );

  assert.deepEqual(result, { ok: false, error: '수신 주소가 올바르지 않습니다.', retryable: false });
});

test('Resend 일시 장애는 재시도 가능 실패로 구분한다', async () => {
  const result = await sendEmail(
    { to: 'planner@example.com', subject: '승인 알림', text: '확인해 주세요.' },
    {
      apiKey: 'server-secret',
      from: 'SCM <scm@example.com>',
      idempotencyKey: 'notification/notice-503',
      fetchImpl: async () => new Response(JSON.stringify({ message: '잠시 사용할 수 없습니다.' }), { status: 503 }),
    },
  );

  assert.deepEqual(result, { ok: false, error: '잠시 사용할 수 없습니다.', retryable: true });
});

test('Resend 409는 동시 중복 요청만 재시도하고 잘못된 중복 키 요청은 종료한다', async () => {
  const options = {
    apiKey: 'server-secret',
    from: 'SCM <scm@example.com>',
    idempotencyKey: 'notification/notice-409',
  };
  const message = { to: 'planner@example.com', subject: '승인 알림', text: '확인해 주세요.' };

  const concurrent = await sendEmail(message, {
    ...options,
    fetchImpl: async () => new Response(JSON.stringify({
      name: 'concurrent_idempotent_requests',
      message: '같은 요청이 처리 중입니다.',
    }), { status: 409 }),
  });
  assert.deepEqual(concurrent, { ok: false, error: '같은 요청이 처리 중입니다.', retryable: true });

  const invalid = await sendEmail(message, {
    ...options,
    fetchImpl: async () => new Response(JSON.stringify({
      name: 'invalid_idempotent_request',
      message: '같은 키에 다른 요청 본문을 사용할 수 없습니다.',
    }), { status: 409 }),
  });
  assert.deepEqual(invalid, {
    ok: false,
    error: '같은 키에 다른 요청 본문을 사용할 수 없습니다.',
    retryable: false,
  });
});

test('서버 이메일 설정이나 수신자가 없으면 외부 요청 없이 실패한다', async () => {
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    return new Response('{}');
  };

  assert.deepEqual(
    await sendEmail({ to: '', subject: '알림', text: '본문' }, { apiKey: 'key', from: 'from@example.com', fetchImpl }),
    { ok: false, error: '이메일 수신자가 없습니다.', retryable: false },
  );
  assert.deepEqual(
    await sendEmail({ to: 'to@example.com', subject: '알림', text: '본문' }, { apiKey: '', from: '', fetchImpl }),
    { ok: false, error: '이메일 발송 환경변수가 설정되지 않았습니다.', retryable: false },
  );
  assert.equal(called, false);
});

test('analytics 알림 행은 읽지 않은 상태와 payload를 보존한다', () => {
  assert.deepEqual(normalizeNotificationRow({
    notification_id: 'notice-1',
    template_code: 'APPROVAL_PENDING',
    title: '승인 대기',
    message: '승인이 필요합니다.',
    payload: { approval_id: 'approval-1' },
    created_at: '2026-09-11T00:00:00Z',
    read_at: null,
  }), {
    notificationId: 'notice-1',
    templateCode: 'APPROVAL_PENDING',
    title: '승인 대기',
    message: '승인이 필요합니다.',
    payload: { approval_id: 'approval-1' },
    createdAt: '2026-09-11T00:00:00Z',
    readAt: null,
    isRead: false,
  });
});

test('관리자 발송 이력은 재시도 가능 여부와 시도 번호를 보존한다', () => {
  const row = normalizeDeliveryRow({
    delivery_id: 7,
    notification_id: 'notice-7',
    template_code: 'APPROVAL_PENDING',
    recipient_email: 'planner@example.com',
    recipient_name: '담당자',
    channel: 'EMAIL',
    status: 'FAILED',
    attempt_number: 2,
    retryable: true,
    attempted_at: '2026-09-11T00:00:00Z',
    error_message: '일시 장애',
    external_message_id: null,
  });

  assert.equal(row.attemptNumber, 2);
  assert.equal(row.retryable, true);
});

test('알림 SQL 계약은 중복 방지, 원자적 claim, 채널별 이력과 승인 후속 취소를 포함한다', () => {
  const sql = readFileSync(
    new URL('../../supabase/migrations/20260911000400_stage1_approval_notification.sql', import.meta.url),
    'utf8',
  );

  assert.match(sql, /unique\s*\(dedupe_key,\s*recipient_user_id,\s*channel\)/i);
  assert.match(sql, /create(?: or replace)? function core\.claim_due_notifications/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /create(?: or replace)? function core\.finish_notification/i);
  assert.match(sql, /create table if not exists core\.notification_delivery/i);
  assert.match(sql, /create table if not exists core\.user_notification/i);
  assert.match(sql, /interval '10 minutes'/i);
  assert.match(sql, /status\s*=\s*'CANCELLED'[\s\S]+approval_id/i);
  assert.match(sql, /create or replace function core\.schedule_demand_submission_reminder/i);
  assert.match(sql, /template_code\s*=\s*'DEMAND_SUBMISSION_OVERDUE'/i);
  assert.match(sql, /create or replace function core\.cancel_notification_series/i);
  assert.match(sql, /security_invoker\s*=\s*true/i);
  assert.match(sql, /create policy notification_outbox_read_own[\s\S]{0,180}using\s*\(\s*recipient_user_id\s*=\s*auth\.uid\(\)\s+or\s+core\.is_admin\(\)\s*\)/i);
  assert.match(sql, /revoke all on core\.notification_outbox[\s\S]+from anon, public/i);
});

test('알림 SQL 계약은 임대 만료 회수와 claim 소유권 검증을 포함한다', () => {
  const sql = readFileSync(
    new URL('../../supabase/migrations/20260911000400_stage1_approval_notification.sql', import.meta.url),
    'utf8',
  );

  assert.match(sql, /claim_token\s+uuid/i);
  assert.match(sql, /claim_expires_at\s+timestamptz/i);
  assert.match(sql, /max_attempts\s+integer/i);
  assert.match(sql, /status\s*=\s*'PROCESSING'[\s\S]{0,500}claim_expires_at\s*<=\s*clock_timestamp\(\)/i);
  assert.match(sql, /attempt_count\s*<\s*(?:\w+\.)?max_attempts/i);
  assert.match(sql, /p_worker_id\s+uuid[\s\S]{0,180}p_claim_token\s+uuid/i);
  assert.match(sql, /p_worker_id\s+is\s+null[\s\S]{0,100}p_claim_token\s+is\s+null/i);
  assert.match(sql, /claimed_by\s+is\s+distinct\s+from\s+p_worker_id/i);
  assert.match(sql, /claim_token\s+is\s+distinct\s+from\s+p_claim_token/i);
});

test('알림 SQL 계약은 실패 이력을 보존하고 제한 횟수까지 재예약한다', () => {
  const sql = readFileSync(
    new URL('../../supabase/migrations/20260911000400_stage1_approval_notification.sql', import.meta.url),
    'utf8',
  );

  assert.match(sql, /p_retryable\s+boolean/i);
  assert.match(sql, /attempt_number\s+integer/i);
  assert.match(sql, /retryable\s+boolean/i);
  assert.match(sql, /insert into core\.notification_delivery[\s\S]{0,900}case when p_success then 'SUCCESS' else 'FAILED' end/i);
  assert.match(sql, /v_retry_scheduled\s*:=\s*not p_success[\s\S]{0,300}attempt_count\s*<\s*v_notice\.max_attempts/i);
  assert.match(sql, /if\s+v_retry_scheduled\s+then[\s\S]{0,500}status\s*=\s*'PENDING'/i);
  assert.match(sql, /scheduled_at\s*=\s*clock_timestamp\(\)\s*\+/i);
});

test('반복 알림의 다음 10분 회차는 개별 채널 발송 성공 여부와 분리한다', () => {
  const sql = readFileSync(
    new URL('../../supabase/migrations/20260911000400_stage1_approval_notification.sql', import.meta.url),
    'utf8',
  );

  assert.match(sql, /v_is_recurring\s*:=\s*v_notice\.template_code\s+in\s*\(\s*'APPROVAL_PENDING',\s*'DEMAND_SUBMISSION_OVERDUE'\s*\)/i);
  assert.match(sql, /v_retry_scheduled\s*:=\s*not p_success[\s\S]{0,180}not v_is_recurring/i);
  assert.match(sql, /v_notice\.template_code\s*=\s*'APPROVAL_PENDING'[\s\S]{0,700}interval '10 minutes'/i);
  assert.match(sql, /date_bin\(\s*interval '10 minutes',\s*clock_timestamp\(\)/i);
  assert.doesNotMatch(sql, /greatest\(v_notice\.scheduled_at\s*\+\s*interval '10 minutes',\s*clock_timestamp\(\)\s*\+\s*interval '10 minutes'\)/i);
  assert.doesNotMatch(sql, /if\s+p_success\s+and\s+v_notice\.template_code\s*=\s*'APPROVAL_PENDING'/i);
  assert.match(sql, /attempt_count,\s*v_retry_scheduled,/i);
});

test('발송 직전 승인과 취소된 series 상태를 다시 확인하는 DB 계약이 있다', () => {
  const sql = readFileSync(
    new URL('../../supabase/migrations/20260911000400_stage1_approval_notification.sql', import.meta.url),
    'utf8',
  );

  assert.match(sql, /create or replace function core\.validate_claimed_notification/i);
  assert.match(sql, /template_code\s*=\s*'APPROVAL_PENDING'[\s\S]{0,500}r\.status\s*=\s*'PENDING'/i);
  assert.match(sql, /status\s*=\s*'CANCELLED'/i);
});
