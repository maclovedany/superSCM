-- Task 14 · Supabase 무료 플랜에서 10분 주기 반복 작업을 pg_cron/pg_net으로 구동
--
-- 배경: 세 가지 반복 작업(알림 발송·임시배정 자동 만료·수요 미제출 알림)은 지금까지
-- Vercel Cron(`vercel.json`, */10 * * * *)이 호출했습니다. 10분 주기는 Vercel Pro 이상에서만
-- 지원되어, 무료 계정으로 실습하는 학생들이 막힙니다. pg_cron/pg_net은 Supabase 무료 플랜에
-- 포함되므로, 스케줄링을 DB 안으로 옮깁니다.
--
-- 구조: pg_cron(10분마다) → pg_net이 알림 Edge Function을 비동기 HTTP POST로 호출합니다.
-- pg_net은 요청을 큐에 넣고 즉시 반환할 뿐 응답을 되돌려주지 않으므로(비동기), claim → 발송 직전
-- 재검증 → 발송 → core.finish_notification 통보까지 전체 루프는 Edge Function
-- (`supabase/functions/notify/index.ts`) 안에서 끝나야 합니다 — pg_cron/pg_net은 "깨우기"만
-- 담당합니다. 나머지 두 작업은 순수 SQL이라 HTTP 없이 DB 함수를 직접 호출합니다.
--
-- 이 파일은 기존 Vercel Cron 라우트(app/api/cron/*)의 코드를 지우지 않습니다 — 유료 플랜을
-- 쓰기로 한 배포는 이 마이그레이션 대신 그 라우트를 쓸 수 있습니다. 다만 **둘을 동시에 켜 두지
-- 마세요**(docs/notification-operations.md). `for update skip locked`가 같은 알림의 중복
-- 처리는 막아 주지만, 한쪽은 어떤 실패를 영구 실패로 다른 쪽은 재시도 대상으로 다르게 판단할
-- 수 있어 발송 이력이 경로마다 모순되게 남습니다(fix round 2 · 어조 통일).
--
-- 재실행 안전성: 확장 설치는 `if not exists`로, 작업 등록은 이름으로 먼저 해제한 뒤 다시
-- 등록하는 방식으로 전체를 몇 번 다시 적용해도 안전합니다(stage1-supabase-수동적용.md §0 원칙).


-- ══ 1. 확장 설치 ══════════════════════════════════════════════
--
-- Supabase 문서(Database → Extensions → pg_cron / pg_net)가 권장하는 형태입니다. 두 확장 모두
-- 자체 스키마(cron·net)를 만들므로 별도 schema 절이 필요 없습니다. 호스팅 Supabase에서는
-- SQL Editor(=postgres 역할)로 실행해야 설치 권한이 있습니다 — 컨트롤러가 이 마이그레이션을
-- 적용할 때와 같은 경로입니다.

create extension if not exists pg_cron;
create extension if not exists pg_net;


-- ══ 2. Vault 시크릿 — 아래는 컨트롤러가 실제 값으로 직접 실행할 안내이며, 이 마이그레이션은
--       시크릿을 만들지 않습니다(평문 커밋 금지). 이미 같은 이름의 시크릿이 있으면
--       vault.update_secret(id, secret)로 값만 교체하세요.
-- ══════════════════════════════════════════════════════════════
--
-- select vault.create_secret(
--   'https://<project-ref>.supabase.co/functions/v1/notify',
--   'stage1_notify_url',
--   'Task 14 · 알림 Edge Function 호출 주소'
-- );
-- select vault.create_secret(
--   '<notify Edge Function의 CRON_SECRET과 동일한 값>',
--   'stage1_notify_secret',
--   'Task 14 · 알림 Edge Function 인증 비밀값(CRON_SECRET)'
-- );
--
-- 두 시크릿이 아직 없으면 아래 net.http_post의 url 인자가 null이 됩니다. net.http_request_queue
-- 테이블의 url 열은 NOT NULL이라(PostgreSQL 17 실측), pg_net은 이 값을 조용히 넘기지 않고
-- **그 자리에서 not-null 제약 위반으로 시끄럽게 실패합니다.** 요청이 net 큐에 들어가기 전에
-- 실패하므로 net._http_response에는 아무 것도 남지 않고, 대신 cron.job_run_details의
-- return_message에 오류가 남습니다 — §6 확인 쿼리에서 job_run_details를 net._http_response보다
-- 먼저 보세요. (fix round 1 · I4 — 이전 버전은 "조용히 null이 넘어간다"고 잘못 적었습니다.)


-- ══ 3. stage1-notify — Edge Function 호출(HTTP, 비동기) ═══════════════

do $$
begin
  if exists (select 1 from cron.job where jobname = 'stage1-notify') then
    perform cron.unschedule('stage1-notify');
  end if;
end;
$$;

select cron.schedule(
  'stage1-notify',
  '*/10 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'stage1_notify_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'stage1_notify_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) as request_id;
  $cron$
);


-- ══ 4. stage1-expire-allocations — 순수 SQL(HTTP 없음) ═══════════════
--
-- core.expire_temporary_allocations는 security definer이고 postgres가 소유합니다. pg_cron은
-- 이 작업을 등록한 역할(postgres, Supabase SQL Editor 기본 역할)로 실행하므로 별도 GRANT 없이도
-- 소유자 권한으로 호출됩니다. auth.uid()에 의존하지 않습니다(로그인 세션 없이도 안전).

do $$
begin
  if exists (select 1 from cron.job where jobname = 'stage1-expire-allocations') then
    perform cron.unschedule('stage1-expire-allocations');
  end if;
end;
$$;

select cron.schedule(
  'stage1-expire-allocations',
  '*/10 * * * *',
  $cron$ select core.expire_temporary_allocations(); $cron$
);


-- ══ 5. stage1-demand-reminders — 순수 SQL(HTTP 없음) ═════════════════
--
-- core.raise_demand_submission_reminders도 마찬가지로 security definer · postgres 소유 ·
-- auth.uid() 비의존입니다.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'stage1-demand-reminders') then
    perform cron.unschedule('stage1-demand-reminders');
  end if;
end;
$$;

select cron.schedule(
  'stage1-demand-reminders',
  '*/10 * * * *',
  $cron$ select core.raise_demand_submission_reminders(); $cron$
);


-- ══ 6. 적용 후 확인 쿼리(모두 주석) ═══════════════════════════
--
-- fix round 1 · I3 — 이 절은 마이그레이션 실행 중 자동으로 함께 도는 실행문이 아니라 안내입니다.
-- 특히 vault.decrypted_secrets 조회는 vault 확장이 없거나 권한이 없는 환경에서는 그 자체로
-- 실패할 수 있는데, 그 시점에는 이미 위 §3~§5에서 세 작업이 전부 등록된 뒤라 마이그레이션이
-- "일부만 적용된 채" 중간에 실패하게 됩니다. 그래서 전부 주석으로 두고, 적용 후 필요한 줄만
-- 따로 복사해 SQL Editor에서 실행하세요.

-- 세 작업이 모두 등록되고 활성 상태인지 확인합니다.
-- select jobname, schedule, active
-- from cron.job
-- where jobname in ('stage1-notify', 'stage1-expire-allocations', 'stage1-demand-reminders')
-- order by jobname;
-- 기대: 3행, schedule = '*/10 * * * *', active = true

-- Vault 시크릿 두 개가 준비됐는지(값이 아니라 존재 여부만) 확인합니다.
-- select name, created_at
-- from vault.decrypted_secrets
-- where name in ('stage1_notify_url', 'stage1_notify_secret')
-- order by name;
-- 기대: 2행. 0~1행이면 §2 안내대로 vault.create_secret을 먼저 실행하세요.

-- 최근 실행 이력 — 이 표를 net._http_response보다 먼저 보세요. vault 시크릿이 없어 url이
-- null이면 net.http_post 자체가 not-null 제약 위반으로 실패하고 그 오류가 여기 return_message에
-- 남습니다(§2 참고, fix round 1 · I4). status가 'failed'가 아니라면 job의 SQL 실행 자체는
-- 성공한 것이고(= net 큐 등록까지는 됨), 실제 HTTP 결과는 그 아래 net._http_response에서 봅니다.
-- select job_run.jobid, cron.job.jobname, job_run.status, job_run.return_message, job_run.start_time
-- from cron.job_run_details job_run
-- join cron.job on cron.job.jobid = job_run.jobid
-- where cron.job.jobname in ('stage1-notify', 'stage1-expire-allocations', 'stage1-demand-reminders')
-- order by job_run.start_time desc
-- limit 20;

-- stage1-notify가 실제로 Edge Function에 도달했는지는 net._http_response에서 확인합니다.
-- pg_net은 비동기이므로 위 job_run_details에는 "요청 제출 성공"만 남고, 실제 HTTP 상태 코드는
-- 여기 나옵니다. 이 표에 행이 없다면 위 job_run_details.return_message부터 확인하세요(요청이
-- net 큐에 들어가지도 못하고 실패했을 수 있습니다 — 예: url이 null인 경우).
-- select id, status_code, content::text, error_msg, created
-- from net._http_response
-- order by created desc
-- limit 20;
-- 기대: status_code = 200(claimed 0건이어도 정상). 401이면 **먼저 supabase/config.toml의
-- [functions.notify] verify_jwt가 false로 배포됐는지부터 의심하세요** — true(기본값)로
-- 배포되면 Supabase 게이트웨이가 CRON_SECRET을 보기도 전에 JWT가 아니라는 이유로 401을
-- 돌려주고, 함수 코드(isAuthorizedRequest)는 실행조차 되지 않습니다(fix round 1 · C1). 배포
-- 시 supabase functions deploy 로그에 "verify_jwt: false"가 찍히는지 확인하고, 그래도 401이면
-- 그 다음으로 vault의 stage1_notify_secret과 Edge Function의 CRON_SECRET이 같은 값인지
-- 확인합니다. status_code가 비어 있고 error_msg만 있으면 요청이 아직 응답을 못 받았거나
-- 실패한 것입니다 — 위 job_run_details.return_message에 이미 원인(예: url이 null이라 not-null
-- 위반)이 남아 있을 가능성이 높습니다.

-- 예약 전 스모크 테스트 — 정상 CRON_SECRET으로 200, 잘못된 값으로 401을 먼저 curl로 확인한
-- 뒤에 이 마이그레이션을 적용해 스케줄을 거는 순서를 권장합니다. 정확한 curl 명령은
-- docs/stage1-supabase-수동적용.md §7-2.5를 참고하세요.

-- 특정 작업을 되돌려야 할 때(예: 유료 플랜으로 전환해 Vercel Cron만 쓰기로 한 경우):
-- select cron.unschedule('stage1-notify');
-- select cron.unschedule('stage1-expire-allocations');
-- select cron.unschedule('stage1-demand-reminders');
