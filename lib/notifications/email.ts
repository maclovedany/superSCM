import type { NotificationPayload } from './types';

export type EmailMessage = { to: string; subject: string; text: string };
export type EmailResult =
  | { ok: true; externalMessageId: string | null }
  | { ok: false; error: string; retryable: boolean };

export type EmailOptions = {
  apiKey: string;
  from: string;
  idempotencyKey?: string;
  fetchImpl?: typeof fetch;
};

function errorCode(body: Record<string, unknown>): string | null {
  const value = body.name ?? body.code;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function isRetryableResponse(status: number, body: Record<string, unknown>): boolean {
  if (status === 409) return errorCode(body) === 'concurrent_idempotent_requests';
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function payloadText(payload: NotificationPayload, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function renderNotificationEmail(templateCode: string, payload: NotificationPayload): Omit<EmailMessage, 'to'> {
  const title = payloadText(payload, 'title') ?? `SCM 알림 · ${templateCode}`;
  const message = payloadText(payload, 'message') ?? 'SCM 시스템에서 확인이 필요한 알림이 도착했습니다.';
  const targetId = payloadText(payload, 'target_id');
  return {
    subject: title,
    text: targetId ? `${message}\n\n대상: ${targetId}` : message,
  };
}

export async function sendEmail(message: EmailMessage, options: EmailOptions): Promise<EmailResult> {
  if (message.to.trim() === '') return { ok: false, error: '이메일 수신자가 없습니다.', retryable: false };
  if (options.apiKey.trim() === '' || options.from.trim() === '') {
    return { ok: false, error: '이메일 발송 환경변수가 설정되지 않았습니다.', retryable: false };
  }

  try {
    const response = await (options.fetchImpl ?? fetch)('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
        ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: options.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
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
