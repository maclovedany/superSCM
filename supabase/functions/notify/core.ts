// Task 14 · Edge Function 순수 로직 (Deno API 미사용)
//
// fix round 1 · I6 — 이전에는 이 로직이 전부 index.ts 안에 있어서, 자동 테스트가 소스를
// 문자열로 읽어 정규식으로만 확인했습니다(순서를 뒤집거나 인자를 빠뜨려도 정규식은 그대로
// 통과할 수 있었습니다). 이 파일은 Deno.serve · Deno.env 같은 Deno 전용 API를 전혀 쓰지
// 않는 순수 함수만 모아 두어, index.ts(Deno)와 이 저장소의 Node 테스트
// (lib/notifications/edge-notify.test.ts, node --test) 양쪽에서 그대로 import해 **실제로
// 실행**하는 방식으로 검증합니다.

export const RESEND_URL = 'https://api.resend.com/emails';

export type NotificationPayload = Record<string, unknown>;

export type ClaimedNotification = {
  notificationId: string;
  claimToken: string;
  templateCode: string;
  recipientUserId: string;
  recipientEmail: string | null;
  channel: 'IN_APP' | 'EMAIL';
  payload: NotificationPayload;
};

export type EmailResult =
  | { ok: true; externalMessageId: string | null }
  | { ok: false; error: string; retryable: boolean };

export type NotifySummary = {
  claimed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  finishErrors: string[];
};

// node:crypto의 timingSafeEqual과 동일한 상수 시간 비교를 Deno/Node 양쪽에서 쓸 수 있게
// 런타임 의존 없이 구현합니다.
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
// fix round 1 · M1 — 오류 문구를 email.ts와 같은 한국어 설명으로 통일하고, 접두어로만
// 코드를 구분합니다(관리자 화면·로그에서 원인을 바로 읽을 수 있도록).
export async function sendEmail(
  message: { to: string; subject: string; text: string },
  options: { apiKey: string; from: string; replyTo?: string; idempotencyKey: string; fetchImpl?: typeof fetch },
): Promise<EmailResult> {
  if (message.to.trim() === '') return { ok: false, error: '이메일 수신자가 없습니다.', retryable: false };
  if (options.apiKey.trim() === '' || options.from.trim() === '') {
    return {
      ok: false,
      error: 'EMAIL_SENDER_NOT_CONFIGURED: 이메일 발송 환경변수가 설정되지 않았습니다.',
      retryable: true,
    };
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
        ...(options.replyTo?.trim() ? { reply_to: options.replyTo.trim() } : {}),
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

// lib/notifications/cron.ts에는 없던 skipped(발송 직전 재검증에서 취소된 건)를 요약에 추가합니다.
export function summarize(claimed: number, succeeded: number, failed: number, skipped: number, finishErrors: string[]): NotifySummary {
  return { claimed, succeeded, failed, skipped, finishErrors };
}

// fix round 1 · I6 — claim 이후 "발송 직전 재검증 → 발송 → finish" 순서, p_retryable 매핑,
// p_external_message_id 전달, skipped/failed 구분은 전부 index.ts의 Deno.serve 핸들러 안에만
// 있었습니다. Deno 전용 코드라 Node 테스트가 실제로 실행해 볼 수 없었고, 정규식 문자열 검사만
// 가능해서 순서를 뒤집거나 인자를 빠뜨려도 테스트가 통과했습니다. 이 함수는 그 루프를 DB
// 호출(rpc)만 주입받는 형태로 분리한 것입니다 — Deno API가 전혀 없으므로 Node 테스트가 가짜
// rpc·sendEmail로 실제 호출해 순서·매핑·집계를 검증할 수 있습니다. index.ts는 이 함수에
// supabase-js RPC 호출을 얇게 이어 붙이기만 합니다.

export type ValidateClaimedNotificationResult = { isValid: boolean | null; error: string | null };

export type FinishNotificationParams = {
  notificationId: string;
  workerId: string;
  claimToken: string;
  success: boolean;
  retryable: boolean;
  errorMessage: string | null;
  externalMessageId: string | null;
};

export type NotifyRpc = {
  validateClaimedNotification: (params: {
    notificationId: string;
    workerId: string;
    claimToken: string;
  }) => Promise<ValidateClaimedNotificationResult>;
  finishNotification: (params: FinishNotificationParams) => Promise<{ error: string | null }>;
};

export type EmailConfig = { apiKey: string; from: string; replyTo?: string };

export async function processClaimedNotifications(
  claimedRows: Record<string, unknown>[],
  workerId: string,
  rpc: NotifyRpc,
  emailConfig: EmailConfig,
  sendEmailFn: typeof sendEmail = sendEmail,
): Promise<NotifySummary> {
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const finishErrors: string[] = [];

  for (const raw of claimedRows) {
    const notice = normalizeClaimedNotification(raw);

    // 발송 직전 재검증은 반드시 이메일 전송보다 먼저 일어나야 합니다 — 순서가 바뀌면 이미
    // 취소된 알림(승인 처리 완료 등)에 이메일이 나갈 수 있습니다.
    const { isValid, error: validationError } = await rpc.validateClaimedNotification({
      notificationId: notice.notificationId,
      workerId,
      claimToken: notice.claimToken,
    });
    if (validationError) {
      finishErrors.push(`${notice.notificationId}: 발송 직전 검증 실패: ${validationError}`);
      continue;
    }
    if (!isValid) {
      skipped += 1;
      continue;
    }

    const result: EmailResult = notice.channel === 'EMAIL'
      ? await sendEmailFn(
        { to: notice.recipientEmail ?? '', ...renderNotificationEmail(notice.templateCode, notice.payload) },
        {
          apiKey: emailConfig.apiKey,
          from: emailConfig.from,
          replyTo: emailConfig.replyTo,
          idempotencyKey: `notification/${notice.notificationId}`,
        },
      )
      : { ok: true, externalMessageId: null };

    const { error: finishError } = await rpc.finishNotification({
      notificationId: notice.notificationId,
      workerId,
      claimToken: notice.claimToken,
      success: result.ok,
      retryable: result.ok ? false : result.retryable,
      errorMessage: result.ok ? null : result.error,
      externalMessageId: result.ok ? result.externalMessageId : null,
    });
    if (finishError) {
      finishErrors.push(`${notice.notificationId}: ${finishError}`);
      continue;
    }
    if (result.ok) succeeded += 1;
    else failed += 1;
  }

  return summarize(claimedRows.length, succeeded, failed, skipped, finishErrors);
}
