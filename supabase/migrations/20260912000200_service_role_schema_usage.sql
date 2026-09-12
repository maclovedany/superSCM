-- Task 3·6·7 알림/작업 함수를 service_role 로 호출할 수 있게 합니다.
--
-- 문제 (2026-09-12 배포 중 실측)
--   Edge Function 과 Vercel Cron 경로는 service key 로 PostgREST 에 붙어
--   `.schema('core').rpc('claim_due_notifications', ...)` 를 호출합니다.
--   각 함수에는 `grant execute ... to service_role` 이 있었지만 스키마 USAGE 가 없어
--   호출이 `permission denied for schema core` (HTTP 500) 로 실패했습니다.
--   EXECUTE 권한만으로는 부족하고 스키마 USAGE 가 함께 있어야 합니다.
--
-- 최소 권한
--   core 스키마의 USAGE 만 부여합니다. core 함수들은 security definer 이므로
--   raw·analytics 접근 권한은 호출자에게 필요하지 않습니다.
--   테이블·뷰에 대한 SELECT/INSERT 를 새로 주지 않습니다.

grant usage on schema core to service_role;

-- 확인 쿼리
--   select has_schema_privilege('service_role','core','USAGE');           -- 기대: true
--   select has_function_privilege('service_role',
--            'core.claim_due_notifications(integer,uuid)','EXECUTE');     -- 기대: true
