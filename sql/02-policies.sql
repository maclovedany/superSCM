-- STEP2 관리자 mutation 정책입니다.
-- 전체 정의는 supabase/migrations/20260828000100_step2_auth_rbac.sql에 있습니다.

revoke insert, update, delete on core.leadtime_plan from anon;
revoke insert, update, delete on core.usage_profile from anon;

grant insert, update, delete on core.leadtime_plan to authenticated;
grant insert, update, delete on core.usage_profile to authenticated;

drop policy if exists "수업용 전체 허용" on core.leadtime_plan;
drop policy if exists "수업용 전체 허용" on core.usage_profile;

drop policy if exists leadtime_plan_admin_insert on core.leadtime_plan;
create policy leadtime_plan_admin_insert on core.leadtime_plan for insert to authenticated with check (core.is_admin());
drop policy if exists leadtime_plan_admin_update on core.leadtime_plan;
create policy leadtime_plan_admin_update on core.leadtime_plan for update to authenticated using (core.is_admin()) with check (core.is_admin());
drop policy if exists leadtime_plan_admin_delete on core.leadtime_plan;
create policy leadtime_plan_admin_delete on core.leadtime_plan for delete to authenticated using (core.is_admin());

drop policy if exists usage_profile_admin_insert on core.usage_profile;
create policy usage_profile_admin_insert on core.usage_profile for insert to authenticated with check (core.is_admin());
drop policy if exists usage_profile_admin_update on core.usage_profile;
create policy usage_profile_admin_update on core.usage_profile for update to authenticated using (core.is_admin()) with check (core.is_admin());
drop policy if exists usage_profile_admin_delete on core.usage_profile;
create policy usage_profile_admin_delete on core.usage_profile for delete to authenticated using (core.is_admin());
