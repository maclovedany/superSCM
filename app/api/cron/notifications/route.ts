import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/notifications/cron';
import { renderNotificationEmail, sendEmail } from '@/lib/notifications/email';
import { normalizeClaimedNotification } from '@/lib/notifications/types';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers, process.env.CRON_SECRET ?? '')) {
    return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 401 });
  }
  try {
    const supabase = createSupabaseAdminClient();
    const workerId = crypto.randomUUID();
    const { data, error } = await supabase.schema('core').rpc('claim_due_notifications', {
      p_limit: 25,
      p_worker_id: workerId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    let succeeded = 0;
    let failed = 0;
    const finishErrors: string[] = [];
    for (const raw of data ?? []) {
      const notice = normalizeClaimedNotification(raw as Record<string, unknown>);
      const { data: isValid, error: validationError } = await supabase.schema('core').rpc('validate_claimed_notification', {
        p_notification_id: notice.notificationId,
        p_worker_id: workerId,
        p_claim_token: notice.claimToken,
      });
      if (validationError) {
        finishErrors.push(`${notice.notificationId}: 발송 직전 검증 실패: ${validationError.message}`);
        continue;
      }
      if (!isValid) continue;

      const result = notice.channel === 'EMAIL'
        ? await sendEmail(
          { to: notice.recipientEmail ?? '', ...renderNotificationEmail(notice.templateCode, notice.payload) },
          {
            apiKey: process.env.RESEND_API_KEY ?? '',
            from: process.env.RESEND_FROM_EMAIL ?? '',
            replyTo: process.env.RESEND_REPLY_TO,
            idempotencyKey: `notification/${notice.notificationId}`,
          },
        )
        : { ok: true as const, externalMessageId: null };
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
    const response = { claimed: (data ?? []).length, succeeded, failed, finishErrors };
    if (finishErrors.length > 0) return NextResponse.json(response, { status: 500 });
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '알림 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
