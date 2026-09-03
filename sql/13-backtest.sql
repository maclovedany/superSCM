-- ★ 영업 가림막 — analytics.v_model_performance · v_champion_model · v_backtest_kpi 의 최종 정의는 sql/29-sales-column-guard.sql 에 있습니다 (renew.prd 4.4 · 4.5).
-- ──────────────────────────────────────────────────────────────
-- ★ core.run_backtest() 의 최종 정의는 sql/27-admin-ops.sql 입니다
--   (검증 실행만 채점 · 실패해도 이력 행이 남음). 이 파일을 다시 실행했다면 sql/27 도 이어서 실행하세요.
-- STEP 7 · Backtest Engine + Champion Model
--
-- renew.prd 13장 · 14장 · 16장
--   "WAPE 와 Bias 를 핵심 KPI 로 사용한다. MAPE 단독 사용은 지양한다.
--    수요가 0에 가까운 달에서 MAPE 가 발산하기 때문이다."
--   "후보 전체 성능을 함께 저장해야 왜 이 모델이 뽑혔는지를 화면에서 보여줄 수 있다."
--
-- 여기서 만드는 것
--   core  backtest_run       실행 이력
--   core  model_performance  품목 × 모델별 지표
--   core  champion_model     품목별 Champion + 후보 전체 성능
--   core  run_backtest()     채점 함수
--   core  set_champion_manual()  관리자 수동 지정 (사유 필수)
--   analytics  v_model_performance · v_champion_model · v_item_series · v_backtest_run
--
-- sql/12-forecast-summary.sql 까지 먼저 실행하세요.
-- ──────────────────────────────────────────────────────────────

-- ══ 1. 실행 이력 ═══════════════════════════════════════════════

create table if not exists core.backtest_run (
  backtest_run_id  text primary key,
  forecast_run_id  text not null references core.forecast_run(run_id) on delete cascade,
  status           text not null default 'RUNNING'
                     check (status in ('RUNNING', 'SUCCESS', 'FAILED')),
  champion_metric  text not null default 'WAPE',
  baseline_model   text,
  test_start       date,
  test_end         date,
  n_models         int not null default 0,
  n_items          int not null default 0,
  n_rows           int not null default 0,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  duration_ms      int,
  triggered_by     uuid references auth.users(id) on delete set null,
  triggered_email  text,
  note             text,
  message          text
);

create index if not exists backtest_run_started_idx on core.backtest_run(started_at desc);

-- ══ 2. 성능 지표 ═══════════════════════════════════════════════

create table if not exists core.model_performance (
  backtest_run_id      text not null references core.backtest_run(backtest_run_id) on delete cascade,
  model_id             text not null,
  model_version        text,
  item_id              text not null,
  n_periods            int  not null,
  actual_sum           numeric,
  wape                 numeric,   -- Σ|A−F| / ΣA · 핵심 KPI
  mape                 numeric,   -- A=0 인 기간은 제외합니다
  bias                 numeric,   -- Σ(F−A) / ΣA · 부호로 과대/과소를 구분
  rmse                 numeric,
  mae                  numeric,
  baseline_improvement numeric,   -- 기준 모델 대비 WAPE 개선율
  metric_value         numeric,   -- champion_metric 으로 고른 값
  rank                 int,
  -- 지표를 낼 수 없는 경우의 사유. 숫자로 채우지 않습니다
  reason               text,
  primary key (backtest_run_id, model_id, item_id)
);

create index if not exists model_performance_item_idx
  on core.model_performance(item_id, rank);

-- ══ 3. Champion ════════════════════════════════════════════════

create table if not exists core.champion_model (
  item_id            text primary key,
  backtest_run_id    text references core.backtest_run(backtest_run_id) on delete set null,
  champion_model_id  text,
  model_version      text,
  champion_metric    text,
  metric_value       numeric,
  wape               numeric,
  mape               numeric,
  bias               numeric,
  rmse               numeric,
  mae                numeric,
  baseline_improvement numeric,
  -- renew.prd 14.2 — 후보 전체 성능을 함께 저장합니다.
  -- 이게 있어야 "왜 이 모델이 뽑혔는지" 를 화면에서 보여줄 수 있습니다.
  candidates         jsonb,
  selection_method   text not null default 'AUTO' check (selection_method in ('AUTO', 'MANUAL')),
  reason             text,
  selected_at        timestamptz not null default now(),
  selected_by        uuid references auth.users(id) on delete set null
);

comment on table core.champion_model is
  'renew.prd 14장 — 품목별 Champion. candidates 에 후보 전체 성능이 들어갑니다';

-- ══ 4. 실적 시계열 (차트용) ════════════════════════════════════
--
-- 학습 구간과 검증 구간을 한 줄로 잇습니다.
-- 차트가 어디까지가 학습이고 어디부터 검증인지 구분해 그릴 수 있어야 합니다.

create or replace view analytics.v_item_series as
select item_id, period, quantity, 'TRAIN'::text as segment
  from core.v_train_demand
union all
select item_id, period, quantity, 'TEST'::text
  from core.v_test_actual;

comment on view analytics.v_item_series is
  '품목별 실적. segment 로 학습/검증 구간을 구분합니다 (차트 음영용)';

-- ══ 5. 채점 함수 ★ ═════════════════════════════════════════════

-- 주의: 반환 컬럼 이름(backtest_run_id · n_models · n_items · n_rows · message)이
--       core.backtest_run / core.model_performance 의 컬럼과 겹칩니다.
--       본문에서 테이블 컬럼을 참조할 때는 반드시 별칭을 붙이세요 (error.md #11).
create or replace function core.run_backtest(
  p_forecast_run_id text default null,
  p_note            text default null
)
returns table (backtest_run_id text, n_models int, n_items int, n_rows int, message text)
language plpgsql
security definer
set search_path = core, public
as $$
declare
  s          core.forecast_setting%rowtype;
  fr         core.forecast_run%rowtype;
  v_id       text;
  v_started  timestamptz := clock_timestamp();
  v_metric   text;
  v_baseline text;
  v_models   int;
  v_items    int;
  v_rows     int;
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다';
  end if;

  select * into s from core.forecast_setting where id = 1;

  -- 지정하지 않으면 가장 최근 성공한 예측 실행을 채점합니다.
  if p_forecast_run_id is null then
    select * into fr from core.forecast_run
     where status = 'SUCCESS' order by started_at desc limit 1;
  else
    select * into fr from core.forecast_run where run_id = p_forecast_run_id;
  end if;

  if not found then
    return query select null::text, 0, 0, 0, '채점할 예측 실행이 없습니다'::text;
    return;
  end if;

  v_metric := coalesce(s.champion_metric, 'WAPE');
  select model_id into v_baseline
    from core.model_config where is_default order by model_id limit 1;
  v_baseline := coalesce(v_baseline, 'MA_3M');

  v_id := 'bt_' || to_char(v_started, 'YYYYMMDDHH24MISS') || '_' ||
          lpad((extract(milliseconds from v_started)::int % 1000)::text, 3, '0');

  insert into core.backtest_run
    (backtest_run_id, forecast_run_id, status, champion_metric, baseline_model,
     test_start, test_end, triggered_by, triggered_email, note)
  select v_id, fr.run_id, 'RUNNING', v_metric, v_baseline,
         s.test_start, s.test_end, auth.uid(),
         (select email from core.app_user where user_id = auth.uid()), p_note;

  -- ── 지표 계산 ───────────────────────────────────────────────
  --
  -- 예측과 실적이 같은 기간에 둘 다 있을 때만 채점합니다.
  -- 겹치는 기간이 없으면 행을 만들지 않습니다.

  with matched as (
    select f.model_id, f.model_version, f.item_id, f.period,
           f.predicted_qty as fcst,
           a.quantity      as actual
      from core.forecast_result f
      join core.v_test_actual a
        on a.item_id = f.item_id and a.period = f.period
     where f.run_id = fr.run_id
       and f.predicted_qty is not null
  ),
  agg as (
    select
      model_id, model_version, item_id,
      count(*)                                   as n_periods,
      sum(actual)                                as actual_sum,
      -- WAPE = Σ|A−F| / ΣA. 분모가 0 이면 낼 수 없습니다.
      case when sum(actual) > 0
           then sum(abs(actual - fcst)) / sum(actual) end          as wape,
      -- MAPE 는 A=0 인 기간을 빼고 계산합니다 (발산 방지).
      case when count(*) filter (where actual > 0) > 0
           then avg(abs(actual - fcst) / nullif(actual, 0))
                  filter (where actual > 0) end                    as mape,
      -- Bias 는 부호를 남깁니다. 양수면 과대예측입니다.
      case when sum(actual) > 0
           then sum(fcst - actual) / sum(actual) end               as bias,
      sqrt(avg(power(actual - fcst, 2)))                           as rmse,
      avg(abs(actual - fcst))                                      as mae
    from matched
    group by model_id, model_version, item_id
  ),
  base as (
    select item_id, wape as baseline_wape
      from agg where model_id = v_baseline
  ),
  scored as (
    select
      a.*,
      case when b.baseline_wape is not null and b.baseline_wape > 0
           then (b.baseline_wape - a.wape) / b.baseline_wape end   as baseline_improvement,
      case v_metric
        when 'MAPE' then a.mape
        when 'RMSE' then a.rmse
        when 'MAE'  then a.mae
        when 'BIAS' then abs(a.bias)
        else             a.wape
      end                                                          as metric_value
    from agg a
    left join base b using (item_id)
  )
  insert into core.model_performance
    (backtest_run_id, model_id, model_version, item_id, n_periods, actual_sum,
     wape, mape, bias, rmse, mae, baseline_improvement, metric_value, rank, reason)
  select
    v_id, s2.model_id, s2.model_version, s2.item_id, s2.n_periods,
    round(s2.actual_sum, 0),
    round(s2.wape, 4), round(s2.mape, 4), round(s2.bias, 4),
    round(s2.rmse, 2), round(s2.mae, 2),
    round(s2.baseline_improvement, 4),
    round(s2.metric_value, 4),
    case when s2.metric_value is not null
         then rank() over (partition by s2.item_id
                           order by s2.metric_value asc nulls last) end,
    case when s2.actual_sum is null or s2.actual_sum = 0 then 'NO_ACTUAL'
         when s2.metric_value is null                    then 'INSUFFICIENT_SAMPLE'
         else null end
  from scored s2;

  get diagnostics v_rows = row_count;

  select count(distinct p.model_id), count(distinct p.item_id)
    into v_models, v_items
    from core.model_performance p where p.backtest_run_id = v_id;

  -- ── Champion 선정 ───────────────────────────────────────────
  --
  -- renew.prd 14.2 — 후보 전체 성능을 함께 저장합니다.
  -- 관리자가 수동으로 지정한 품목은 건드리지 않습니다 (사유가 남아 있으므로).

  -- ★ backtest_run_id 는 이 함수의 반환 컬럼 이름이기도 합니다.
  --   한정하지 않으면 "column reference is ambiguous" 가 납니다 (error.md #11).
  with cand as (
    select p.item_id,
           jsonb_agg(jsonb_build_object(
             'model_id', p.model_id, 'wape', p.wape, 'mape', p.mape, 'bias', p.bias,
             'rmse', p.rmse, 'mae', p.mae, 'baseline_improvement', p.baseline_improvement,
             'rank', p.rank, 'reason', p.reason
           ) order by p.rank nulls last) as candidates
      from core.model_performance p
     where p.backtest_run_id = v_id
     group by p.item_id
  ),
  best as (
    select distinct on (p.item_id) p.*
      from core.model_performance p
     where p.backtest_run_id = v_id and p.rank = 1
     order by p.item_id, p.metric_value asc
  )
  insert into core.champion_model
    (item_id, backtest_run_id, champion_model_id, model_version, champion_metric,
     metric_value, wape, mape, bias, rmse, mae, baseline_improvement,
     candidates, selection_method, reason, selected_at)
  select b.item_id, v_id, b.model_id, b.model_version, v_metric,
         b.metric_value, b.wape, b.mape, b.bias, b.rmse, b.mae, b.baseline_improvement,
         c.candidates, 'AUTO',
         v_metric || ' ' || round(b.metric_value * 100, 1) || '% 로 후보 중 가장 좋았습니다',
         now()
    from best b join cand c using (item_id)
  on conflict (item_id) do update set
    backtest_run_id      = excluded.backtest_run_id,
    champion_model_id    = excluded.champion_model_id,
    model_version        = excluded.model_version,
    champion_metric      = excluded.champion_metric,
    metric_value         = excluded.metric_value,
    wape                 = excluded.wape,
    mape                 = excluded.mape,
    bias                 = excluded.bias,
    rmse                 = excluded.rmse,
    mae                  = excluded.mae,
    baseline_improvement = excluded.baseline_improvement,
    candidates           = excluded.candidates,
    selection_method     = 'AUTO',
    reason               = excluded.reason,
    selected_at          = now(),
    selected_by          = null
  -- 수동 지정은 덮어쓰지 않습니다. 사람이 사유를 적어 고른 것이기 때문입니다.
  where champion_model.selection_method <> 'MANUAL';

  update core.backtest_run as r
     set status = 'SUCCESS', n_models = v_models, n_items = v_items, n_rows = v_rows,
         finished_at = clock_timestamp(),
         duration_ms = (extract(epoch from (clock_timestamp() - v_started)) * 1000)::int,
         message = v_rows || '행을 채점했습니다'
   where r.backtest_run_id = v_id;

  return query select v_id, v_models, v_items, v_rows,
                      (v_rows || '행을 채점했습니다')::text;
exception
  when others then
    update core.backtest_run as r
       set status = 'FAILED', finished_at = clock_timestamp(), message = SQLERRM
     where r.backtest_run_id = v_id;
    return query select v_id, 0, 0, 0, ('채점에 실패했습니다: ' || SQLERRM)::text;
end;
$$;

revoke all on function core.run_backtest(text, text) from public, anon;
grant execute on function core.run_backtest(text, text) to authenticated;

-- ══ 6. Champion 수동 지정 ══════════════════════════════════════
--
-- renew.prd 14.3 — "성능이 조금 낮아도 설명 가능성 때문에 단순 모델을 택할 수 있으며,
--                   사유를 필수로 남긴다."

create or replace function core.set_champion_manual(
  p_item_id  text,
  p_model_id text,
  p_reason   text
)
returns table (ok boolean, message text)
language plpgsql
security definer
set search_path = core, public
as $$
declare
  perf core.model_performance%rowtype;
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    return query select false, '사유를 반드시 입력해야 합니다'::text;
    return;
  end if;

  select * into perf
    from core.model_performance p
   where p.item_id = p_item_id and p.model_id = p_model_id
   order by p.backtest_run_id desc
   limit 1;

  if not found then
    return query select false, '이 품목에 대한 해당 모델의 성능 기록이 없습니다'::text;
    return;
  end if;

  update core.champion_model as c
     set champion_model_id    = p_model_id,
         model_version        = perf.model_version,
         metric_value         = perf.metric_value,
         wape                 = perf.wape,
         mape                 = perf.mape,
         bias                 = perf.bias,
         rmse                 = perf.rmse,
         mae                  = perf.mae,
         baseline_improvement = perf.baseline_improvement,
         selection_method     = 'MANUAL',
         reason               = p_reason,
         selected_at          = now(),
         selected_by          = auth.uid()
   where c.item_id = p_item_id;

  if not found then
    return query select false, '이 품목의 Champion 기록이 없습니다. 먼저 백테스트를 실행하세요'::text;
    return;
  end if;

  return query select true, (p_item_id || ' 의 Champion 을 ' || p_model_id || ' 로 지정했습니다')::text;
end;
$$;

revoke all on function core.set_champion_manual(text, text, text) from public, anon;
grant execute on function core.set_champion_manual(text, text, text) to authenticated;

-- ══ 7. analytics 뷰 ════════════════════════════════════════════

create or replace view analytics.v_backtest_run as
select b.*,
       (select count(*) from core.model_performance p
         where p.backtest_run_id = b.backtest_run_id) as perf_rows
  from core.backtest_run b;

create or replace view analytics.v_model_performance as
select p.*, m.model_name, m.family, im.item_name,
       (c.champion_model_id = p.model_id) as is_champion
  from core.model_performance p
  left join core.model_config m using (model_id)
  left join core.v_item_master im using (item_id)
  left join core.champion_model c on c.item_id = p.item_id;

create or replace view analytics.v_champion_model as
select c.*, m.model_name, m.family, im.item_name,
       d.demand_type, d.demand_type_reason
  from core.champion_model c
  left join core.model_config m on m.model_id = c.champion_model_id
  left join core.v_item_master im using (item_id)
  left join analytics.v_sku_demand_profile d using (item_id);

create or replace view analytics.v_backtest_kpi as
select
  (select count(*) from core.champion_model)                         as n_champions,
  (select count(*) from core.champion_model where selection_method = 'MANUAL') as n_manual,
  (select round(avg(wape), 4) from core.champion_model)              as avg_wape,
  (select round(avg(abs(bias)), 4) from core.champion_model)         as avg_abs_bias,
  (select count(*) from core.champion_model where baseline_improvement > 0) as n_better_than_baseline,
  (select count(*) from core.backtest_run)                           as n_runs,
  (select max(started_at) from core.backtest_run)                    as last_run_at;

-- ══ 8. 권한 ════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array['backtest_run','model_performance','champion_model'] loop
    execute format('grant select, insert, update, delete on core.%I to authenticated', t);
    execute format('revoke all on core.%I from anon', t);
    execute format('alter table core.%I enable row level security', t);
    execute format('drop policy if exists %I on core.%I', t || '_read', t);
    execute format('create policy %I on core.%I for select to authenticated using (true)',
                   t || '_read', t);
    execute format('drop policy if exists %I on core.%I', t || '_write_admin', t);
    execute format('create policy %I on core.%I for all to authenticated
                      using (core.is_admin()) with check (core.is_admin())',
                   t || '_write_admin', t);
  end loop;
end $$;

grant select on analytics.v_backtest_run      to authenticated;
grant select on analytics.v_model_performance to authenticated;
grant select on analytics.v_champion_model    to authenticated;
grant select on analytics.v_backtest_kpi      to authenticated;
grant select on analytics.v_item_series       to authenticated;

-- ══ 9. 확인 ════════════════════════════════════════════════════
--
-- 실행해 보려면 (관리자 세션에서):
--   select * from core.run_backtest();

select 'backtest_run' as t, count(*) from core.backtest_run
union all select 'model_performance', count(*) from core.model_performance
union all select 'champion_model',    count(*) from core.champion_model;
