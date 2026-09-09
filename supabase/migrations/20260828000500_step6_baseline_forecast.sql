-- STEP 6 실행 전제: STEP 2 → STEP 3 → STEP 4 → STEP 5를 먼저 실행합니다.
-- Forecast 학습 입력은 core.v_train_demand로 한정하며 raw 또는 test actual을 직접 참조하지 않습니다.

alter table core.forecast_setting add column if not exists forecast_horizon integer not null default 3;
do $forecast_horizon_constraint$
begin
  if not exists (select 1 from pg_constraint where conname = 'forecast_setting_horizon_positive') then
    alter table core.forecast_setting add constraint forecast_setting_horizon_positive check (forecast_horizon > 0);
  end if;
end;
$forecast_horizon_constraint$;

create table if not exists core.model_config (
  model_id text primary key,
  model_name text not null,
  family text not null,
  engine text not null check (engine in ('SQL', 'PYTHON')),
  version text not null,
  enabled boolean not null default true,
  is_default boolean not null default false,
  applicable_demand_type text[] not null,
  parameters jsonb not null default '{}'::jsonb,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  check (applicable_demand_type <@ array['SMOOTH', 'INTERMITTENT', 'ERRATIC', 'LUMPY']::text[])
);

create table if not exists core.forecast_run (
  run_id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('RUNNING', 'SUCCESS', 'FAILED')),
  granularity text,
  train_start date,
  train_end date,
  horizon integer,
  champion_metric text,
  data_snapshot_at timestamptz,
  stale_at timestamptz,
  models jsonb not null default '[]'::jsonb,
  n_models integer not null default 0,
  n_items integer not null default 0,
  n_rows integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms bigint,
  triggered_by uuid references auth.users(id),
  triggered_email text,
  note text,
  message text
);

create table if not exists core.model_version (
  model_version uuid primary key default gen_random_uuid(),
  run_id uuid not null references core.forecast_run(run_id) on delete cascade,
  model_id text not null,
  version text not null,
  definition jsonb not null,
  parameters jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (run_id, model_id)
);

create table if not exists core.forecast_result (
  run_id uuid not null references core.forecast_run(run_id) on delete cascade,
  model_id text not null,
  item_id text not null,
  period date not null,
  model_version uuid not null references core.model_version(model_version),
  predicted_qty numeric,
  p50 numeric,
  p80 numeric,
  p90 numeric,
  sigma numeric,
  basis jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (run_id, model_id, item_id, period)
);

create index if not exists forecast_run_status_started_idx on core.forecast_run (status, started_at desc);
create index if not exists model_version_run_idx on core.model_version (run_id, model_id);
create index if not exists forecast_result_run_item_idx on core.forecast_result (run_id, item_id, period);

insert into core.model_config (model_id, model_name, family, engine, version, enabled, is_default, applicable_demand_type, parameters, description)
values
  ('MA_3M', '3개월 이동평균', 'MOVING_AVERAGE', 'SQL', '1.0.0', true, false, array['SMOOTH', 'ERRATIC'], '{"window": 3}'::jsonb, '최근 3개 월 학습 수요의 단순 평균'),
  ('MA_6M', '6개월 이동평균', 'MOVING_AVERAGE', 'SQL', '1.0.0', true, false, array['SMOOTH', 'ERRATIC'], '{"window": 6}'::jsonb, '최근 6개 월 학습 수요의 단순 평균'),
  ('WMA_3M', '3개월 가중이동평균', 'WEIGHTED_MOVING_AVERAGE', 'SQL', '1.0.0', true, true, array['SMOOTH', 'ERRATIC'], '{"window": 3, "weights": [3, 2, 1]}'::jsonb, '최근순 3:2:1 가중치'),
  ('PY_SAME_MONTH', '전년 동월', 'SEASONAL', 'SQL', '1.0.0', true, false, array['SMOOTH', 'ERRATIC'], '{"lag_months": 12}'::jsonb, '예측 월의 전년 동월 학습 Actual'),
  ('SEASONAL_NAIVE', '계절성 나이브', 'SEASONAL', 'SQL', '1.0.0', true, false, array['SMOOTH', 'ERRATIC'], '{"seasonal_lag_months": 12}'::jsonb, '직전 연도의 같은 달 학습 Actual')
on conflict (model_id) do nothing;

create or replace function core.run_baseline_forecast(p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = core, analytics, pg_temp
as $$
declare
  v_run_id uuid := gen_random_uuid();
  v_started_at timestamptz := clock_timestamp();
  v_train_start date;
  v_train_end date;
  v_granularity text;
  v_horizon integer;
  v_snapshot_at timestamptz;
  v_actor uuid := auth.uid();
  v_email text;
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;

  insert into core.forecast_run (run_id, status, triggered_by, note, started_at)
  values (v_run_id, 'RUNNING', v_actor, p_note, v_started_at);

  begin
  select train_start, train_end, granularity, forecast_horizon
    into v_train_start, v_train_end, v_granularity, v_horizon
  from core.forecast_setting
  where active
    and core.is_valid_forecast_window(train_start, train_end, test_start, test_end, granularity)
  order by updated_at desc
  limit 1;

  if v_train_start is null or v_granularity <> 'MONTH' then
    update core.forecast_run
    set status = 'FAILED', finished_at = clock_timestamp(),
      duration_ms = floor(extract(epoch from clock_timestamp() - v_started_at) * 1000),
      message = '유효한 MONTH granularity 학습 설정이 필요합니다.'
    where run_id = v_run_id;
    return v_run_id;
  end if;

  select email into v_email from core.app_user where user_id = v_actor;
  select max(loaded_at) into v_snapshot_at from core.v_train_demand;

  update core.forecast_run
  set granularity = v_granularity, train_start = v_train_start, train_end = v_train_end,
    horizon = v_horizon, data_snapshot_at = v_snapshot_at, triggered_email = v_email
  where run_id = v_run_id;

  insert into core.model_version (run_id, model_id, version, definition, parameters, created_by)
  select v_run_id, c.model_id, c.version,
    jsonb_build_object('model_name', c.model_name, 'family', c.family, 'engine', c.engine,
      'applicable_demand_type', c.applicable_demand_type, 'parameters', c.parameters, 'description', c.description),
    c.parameters, v_actor
  from core.model_config c
  where c.enabled and c.engine = 'SQL';

  if not exists (select 1 from core.model_version where run_id = v_run_id) then
    update core.forecast_run
    set status = 'FAILED', finished_at = clock_timestamp(),
      duration_ms = floor(extract(epoch from clock_timestamp() - v_started_at) * 1000),
      message = '실행 가능한 SQL 모델이 없습니다.'
    where run_id = v_run_id;
    return v_run_id;
  end if;

  create temp table baseline_models on commit drop as
  select mv.model_version, mv.model_id, mv.parameters,
    array(select jsonb_array_elements_text(mv.definition -> 'applicable_demand_type')) as applicable_demand_type
  from core.model_version mv
  where mv.run_id = v_run_id;

  create temp table baseline_grid on commit drop as
  with periods as (
    select generate_series(date_trunc('month', v_train_start), date_trunc('month', v_train_end), interval '1 month')::date as period
  ), demand as (
    select item_id, date_trunc('month', use_date)::date as period, sum(qty) as qty, count(qty) as n_qty
    from core.v_train_demand
    group by item_id, date_trunc('month', use_date)::date
  )
  select i.item_id, p.period,
    case when d.item_id is null then 0::numeric when d.n_qty = 0 then null::numeric else d.qty end as qty,
    profile.demand_type
  from core.v_item_master i
  cross join periods p
  left join demand d on d.item_id = i.item_id and d.period = p.period
  left join analytics.v_sku_demand_profile profile on profile.item_id = i.item_id;

  create temp table baseline_fitted on commit drop as
  select m.model_version, m.model_id, g.item_id, g.period, g.qty as actual_qty,
    case
      when m.model_id in ('MA_3M', 'MA_6M') then (
        select case when count(*) = (m.parameters ->> 'window')::integer and count(qty) = (m.parameters ->> 'window')::integer then avg(qty) end
        from (select qty from baseline_grid h where h.item_id = g.item_id and h.period < g.period order by h.period desc limit (m.parameters ->> 'window')::integer) history
      )
      when m.model_id = 'WMA_3M' then (
        select case when count(*) = jsonb_array_length(m.parameters -> 'weights') and count(qty) = jsonb_array_length(m.parameters -> 'weights') then
          sum(qty * (m.parameters -> 'weights' ->> ((rn - 1)::integer))::numeric)
          / nullif(sum((m.parameters -> 'weights' ->> ((rn - 1)::integer))::numeric), 0) end
        from (select qty, row_number() over (order by period desc) as rn from baseline_grid h where h.item_id = g.item_id and h.period < g.period order by h.period desc limit jsonb_array_length(m.parameters -> 'weights')) history
      )
      when m.model_id = 'PY_SAME_MONTH' then (select qty from baseline_grid h where h.item_id = g.item_id and h.period = (g.period - make_interval(months => (m.parameters ->> 'lag_months')::integer))::date)
      when m.model_id = 'SEASONAL_NAIVE' then (select qty from baseline_grid h where h.item_id = g.item_id and h.period = (g.period - make_interval(months => (m.parameters ->> 'seasonal_lag_months')::integer))::date)
      else null
    end as fitted_qty
  from baseline_grid g
  join baseline_models m on g.demand_type = any(m.applicable_demand_type);

  create temp table baseline_sigma on commit drop as
  select model_version, model_id, item_id, stddev_samp(actual_qty - fitted_qty) as sigma
  from baseline_fitted
  where actual_qty is not null and fitted_qty is not null
  group by model_version, model_id, item_id;

  create temp table baseline_candidates on commit drop as
  select m.model_version, m.model_id, m.parameters, m.applicable_demand_type,
    i.item_id, i.demand_type, target.period
  from baseline_models m
  join (select distinct item_id, demand_type from baseline_grid) i on i.demand_type = any(m.applicable_demand_type)
  cross join lateral (
    select generate_series(
      date_trunc('month', v_train_end) + interval '1 month',
      date_trunc('month', v_train_end) + make_interval(months => v_horizon),
      interval '1 month'
    )::date as period
  ) target;

  insert into core.forecast_result (run_id, model_id, item_id, period, model_version, predicted_qty, p50, p80, p90, sigma, basis)
  select v_run_id, c.model_id, c.item_id, c.period, c.model_version,
    forecast.predicted_qty, forecast.predicted_qty,
    case when forecast.predicted_qty is null or s.sigma is null then null else forecast.predicted_qty + 0.841621234 * s.sigma end,
    case when forecast.predicted_qty is null or s.sigma is null then null else forecast.predicted_qty + 1.281551566 * s.sigma end,
    s.sigma,
    jsonb_build_object('source', 'TRAIN_ONLY', 'parameters', c.parameters,
      'reason_code', case when forecast.predicted_qty is null then 'INSUFFICIENT_HISTORY' when s.sigma is null then 'SIGMA_UNAVAILABLE' else null end)
  from baseline_candidates c
  left join baseline_sigma s on s.model_version = c.model_version and s.item_id = c.item_id
  cross join lateral (
    select case
      when c.model_id in ('MA_3M', 'MA_6M') then (
        select case when count(*) = (c.parameters ->> 'window')::integer and count(qty) = (c.parameters ->> 'window')::integer then avg(qty) end
        from (select qty from baseline_grid h where h.item_id = c.item_id and h.period <= v_train_end order by h.period desc limit (c.parameters ->> 'window')::integer) history
      )
      when c.model_id = 'WMA_3M' then (
        select case when count(*) = jsonb_array_length(c.parameters -> 'weights') and count(qty) = jsonb_array_length(c.parameters -> 'weights') then
          sum(qty * (c.parameters -> 'weights' ->> ((rn - 1)::integer))::numeric)
          / nullif(sum((c.parameters -> 'weights' ->> ((rn - 1)::integer))::numeric), 0) end
        from (select qty, row_number() over (order by period desc) as rn from baseline_grid h where h.item_id = c.item_id and h.period <= v_train_end order by h.period desc limit jsonb_array_length(c.parameters -> 'weights')) history
      )
      when c.model_id in ('PY_SAME_MONTH', 'SEASONAL_NAIVE') then (
        select qty from baseline_grid h where h.item_id = c.item_id and h.period = (c.period - make_interval(months => (c.parameters ->> (case when c.model_id = 'PY_SAME_MONTH' then 'lag_months' else 'seasonal_lag_months' end))::integer))::date
      )
      else null
    end as predicted_qty
  ) forecast;

  update core.forecast_run r
  set status = 'SUCCESS',
    models = coalesce((select jsonb_agg(jsonb_build_object('model_id', model_id, 'model_version', model_version, 'parameters', parameters) order by model_id) from baseline_models), '[]'::jsonb),
    n_models = (select count(*) from baseline_models),
    n_items = (select count(distinct item_id) from core.forecast_result where run_id = v_run_id and predicted_qty is not null),
    n_rows = (select count(*) from core.forecast_result where run_id = v_run_id),
    finished_at = clock_timestamp(),
    duration_ms = floor(extract(epoch from clock_timestamp() - v_started_at) * 1000),
    message = 'SQL Baseline Forecast 실행 완료'
  where r.run_id = v_run_id;
  return v_run_id;
  exception when others then
    update core.forecast_run
    set status = 'FAILED', finished_at = clock_timestamp(),
      duration_ms = floor(extract(epoch from clock_timestamp() - v_started_at) * 1000),
      message = sqlerrm
    where run_id = v_run_id;
    return v_run_id;
  end;
end;
$$;

create or replace view analytics.v_model_config as
select model_id, model_name, family, engine, version, enabled, is_default, applicable_demand_type, parameters, description, updated_at, updated_by
from core.model_config;

create or replace view analytics.v_forecast_run as
select r.*,
  coalesce(r.stale_at is not null or exists (
    select 1 from core.upload_batch b
    where b.status = 'IMPORTED'
      and b.import_type in ('usage_history', 'sales_order', 'business_event')
      and r.data_snapshot_at is not null
      and b.imported_at > r.data_snapshot_at
  ), false) as is_stale
from core.forecast_run r;

create or replace view analytics.v_forecast_result as
select f.run_id, f.model_id, f.item_id, i.item_name, f.period, f.model_version,
  f.predicted_qty, f.p50, f.p80, f.p90, f.sigma, f.basis, f.created_at
from core.forecast_result f
left join core.v_item_master i on i.item_id = f.item_id;

create or replace view analytics.v_forecast_run_kpi as
select count(*) as total_runs,
  count(*) filter (where status = 'SUCCESS') as success_runs,
  count(*) filter (where status = 'FAILED') as failed_runs,
  count(*) filter (where is_stale) as stale_runs,
  max(finished_at) filter (where status = 'SUCCESS') as latest_success_at
from analytics.v_forecast_run;

alter table core.model_config enable row level security;
alter table core.forecast_run enable row level security;
alter table core.model_version enable row level security;
alter table core.forecast_result enable row level security;

do $forecast_updated_at$
begin
  if to_regprocedure('core.set_updated_at()') is not null then
    execute 'drop trigger if exists model_config_set_updated_at on core.model_config';
    execute 'create trigger model_config_set_updated_at before update on core.model_config for each row execute function core.set_updated_at()';
  end if;
end;
$forecast_updated_at$;

do $forecast_rls$
declare table_name text;
begin
  foreach table_name in array array['model_config', 'forecast_run', 'model_version', 'forecast_result'] loop
    execute format('drop policy if exists %I on core.%I', table_name || '_active_select', table_name);
    execute format('drop policy if exists %I on core.%I', table_name || '_admin_mutation', table_name);
    execute format('create policy %I on core.%I for select to authenticated using (core.is_active_user())', table_name || '_active_select', table_name);
    execute format('create policy %I on core.%I for all to authenticated using (core.is_admin()) with check (core.is_admin())', table_name || '_admin_mutation', table_name);
  end loop;
end;
$forecast_rls$;

grant select, insert, update, delete on core.model_config, core.forecast_run, core.model_version, core.forecast_result to authenticated;
grant select on analytics.v_model_config, analytics.v_forecast_run, analytics.v_forecast_result, analytics.v_forecast_run_kpi to authenticated;
grant execute on function core.run_baseline_forecast(text) to authenticated;
revoke all on core.model_config, core.forecast_run, core.model_version, core.forecast_result from anon;
revoke execute on function core.run_baseline_forecast(text) from anon;
