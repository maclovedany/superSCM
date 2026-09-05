-- 37. 계획 뷰 캐시 — 화면이 읽는 무거운 뷰를 실체화합니다 (error.md #36)
--
-- 왜
--   안전재고 → 발주 추천 → 재고 전개 → 대시보드 KPI 는 품목 62,592개 위에서 서로를 다시 계산합니다.
--   뷰 하나는 0.5~2초지만, 대시보드처럼 여럿을 한 요청에 조인하는 뷰는 같은 계산을 여러 번 인라인해
--   15~20초가 되고(work_mem 2 MB 라 해시 조인이 디스크로 넘칩니다), 화면은 30초 시간 제한에 걸립니다.
--   실행 결과 통계(v_forecast_run_model · v_forecast_run_detail)는 forecast_result 110만 행을 매번 훑어 8~24초입니다.
--
-- 어떻게
--   ① 무거운 뷰의 **정의를 그대로** materialized view 로 복사하고, 뷰는 `select * from mv` 로 바꿉니다.
--      컬럼 이름 · 순서 · 타입이 같아 그 위의 뷰 29개와 화면 코드는 손대지 않습니다.
--      sql/29 가 영업용 가림 뷰(`_src`)를 만든 뷰는 `_src` 쪽을 실체화합니다.
--   ② forecast_result 의 실행 × 모델 통계를 mv_forecast_run_stat 으로 두고 실행 뷰 3개가 그것을 읽습니다.
--   ③ core.refresh_planning_cache(scope) 가 새로 계산합니다 — 실행이 끝날 때 'ALL'(finalize_run_storage),
--      보정 · 승인 · 정책 저장 뒤 'PLANNING'(앱 Server Action 이 응답 뒤 after() 로), pg_cron 이 있으면 매시간 'ALL'.
--
-- 순서: 31 → 29 → **37** → 28. 16 · 15 · 12 · 27 등 원본 뷰를 다시 돌렸다면 37 도 다시 돌립니다
--       (원본 뷰가 되살아나 느려진 상태를 37 이 다시 캐시로 바꿉니다).

-- ══ 0. 무료 플랜 인스턴스 메모리 — 화면 쪽 롤의 정렬·해시 작업 메모리 ═══
-- 기본 2 MB 로는 6만 행 해시 조인이 디스크로 넘칩니다. 동시 접속이 적은 관리 화면이라 16 MB 면 충분합니다.
alter role authenticated set work_mem = '16MB';

-- ══ 1. 도구 — 뷰 정의를 그대로 실체화하고, 뷰를 그 위로 올립니다 ═══
create table if not exists core.planning_cache_log (
  refreshed_at timestamptz not null default now(),
  duration_ms  int,
  detail       jsonb
);

create or replace function core.__cache_view(p_view regclass, p_mv text, p_index_cols text default null)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_def   text;
  v_schema text; v_name text;
  v_mv    regclass := to_regclass(p_mv);
begin
  select n.nspname, c.relname into v_schema, v_name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = p_view;
  v_def := pg_get_viewdef(p_view, true);

  -- 이미 캐시 위에 올라간 뷰면(정의가 mv 를 읽음) 다시 만들지 않습니다 — 새 mv 를 옛 mv 로 채우는 순환을 막습니다.
  if v_mv is not null and position(p_mv in v_def) > 0 then
    return format('%s: 이미 %s 를 읽습니다', p_view::text, p_mv);
  end if;

  execute format('drop materialized view if exists %s', p_mv);
  execute format('create materialized view %s as %s', p_mv, v_def);
  if p_index_cols is not null then
    execute format('create index on %s (%s)', p_mv, p_index_cols);
  end if;
  execute format('analyze %s', p_mv);
  -- 뷰를 캐시 위로. 컬럼이 같으므로 이 뷰를 읽는 위 뷰들은 그대로 살아 있습니다.
  execute format('create or replace view %I.%I as select * from %s', v_schema, v_name, p_mv);
  return format('%s → %s 실체화', p_view::text, p_mv);
end;
$$;
revoke all on function core.__cache_view(regclass, text, text) from public, anon, authenticated;

-- ══ 2. 계획 뷰 — 의존 순서대로 (아래가 위를 읽습니다) ═══
-- 실체화 대상은 "같은 계산이 여러 뷰에서 반복되는" 층입니다. 그 위의 얇은 뷰는 그대로 둡니다.
select core.__cache_view('analytics.v_inventory_projection',  'core.mv_inventory_projection',  'item_id, period');
select core.__cache_view('analytics.v_stockout_risk',         'core.mv_stockout_risk',         'item_id');
select core.__cache_view('analytics.v_demand_window',         'core.mv_demand_window',         'item_id');
select core.__cache_view(
  case when to_regclass('analytics.v_safety_stock_src') is not null
       then 'analytics.v_safety_stock_src' else 'analytics.v_safety_stock' end::regclass,
  'core.mv_safety_stock', 'item_id');
select core.__cache_view('analytics.v_purchase_recommendation', 'core.mv_purchase_recommendation', 'item_id');
select core.__cache_view('analytics.v_chart_demand_trend',    'core.mv_chart_demand_trend',    null);
select core.__cache_view('analytics.v_chart_projection_total', 'core.mv_chart_projection_total', null);
select core.__cache_view('analytics.v_dashboard_sparkline',    'core.mv_dashboard_sparkline',   'item_id');
-- 실적만 읽는 차트 — 데이터 적재 · 실행 뒤에만 바뀝니다
select core.__cache_view('analytics.v_shipment_trend',         'core.mv_shipment_trend',        null);
select core.__cache_view('analytics.v_chart_usage_heatmap',    'core.mv_chart_usage_heatmap',   null);
select core.__cache_view('analytics.v_item_demand_profile',   'core.mv_item_demand_profile',   'item_code');  -- v_item_demand_kpi 는 이 위의 집계
select core.__cache_view(
  case when to_regclass('analytics.v_champion_model_src') is not null
       then 'analytics.v_champion_model_src' else 'analytics.v_champion_model' end::regclass,
  'core.mv_champion_model', 'item_id');

-- ══ 3. 실행 × 모델 통계 — forecast_result 를 요청마다 훑지 않습니다 ═══
-- 다시 돌려도 됩니다 — 아래 실행 뷰 3개가 이 표를 읽으므로 drop 하지 않고, 정의를 바꿀 때만 손으로 지웁니다.
create materialized view if not exists core.mv_forecast_run_stat as
select f.run_id, f.model_id, f.model_version,
       count(distinct f.item_id)::int                 as n_items,
       count(*)::int                                  as n_rows,
       min(f.period)                                  as first_period,
       max(f.period)                                  as last_period,
       count(*) filter (where f.p80 is not null)::int as n_with_interval,
       round(sum(f.predicted_qty), 0)                 as total_qty
  from core.forecast_result f
 group by f.run_id, f.model_id, f.model_version;
create index if not exists mv_forecast_run_stat_run_idx on core.mv_forecast_run_stat (run_id);

-- 컬럼 이름 · 순서 · 타입은 sql/12 · sql/11 · sql/27 의 정의와 같습니다 (create or replace 조건).
create or replace view analytics.v_forecast_run_model as
select
  s.run_id,
  s.model_id,
  m.model_name,
  m.family,
  sum(s.n_rows)::bigint          as n_rows,
  sum(s.n_items)::bigint         as n_items,
  round(sum(s.total_qty), 0)     as total_qty
from core.mv_forecast_run_stat s
left join core.model_config m using (model_id)
group by s.run_id, s.model_id, m.model_name, m.family;

create or replace view analytics.v_forecast_run as
select r.*,
       coalesce((select sum(s.n_rows) from core.mv_forecast_run_stat s where s.run_id = r.run_id), 0)::bigint as result_rows,
       (r.data_snapshot_at is not null
        and r.data_snapshot_at < (select d.data_loaded_at from core.v_data_loaded_at d)) as is_stale
  from core.forecast_run r;

create or replace view analytics.v_forecast_run_detail as
with per_model as (
  select s.run_id, s.model_id, s.model_version, s.n_items, s.n_rows, s.first_period, s.last_period, s.n_with_interval
    from core.mv_forecast_run_stat s
),
run_agg as (
  select s.run_id,
         max(s.n_items)::int                as run_items,
         count(distinct s.model_id)::int    as run_models,
         sum(s.n_rows)::int                 as run_rows,
         min(s.first_period)                as run_first_period,
         max(s.last_period)                 as run_last_period
    from core.mv_forecast_run_stat s
   group by s.run_id
),
bt as (
  select b.forecast_run_id,
         count(*)::int as n_backtests,
         (array_agg(b.backtest_run_id order by b.started_at desc))[1] as backtest_run_id
    from core.backtest_run b
   where b.status = 'SUCCESS'
   group by b.forecast_run_id
),
sim as (
  select v.forecast_run_id,
         count(*)::int as n_simulations,
         (array_agg(v.simulation_id order by v.started_at desc))[1] as simulation_id
    from core.simulation_run v
   where v.status = 'SUCCESS'
   group by v.forecast_run_id
),
loaded as (
  select d.data_loaded_at as loaded_at from core.v_data_loaded_at d
)
select r.run_id,
       r.mode,
       r.status,
       r.granularity,
       r.train_start,
       r.train_end,
       r.horizon,
       r.champion_metric,
       r.data_snapshot_at,
       r.started_at,
       r.finished_at,
       r.duration_ms,
       r.triggered_email,
       r.note,
       r.message,
       coalesce(ra.run_items, 0)   as run_items,
       coalesce(ra.run_models, 0)  as run_models,
       coalesce(ra.run_rows, 0)    as run_rows,
       ra.run_first_period,
       ra.run_last_period,
       (bt.backtest_run_id is not null) as has_backtest,
       bt.backtest_run_id,
       (sim.simulation_id is not null)  as has_simulation,
       sim.simulation_id,
       (r.data_snapshot_at is not null
        and l.loaded_at is not null
        and r.data_snapshot_at < l.loaded_at) as is_stale,
       pm.model_id,
       mc.model_name,
       mc.family,
       mc.engine,
       pm.model_version,
       pm.n_items,
       pm.n_rows,
       pm.first_period,
       pm.last_period,
       pm.n_with_interval
  from core.forecast_run r
  cross join loaded l
  left join run_agg  ra  on ra.run_id  = r.run_id
  left join per_model pm on pm.run_id  = r.run_id
  left join bt           on bt.forecast_run_id  = r.run_id
  left join sim          on sim.forecast_run_id = r.run_id
  left join core.model_config mc on mc.model_id = pm.model_id;

grant select on analytics.v_forecast_run_model  to authenticated;
grant select on analytics.v_forecast_run        to authenticated;
grant select on analytics.v_forecast_run_detail to authenticated;

-- ══ 4. 새로 계산 — 실행 끝 · 저장 뒤 · 매시간 ═══
drop function if exists core.refresh_planning_cache();
drop function if exists core.refresh_planning_cache(text);
create or replace function core.refresh_planning_cache(p_scope text default 'ALL')
returns table (refreshed int, duration_ms int)
language plpgsql
security definer
set search_path = core, public
set statement_timeout = '0'
as $$
declare
  t0 timestamptz := clock_timestamp();
  -- PLANNING: 보정 · 승인 · 정책 저장이 바꾸는 층 (Consensus 아래). 약 15~20초.
  -- ALL: 실행 · 백테스트 · 적재 뒤 — 실행 통계 · 수요 패턴 · Champion 까지 (약 50초, 실행 안에서 돕니다).
  v_planning text[] := array[
    'core.mv_inventory_projection', 'core.mv_stockout_risk', 'core.mv_demand_window',
    'core.mv_safety_stock', 'core.mv_purchase_recommendation',
    'core.mv_chart_demand_trend', 'core.mv_chart_projection_total', 'core.mv_dashboard_sparkline'];
  v_all text[] := array['core.mv_forecast_run_stat', 'core.mv_item_demand_profile', 'core.mv_champion_model',
                        'core.mv_shipment_trend', 'core.mv_chart_usage_heatmap'] || v_planning;
  v_names text[] := case when upper(coalesce(p_scope, 'ALL')) = 'PLANNING' then v_planning else v_all end;
  v_n int := 0; v_name text;
begin
  foreach v_name in array v_names loop
    if to_regclass(v_name) is not null then
      execute format('refresh materialized view %s', v_name);
      execute format('analyze %s', v_name);
      v_n := v_n + 1;
    end if;
  end loop;
  insert into core.planning_cache_log (duration_ms, detail)
  values (extract(milliseconds from clock_timestamp() - t0)::int,
          jsonb_build_object('refreshed', v_n, 'scope', upper(coalesce(p_scope, 'ALL'))));
  delete from core.planning_cache_log where refreshed_at < now() - interval '30 days';
  return query select v_n, extract(milliseconds from clock_timestamp() - t0)::int;
end;
$$;
revoke all on function core.refresh_planning_cache(text) from public, anon;
grant execute on function core.refresh_planning_cache(text) to authenticated;

-- 마지막으로 새로 계산한 시각 — 화면의 "기준 시각" 표시용
create or replace view analytics.v_planning_cache as
select max(l.refreshed_at) as refreshed_at,
       (select l2.duration_ms from core.planning_cache_log l2 order by l2.refreshed_at desc limit 1) as duration_ms
  from core.planning_cache_log l;
grant select on analytics.v_planning_cache to authenticated;

-- pg_cron 이 켜져 있으면(Supabase → Database → Extensions → pg_cron) 매시간 새로 계산합니다.
-- current_date 를 쓰는 재고 소진 · 발주 창 계산이 날짜가 바뀌어도 맞도록.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'planning-cache-hourly';
    perform cron.schedule('planning-cache-hourly', '5 * * * *', 'select core.refresh_planning_cache()');
    raise notice 'pg_cron: planning-cache-hourly 등록';
  else
    raise notice 'pg_cron 없음 — 실행 끝 · 저장 뒤에만 새로 계산합니다. 매시간 갱신을 원하면 pg_cron 을 켜고 37 을 다시 돌리세요';
  end if;
end $$;

-- 첫 계산
select * from core.refresh_planning_cache('ALL');

-- 확인 — 화면 시간(1000행 표본)
select 'v_dashboard_kpi' as v, count(*) from analytics.v_dashboard_kpi
union all select 'v_purchase_recommendation', count(*) from (select * from analytics.v_purchase_recommendation limit 1000) t
union all select 'v_forecast_run_model', count(*) from analytics.v_forecast_run_model;
