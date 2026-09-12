// Task 14 · pg_cron/pg_net에서 10분마다 호출하는 알림 발송 Edge Function.
//
// app/api/cron/notifications/route.ts(lib/notifications/{email,types,cron}.ts)를 그대로 이식했습니다.
// pg_net은 비동기라 호출 결과를 되돌려받을 수 없으므로, claim → 발송 직전 재검증 → 발송 →
// core.finish_notification 통보까지 이 함수 하나가 전체 루프를 책임집니다(controller 결정,
// cron-edge-report.md 참고). Deno 런타임이라 npm 의존성 없이 fetch만 쓰고, DB 호출은 Supabase가
// 공식 가이드에서 권장하는 `jsr:@supabase/supabase-js@2`를 사용해 route.ts와 같은
// `.schema('core').rpc(...)` 호출 형태를 그대로 유지합니다.
//
// 컨트롤러 결정 — Resend 키 미설정: IN_APP 알림은 외부 서비스 없이도 정상 완료되어야 합니다.
// EMAIL 채널은 이 경우 영구 실패로 남기지 않고 'EMAIL_SENDER_NOT_CONFIGURED' 사유로 재시도
// 대상 실패 처리합니다 — 키를 설정하면 다음 재시도(또는 반복 알림의 다음 회차)에서 정상
// 발송됩니다. 반복 템플릿(APPROVAL_PENDING · DEMAND_SUBMISSION_OVERDUE)은 core.finish_notification
// 규칙상 재시도 대신 매 10분 새 알림으로 이어지므로, 이 회차의 실패는 1회 시도로 끝나고 다음
// 회차가 다시 시도합니다. 그 외 단발 템플릿은 core.notification_outbox.max_attempts(기본 5회)까지
// 10분→20분→40분→80분 간격으로 재시도한 뒤 최종 실패로 남습니다(cron-edge-report.md 참고).

import { createClient } from 'jsr:@supabase/supabase-js@2';

const RESEND_URL = 'https://api.resend.com/emails';

type NotificationPayload = Record<string, unknown>;

type ClaimedNotification = {
  notificationId: string;
  claimToken: string;
  templateCode: string;
  recipientUserId: string;
  recipientEmail: string | null;
  channel: 'IN_APP' | 'EMAIL';
  payload: NotificationPayload;
};

type EmailResult =
  | { ok: true; externalMessageId: string | null }
  | { ok: false; error: string; retryable: boolean };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// node:crypto의 timingSafeEqual과 동일한 상수 시간 비교를 Deno 런타임 의존 없이 구현합니다.
function safeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < leftBytes.length; i += 1) diff |= leftBytes[i] ^ rightBytes[i];
  return diff === 0;
}

// lib/notifications/cron.ts의 isAuthorizedCronRequest와 동일한 계약입니다.
export function isAuthorizedRequest(headers: Headers, expectedSecret: string): boolean {
  if (expectedSecret.trim() === '') return false;
  const authorization = headers.get('authorization');
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  const dedicatedHeader = headers.get('x-cron-secret') ?? '';
  return safeEqual(bearer, expectedSecret) || safeEqual(dedicatedHeader, expectedSecret);
}

function nullableString(input: unknown): string | null {
  return input === null || input === undefined || input === '' ? null : String(input);
}

function objectValue(input: unknown): NotificationPayload {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? (input as NotificationPayload)
    : {};
}

// lib/notifications/types.ts의 normalizeClaimedNotification과 동일한 필드 계약입니다.
export function normalizeClaimedNotification(row: Record<string, unknown>): ClaimedNotification {
  return {
    notificationId: String(row.notification_id ?? ''),
    claimToken: String(row.claim_token ?? ''),
    templateCode: String(row.template_code ?? ''),
    recipientUserId: String(row.recipient_user_id ?? ''),
    recipientEmail: nullableString(row.recipient_email),
    channel: row.channel === 'EMAIL' ? 'EMAIL' : 'IN_APP',
    payload: objectValue(row.payload),
  };
}

function payloadText(payload: NotificationPayload, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

// lib/notifications/email.ts의 renderNotificationEmail과 동일합니다.
export function renderNotificationEmail(templateCode: string, payload: NotificationPayload): { subject: string; text: string } {
  const title = payloadText(payload, 'title') ?? `SCM 알림 · ${templateCode}`;
  const message = payloadText(payload, 'message') ?? 'SCM 시스템에서 확인이 필요한 알림이 도착했습니다.';
  const targetId = payloadText(payload, 'target_id');
  return {
    subject: title,
    text: targetId ? `${message}\n\n대상: ${targetId}` : message,
  };
}

function errorCode(body: Record<string, unknown>): string | null {
  const value = body.name ?? body.code;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function isRetryableResponse(status: number, body: Record<string, unknown>): boolean {
  if (status === 409) {
    return ['concurrent_idempotent_requests', 'resource_locked'].includes(errorCode(body) ?? '');
  }
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

// lib/notifications/email.ts의 sendEmail 이식본. 유일한 차이는 설정 누락 처리입니다 —
// 원본 라우트(Vercel)는 설정 누락을 영구 실패로 보지만, 이 Edge Function은 컨트롤러 결정에 따라
// EMAIL_SENDER_NOT_CONFIGURED로 재시도 대상 실패를 반환합니다(Resend 없이도 배포 가능해야 함).
export async function sendEmail(
  message: { to: string; subject: string; text: string },
  options: { apiKey: string; from: string; idempotencyKey: string; fetchImpl?: typeof fetch },
): Promise<EmailResult> {
  if (message.to.trim() === '') return { ok: false, error: '이메일 수신자가 없습니다.', retryable: false };
  if (options.apiKey.trim() === '' || options.from.trim() === '') {
    return { ok: false, error: 'EMAIL_SENDER_NOT_CONFIGURED', retryable: true };
  }

  try {
    const response = await (options.fetchImpl ?? fetch)(RESEND_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': options.idempotencyKey,
      },
      body: JSON.stringify({
        from: options.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return {
        ok: false,
        error: typeof body.message === 'string' && body.message.trim() !== ''
          ? body.message
          : `이메일 발송에 실패했습니다. (${response.status})`,
        retryable: isRetryableResponse(response.status, body),
      };
    }
    return {
      ok: true,
      externalMessageId: typeof body.id === 'string' && body.id !== '' ? body.id : null,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '이메일 발송 중 오류가 발생했습니다.',
      retryable: true,
    };
  }
}

export type NotifySummary = {
  claimed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  finishErrors: string[];
};

// lib/notifications/cron.ts에는 없던 skipped(발송 직전 재검증에서 취소된 건)를 요약에 추가합니다.
export function summarize(claimed: number, succeeded: number, failed: number, skipped: number, finishErrors: string[]): NotifySummary {
  return { claimed, succeeded, failed, skipped, finishErrors };
}

Deno.serve(async (req: Request) => {
  const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
  if (!isAuthorizedRequest(req.headers, cronSecret)) {
    return json({ error: '허용되지 않은 요청입니다.' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: '서버용 Supabase URL과 service role key가 필요합니다.' }, 500);
  }
  const resendApiKey = Deno.env.get('RESEND_API_KEY') ?? '';
  const resendFrom = Deno.env.get('RESEND_FROM_EMAIL') ?? '';

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  try {
    const workerId = crypto.randomUUID();
    const { data, error } = await supabase.schema('core').rpc('claim_due_notifications', {
      p_limit: 25,
      p_worker_id: workerId,
    });
    if (error) return json({ error: error.message }, 500);

    const claimedRows: Record<string, unknown>[] = data ?? [];
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    const finishErrors: string[] = [];

    for (const raw of claimedRows) {
      const notice = normalizeClaimedNotification(raw);

      const { data: isValid, error: validationError } = await supabase.schema('core').rpc('validate_claimed_notification', {
        p_notification_id: notice.notificationId,
        p_worker_id: workerId,
        p_claim_token: notice.claimToken,
      });
      if (validationError) {
        finishErrors.push(`${notice.notificationId}: 발송 직전 검증 실패: ${validationError.message}`);
        continue;
      }
      if (!isValid) {
        skipped += 1;
        continue;
      }

      const result: EmailResult = notice.channel === 'EMAIL'
        ? await sendEmail(
          { to: notice.recipientEmail ?? '', ...renderNotificationEmail(notice.templateCode, notice.payload) },
          {
            apiKey: resendApiKey,
            from: resendFrom,
            idempotencyKey: `notification/${notice.notificationId}`,
          },
        )
        : { ok: true, externalMessageId: null };

      const { error: finishError } = await supabase.schema('core').rpc('finish_notification', {
        p_notification_id: notice.notificationId,
        p_worker_id: workerId,
        p_claim_token: notice.claimToken,
        p_success: result.ok,
        p_retryable: result.ok ? false : result.retryable,
        p_error_message: result.ok ? null : result.error,
        p_external_message_id: result.ok ? result.externalMessageId : null,
      });
      if (finishError) {
        finishErrors.push(`${notice.notificationId}: ${finishError.message}`);
        continue;
      }
      if (result.ok) succeeded += 1;
      else failed += 1;
    }

    const summary = summarize(claimedRows.length, succeeded, failed, skipped, finishErrors);
    return json(summary, finishErrors.length > 0 ? 500 : 200);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '알림 처리 중 오류가 발생했습니다.' }, 500);
  }
});
