-- ============================================================
-- 05. 권한 — 누가 무엇을 읽을 수 있는가
--
--   ★ 항상 마지막에 실행합니다. 그리고 앞 파일을 다시 실행했다면 이 파일도 다시 실행합니다.
--     새로 만든 뷰에 권한이 안 붙어 화면이 "에러 없이 빈 배열"로 나오는 사고가 가장 흔합니다.
--
--   설계
--     raw        앱에서 못 읽습니다. RLS 로 닫혀 있고 GRANT 도 주지 않습니다.
--     core       로그인 사용자(authenticated) 읽기
--     analytics  로그인 사용자(authenticated) 읽기   ← 화면과 Tool 이 여기만 봅니다
--     anon       아무것도 못 읽습니다 (로그인 전)
-- ============================================================

-- ------------------------------------------------------------
-- 스키마 접근
-- ------------------------------------------------------------
grant usage on schema core      to authenticated;
grant usage on schema analytics to authenticated;

revoke usage on schema raw       from anon, authenticated;
revoke usage on schema core      from anon;
revoke usage on schema analytics from anon;

-- ------------------------------------------------------------
-- 읽기 권한 — 지금 있는 객체
-- ------------------------------------------------------------
grant select on all tables in schema core      to authenticated;
grant select on all tables in schema analytics to authenticated;
-- (PostgreSQL 에서 "table" 권한은 뷰에도 적용됩니다)

-- ------------------------------------------------------------
-- 읽기 권한 — 앞으로 만들 객체에도 자동으로
-- ------------------------------------------------------------
alter default privileges in schema core      grant select on tables to authenticated;
alter default privileges in schema analytics grant select on tables to authenticated;

-- ------------------------------------------------------------
-- ★ anon 잠금 — 로그인 전에는 아무것도 못 봅니다
--
--   브라우저에 그대로 실려 나가는 publishable 키만으로 core · analytics 전체가
--   읽히는 사고가 실제로 있었습니다. 이 블록이 그 경로를 닫습니다.
-- ------------------------------------------------------------
revoke all on all tables    in schema raw       from anon, public;
revoke all on all tables    in schema core      from anon, public;
revoke all on all tables    in schema analytics from anon, public;
revoke all on all functions in schema core      from anon, public;
revoke all on all functions in schema analytics from anon, public;

alter default privileges in schema raw       revoke all on tables from anon, public;
alter default privileges in schema core      revoke all on tables from anon, public;
alter default privileges in schema analytics revoke all on tables from anon, public;

-- ------------------------------------------------------------
-- Supabase 대시보드 설정 (SQL 로 안 되는 부분 — 손으로 해야 합니다)
--
--   Project Settings → API → Data API → Exposed schemas
--       public, core, analytics
--
--   ★ 이 설정이 없으면 조회가 "에러 없이 빈 배열"로 돌아옵니다.
--     Tool 은 "데이터가 없습니다"라고 보고하는데 실제로는 권한 문제입니다.
--     오늘 실습에서 빈 결과가 나오면 여기부터 확인하세요.
-- ------------------------------------------------------------


-- ============================================================
-- 확인 ① — authenticated 가 analytics 를 읽을 수 있는가
-- ============================================================
select table_schema, table_name,
       has_table_privilege('authenticated', table_schema||'.'||table_name, 'SELECT') as authenticated_select,
       has_table_privilege('anon',          table_schema||'.'||table_name, 'SELECT') as anon_select
from information_schema.tables
where table_schema in ('analytics','core')
order by table_schema, table_name;
-- 기대: authenticated_select = true · anon_select = false (전부)


-- ============================================================
-- 확인 ② — raw 는 앱에서 못 읽는가
-- ============================================================
select has_schema_privilege('authenticated', 'raw', 'USAGE') as raw_usage_authenticated,
       has_schema_privilege('anon',          'raw', 'USAGE') as raw_usage_anon;
-- 기대: 둘 다 false


-- ============================================================
-- 확인 ③ — 그런데 analytics 뷰는 정상 동작하는가
--   (뷰는 소유자 권한으로 실행되므로 raw 를 읽습니다. 이게 의도한 구조입니다)
-- ============================================================
select count(*) as n from analytics.v_shipment_trend;
-- 기대: 10,000행 이상. 0 이면 뷰 소유자가 raw 를 못 읽는 것이니
--       뷰를 postgres 롤로 다시 만드세요.
