// Task 14 · pg_cron/pg_net에서 10분마다 호출하는 알림 발송 Edge Function.
//
// app/api/cron/notifications/route.ts(lib/notifications/{email,types,cron}.ts)를 그대로 이식했습니다.
// pg_net은 비동기라 호출 결과를 되돌려받을 수 없으므로, claim → 발송 직전 재검증 → 발송 →
// core.finish_notification 통보까지 이 함수 하나가 전체 루프를 책임집니다(controller 결정,
// cron-edge-report.md 참고). Deno 런타임이라 npm 의존성 없이 fetch만 쓰고, DB 호출은 Supabase가
// 공식 가이드에서 권장하는 `jsr:@supabase/supabase-js`(버전 고정, 아래 M2 참고)를 사용해
// route.ts와 같은 `.schema('core').rpc(...)` 호출 형태를 그대로 유지합니다.
//
// 이 파일은 Deno.serve/Deno.env 같은 Deno 전용 부분만 담당합니다. 인증·이메일 발송·정규화
// 같은 순수 로직은 ./core.ts에 있습니다 — Deno API를 쓰지 않아 이 저장소의 Node 테스트
// (lib/notifications/edge-notify.test.ts)가 실제로 import해서 실행 검증합니다(fix round 1 · I6).
//
// 컨트롤러 결정 — Resend 키 미설정: IN_APP 알림은 외부 서비스 없이도 정상 완료되어야 합니다.
// EMAIL 채널은 이 경우 영구 실패로 남기지 않고 'EMAIL_SENDER_NOT_CONFIGURED' 사유로 재시도
// 대상 실패 처리합니다 — 키를 설정하면 다음 재시도(또는 반복 알림의 다음 회차)에서 정상
// 발송됩니다. 반복 템플릿(APPROVAL_PENDING · DEMAND_SUBMISSION_OVERDUE)은 core.finish_notification
// 규칙상 재시도 대신 매 10분 새 알림으로 이어지므로, 이 회차의 실패는 1회 시도로 끝나고 다음
// 회차가 다시 시도합니다. 그 외 단발 템플릿은 core.notification_outbox.max_attempts(기본 5회)까지
// 10분→20분→40분→80분 간격으로 재시도한 뒤 최종 실패로 남습니다(누적 10·30·70·150분,
// docs/notification-operations.md 참고).
//
// RESEND_REPLY_TO(선택): 발신 주소(RESEND_FROM_EMAIL)가 수신함 없는 발송 전용 하위 도메인
// (예: alert@send.upflash.co.kr)이면 받는 사람이 답장해도 반송됩니다. 이 값을 설정하면
// Resend 요청에 reply_to를 실어 실제 수신 가능한 주소(예: contact@upflash.co.kr)로 답장이
// 가게 합니다. 비어 있으면 필드 자체를 보내지 않아 기존 동작과 동일합니다.
//
// 배포 전 필독 — supabase/config.toml의 [functions.notify] verify_jwt가 반드시 false여야
// 합니다. 이 함수는 Supabase Auth JWT가 아니라 CRON_SECRET(아래 isAuthorizedRequest)로만
// 인증하는데, verify_jwt가 기본값(true)이면 게이트웨이가 이 코드를 실행하기도 전에
// pg_net의 Bearer 토큰을 401로 거부합니다(fix round 1 · C1).

// fix round 1 · M2 — 버전을 명시하지 않으면 배포 시점의 latest가 조용히 바뀔 수 있습니다.
// package.json의 @supabase/supabase-js(npm, ^2.112.4)와 같은 버전을 JSR에서 확인해
// (jsr.io/@supabase/supabase-js/meta.json, 2026-09-12 기준 존재 확인) 고정했습니다. 올릴 때는
// 이 저장소의 npm 버전과 함께 올리세요.
import { createClient } from 'jsr:@supabase/supabase-js@2.112.4';
import { isAuthorizedRequest, processClaimedNotifications } from './core.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
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
  const resendReplyTo = Deno.env.get('RESEND_REPLY_TO') ?? '';

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

    // 실제 DB 호출(supabase-js RPC)을 core.ts의 NotifyRpc 인터페이스로 얇게 이어 붙입니다.
    // 루프 자체(순서·재시도 매핑·집계)는 core.ts의 processClaimedNotifications가 담당하며,
    // 거기서 Node 테스트로 이미 실행 검증됩니다(fix round 1 · I6).
    const summary = await processClaimedNotifications(
      claimedRows,
      workerId,
      {
        async validateClaimedNotification({ notificationId, workerId: worker, claimToken }) {
          const { data: isValid, error } = await supabase.schema('core').rpc('validate_claimed_notification', {
            p_notification_id: notificationId,
            p_worker_id: worker,
            p_claim_token: claimToken,
          });
          return { isValid: isValid ?? null, error: error?.message ?? null };
        },
        async finishNotification({ notificationId, workerId: worker, claimToken, success, retryable, errorMessage, externalMessageId }) {
          const { error } = await supabase.schema('core').rpc('finish_notification', {
            p_notification_id: notificationId,
            p_worker_id: worker,
            p_claim_token: claimToken,
            p_success: success,
            p_retryable: retryable,
            p_error_message: errorMessage,
            p_external_message_id: externalMessageId,
          });
          return { error: error?.message ?? null };
        },
      },
      { apiKey: resendApiKey, from: resendFrom, replyTo: resendReplyTo },
    );

    return json(summary, summary.finishErrors.length > 0 ? 500 : 200);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '알림 처리 중 오류가 발생했습니다.' }, 500);
  }
});
