-- STEP 7 실행 전제: STEP 2 → STEP 3 → STEP 4 → STEP 5 → STEP 6을 먼저 실행합니다.
-- Backtest 입력은 저장된 core.forecast_result와 core.v_test_actual만 사용합니다.

alter table core.forecast_setting add column if not exists champion_metric text not null default 'WAPE';
alter table core.forecast_setting add column if not exists reference_model_id text not null default 'WMA_3M';

create table if not exists core.backtest_run (
  backtest_run_id uuid primary key default gen_random_uuid(),
  forecast_run_id uuid not null references core.forecast_run(run_id),
  test_start date, test_end date, metric text not null, reference_model_id text,
  status text not null check (status in ('RUNNING', 'SUCCESS', 'FAILED')),
  started_at timestamptz not null default now(), finished_at timestamptz,
  triggered_by uuid references auth.users(id), message text
);

create table if not exists core.model_performance (
  backtest_run_id uuid not null references core.backtest_run(backtest_run_id) on delete cascade,
  forecast_run_id uuid not null references core.forecast_run(run_id),
  model_id text not null, model_version uuid not null references core.model_version(model_version), item_id text not null,
  n_periods integer not null default 0, wape numeric, mape numeric, bias numeric, rmse numeric, mae numeric,
  baseline_improvement numeric, rank integer, calculation_status text not null default 'SUCCESS', reason_code text,
  calculated_at timestamptz not null default now(),
  primary key (backtest_run_id, model_id, item_id)
);

create table if not exists core.champion_model_selection (
  selection_id uuid primary key default gen_random_uuid(),
  backtest_run_id uuid not null references core.backtest_run(backtest_run_id), item_id text not null,
  champion_model_id text, model_version uuid references core.model_version(model_version),
  champion_metric text not null, champion_metric_value numeric,
  wape numeric, mape numeric, bias numeric, rmse numeric, mae numeric,
  candidate_performance jsonb not null default '[]'::jsonb,
  selection_reason text not null, selection_method text not null check (selection_method in ('AUTO', 'MANUAL')),
  selected_at timestamptz not null default now(), selected_by uuid references auth.users(id)
);
create index if not exists model_performance_run_item_idx on core.model_performance (backtest_run_id, item_id, rank);
create index if not exists champion_selection_item_idx on core.champion_model_selection (item_id, selected_at desc);

comment on table core.model_performance is 'Bias = 평균(Forecast - Actual): 양수는 과대예측, 음수는 과소예측. MAPE는 Actual=0 기간을 제외한다.';
comment on column core.model_performance.wape is 'sum(abs(forecast-actual))/sum(abs(actual)); Actual 절대합 0이면 null.';

create or replace function core.run_backtest(p_forecast_run_id uuid)
returns uuid language plpgsql security definer set search_path = core, analytics, pg_temp as $$
declare v_backtest_id uuid := gen_random_uuid(); v_started timestamptz := clock_timestamp();
  v_test_start date; v_test_end date; v_metric text; v_reference text; v_actor uuid := auth.uid();
begin
  if not core.is_admin() then raise exception '관리자 권한이 필요합니다.' using errcode = '42501'; end if;
  insert into core.backtest_run(backtest_run_id, forecast_run_id, metric, status, started_at, triggered_by)
  values(v_backtest_id, p_forecast_run_id, 'WAPE', 'RUNNING', v_started, v_actor);
  begin
    if not exists(select 1 from core.forecast_run where run_id=p_forecast_run_id and status='SUCCESS') then raise exception 'SUCCESS Forecast Run만 Backtest할 수 있습니다.'; end if;
    select test_start,test_end,champion_metric,reference_model_id into v_test_start,v_test_end,v_metric,v_reference
    from core.forecast_setting where active and core.is_valid_forecast_window(train_start,train_end,test_start,test_end,granularity) order by updated_at desc limit 1;
    if v_test_start is null then raise exception '유효한 검증 기간 설정이 필요합니다.'; end if;
    update core.backtest_run set test_start=v_test_start,test_end=v_test_end,metric=v_metric,reference_model_id=v_reference where backtest_run_id=v_backtest_id;

    insert into core.model_performance(backtest_run_id,forecast_run_id,model_id,model_version,item_id,n_periods,wape,mape,bias,rmse,mae,calculation_status,reason_code)
    with actual as (
      select item_id,date_trunc('month',use_date)::date as period,sum(qty) as actual_qty,count(qty) as n_qty
      from core.v_test_actual group by item_id,date_trunc('month',use_date)::date
    ), candidates as (
      select distinct f.model_id,f.model_version,f.item_id from core.forecast_result f where f.run_id=p_forecast_run_id
    ), paired as (
      select f.model_id,f.model_version,f.item_id,f.period,f.predicted_qty,
        case when a.item_id is null then null when a.n_qty=0 then null else a.actual_qty end as actual_qty
      from core.forecast_result f left join actual a on a.item_id=f.item_id and a.period=f.period
      where f.run_id=p_forecast_run_id and f.period between v_test_start and v_test_end
    ), grouped as (
      select c.model_id,c.model_version,c.item_id,count(*) filter(where p.predicted_qty is not null and p.actual_qty is not null)::integer as n_periods,
        sum(abs(p.predicted_qty-p.actual_qty)) filter(where p.predicted_qty is not null and p.actual_qty is not null) as abs_error_sum,
        sum(abs(p.actual_qty)) filter(where p.predicted_qty is not null and p.actual_qty is not null) as abs_actual_sum,
        count(*) filter(where p.predicted_qty is not null and p.actual_qty is not null and p.actual_qty<>0) as mape_periods,
        avg(abs((p.predicted_qty-p.actual_qty)/nullif(p.actual_qty,0))) filter(where p.predicted_qty is not null and p.actual_qty<>0) as mape,
        avg(p.predicted_qty-p.actual_qty) filter(where p.predicted_qty is not null and p.actual_qty is not null) as bias,
        sqrt(avg(power(p.predicted_qty-p.actual_qty,2))) filter(where p.predicted_qty is not null and p.actual_qty is not null) as rmse,
        avg(abs(p.predicted_qty-p.actual_qty)) filter(where p.predicted_qty is not null and p.actual_qty is not null) as mae
      from candidates c left join paired p on p.model_id=c.model_id and p.model_version=c.model_version and p.item_id=c.item_id
      group by c.model_id,c.model_version,c.item_id
    )
    select v_backtest_id,p_forecast_run_id,model_id,model_version,item_id,n_periods,
      case when abs_actual_sum=0 then null else abs_error_sum/abs_actual_sum end,mape,bias,rmse,mae,
      case when n_periods=0 then 'UNAVAILABLE' when abs_actual_sum=0 then 'UNAVAILABLE' else 'SUCCESS' end,
      case when n_periods=0 then 'FORECAST_OR_ACTUAL_MISSING' when abs_actual_sum=0 then 'WAPE_ZERO_DENOMINATOR' when mape_periods=0 then 'MAPE_ZERO_DENOMINATOR' else null end
    from grouped;

    update core.model_performance p set baseline_improvement=(ref.wape-p.wape)/nullif(ref.wape,0)
    from core.model_performance ref where p.backtest_run_id=v_backtest_id and ref.backtest_run_id=p.backtest_run_id and ref.item_id=p.item_id and ref.model_id=v_reference and p.wape is not null and ref.wape is not null;
    with ranked as (
      select backtest_run_id,model_id,item_id,row_number() over(partition by item_id order by
        case v_metric when 'WAPE' then wape when 'MAPE' then mape when 'RMSE' then rmse when 'MAE' then mae end asc,
        abs(bias) asc nulls last,rmse asc nulls last,model_id asc) as position
      from core.model_performance where backtest_run_id=v_backtest_id and calculation_status='SUCCESS'
        and (case v_metric when 'WAPE' then wape when 'MAPE' then mape when 'RMSE' then rmse when 'MAE' then mae end) is not null
    ) update core.model_performance p set rank=r.position from ranked r where p.backtest_run_id=r.backtest_run_id and p.model_id=r.model_id and p.item_id=r.item_id;

    insert into core.champion_model_selection(backtest_run_id,item_id,champion_model_id,model_version,champion_metric,champion_metric_value,wape,mape,bias,rmse,mae,candidate_performance,selection_reason,selection_method,selected_by)
    select v_backtest_id,all_items.item_id,winner.model_id,winner.model_version,v_metric,
      case v_metric when 'WAPE' then winner.wape when 'MAPE' then winner.mape when 'RMSE' then winner.rmse when 'MAE' then winner.mae end,
      winner.wape,winner.mape,winner.bias,winner.rmse,winner.mae,
      (select jsonb_agg(jsonb_build_object('model_id',p.model_id,'model_version',p.model_version,'wape',p.wape,'mape',p.mape,'bias',p.bias,'rmse',p.rmse,'mae',p.mae,'rank',p.rank,'reason_code',p.reason_code) order by p.rank nulls last,p.model_id) from core.model_performance p where p.backtest_run_id=v_backtest_id and p.item_id=all_items.item_id),
      case when winner.model_id is null then 'NO_VALID_CANDIDATE' else 'LOWEST_'||v_metric||'_THEN_ABS_BIAS_RMSE_MODEL_ID' end,'AUTO',v_actor
    from (select distinct item_id from core.model_performance where backtest_run_id=v_backtest_id) all_items
    left join core.model_performance winner on winner.backtest_run_id=v_backtest_id and winner.item_id=all_items.item_id and winner.rank=1;
    update core.backtest_run set status='SUCCESS',finished_at=clock_timestamp(),message='Backtest scoring 완료' where backtest_run_id=v_backtest_id;
    return v_backtest_id;
  exception when others then
    update core.backtest_run set status='FAILED',finished_at=clock_timestamp(),message=sqlerrm where backtest_run_id=v_backtest_id;
    return v_backtest_id;
  end;
end; $$;

create or replace function core.select_manual_champion(p_backtest_run_id uuid,p_item_id text,p_model_id text,p_reason text)
returns uuid language plpgsql security definer set search_path=core,pg_temp as $$
declare v_perf core.model_performance%rowtype; v_id uuid := gen_random_uuid();
begin
  if not core.is_admin() then raise exception '관리자 권한이 필요합니다.' using errcode='42501'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception '수동 Champion 변경 사유는 필수입니다.' using errcode='22023'; end if;
  select * into v_perf from core.model_performance where backtest_run_id=p_backtest_run_id and item_id=p_item_id and model_id=p_model_id;
  if not found then raise exception '해당 Backtest 후보 성능을 찾을 수 없습니다.' using errcode='22023'; end if;
  insert into core.champion_model_selection(selection_id,backtest_run_id,item_id,champion_model_id,model_version,champion_metric,champion_metric_value,wape,mape,bias,rmse,mae,candidate_performance,selection_reason,selection_method,selected_by)
  values(v_id,p_backtest_run_id,p_item_id,p_model_id,v_perf.model_version,'MANUAL',v_perf.wape,v_perf.wape,v_perf.mape,v_perf.bias,v_perf.rmse,v_perf.mae,
    (select jsonb_agg(jsonb_build_object('model_id',model_id,'wape',wape,'mape',mape,'bias',bias,'rmse',rmse,'mae',mae,'rank',rank)) from core.model_performance where backtest_run_id=p_backtest_run_id and item_id=p_item_id),p_reason,'MANUAL',auth.uid());
  insert into core.audit_log(actor,action,target_type,target_id,before,after)
  values(auth.uid(),'CHAMPION_MANUALLY_CHANGED','champion_model',p_item_id,
    (select to_jsonb(c) from core.champion_model_selection c where c.item_id=p_item_id order by selected_at desc offset 1 limit 1),
    jsonb_build_object('selection_id',v_id,'backtest_run_id',p_backtest_run_id,'model_id',p_model_id,'reason',p_reason));
  return v_id;
end; $$;

create or replace view analytics.v_backtest_run as select * from core.backtest_run;
create or replace view analytics.v_model_performance as select p.*,r.metric,r.test_start,r.test_end from core.model_performance p join core.backtest_run r using(backtest_run_id);
create or replace view analytics.v_champion_model as select distinct on(item_id) * from core.champion_model_selection order by item_id,selected_at desc;
create or replace view analytics.v_model_comparison_detail as
with actual as (select item_id,date_trunc('month',use_date)::date as period,sum(qty) as actual_qty,count(qty) as n_qty from core.v_test_actual group by item_id,date_trunc('month',use_date)::date)
select f.run_id,f.model_id,f.item_id,f.period,f.p50,f.p80,f.p90,f.predicted_qty,case when a.n_qty=0 then null else a.actual_qty end as actual_qty
from core.forecast_result f left join actual a on a.item_id=f.item_id and a.period=f.period;

alter table core.backtest_run enable row level security; alter table core.model_performance enable row level security; alter table core.champion_model_selection enable row level security;
do $backtest_rls$ declare t text; begin foreach t in array array['backtest_run','model_performance','champion_model_selection'] loop
  execute format('create policy %I on core.%I for select to authenticated using(core.is_active_user())',t||'_active_select',t);
  execute format('create policy %I on core.%I for all to authenticated using(core.is_admin()) with check(core.is_admin())',t||'_admin_mutation',t);
end loop; end $backtest_rls$;
grant select,insert,update,delete on core.backtest_run,core.model_performance,core.champion_model_selection to authenticated;
grant select on analytics.v_backtest_run,analytics.v_model_performance,analytics.v_champion_model,analytics.v_model_comparison_detail to authenticated;
grant execute on function core.run_backtest(uuid),core.select_manual_champion(uuid,text,text,text) to authenticated;
revoke all on core.backtest_run,core.model_performance,core.champion_model_selection from anon;
revoke execute on function core.run_backtest(uuid),core.select_manual_champion(uuid,text,text,text) from anon;
