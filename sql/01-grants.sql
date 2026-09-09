-- STEP2 운영 권한 기준입니다.
-- 신규 환경에서는 supabase/migrations/20260828000100_step2_auth_rbac.sql을 적용하세요.

revoke all on schema core from anon;
revoke all on schema analytics from anon;
revoke all on all tables in schema core from anon;
revoke all on all tables in schema analytics from anon;
revoke all on public.planning_runs, public.ol_demand, public.sfdc_pipeline, public.bulk_deals,
  public.historical_actuals, public.demand_confirmations from anon;

grant usage on schema core, analytics to authenticated;
grant select on all tables in schema analytics to authenticated;
grant select on core.app_user, core.audit_log, core.leadtime_plan, core.usage_profile to authenticated;
grant select on public.planning_runs, public.ol_demand, public.sfdc_pipeline, public.bulk_deals,
  public.historical_actuals, public.demand_confirmations to authenticated;

alter default privileges in schema core revoke all on tables from anon;
alter default privileges in schema analytics revoke all on tables from anon;
alter default privileges in schema analytics grant select on tables to authenticated;
