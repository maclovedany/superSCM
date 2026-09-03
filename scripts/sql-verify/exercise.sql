-- ──────────────────────────────────────────────────────────────
-- Harness pass 3: call every write-path RPC once.
--
-- Why this exists
-- ───────────────
-- Loading a file only proves its function bodies PARSE. PostgreSQL
-- checks plpgsql syntax at CREATE FUNCTION time but resolves the tables
-- and columns inside the body lazily, at first execution. A function
-- that selects a column that does not exist creates fine and fails the
-- first time the app calls it.
--
-- These RPCs are never called by any project file's own verification
-- block, so nothing under sql/ ever executes them:
--
--   core.import_commit            core.rollback_batch
--   core.run_virtual_operation    core.set_forecast_override
--   core.clear_forecast_override  core.approve_recommendation
--   core.acknowledge_alert        core.set_leadtime_plan
--   core.set_champion_manual      core.save_agent_turn
--
-- STEP 20 added three more. seed.sql calls run_baseline_forecast() and
-- run_backtest(null) with their DEFAULT arguments, which only ever takes
-- the VALIDATION path. The PRODUCTION branch of run_baseline_forecast and
-- the two "this is a production run, refuse it" guards were therefore
-- never executed by any pass -- which is how a critical defect in
-- run_virtual_operation survived a 25/25 run. They are exercised below:
--
--   core.run_baseline_forecast(note, 'PRODUCTION')
--   core.run_backtest(<production run>)          -> must refuse
--   core.run_virtual_operation(<production run>) -> must refuse
--
-- Each is called once here with arguments taken from the seeded data,
-- inside its own SAVEPOINT so one failure does not poison the rest, and
-- the whole thing is ROLLED BACK at the end.
--
-- Nothing is asserted about the RESULT. The only question is whether the
-- body executes without raising an internal error. A "does not exist" or
-- "column ... does not exist" here is a genuine runtime defect; a clean
-- domain-level raise (e.g. "batch not found") is the function working.
-- ──────────────────────────────────────────────────────────────

\set ON_ERROR_STOP off

begin;

set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

-- Fixtures pulled from the seeded data, so every argument is a real key.
select
  coalesce((select item_id from analytics.v_consensus_forecast order by period, item_id limit 1),
           (select item_id from core.champion_model order by item_id limit 1))    as item1,
  coalesce((select champion_model_id from core.champion_model
             where champion_model_id is not null limit 1), 'MA3')                 as model1,
  coalesce((select supplier_id from analytics.v_leadtime_gap order by supplier_id limit 1),
           'SUP001')                                                              as sup1,
  coalesce((select min(alert_id)::text from core.alert where resolved_at is null),
           '0')                                                                   as alert1,
  coalesce((select min(period)::text from analytics.v_consensus_forecast),
           (current_date + 30)::text)                                             as period1
\gset

\echo '### FIXTURES' :item1 :model1 :sup1 :alert1 :period1

\echo '### EXERCISE core.set_leadtime_plan'
savepoint sp; select * from core.set_leadtime_plan(:'sup1', 21, 'harness'); rollback to sp;

\echo '### EXERCISE core.set_forecast_override'
savepoint sp; select * from core.set_forecast_override(:'item1', :'period1'::date, 123, 'PROMOTION', 'harness');

-- clear_forecast_override is run inside the SAME savepoint so it has a
-- real override to remove; rolled back together afterwards.
\echo '### EXERCISE core.clear_forecast_override'
select * from core.clear_forecast_override(:'item1', :'period1'::date); rollback to sp;

\echo '### EXERCISE core.set_champion_manual'
savepoint sp; select * from core.set_champion_manual(:'item1', :'model1', 'harness'); rollback to sp;

\echo '### EXERCISE core.run_virtual_operation'
savepoint sp; select * from core.run_virtual_operation(null, 'harness'); rollback to sp;

-- ── STEP 20: the run-mode paths ───────────────────────────────
--
-- One savepoint holds all three, because the two guards need a real
-- PRODUCTION run to refuse and the first call is what creates it.
--
-- Read the OUTPUT of the last two, not just their exit status: each must
-- come back with a refusal message and a null id. A row with an id means
-- the guard is gone and the simulation just scored a run whose forecasts
-- all sit outside the window.
savepoint sp;

\echo '### EXERCISE core.run_baseline_forecast (PRODUCTION)'
select * from core.run_baseline_forecast('harness production', 'PRODUCTION');

\echo '### EXERCISE core.run_backtest refuses a PRODUCTION run'
select * from core.run_backtest(
  (select r.run_id from core.forecast_run r
    where r.mode = 'PRODUCTION' and r.status = 'SUCCESS'
    order by r.started_at desc limit 1),
  'harness');

\echo '### EXERCISE core.run_virtual_operation refuses a PRODUCTION run'
select * from core.run_virtual_operation(
  (select r.run_id from core.forecast_run r
    where r.mode = 'PRODUCTION' and r.status = 'SUCCESS'
    order by r.started_at desc limit 1),
  'harness');

rollback to sp;

\echo '### EXERCISE core.approve_recommendation'
savepoint sp; select * from core.approve_recommendation(:'item1', 100, 'APPROVED', 'OTHER', 'harness'); rollback to sp;

\echo '### EXERCISE core.acknowledge_alert'
savepoint sp; select * from core.acknowledge_alert(:'alert1'::bigint); rollback to sp;

\echo '### EXERCISE core.save_agent_turn'
savepoint sp; select * from core.save_agent_turn(
  'conv-harness-1', 'harness', 'question',
  '{"text":"harness"}'::jsonb, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb); rollback to sp;

-- import_commit / rollback_batch need a staged upload batch, which would
-- mean replaying sql/08-import.sql's staging contract. They are called
-- with an id that does not exist: that still executes the lookup, so a
-- bad column reference would surface, and the correct outcome is a clean
-- domain error rather than an internal one.
\echo '### EXERCISE core.import_commit (missing batch: a clean domain error is a PASS)'
savepoint sp; select * from core.import_commit('batch-does-not-exist'); rollback to sp;

\echo '### EXERCISE core.rollback_batch (missing batch: a clean domain error is a PASS)'
savepoint sp; select * from core.rollback_batch('batch-does-not-exist'); rollback to sp;

rollback;
