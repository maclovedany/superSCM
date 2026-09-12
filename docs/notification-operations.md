# 알림 발송 운영 기준

## 실행 주기와 배포 조건 — 기본: Supabase pg_cron (무료 플랜)

세 가지 반복 작업(알림 발송 · 임시배정 자동 만료 · 수요 미제출 알림)은 모두 10분 주기입니다.
기본 경로는 **Supabase pg_cron/pg_net**입니다 — 무료 플랜에 포함되어 있어 별도 결제 없이
씁니다(`supabase/migrations/20260912000100_stage1_pg_cron_jobs.sql`, Task 14).

```
pg_cron(10분마다) ─┬─ stage1-notify            → pg_net이 Edge Function(notify)을 HTTP POST로 호출
                   ├─ stage1-expire-allocations → core.expire_temporary_allocations()를 직접 호출(SQL만)
                   └─ stage1-demand-reminders   → core.raise_demand_submission_reminders()를 직접 호출(SQL만)
```

뒤 두 작업은 순수 SQL이라 HTTP가 필요 없습니다. 알림 발송만 외부 이메일 발송(Resend)이 있어
Edge Function(`supabase/functions/notify/index.ts`)을 거칩니다.

**pg_net은 비동기입니다.** `net.http_post`는 요청을 큐에 넣고 즉시 반환할 뿐, HTTP 응답을
pg_cron 작업 결과로 돌려주지 않습니다. 그래서 claim → 발송 직전 재검증 → 발송 →
`core.finish_notification` 통보까지 전체 루프는 pg_cron이 아니라 **Edge Function 안에서**
끝납니다 — pg_cron/pg_net은 "10분마다 깨우기"만 담당합니다. 이는 기존
`/api/cron/notifications` 라우트가 하던 일과 완전히 같은 루프이며, 실행 위치만
Vercel 서버리스 함수에서 Supabase Edge Function으로 옮긴 것입니다.

작업이 "실행됐는지"와 "Edge Function이 실제로 응답했는지"는 서로 다른 질문입니다. 확인 순서:

1. `select jobname, schedule, active from cron.job;` — 작업이 등록·활성 상태인지.
2. `select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'stage1-notify') order by start_time desc limit 10;` —
   pg_cron이 그 회차에 SQL(= `net.http_post` 제출)을 실행했는지. 여기 `status = 'succeeded'`는
   "HTTP 요청을 큐에 넣는 데 성공했다"는 뜻이지 "Edge Function이 200을 반환했다"는 뜻이 아닙니다.
3. `select id, status_code, content::text, error_msg, created from net._http_response order by created desc limit 20;` —
   실제 HTTP 응답. `status_code`가 비어 있고 `error_msg`만 있으면 요청 자체가 실패한 것(예:
   Vault 시크릿 미설정으로 url이 null이 되어 `net.http_post`가 not-null 제약 위반으로
   실패 — 이 경우 이 표가 아니라 2번 `cron.job_run_details.return_message`에 원인이 남습니다).

`status_code = 401`을 보면 **먼저 `supabase/config.toml`의 `[functions.notify]`가
`verify_jwt = false`로 배포됐는지부터 의심하세요.** 기본값(`true`)으로 배포되면 Supabase
게이트웨이가 `CRON_SECRET`을 보기도 전에 "JWT가 아니다"라는 이유로 401을 돌려주고, 함수
코드(`isAuthorizedRequest`)는 실행조차 되지 않습니다 — 이때 Vault의 `stage1_notify_secret`을
아무리 맞게 고쳐도 401이 그대로입니다(fix round 1 · C1). `verify_jwt`가 확실히 `false`인데도
401이면 그 다음으로 Vault의 `stage1_notify_secret`과 Edge Function의 `CRON_SECRET`이 같은
값인지 확인합니다.

적용·시크릿 설정 순서와 배포 직후 스모크 테스트(curl로 200/401 확인)는
`docs/stage1-supabase-수동적용.md` §7에 있습니다.

**Vercel Cron과 동시에 켜 두지 마세요.** `vercel.json`에는 여전히 세 라우트의 10분 Cron
설정이 남아 있습니다. Supabase pg_cron 경로를 쓰기로 했다면 Vercel 프로젝트의 Cron을
끄거나(Vercel 대시보드에서 비활성화, 또는 `vercel.json`에서 해당 항목 제거) 애초에 Cron이
붙지 않는 배포(Hobby)로 두세요. 두 경로가 동시에 살아 있으면 처리 자체는
`for update skip locked`로 안전하지만, 같은 알림 건이 한쪽에서는 영구 실패로, 다른 쪽에서는
재시도 중으로 기록되는 등 발송 이력이 서로 모순되게 남아 헷갈립니다(예: Vercel 라우트는
Resend 설정 누락을 영구 실패로 보고, Edge Function은 재시도 대상으로 봅니다 — 아래
"Resend 키를 아직 설정하지 않았을 때" 참고).

## 대안 경로 — Vercel Cron(유료 플랜)

`app/api/cron/notifications`(그리고 `/api/cron/allocations`, `/api/cron/demand-submissions`)
라우트는 그대로 저장소에 남아 있으며, Vercel Pro 이상이거나 같은 주기를 보장하는 외부
스케줄러가 있는 배포는 계속 이 경로를 쓸 수 있습니다. `vercel.json`의 10분 Cron은
**Vercel Hobby에서는 지원되지 않습니다.** 두 경로(Supabase pg_cron과 Vercel Cron)를
동시에 켜 두어도 `core.claim_due_notifications`의 `for update skip locked`가 중복 처리를
막으므로 안전하지만, 보통은 하나만 씁니다.

외부 스케줄러(Vercel Cron 포함)를 사용할 때도 `Authorization: Bearer <CRON_SECRET>` 또는
`x-cron-secret: <CRON_SECRET>` 헤더를 반드시 전달합니다. Edge Function도 같은 방식(둘 중
하나의 헤더)으로 인증합니다 — 값은 Vercel 환경변수의 `CRON_SECRET`과 같을 필요는 없고,
Edge Function 자체의 시크릿(`supabase secrets set CRON_SECRET=...`)과 Vault의
`stage1_notify_secret`이 일치하기만 하면 됩니다.

`/api/cron/allocations`(Task 6 · 30일 임시배정 자동 만료) · `core.expire_temporary_allocations`는
만료 판정 · 배정 해제 · 주문 상태 전환 · 완료 알림 예약을 모두 한 트랜잭션으로 끝냅니다. 신규
입고 후속 배정(AUTO/MANUAL)은 이 작업이 아니라 입고 커밋(`core.commit_import_batch`) 트랜잭션
안에서 바로 실행되므로 별도 스케줄러가 필요 없습니다.

`/api/cron/demand-submissions`(Task 7 · 부서 수요 미제출 반복 알림) · `core.raise_demand_submission_reminders`는
마감일이 지났는데 아직 제출(`SUBMITTED`/`AGREED`)하지 않은 부서마다, "마감일 + 1일 00:00
Asia/Seoul"을 고정 시각으로 첫 알림을 예약합니다. 고정 시각을 쓰므로 10분마다 다시 호출해도
`core.enqueue_notification`의 dedupe_key가 겹쳐 중복 예약되지 않습니다. 10분 반복 자체는 이
작업이 아니라 `core.finish_notification`이 `DEMAND_SUBMISSION_OVERDUE` 템플릿을 계속
재예약하며 이어갑니다. 제출 완료 시 중단(`core.cancel_notification_series`)은
`core.submit_demand_submission` 트랜잭션 안에서, 마감 후 회수 시 재개는
`core.withdraw_demand_submission` 트랜잭션 안에서 바로 일어나므로 이 작업과는 독립적입니다.

## Resend 키를 아직 설정하지 않았을 때(Edge Function)

Edge Function은 Resend 없이도 배포할 수 있습니다. `RESEND_API_KEY`·`RESEND_FROM_EMAIL`이
없으면:

- **IN_APP** 알림은 외부 서비스가 필요 없으므로 그대로 정상 발송(성공)됩니다.
- **EMAIL** 채널은 `EMAIL_SENDER_NOT_CONFIGURED` 사유로 **재시도 대상 실패**가 됩니다(영구
  실패로 남기지 않습니다). 키를 설정하면 다음 재시도 또는 다음 반복 회차에서 정상 발송됩니다.

주의(시도 횟수 소진) — `APPROVAL_PENDING`·`DEMAND_SUBMISSION_OVERDUE`(반복 템플릿)는 매 10분
새 알림 행으로 이어지므로 이 실패는 매번 "1회 시도 후 그 회차만 실패"로 끝나고 다음 회차가
다시 시도합니다. 그 외 **단발 템플릿**(`APPROVAL_DECIDED`·`TEMP_ALLOCATION_EXPIRY_WARNING` 등)은
같은 알림 ID로 재시도하는데, **키 없이 운영하면 그 일회성 이메일 알림은 약 2시간 30분
(1차 시도 직후 10분·30분·70분·150분 누적 시점에 재시도, `max_attempts` 기본 5회를 다 씀)
후 `FAILED`로 확정되며, 이후 Resend 키를 넣어도 그 알림 자체는 되살아나지 않습니다**(다음에
같은 업무 이벤트가 다시 발생해야 새 알림이 예약됩니다). 사용자 환경(발신
`alert@send.upflash.co.kr`, 답장 `contact@upflash.co.kr`, Resend 키 보유)처럼 배포와 같은
세션에 키를 설정할 계획이면 이 2시간 30분 창은 실제로 생기지 않습니다 — 이 절은 "키를 아예
설정하지 않고 운영하기로 한" 배포(예: 학생 실습)를 위한 안내입니다. 그런 배포에서는 이 값을
정상적인 소음으로 보고 넘어가면 됩니다 — IN_APP 알림함은 영향받지 않습니다.

## 처리 안전장치

- 한 번 실행할 때 최대 25건을 가져옵니다.
- 한 작업자의 처리 임대시간은 2분입니다.
- 임대시간 안에는 작업자 UUID와 claim token이 일치해야 완료할 수 있습니다.
- 서버가 중단되면 임대 만료 뒤 다른 작업자가 같은 알림을 회수합니다.
- 알림 한 건의 최대 시도 횟수는 기본 5회입니다.
- 일시 장애는 10분부터 늘어나는 간격으로 재예약하며, 각 실패 시도는 발송 이력에 남깁니다.
- 승인 대기와 수요 미제출 반복 알림은 개별 발송의 성공·실패와 분리해 다음 10분 회차를 예약합니다.
  따라서 한 회차의 주소 오류나 설정 누락이 전체 반복 알림을 중단시키지 않습니다.
- 다음 예약 시각은 10분 경계에 맞춰 저장해 작업 시작이 몇 초 늦어져도 다음 Cron 회차를 놓치지 않습니다.
- 입력 오류와 설정 누락 같은 영구 오류는 재예약하지 않고 최종 실패로 남깁니다. 예외 —
  Supabase Edge Function 경로의 Resend 키 미설정은 영구 오류로 보지 않고 재시도 대상으로
  남깁니다(위 "Resend 키를 아직 설정하지 않았을 때" 참고). Vercel 라우트 경로는 기존과 같이
  설정 누락을 영구 실패로 봅니다.
- Resend 요청은 `notification/<notification_id>` 중복 방지 키를 사용합니다.
- 외부 발송 후 데이터베이스 완료 기록까지 성공해야 Cron 성공 건수로 집계합니다.

## 운영 확인

- 관리자 화면 `/admin/notification-history`에서 시도 번호, 성공·실패, 재시도 가능 여부,
  오류 또는 외부 메시지 ID를 확인합니다.
- `PROCESSING`이 2분 이상 유지되면 다음 Cron이 자동 회수합니다.
- 같은 알림이 5회 실패하면 `FAILED`로 종료되며 자동 재시도하지 않습니다.
- 승인 대기 알림은 발송 직전에 승인 상태를 다시 확인합니다. 이미 승인·반려·취소됐거나
  series가 취소된 알림은 발송하지 않습니다.

데이터베이스 상태 확인과 외부 이메일 전송은 하나의 트랜잭션으로 묶을 수 없습니다. 승인 처리가
발송 직전 확인과 이메일 제공자 요청 사이에 동시에 완료되면 이미 전송을 시작한 알림 한 건은 도착할
수 있습니다. 이 경우 후속 알림은 즉시 취소되고, 완료 기록은 성공으로 집계하지 않습니다. 운영상
이 짧은 경쟁 구간에서 이미 전송을 시작한 Outbox 행마다 한 건은 허용합니다. 한 승인 건에 수신자가
여러 명이거나 Cron 작업자가 동시에 실행되면 각 수신자·채널의 처리 중 행만큼 도착할 수 있습니다.
데이터베이스와 외부 서비스 간 exactly-once 전송이나 승인 건 전체 기준 최대 한 건을 보장한다고
표시하지 않습니다.

## 서버 환경변수

### Vercel 라우트(`app/api/cron/*`)를 쓸 때

- `SUPABASE_SECRET_KEY` 또는 `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `RESEND_REPLY_TO` (선택) — 발신 주소가 수신함 없는 발송 전용 하위 도메인
  (예: `alert@send.example.com`)이면, 받는 사람이 답장했을 때 반송되지 않도록 실제
  수신 가능한 주소를 넣습니다. 비워 두면 이전과 동일하게 동작합니다.

이 값에는 `NEXT_PUBLIC_` 접두어를 붙이지 않습니다.

### Supabase Edge Function(`supabase/functions/notify`)을 쓸 때

Edge Function 시크릿(Vercel 환경변수와 별도로 관리합니다):

- `SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY` — 플랫폼이 자동으로 주입합니다. 직접 설정할
  필요가 없습니다.
- `CRON_SECRET` — `supabase secrets set CRON_SECRET=...`로 직접 설정합니다. Vault의
  `stage1_notify_secret`과 같은 값이어야 합니다.
- `RESEND_API_KEY`·`RESEND_FROM_EMAIL` — 선택. 없으면 "Resend 키를 아직 설정하지 않았을 때"
  절의 규칙을 따릅니다.
- `RESEND_REPLY_TO` — 선택. 발신 주소가 수신함 없는 발송 전용 하위 도메인이면 실제 수신
  가능한 주소(예: 회사 대표 메일)를 넣어 답장이 반송되지 않게 합니다. Vercel 라우트도
  같은 이름의 환경변수로 동일하게 동작합니다.

그리고 pg_cron이 참조하는 Vault 시크릿 두 개(`stage1_notify_url`·`stage1_notify_secret`,
평문으로 저장소에 커밋하지 않음)는 `docs/stage1-supabase-수동적용.md`의 절차대로 만듭니다.

Resend의 중복 방지 키는 동일 요청의 재시도 중복을 줄이지만 보존 기간은 24시간입니다.
현재 최대 재시도 간격은 이 기간 안에서 끝나도록 구성되어 있습니다.

참고: https://resend.com/docs/dashboard/emails/idempotency-keys
