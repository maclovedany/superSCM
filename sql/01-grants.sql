-- API 롤에 읽기 권한을 부여합니다.
--
-- dump.sql 에는 GRANT 문이 없어서, 복원 직후에는 Exposed schemas 를
-- 설정해도 "permission denied for schema analytics" (42501) 가 납니다.
-- Supabase → SQL Editor 에서 이 파일을 한 번 실행하세요.

-- 1) 스키마에 들어갈 수 있게
grant usage on schema core      to anon, authenticated;
grant usage on schema analytics to anon, authenticated;

-- 2) 안에 있는 뷰·테이블을 읽을 수 있게 (뷰도 all tables 에 포함됩니다)
grant select on all tables in schema core      to anon, authenticated;
grant select on all tables in schema analytics to anon, authenticated;

-- 3) 앞으로 새로 만드는 뷰에도 자동으로 붙게
--    (오후에 뷰를 추가해도 다시 GRANT 하지 않아도 됩니다)
alter default privileges in schema core
  grant select on tables to anon, authenticated;
alter default privileges in schema analytics
  grant select on tables to anon, authenticated;

-- raw 스키마는 일부러 열지 않습니다.
-- core/analytics 뷰가 postgres 소유(security definer)라 raw 를 대신 읽어줍니다.

-- 확인
select has_schema_privilege('anon', 'analytics', 'usage')            as anon_schema_ok,
       has_table_privilege('anon', 'analytics.v_leadtime_gap', 'select') as anon_view_ok;
