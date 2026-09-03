-- API 롤에 읽기 권한을 부여합니다.
--
-- ★ 권한의 최종 상태는 이 파일이 아니라 sql/28-anon-lockdown.sql 이 정합니다.
--   아래 grant 는 anon(로그인하지 않은 방문자)에게도 core · analytics 전체를 엽니다.
--   publishable 키는 비밀이 아니므로, 이 파일까지만 적용한 데이터베이스는
--   로그인 없이 공급망 데이터 전체가 읽힙니다. 반드시 sql/28 까지 적용하세요.
--   sql/28 은 여기서 준 것을 anon 에게서만 거두고 authenticated 는 그대로 둡니다.
--   이 파일의 문장은 일부러 바꾸지 않습니다 — 앞 파일은 그것만으로도 돌아가야 합니다.
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
