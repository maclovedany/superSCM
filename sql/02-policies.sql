-- 참가자가 값을 확정하는 두 테이블의 쓰기 정책입니다.
--
-- core.leadtime_plan 과 core.usage_profile 은 dump.sql 에서 RLS 만 켜져 있고
-- 정책이 하나도 없습니다(dump.sql:10936, 10948). 정책이 없는 RLS 는 "전부 거부"라
-- 앱에서 읽기도 쓰기도 되지 않습니다.
--
-- SQL Editor / Table Editor 로만 값을 바꿀 거면 이 파일은 실행하지 않아도 됩니다.
-- (그쪽은 postgres 롤이라 RLS 를 우회합니다.)
-- 앱 화면에서 확정값을 저장하게 하려면 01-grants.sql 다음에 실행하세요.

-- 1) 테이블 권한 — RLS 와 별개로 필요합니다.
--    01-grants.sql 은 select 만 줬으므로 쓰기 권한을 여기서 더합니다.
grant select, insert, update, delete on core.leadtime_plan to anon, authenticated;
grant select, insert, update, delete on core.usage_profile to anon, authenticated;

-- 2) RLS 정책
--    ⚠ 수업용입니다. publishable 키는 브라우저에 노출되므로,
--      키를 가진 사람은 누구나 이 두 테이블을 고칠 수 있습니다.
--      실제 운영에서는 auth.uid() 등으로 조건을 좁혀야 합니다.
drop policy if exists "수업용 전체 허용" on core.leadtime_plan;
create policy "수업용 전체 허용"
  on core.leadtime_plan
  for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "수업용 전체 허용" on core.usage_profile;
create policy "수업용 전체 허용"
  on core.usage_profile
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- 확인 — 두 줄이 나와야 합니다.
select schemaname, tablename, policyname, roles, cmd
  from pg_policies
 where schemaname = 'core'
   and tablename in ('leadtime_plan', 'usage_profile');

-- 되돌리기 (수업 후)
-- drop policy "수업용 전체 허용" on core.leadtime_plan;
-- drop policy "수업용 전체 허용" on core.usage_profile;
-- revoke insert, update, delete on core.leadtime_plan from anon, authenticated;
-- revoke insert, update, delete on core.usage_profile from anon, authenticated;
