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

-- ── STEP 18 What-If — Base 가 뷰와 같은가 ★ ───────────────────
--
-- 이 두 확인은 원래 sql/24-what-if.sql 끝에 있었습니다. 품목마다 시뮬레이션을
-- 다시 돌려 30~55초가 걸리는데, Supabase SQL Editor 가 그 전에 끊어
-- 파일 전체가 실패했습니다(error.md #28). 그래서 그 파일에서는 주석 처리하고
-- 확인은 여기로 옮겼습니다. **여기서 빠지면 아무도 안 보게 되므로** 옮긴 것입니다.
--
-- 빈 params 로 돌린 Base 가 뷰와 다르면 그 위에 세운 시나리오는 전부 장식입니다.
-- 둘 다 0 이어야 합니다.

\echo '### EXERCISE what-if Base = 뷰 (0 이어야 PASS)'
-- ★ 실데이터는 품목이 9,000개가 넘어 전부 돌리면 300초를 넘습니다. 표본 40개로 봅니다 —
--   함수와 뷰가 같은 규칙인지 확인하는 데는 충분합니다.
with s as (
  select r.item_id, core.fn_scenario_summary(r.item_id, '{}'::jsonb) as base
    from (select item_id from analytics.v_stockout_risk order by item_id limit 40) r
)
select count(*) as base_vs_view_mismatches
  from s
  join analytics.v_stockout_risk                r  on r.item_id  = s.item_id
  left join analytics.v_safety_stock            ss on ss.item_id = s.item_id
  left join analytics.v_purchase_recommendation pr on pr.item_id = s.item_id
 where (s.base ->> 'stockout_date')::date       is distinct from r.stockout_date
    or  s.base ->> 'risk'                       is distinct from r.risk_status
    or  coalesce(s.base ->> 'reason', '')       is distinct from coalesce(r.reason, '')
    or (s.base ->> 'safety_stock')::numeric     is distinct from ss.safety_stock
    or (s.base ->> 'order_qty')::numeric        is distinct from pr.final_recommended_qty
    or (s.base ->> 'required_order_date')::date is distinct from pr.required_order_date
    or round((s.base ->> 'daily_demand')::numeric, 10)
         is distinct from round(ss.daily_demand::numeric, 10)
    or round((s.base ->> 'sigma_dlt')::numeric, 10)
         is distinct from round(ss.sigma_dlt::numeric, 10)
    or (s.base ->> 'window_demand_qty')::numeric is distinct from pr.consensus_forecast
    or (s.base ->> 'raw_order_qty')::numeric     is distinct from pr.raw_recommended_qty
    or (s.base ->> 'z_value')::numeric           is distinct from ss.z_value
    or (s.base ->> 'current_stock')::numeric     is distinct from pr.current_inventory;

\echo '### EXERCISE what-if Base 전개 = v_inventory_projection (0 이어야 PASS)'
-- ★ 표본 40품목만 (위와 같은 이유). 뷰 쪽도 같은 40품목으로 좁혀야 full join 이 맞습니다.
with sample as (
  select distinct ip.item_id from analytics.v_inventory_projection ip order by 1 limit 40
),
fp as (
  select p.item_id, f.period, f.opening_qty, f.receipt_qty, f.demand_qty, f.closing_qty
    from sample p
    cross join lateral core.fn_projection(p.item_id, '{}'::jsonb) f
)
select count(*) as projection_mismatches
  from fp
  full join (select v.* from analytics.v_inventory_projection v join sample using (item_id)) v
    on v.item_id = fp.item_id and v.period = fp.period
 where fp.item_id is null
    or v.item_id  is null
    or fp.opening_qty is distinct from v.opening_qty
    or fp.receipt_qty is distinct from v.receipt_qty
    or fp.demand_qty  is distinct from v.demand_qty
    or fp.closing_qty is distinct from v.closing_qty;

rollback;
