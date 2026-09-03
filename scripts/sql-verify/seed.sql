-- ──────────────────────────────────────────────────────────────
-- Harness seed: make the derived tables non-empty.
--
-- Why this exists
-- ───────────────
-- The dump carries the raw layer (shipment_log, usage_history,
-- inventory, item_master, ...) but NOT the derived layer that STEP 6+
-- introduced: core.forecast_run, core.forecast_result,
-- core.champion_model, core.alert are all empty after a cold load.
--
-- Without them, every downstream file (15..20) takes only its
-- "no forecast" branch: v_projection_item returns
-- CALCULATION_UNAVAILABLE / NO_FORECAST for all 20 items, and the real
-- arithmetic is never executed. A file can PASS while its main code
-- path is broken.
--
-- So this file drives the project's own entry points to fill the
-- derived layer, then run.sh re-runs every project file with data
-- present. Pass 2 is where runtime errors inside function bodies and
-- views actually surface.
--
-- Nothing here is invented data. Everything is produced by the
-- project's own functions from the dump's real rows.
-- ──────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on

-- ── 1) An admin identity ──────────────────────────────────────
--
-- Real Supabase: GoTrue inserts into auth.users when someone signs up,
-- and the on_auth_user_created trigger from sql/03-auth.sql mirrors the
-- row into core.app_user with role USER. An operator then promotes it
-- (sql/05-first-admin.sql).
--
-- Here we insert into auth.users directly, which exercises that same
-- trigger, then promote. The fixed UUID lets later steps impersonate.
--
-- Difference from Supabase: no password, no email confirmation, no JWT.
-- Impersonation is `set request.jwt.claim.sub`, which auth.uid() reads.

insert into auth.users (id, email, raw_user_meta_data)
values (
  '00000000-0000-0000-0000-0000000000a1',
  'harness-admin@example.invalid',
  '{"name":"Harness Admin","department":"SCM"}'::jsonb
)
on conflict (id) do nothing;

update core.app_user
   set role = 'ADMIN', active = true
 where user_id = '00000000-0000-0000-0000-0000000000a1';

-- Impersonate that admin for the rest of this session. Every function
-- below is gated on core.is_admin().
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

select auth.uid() as impersonating, core.is_admin() as is_admin;

-- ── 2) Baseline forecast ──────────────────────────────────────
-- sql/11-forecast-engine.sql. Fills core.forecast_run and
-- core.forecast_result from raw.usage_history / raw.shipment_log.

select * from core.run_baseline_forecast('sql-verify harness seed');

-- ── 3) Backtest, which elects a champion model per item ───────
-- sql/13-backtest.sql. Fills core.backtest_run, core.model_performance
-- and core.champion_model. analytics.v_consensus_forecast reads the
-- champion, so without this the consensus falls back and several
-- downstream branches stay unreachable.

select * from core.run_backtest(null, 'sql-verify harness seed');

-- ── 4) Alert scan ─────────────────────────────────────────────
-- sql/20-alert.sql. Fills core.alert.

select * from core.scan_alerts();

-- ── 5) What the seed produced ─────────────────────────────────

select 'core.forecast_run'     as tbl, count(*) from core.forecast_run
union all select 'core.forecast_result',  count(*) from core.forecast_result
union all select 'core.backtest_run',     count(*) from core.backtest_run
union all select 'core.model_performance',count(*) from core.model_performance
union all select 'core.champion_model',   count(*) from core.champion_model
union all select 'core.alert',            count(*) from core.alert
union all select 'core.app_user',         count(*) from core.app_user
order by 1;
