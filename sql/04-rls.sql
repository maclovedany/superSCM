-- ──────────────────────────────────────────────────────────────
-- STEP 2 · 인증과 권한 (2/2)
--
-- sql/02-policies.sql 의 "수업용 전체 허용" 정책을 폐기하고
-- 역할 기반 정책으로 교체합니다.
--
-- 02-policies.sql 은 anon 에게 for all using(true) 를 줬습니다.
-- publishable 키는 브라우저에 노출되므로, 키를 가진 누구나
-- 계획 리드타임과 사용 프로파일을 고칠 수 있었습니다.
--
-- 03-auth.sql 을 먼저 실행하세요. core.is_admin() 이 필요합니다.
-- ──────────────────────────────────────────────────────────────

-- 1) 수업용 정책 폐기 ──────────────────────────────────────────

drop policy if exists "수업용 전체 허용" on core.leadtime_plan;
drop policy if exists "수업용 전체 허용" on core.usage_profile;

revoke insert, update, delete on core.leadtime_plan  from anon, authenticated;
revoke insert, update, delete on core.usage_profile  from anon, authenticated;

-- 2) 정책값 쓰기는 관리자만 ────────────────────────────────────
--
-- renew.prd 4.2 — SCM 정책(리드타임 · 안전재고 · 서비스 수준)은 ADMIN 권한입니다.

grant insert, update, delete on core.leadtime_plan to authenticated;
grant insert, update, delete on core.usage_profile to authenticated;

alter table core.leadtime_plan enable row level security;
alter table core.usage_profile enable row level security;

drop policy if exists leadtime_plan_read on core.leadtime_plan;
create policy leadtime_plan_read on core.leadtime_plan
  for select to anon, authenticated
  using (true);

drop policy if exists leadtime_plan_write_admin on core.leadtime_plan;
create policy leadtime_plan_write_admin on core.leadtime_plan
  for all to authenticated
  using (core.is_admin())
  with check (core.is_admin());

drop policy if exists usage_profile_read on core.usage_profile;
create policy usage_profile_read on core.usage_profile
  for select to anon, authenticated
  using (true);

drop policy if exists usage_profile_write_admin on core.usage_profile;
create policy usage_profile_write_admin on core.usage_profile
  for all to authenticated
  using (core.is_admin())
  with check (core.is_admin());

-- 읽기를 anon 에도 남겨 두는 이유:
-- analytics 뷰가 postgres 소유(security definer)라 이 테이블을 대신 읽습니다.
-- 뷰 경로가 막히지 않도록 select 는 유지하고, 쓰기만 닫습니다.

-- 3) 확인 ──────────────────────────────────────────────────────
--
-- anon 에 insert/update/delete 가 남아 있으면 안 됩니다.

select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'core'
   and table_name in ('leadtime_plan', 'usage_profile')
   and grantee in ('anon', 'authenticated')
 order by grantee, privilege_type;

select tablename, policyname, cmd, roles
  from pg_policies
 where schemaname = 'core'
 order by tablename, policyname;
