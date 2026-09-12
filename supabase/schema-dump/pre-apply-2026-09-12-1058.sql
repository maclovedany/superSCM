--
-- PostgreSQL database dump
--

\restrict JYwI5f0Nhx4pGxuyZtmaO5LeNsVhacVeaEZZwtmztZi9igE3rxmNVNexndWkAcn

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: analytics; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA analytics;


--
-- Name: core; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA core;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: raw; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA raw;


--
-- Name: audit_app_user_change(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.audit_app_user_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'pg_temp'
    AS $$
begin
  if old.role is distinct from new.role then
    insert into core.audit_log (actor, action, target_type, target_id, before, after)
    values (
      auth.uid(), 'USER_ROLE_CHANGED', 'app_user', new.user_id::text,
      jsonb_build_object('role', old.role, 'active', old.active),
      jsonb_build_object('role', new.role, 'active', new.active)
    );
  end if;

  if old.active is distinct from new.active then
    insert into core.audit_log (actor, action, target_type, target_id, before, after)
    values (
      auth.uid(), 'USER_ACTIVE_CHANGED', 'app_user', new.user_id::text,
      jsonb_build_object('role', old.role, 'active', old.active),
      jsonb_build_object('role', new.role, 'active', new.active)
    );
  end if;
  return new;
end;
$$;


--
-- Name: commit_import_batch(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.commit_import_batch(p_batch_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'raw', 'pg_temp'
    AS $_$
declare b core.upload_batch%rowtype; table_name text; r record; payload jsonb;
begin
  if not core.is_admin() then raise exception '관리자 권한이 필요합니다.' using errcode='42501'; end if;
  select * into b from core.upload_batch where batch_id=p_batch_id for update;
  if not found or b.status <> 'VALIDATED' or b.error_rows > 0 then raise exception '검증 완료 및 오류 0건인 batch만 적재할 수 있습니다.' using errcode='22023'; end if;
  table_name := core.import_target_table(b.import_type); if table_name is null then raise exception '지원하지 않는 Import Type입니다.'; end if;
  if b.import_mode='replace' then execute format('insert into core.import_row_backup(batch_id,target_table,row_data,backup_reason) select $1,$2,to_jsonb(t),''REPLACE'' from raw.%I t',table_name) using p_batch_id,table_name; execute format('delete from raw.%I',table_name); end if;
  for r in select row_number,mapped_data from core.import_staging where batch_id=p_batch_id and validation_status in ('SUCCESS','WARNING') order by row_number loop
    payload := r.mapped_data || jsonb_build_object('batch_id',p_batch_id,'source_type','FILE_UPLOAD','loaded_at',now(),'source_record_id',coalesce(r.mapped_data->>'source_record_id',r.row_number::text));
    if b.import_type='inventory' then payload := jsonb_build_object('품목코드',payload->>'item_id','창고',payload->>'warehouse','현재고',payload->>'current_stock','기준일자',payload->>'reference_date','안전재고',payload->>'safety_stock','batch_id',p_batch_id,'source_type','FILE_UPLOAD','loaded_at',now(),'source_record_id',payload->>'source_record_id');
    elsif b.import_type='item_master' then payload := jsonb_build_object('품목코드',payload->>'item_id','품목명',payload->>'item_name','품목구분',payload->>'item_type','단위',payload->>'unit','supplier_id',payload->>'supplier_id','batch_id',p_batch_id,'source_type','FILE_UPLOAD','loaded_at',now(),'source_record_id',payload->>'source_record_id');
    elsif b.import_type='supplier_master' then payload := jsonb_build_object('공급업체코드',payload->>'supplier_id','공급업체명',payload->>'supplier_name','국가',payload->>'country','batch_id',p_batch_id,'source_type','FILE_UPLOAD','loaded_at',now(),'source_record_id',payload->>'source_record_id');
    elsif b.import_type='purchase_order' then payload := jsonb_build_object('발주번호',payload->>'source_record_id','발주일',payload->>'order_date','공급업체',payload->>'supplier_id','품목코드',payload->>'item_id','발주수량',payload->>'qty','batch_id',p_batch_id,'source_type','FILE_UPLOAD','loaded_at',now(),'source_record_id',payload->>'source_record_id');
    elsif b.import_type='goods_receipt' then payload := jsonb_build_object('입고번호',payload->>'source_record_id','품목코드',payload->>'item_id','입고수량',payload->>'qty','입고일',payload->>'receipt_date','batch_id',p_batch_id,'source_type','FILE_UPLOAD','loaded_at',now(),'source_record_id',payload->>'source_record_id'); end if;
    if b.import_mode='upsert' then execute format('insert into core.import_row_backup(batch_id,target_table,row_data,backup_reason) select $1,$2,to_jsonb(t),''UPSERT'' from raw.%I t where t.source_type=''FILE_UPLOAD'' and t.source_record_id=$3',table_name) using p_batch_id,table_name,payload->>'source_record_id'; execute format('delete from raw.%I where source_type=''FILE_UPLOAD'' and source_record_id=$1',table_name) using payload->>'source_record_id'; end if;
    execute format('insert into raw.%I select * from jsonb_populate_record(null::raw.%I,$1)',table_name,table_name) using payload;
  end loop;
  update core.upload_batch set status='IMPORTED', imported_at=now(), forecast_stale_marked=b.import_type in ('usage_history','sales_order','business_event') where batch_id=p_batch_id;
  if b.import_type in ('usage_history','sales_order','business_event') and to_regclass('core.forecast_run') is not null then execute 'update core.forecast_run set stale_at=now() where data_snapshot_at < now() and stale_at is null'; end if;
end; $_$;


--
-- Name: handle_new_auth_user(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.handle_new_auth_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'auth', 'pg_temp'
    AS $$
begin
  insert into core.app_user (user_id, email, name, department, role, active)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    nullif(new.raw_user_meta_data ->> 'department', ''),
    'USER',
    true
  )
  on conflict (user_id) do update
    set email = excluded.email,
        name = case when core.app_user.name = '' then excluded.name else core.app_user.name end,
        updated_at = now();
  return new;
end;
$$;


--
-- Name: import_target_table(text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.import_target_table(p_type text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case p_type when 'usage_history' then 'usage_history' when 'inventory' then 'inventory' when 'item_master' then 'item_master' when 'supplier_master' then 'supplier_master' when 'purchase_order' then 'purchase_order' when 'goods_receipt' then 'goods_receipt' when 'sales_order' then 'sales_order' when 'business_event' then 'business_event' end;
$$;


--
-- Name: is_active_user(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.is_active_user(check_user_id uuid DEFAULT auth.uid()) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'core', 'pg_temp'
    AS $$
  select exists (
    select 1
      from core.app_user
     where user_id = check_user_id
       and active = true
  );
$$;


--
-- Name: is_admin(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.is_admin(check_user_id uuid DEFAULT auth.uid()) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'core', 'pg_temp'
    AS $$
  select exists (
    select 1
      from core.app_user
     where user_id = check_user_id
       and role = 'ADMIN'
       and active = true
  );
$$;


--
-- Name: is_business_day(date, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.is_business_day(p_date date, p_country text DEFAULT 'KR'::text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select coalesce(
    (select c.is_business_day
       from core.business_calendar c
      where c.country_code = p_country and c.calendar_date = p_date),
    extract(isodow from p_date) between 1 and 5
  );
$$;


--
-- Name: is_valid_forecast_window(date, date, date, date, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.is_valid_forecast_window(p_train_start date, p_train_end date, p_test_start date, p_test_end date, p_granularity text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  select coalesce(
    p_train_start is not null
    and p_train_end is not null
    and p_test_start is not null
    and p_test_end is not null
    and p_train_start <= p_train_end
    and p_test_start <= p_test_end
    and p_train_end < p_test_start
    and p_granularity in ('DAY', 'WEEK', 'MONTH'),
    false
  );
$$;


--
-- Name: mark_login(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.mark_login() RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'core', 'pg_temp'
    AS $$
  update core.app_user
     set last_login_at = now(), updated_at = now()
   where user_id = auth.uid()
     and active = true;
$$;


--
-- Name: previous_business_day(date, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.previous_business_day(p_date date, p_country text DEFAULT 'KR'::text) RETURNS date
    LANGUAGE plpgsql STABLE
    AS $$
declare
  v_date date := p_date;
  v_tries int := 0;
begin
  if p_date is null then
    return null;
  end if;
  while not core.is_business_day(v_date, p_country) loop
    v_date := v_date - 1;
    v_tries := v_tries + 1;
    if v_tries > 30 then
      return null;
    end if;
  end loop;
  return v_date;
end;
$$;


--
-- Name: protect_self_admin_change(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.protect_self_admin_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'core', 'pg_temp'
    AS $$
begin
  if auth.uid() = old.user_id and old.role = 'ADMIN' and new.role <> 'ADMIN' then
    raise exception '자신의 관리자 권한은 제거할 수 없습니다.' using errcode = '42501';
  end if;
  if auth.uid() = old.user_id and old.active = true and new.active = false then
    raise exception '자신의 계정은 비활성화할 수 없습니다.' using errcode = '42501';
  end if;
  return new;
end;
$$;


--
-- Name: rollback_import_batch(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.rollback_import_batch(p_batch_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'raw', 'pg_temp'
    AS $_$
declare b core.upload_batch%rowtype; table_name text; r record;
begin
  if not core.is_admin() then raise exception '관리자 권한이 필요합니다.' using errcode='42501'; end if;
  select * into b from core.upload_batch where batch_id=p_batch_id for update; if not found or b.status <> 'IMPORTED' then raise exception '적재 완료 batch만 rollback할 수 있습니다.'; end if;
  table_name:=core.import_target_table(b.import_type); execute format('delete from raw.%I where batch_id=$1',table_name) using p_batch_id;
  for r in select row_data from core.import_row_backup where batch_id=p_batch_id order by backup_id loop execute format('insert into raw.%I select * from jsonb_populate_record(null::raw.%I,$1)',table_name,table_name) using r.row_data; end loop;
  update core.upload_batch set status='ROLLED_BACK',rolled_back_at=now() where batch_id=p_batch_id;
end; $_$;


--
-- Name: run_backtest(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.run_backtest(p_forecast_run_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'analytics', 'pg_temp'
    AS $$
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


--
-- Name: run_baseline_forecast(text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.run_baseline_forecast(p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'analytics', 'pg_temp'
    AS $$
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


--
-- Name: select_manual_champion(uuid, text, text, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.select_manual_champion(p_backtest_run_id uuid, p_item_id text, p_model_id text, p_reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'pg_temp'
    AS $$
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


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'core', 'pg_temp'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: backtest_run; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.backtest_run (
    backtest_run_id uuid DEFAULT gen_random_uuid() NOT NULL,
    forecast_run_id uuid NOT NULL,
    test_start date,
    test_end date,
    metric text NOT NULL,
    reference_model_id text,
    status text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    triggered_by uuid,
    message text,
    CONSTRAINT backtest_run_status_check CHECK ((status = ANY (ARRAY['RUNNING'::text, 'SUCCESS'::text, 'FAILED'::text])))
);


--
-- Name: v_backtest_run; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_backtest_run AS
 SELECT backtest_run_id,
    forecast_run_id,
    test_start,
    test_end,
    metric,
    reference_model_id,
    status,
    started_at,
    finished_at,
    triggered_by,
    message
   FROM core.backtest_run;


--
-- Name: dim_item; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.dim_item (
    item_code text NOT NULL,
    hoc_code text,
    description text,
    family text,
    item_type text,
    source_types text
);


--
-- Name: TABLE dim_item; Type: COMMENT; Schema: raw; Owner: -
--

COMMENT ON TABLE raw.dim_item IS '품목 통합 마스터. 실데이터 원본. 수정 금지';


--
-- Name: v_item; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_item AS
 SELECT item_code,
    COALESCE(NULLIF(btrim(hoc_code), ''::text), item_code) AS hoc_code,
    description,
    family,
    item_type,
    source_types
   FROM raw.dim_item;


--
-- Name: bridge_bom; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.bridge_bom (
    model_key text,
    model_base text,
    bom_group text,
    item_code text,
    qty numeric(18,4),
    active text,
    start_date text,
    end_date text,
    source_file text
);


--
-- Name: bridge_cap_option; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.bridge_cap_option (
    model_key text,
    cap_item_code text,
    option_item_code text,
    option_desc text,
    role text
);


--
-- Name: bridge_mc_cap; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.bridge_mc_cap (
    model_key text,
    model_base text,
    predecessor_model text,
    cap_item_code text,
    cap_item_name text,
    neutral_item_code text,
    remark text
);


--
-- Name: v_bom_requirement; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_bom_requirement AS
 WITH cap AS (
         SELECT bridge_mc_cap.model_base,
            bridge_mc_cap.model_key,
            bridge_mc_cap.cap_item_code,
            bridge_mc_cap.cap_item_name,
            bridge_mc_cap.neutral_item_code
           FROM raw.bridge_mc_cap
          WHERE ((bridge_mc_cap.model_base IS NOT NULL) AND (btrim(bridge_mc_cap.model_base) <> ''::text))
        )
 SELECT c.model_base,
    c.model_key,
    'CAP'::text AS part_role,
    c.cap_item_code AS item_code,
    COALESCE(NULLIF(btrim(c.cap_item_name), ''::text), i.description) AS description,
    (1)::numeric AS qty,
    NULL::text AS bom_group
   FROM (cap c
     LEFT JOIN core.v_item i ON ((i.item_code = c.cap_item_code)))
UNION ALL
 SELECT c.model_base,
    c.model_key,
    'NEUTRAL'::text AS part_role,
    c.neutral_item_code AS item_code,
    i.description,
    (1)::numeric AS qty,
    NULL::text AS bom_group
   FROM (cap c
     LEFT JOIN core.v_item i ON ((i.item_code = c.neutral_item_code)))
  WHERE ((c.neutral_item_code IS NOT NULL) AND (btrim(c.neutral_item_code) <> ''::text))
UNION ALL
 SELECT c.model_base,
    c.model_key,
    o.role AS part_role,
    o.option_item_code AS item_code,
    COALESCE(NULLIF(btrim(o.option_desc), ''::text), i.description) AS description,
    (1)::numeric AS qty,
    NULL::text AS bom_group
   FROM ((raw.bridge_cap_option o
     JOIN cap c ON ((c.cap_item_code = o.cap_item_code)))
     LEFT JOIN core.v_item i ON ((i.item_code = o.option_item_code)))
UNION ALL
 SELECT b.model_base,
    b.model_key,
    'BOM'::text AS part_role,
    b.item_code,
    i.description,
    COALESCE(b.qty, (1)::numeric) AS qty,
    b.bom_group
   FROM (raw.bridge_bom b
     LEFT JOIN core.v_item i ON ((i.item_code = b.item_code)))
  WHERE ((b.model_base IS NOT NULL) AND (btrim(b.model_base) <> ''::text) AND (COALESCE(btrim(b.active), ''::text) <> 'X'::text));


--
-- Name: VIEW v_bom_requirement; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_bom_requirement IS '기종 1대 판매 시 필요한 CAP · Neutral · 필수옵션 · SCC · BOM 구성 통합';


--
-- Name: bridge_option_model; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.bridge_option_model (
    item_code text,
    model_key text,
    model_base text,
    link_type text,
    cat text,
    common text,
    detail text
);


--
-- Name: v_option_commonality; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_option_commonality AS
 SELECT item_code,
    count(DISTINCT model_base) FILTER (WHERE (model_base IS NOT NULL)) AS n_models,
    max(common) AS common_flag
   FROM raw.bridge_option_model
  GROUP BY item_code;


--
-- Name: v_bom_requirement_x; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_bom_requirement_x AS
 SELECT r.model_base,
    r.model_key,
    r.part_role,
    r.item_code,
    r.description,
    r.qty,
    r.bom_group,
    oc.n_models,
    oc.common_flag,
        CASE
            WHEN (oc.common_flag = 'COMMON'::text) THEN '복수 기종 공용 — 기종별 합산 시 이중 계상 주의'::text
            ELSE NULL::text
        END AS common_note
   FROM (analytics.v_bom_requirement r
     LEFT JOIN core.v_option_commonality oc ON ((oc.item_code = r.item_code)));


--
-- Name: champion_model_selection; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.champion_model_selection (
    selection_id uuid DEFAULT gen_random_uuid() NOT NULL,
    backtest_run_id uuid NOT NULL,
    item_id text NOT NULL,
    champion_model_id text,
    model_version uuid,
    champion_metric text NOT NULL,
    champion_metric_value numeric,
    wape numeric,
    mape numeric,
    bias numeric,
    rmse numeric,
    mae numeric,
    candidate_performance jsonb DEFAULT '[]'::jsonb NOT NULL,
    selection_reason text NOT NULL,
    selection_method text NOT NULL,
    selected_at timestamp with time zone DEFAULT now() NOT NULL,
    selected_by uuid,
    CONSTRAINT champion_model_selection_selection_method_check CHECK ((selection_method = ANY (ARRAY['AUTO'::text, 'MANUAL'::text])))
);


--
-- Name: v_champion_model; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_champion_model AS
 SELECT DISTINCT ON (item_id) selection_id,
    backtest_run_id,
    item_id,
    champion_model_id,
    model_version,
    champion_metric,
    champion_metric_value,
    wape,
    mape,
    bias,
    rmse,
    mae,
    candidate_performance,
    selection_reason,
    selection_method,
    selected_at,
    selected_by
   FROM core.champion_model_selection
  ORDER BY item_id, selected_at DESC;


--
-- Name: forecast_setting; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.forecast_setting (
    setting_id uuid DEFAULT gen_random_uuid() NOT NULL,
    active boolean DEFAULT true NOT NULL,
    train_start date,
    train_end date,
    test_start date,
    test_end date,
    granularity text DEFAULT 'DAY'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    forecast_horizon integer DEFAULT 3 NOT NULL,
    champion_metric text DEFAULT 'WAPE'::text NOT NULL,
    reference_model_id text DEFAULT 'WMA_3M'::text NOT NULL,
    CONSTRAINT forecast_setting_granularity_check CHECK ((granularity = ANY (ARRAY['DAY'::text, 'WEEK'::text, 'MONTH'::text]))),
    CONSTRAINT forecast_setting_horizon_positive CHECK ((forecast_horizon > 0))
);


--
-- Name: usage_history; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.usage_history (
    usage_id text,
    item_id text,
    use_date date,
    qty numeric,
    warehouse text,
    note text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);


--
-- Name: v_test_actual; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_test_actual AS
 WITH active_setting AS (
         SELECT forecast_setting.test_start,
            forecast_setting.test_end
           FROM core.forecast_setting
          WHERE (forecast_setting.active AND core.is_valid_forecast_window(forecast_setting.train_start, forecast_setting.train_end, forecast_setting.test_start, forecast_setting.test_end, forecast_setting.granularity))
          ORDER BY forecast_setting.updated_at DESC
         LIMIT 1
        )
 SELECT u.usage_id,
    u.item_id,
    u.use_date,
    u.qty,
    u.warehouse,
    u.note,
    u.batch_id,
    u.source_type,
    u.loaded_at,
    u.source_record_id
   FROM (raw.usage_history u
     CROSS JOIN active_setting s)
  WHERE ((u.use_date >= s.test_start) AND (u.use_date <= s.test_end));


--
-- Name: v_train_demand; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_train_demand AS
 WITH active_setting AS (
         SELECT forecast_setting.train_start,
            forecast_setting.train_end
           FROM core.forecast_setting
          WHERE (forecast_setting.active AND core.is_valid_forecast_window(forecast_setting.train_start, forecast_setting.train_end, forecast_setting.test_start, forecast_setting.test_end, forecast_setting.granularity))
          ORDER BY forecast_setting.updated_at DESC
         LIMIT 1
        )
 SELECT u.usage_id,
    u.item_id,
    u.use_date,
    u.qty,
    u.warehouse,
    u.note,
    u.batch_id,
    u.source_type,
    u.loaded_at,
    u.source_record_id
   FROM (raw.usage_history u
     CROSS JOIN active_setting s)
  WHERE ((u.use_date >= s.train_start) AND (u.use_date <= s.train_end));


--
-- Name: v_data_coverage; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_data_coverage AS
 WITH data_coverage AS (
         SELECT min(usage_history.use_date) AS data_start,
            max(usage_history.use_date) AS data_end
           FROM raw.usage_history
        ), active_setting AS (
         SELECT forecast_setting.train_start,
            forecast_setting.train_end,
            forecast_setting.test_start,
            forecast_setting.test_end,
            forecast_setting.granularity
           FROM core.forecast_setting
          WHERE forecast_setting.active
          ORDER BY forecast_setting.updated_at DESC
         LIMIT 1
        ), train_rows AS (
         SELECT count(*) AS row_count
           FROM core.v_train_demand
        ), test_rows AS (
         SELECT count(*) AS row_count
           FROM core.v_test_actual
        )
 SELECT d.data_start,
    d.data_end,
    s.train_start,
    s.train_end,
    s.test_start,
    s.test_end,
    s.granularity,
    tr.row_count AS train_row_count,
    te.row_count AS test_row_count,
    COALESCE((core.is_valid_forecast_window(s.train_start, s.train_end, s.test_start, s.test_end, s.granularity) AND (d.data_start IS NOT NULL) AND (s.train_start >= d.data_start) AND (s.train_end <= d.data_end)), false) AS train_window_ok,
    COALESCE((core.is_valid_forecast_window(s.train_start, s.train_end, s.test_start, s.test_end, s.granularity) AND (d.data_start IS NOT NULL) AND (s.test_start >= d.data_start) AND (s.test_end <= d.data_end)), false) AS test_window_ok,
    COALESCE((core.is_valid_forecast_window(s.train_start, s.train_end, s.test_start, s.test_end, s.granularity) AND (d.data_start IS NOT NULL) AND (s.train_start >= d.data_start) AND (s.train_end <= d.data_end) AND (s.test_start >= d.data_start) AND (s.test_end <= d.data_end)), false) AS data_isolation_ok,
        CASE
            WHEN (NOT COALESCE(core.is_valid_forecast_window(s.train_start, s.train_end, s.test_start, s.test_end, s.granularity), false)) THEN 'BLOCKED_INVALID_SETTING'::text
            WHEN (NOT COALESCE(((d.data_start IS NOT NULL) AND (s.train_start >= d.data_start) AND (s.train_end <= d.data_end) AND (s.test_start >= d.data_start) AND (s.test_end <= d.data_end)), false)) THEN 'WINDOW_OUTSIDE_DATA'::text
            ELSE 'READY'::text
        END AS data_isolation_status
   FROM (((data_coverage d
     LEFT JOIN active_setting s ON (true))
     CROSS JOIN train_rows tr)
     CROSS JOIN test_rows te);


--
-- Name: policy_config; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.policy_config (
    policy_key text NOT NULL,
    policy_value jsonb NOT NULL,
    description text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: item_master; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.item_master (
    "품목코드" text,
    "품목명" text,
    "품목구분" text,
    "단위" text,
    "표준단가" text,
    "사용여부" text,
    supplier_id text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);


--
-- Name: v_item_master; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_item_master AS
 SELECT DISTINCT ON (item_id) item_id,
    item_name,
    item_type,
    supplier_id,
    unit,
    is_active
   FROM ( SELECT upper(regexp_replace(item_master."품목코드", '[\s\-_]'::text, ''::text, 'g'::text)) AS item_id,
            item_master."품목명" AS item_name,
            item_master."품목구분" AS item_type,
            item_master.supplier_id,
            item_master."단위" AS unit,
            item_master."사용여부" AS is_active,
                CASE
                    WHEN (item_master."품목코드" = upper(regexp_replace(item_master."품목코드", '[\s\-_]'::text, ''::text, 'g'::text))) THEN 0
                    ELSE 1
                END AS pref
           FROM raw.item_master) t
  ORDER BY item_id, pref;


--
-- Name: v_sku_demand_profile; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_sku_demand_profile AS
 WITH active_setting AS (
         SELECT forecast_setting.train_start,
            forecast_setting.train_end
           FROM core.forecast_setting
          WHERE (forecast_setting.active AND core.is_valid_forecast_window(forecast_setting.train_start, forecast_setting.train_end, forecast_setting.test_start, forecast_setting.test_end, forecast_setting.granularity))
          ORDER BY forecast_setting.updated_at DESC
         LIMIT 1
        ), policy AS (
         SELECT max(((policy_config.policy_value ->> 'value'::text))::numeric) FILTER (WHERE (policy_config.policy_key = 'SEASONALITY_INDEX_CV_THRESHOLD'::text)) AS seasonality_threshold,
            max(((policy_config.policy_value ->> 'value'::text))::integer) FILTER (WHERE (policy_config.policy_key = 'DEMAND_PROFILE_RECENT_PERIODS'::text)) AS recent_periods
           FROM core.policy_config
          WHERE policy_config.active
        ), periods AS (
         SELECT (generate_series(date_trunc('month'::text, (active_setting.train_start)::timestamp with time zone), date_trunc('month'::text, (active_setting.train_end)::timestamp with time zone), '1 mon'::interval))::date AS period
           FROM active_setting
        ), items AS (
         SELECT v_item_master.item_id,
            v_item_master.item_name
           FROM core.v_item_master
        ), monthly_demand AS (
         SELECT v_train_demand.item_id,
            (date_trunc('month'::text, (v_train_demand.use_date)::timestamp with time zone))::date AS period,
            sum(v_train_demand.qty) AS qty,
            count(v_train_demand.qty) AS n_qty
           FROM core.v_train_demand
          GROUP BY v_train_demand.item_id, ((date_trunc('month'::text, (v_train_demand.use_date)::timestamp with time zone))::date)
        ), grid AS (
         SELECT i.item_id,
            i.item_name,
            p_1.period,
            row_number() OVER (PARTITION BY i.item_id ORDER BY p_1.period) AS period_number,
                CASE
                    WHEN (d.item_id IS NULL) THEN (0)::numeric
                    WHEN (d.n_qty = 0) THEN NULL::numeric
                    ELSE d.qty
                END AS qty
           FROM ((items i
             CROSS JOIN periods p_1)
             LEFT JOIN monthly_demand d ON (((d.item_id = i.item_id) AND (d.period = p_1.period))))
        ), metrics AS (
         SELECT grid.item_id,
            max(grid.item_name) AS item_name,
            count(*) AS n_periods,
            count(*) FILTER (WHERE (grid.qty > (0)::numeric)) AS n_nonzero_periods,
            count(*) FILTER (WHERE (grid.qty IS NULL)) AS n_null_periods,
            avg(grid.qty) FILTER (WHERE (grid.qty > (0)::numeric)) AS mean_nonzero,
            stddev_samp(grid.qty) FILTER (WHERE (grid.qty > (0)::numeric)) AS sd_nonzero,
            ((count(*) FILTER (WHERE (grid.qty = (0)::numeric)))::numeric / (NULLIF(count(*), 0))::numeric) AS zero_demand_rate,
            regr_slope((grid.qty)::double precision, (grid.period_number)::double precision) FILTER (WHERE (grid.qty IS NOT NULL)) AS trend_per_period
           FROM grid
          GROUP BY grid.item_id
        ), peak_period AS (
         SELECT DISTINCT ON (grid.item_id) grid.item_id,
            grid.period AS peak_period
           FROM grid
          WHERE (grid.qty IS NOT NULL)
          ORDER BY grid.item_id, grid.qty DESC, grid.period
        ), recent_change AS (
         SELECT g.item_id,
            avg(g.qty) FILTER (WHERE (g.period_number > (m_1.n_periods - p_1.recent_periods))) AS recent_average,
            avg(g.qty) FILTER (WHERE ((g.period_number >= ((m_1.n_periods - (2 * p_1.recent_periods)) + 1)) AND (g.period_number <= (m_1.n_periods - p_1.recent_periods)))) AS previous_average
           FROM ((grid g
             JOIN metrics m_1 USING (item_id))
             CROSS JOIN policy p_1)
          GROUP BY g.item_id
        ), seasonal_months AS (
         SELECT grid.item_id,
            (EXTRACT(month FROM grid.period))::integer AS month_number,
            avg(grid.qty) AS monthly_average
           FROM grid
          WHERE (grid.qty IS NOT NULL)
          GROUP BY grid.item_id, ((EXTRACT(month FROM grid.period))::integer)
        ), seasonality_metric AS (
         SELECT seasonal_months.item_id,
            (stddev_samp(seasonal_months.monthly_average) / NULLIF(avg(seasonal_months.monthly_average), (0)::numeric)) AS seasonal_index_cv
           FROM seasonal_months
          GROUP BY seasonal_months.item_id
        )
 SELECT m.item_id,
    m.item_name,
    m.n_periods,
    m.n_nonzero_periods,
        CASE
            WHEN (m.n_nonzero_periods = 0) THEN NULL::numeric
            ELSE ((m.n_periods)::numeric / (m.n_nonzero_periods)::numeric)
        END AS adi,
        CASE
            WHEN ((m.n_nonzero_periods < 2) OR (m.mean_nonzero = (0)::numeric)) THEN NULL::numeric
            ELSE (m.sd_nonzero / m.mean_nonzero)
        END AS cv,
        CASE
            WHEN ((m.n_nonzero_periods < 2) OR (m.mean_nonzero = (0)::numeric)) THEN NULL::numeric
            ELSE power((m.sd_nonzero / m.mean_nonzero), (2)::numeric)
        END AS cv_squared,
    m.zero_demand_rate,
    m.trend_per_period,
        CASE
            WHEN ((m.n_null_periods > 0) OR (p.recent_periods IS NULL) OR (p.recent_periods <= 0)) THEN NULL::numeric
            WHEN (m.n_periods < (2 * p.recent_periods)) THEN NULL::numeric
            WHEN ((r.previous_average IS NULL) OR (r.previous_average = (0)::numeric)) THEN NULL::numeric
            ELSE ((r.recent_average - r.previous_average) / r.previous_average)
        END AS recent_change_rate,
    peak.peak_period,
        CASE
            WHEN ((m.n_null_periods > 0) OR (m.n_nonzero_periods < 2)) THEN NULL::text
            WHEN ((((m.n_periods)::numeric / (m.n_nonzero_periods)::numeric) < 1.32) AND (power((m.sd_nonzero / m.mean_nonzero), (2)::numeric) < 0.49)) THEN 'SMOOTH'::text
            WHEN ((((m.n_periods)::numeric / (m.n_nonzero_periods)::numeric) >= 1.32) AND (power((m.sd_nonzero / m.mean_nonzero), (2)::numeric) < 0.49)) THEN 'INTERMITTENT'::text
            WHEN ((((m.n_periods)::numeric / (m.n_nonzero_periods)::numeric) < 1.32) AND (power((m.sd_nonzero / m.mean_nonzero), (2)::numeric) >= 0.49)) THEN 'ERRATIC'::text
            ELSE 'LUMPY'::text
        END AS demand_type,
        CASE
            WHEN ((m.n_null_periods > 0) OR (m.n_periods < 24) OR (sm.seasonal_index_cv IS NULL) OR (p.seasonality_threshold IS NULL)) THEN NULL::boolean
            ELSE (sm.seasonal_index_cv >= p.seasonality_threshold)
        END AS seasonality,
        CASE
            WHEN (m.n_null_periods > 0) THEN 'NULL_QUANTITY'::text
            WHEN (m.n_nonzero_periods = 0) THEN 'NO_DEMAND'::text
            WHEN (m.n_nonzero_periods < 2) THEN 'INSUFFICIENT_NONZERO_PERIODS'::text
            WHEN (m.n_periods < 24) THEN 'INSUFFICIENT_PERIODS'::text
            WHEN ((p.seasonality_threshold IS NULL) OR (p.recent_periods IS NULL) OR (p.recent_periods <= 0)) THEN 'POLICY_UNAVAILABLE'::text
            WHEN (sm.seasonal_index_cv IS NULL) THEN 'CALCULATION_UNAVAILABLE'::text
            WHEN (m.n_periods < (2 * p.recent_periods)) THEN 'INSUFFICIENT_RECENT_PERIODS'::text
            WHEN ((r.previous_average IS NULL) OR (r.previous_average = (0)::numeric)) THEN 'ZERO_BASELINE'::text
            ELSE NULL::text
        END AS reason_code,
        CASE
            WHEN ((m.n_nonzero_periods < 2) OR (m.mean_nonzero = (0)::numeric)) THEN NULL::text
            WHEN (power((m.sd_nonzero / m.mean_nonzero), (2)::numeric) < 0.49) THEN 'STABLE'::text
            ELSE 'VOLATILE'::text
        END AS stability
   FROM ((((metrics m
     CROSS JOIN policy p)
     LEFT JOIN peak_period peak USING (item_id))
     LEFT JOIN recent_change r USING (item_id))
     LEFT JOIN seasonality_metric sm USING (item_id));


--
-- Name: v_demand_profile_kpi; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_demand_profile_kpi AS
 SELECT count(*) AS total_items,
    count(*) FILTER (WHERE (demand_type = 'SMOOTH'::text)) AS n_smooth,
    count(*) FILTER (WHERE (demand_type = 'INTERMITTENT'::text)) AS n_intermittent,
    count(*) FILTER (WHERE (demand_type = 'ERRATIC'::text)) AS n_erratic,
    count(*) FILTER (WHERE (demand_type = 'LUMPY'::text)) AS n_lumpy,
    count(*) FILTER (WHERE (demand_type = ANY (ARRAY['INTERMITTENT'::text, 'LUMPY'::text]))) AS n_croston_needed,
    count(*) FILTER (WHERE (demand_type IS NULL)) AS n_calculation_unavailable
   FROM analytics.v_sku_demand_profile;


--
-- Name: forecast_result; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.forecast_result (
    run_id uuid NOT NULL,
    model_id text NOT NULL,
    item_id text NOT NULL,
    period date NOT NULL,
    model_version uuid NOT NULL,
    predicted_qty numeric,
    p50 numeric,
    p80 numeric,
    p90 numeric,
    sigma numeric,
    basis jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: v_forecast_result; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_forecast_result AS
 SELECT f.run_id,
    f.model_id,
    f.item_id,
    i.item_name,
    f.period,
    f.model_version,
    f.predicted_qty,
    f.p50,
    f.p80,
    f.p90,
    f.sigma,
    f.basis,
    f.created_at
   FROM (core.forecast_result f
     LEFT JOIN core.v_item_master i ON ((i.item_id = f.item_id)));


--
-- Name: forecast_run; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.forecast_run (
    run_id uuid DEFAULT gen_random_uuid() NOT NULL,
    status text NOT NULL,
    granularity text,
    train_start date,
    train_end date,
    horizon integer,
    champion_metric text,
    data_snapshot_at timestamp with time zone,
    stale_at timestamp with time zone,
    models jsonb DEFAULT '[]'::jsonb NOT NULL,
    n_models integer DEFAULT 0 NOT NULL,
    n_items integer DEFAULT 0 NOT NULL,
    n_rows integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    duration_ms bigint,
    triggered_by uuid,
    triggered_email text,
    note text,
    message text,
    CONSTRAINT forecast_run_status_check CHECK ((status = ANY (ARRAY['RUNNING'::text, 'SUCCESS'::text, 'FAILED'::text])))
);


--
-- Name: upload_batch; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.upload_batch (
    batch_id uuid DEFAULT gen_random_uuid() NOT NULL,
    file_name text NOT NULL,
    import_type text NOT NULL,
    import_mode text NOT NULL,
    total_rows integer DEFAULT 0 NOT NULL,
    success_rows integer DEFAULT 0 NOT NULL,
    warning_rows integer DEFAULT 0 NOT NULL,
    error_rows integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'PARSED'::text NOT NULL,
    uploaded_by uuid,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    imported_at timestamp with time zone,
    rolled_back_at timestamp with time zone,
    forecast_stale_marked boolean DEFAULT false NOT NULL,
    CONSTRAINT upload_batch_import_mode_check CHECK ((import_mode = ANY (ARRAY['append'::text, 'upsert'::text, 'replace'::text]))),
    CONSTRAINT upload_batch_import_type_check CHECK ((import_type = ANY (ARRAY['usage_history'::text, 'inventory'::text, 'item_master'::text, 'supplier_master'::text, 'purchase_order'::text, 'goods_receipt'::text, 'sales_order'::text, 'business_event'::text]))),
    CONSTRAINT upload_batch_status_check CHECK ((status = ANY (ARRAY['PARSED'::text, 'VALIDATING'::text, 'VALIDATED'::text, 'IMPORTED'::text, 'FAILED'::text, 'ROLLED_BACK'::text])))
);


--
-- Name: v_forecast_run; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_forecast_run AS
 SELECT run_id,
    status,
    granularity,
    train_start,
    train_end,
    horizon,
    champion_metric,
    data_snapshot_at,
    stale_at,
    models,
    n_models,
    n_items,
    n_rows,
    started_at,
    finished_at,
    duration_ms,
    triggered_by,
    triggered_email,
    note,
    message,
    COALESCE(((stale_at IS NOT NULL) OR (EXISTS ( SELECT 1
           FROM core.upload_batch b
          WHERE ((b.status = 'IMPORTED'::text) AND (b.import_type = ANY (ARRAY['usage_history'::text, 'sales_order'::text, 'business_event'::text])) AND (r.data_snapshot_at IS NOT NULL) AND (b.imported_at > r.data_snapshot_at))))), false) AS is_stale
   FROM core.forecast_run r;


--
-- Name: v_forecast_run_kpi; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_forecast_run_kpi AS
 SELECT count(*) AS total_runs,
    count(*) FILTER (WHERE (status = 'SUCCESS'::text)) AS success_runs,
    count(*) FILTER (WHERE (status = 'FAILED'::text)) AS failed_runs,
    count(*) FILTER (WHERE is_stale) AS stale_runs,
    max(finished_at) FILTER (WHERE (status = 'SUCCESS'::text)) AS latest_success_at
   FROM analytics.v_forecast_run;


--
-- Name: bridge_xcn; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.bridge_xcn (
    family text,
    related_item text,
    related_desc text,
    hoc_item text,
    hoc_desc text
);


--
-- Name: v_part_linkage; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_part_linkage AS
 SELECT DISTINCT related_item,
    hoc_item
   FROM raw.bridge_xcn
  WHERE ((related_item IS NOT NULL) AND (hoc_item IS NOT NULL));


--
-- Name: fact_shipment; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.fact_shipment (
    item_code text NOT NULL,
    ym character(7) NOT NULL,
    qty numeric(18,4) NOT NULL,
    item_type text NOT NULL,
    source_file text NOT NULL
);


--
-- Name: TABLE fact_shipment; Type: COMMENT; Schema: raw; Owner: -
--

COMMENT ON TABLE raw.fact_shipment IS '월별 출고 실적. 수량 0인 달은 미저장. PART 2023-04~2026-07 / OPTION 2020-01~2026-07';


--
-- Name: v_shipment_by_hoc; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_shipment_by_hoc AS
 SELECT COALESCE(x.hoc_item, f.item_code) AS hoc_item,
    f.item_type,
    f.ym,
    sum(f.qty) AS qty,
    count(*) AS n_source_codes
   FROM (raw.fact_shipment f
     LEFT JOIN core.v_part_linkage x ON (((x.related_item = f.item_code) AND (f.item_type = 'PART'::text))))
  GROUP BY COALESCE(x.hoc_item, f.item_code), f.item_type, f.ym;


--
-- Name: VIEW v_shipment_by_hoc; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON VIEW core.v_shipment_by_hoc IS 'XCN 연계를 합산한 대표코드 기준 월별 출고량. Tool 은 반드시 이 뷰를 읽는다';


--
-- Name: v_item_demand_profile; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_item_demand_profile AS
 WITH bound AS (
         SELECT max(fact_shipment.ym) AS max_ym,
            max((((SUBSTRING(fact_shipment.ym FROM 1 FOR 4))::integer * 12) + (SUBSTRING(fact_shipment.ym FROM 6 FOR 2))::integer)) AS max_idx
           FROM raw.fact_shipment
        ), agg AS (
         SELECT h.hoc_item,
            max(h.item_type) AS item_type,
            b.max_ym,
            (count(*))::integer AS n_nonzero,
            ((b.max_idx - min((((SUBSTRING(h.ym FROM 1 FOR 4))::integer * 12) + (SUBSTRING(h.ym FROM 6 FOR 2))::integer))) + 1) AS n_span,
            avg(h.qty) AS mean_nz,
            stddev_samp(h.qty) AS sd_nz,
            min(h.ym) AS first_ym,
            max(h.ym) AS last_ym
           FROM (core.v_shipment_by_hoc h
             CROSS JOIN bound b)
          GROUP BY h.hoc_item, b.max_idx, b.max_ym
        )
 SELECT a.hoc_item AS item_code,
    i.description,
    i.family,
    a.item_type,
    a.max_ym AS data_as_of,
    a.first_ym,
    a.last_ym,
    a.n_span AS n_periods,
    a.n_nonzero,
    round(a.mean_nz, 1) AS mean_nonzero_qty,
        CASE
            WHEN (a.n_span >= 6) THEN round(((a.n_span)::numeric / (a.n_nonzero)::numeric), 2)
            ELSE NULL::numeric
        END AS adi,
        CASE
            WHEN (a.n_span >= 6) THEN round(((1)::numeric - ((a.n_nonzero)::numeric / (a.n_span)::numeric)), 3)
            ELSE NULL::numeric
        END AS zero_demand_rate,
        CASE
            WHEN ((a.n_span >= 6) AND (a.n_nonzero >= 2) AND (a.mean_nz > (0)::numeric)) THEN round(((a.sd_nz / a.mean_nz) ^ (2)::numeric), 3)
            ELSE NULL::numeric
        END AS cv_squared,
        CASE
            WHEN (a.n_span < 6) THEN NULL::text
            WHEN (a.n_nonzero < 2) THEN NULL::text
            WHEN (a.mean_nz <= (0)::numeric) THEN NULL::text
            WHEN ((((a.n_span)::numeric / (a.n_nonzero)::numeric) < 1.32) AND (((a.sd_nz / a.mean_nz) ^ (2)::numeric) < 0.49)) THEN 'SMOOTH'::text
            WHEN (((a.n_span)::numeric / (a.n_nonzero)::numeric) < 1.32) THEN 'ERRATIC'::text
            WHEN (((a.sd_nz / a.mean_nz) ^ (2)::numeric) < 0.49) THEN 'INTERMITTENT'::text
            ELSE 'LUMPY'::text
        END AS demand_type,
        CASE
            WHEN (a.n_span < 6) THEN 'INSUFFICIENT_HISTORY'::text
            WHEN (a.n_nonzero < 2) THEN 'INSUFFICIENT_SAMPLE'::text
            WHEN (a.mean_nz <= (0)::numeric) THEN 'NO_POSITIVE_DEMAND'::text
            ELSE NULL::text
        END AS reason_code
   FROM (agg a
     LEFT JOIN core.v_item i ON ((i.item_code = a.hoc_item)));


--
-- Name: VIEW v_item_demand_profile; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_item_demand_profile IS 'Syntetos-Boylan 수요 유형 분류. 관측 6개월 미만은 유형 null + INSUFFICIENT_HISTORY';


--
-- Name: v_item_demand_kpi; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_item_demand_kpi AS
 SELECT item_type,
    count(*) AS n_items,
    count(*) FILTER (WHERE (demand_type = 'SMOOTH'::text)) AS n_smooth,
    count(*) FILTER (WHERE (demand_type = 'ERRATIC'::text)) AS n_erratic,
    count(*) FILTER (WHERE (demand_type = 'INTERMITTENT'::text)) AS n_intermittent,
    count(*) FILTER (WHERE (demand_type = 'LUMPY'::text)) AS n_lumpy,
    count(*) FILTER (WHERE (demand_type IS NULL)) AS n_unknown,
    count(*) FILTER (WHERE (demand_type = ANY (ARRAY['INTERMITTENT'::text, 'LUMPY'::text]))) AS n_croston_candidate
   FROM analytics.v_item_demand_profile
  GROUP BY item_type;


--
-- Name: item_policy; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.item_policy (
    item_id text NOT NULL,
    moq numeric,
    pack_size numeric,
    item_grade text,
    service_level numeric(5,4),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    target_dos_days numeric,
    allocation_mode text DEFAULT 'AUTO'::text NOT NULL,
    target_stock_qty numeric,
    unit_price numeric,
    unit_price_basis text,
    min_order_amount numeric,
    CONSTRAINT item_policy_allocation_mode_check CHECK ((allocation_mode = ANY (ARRAY['AUTO'::text, 'MANUAL'::text]))),
    CONSTRAINT item_policy_min_order_amount_check CHECK (((min_order_amount IS NULL) OR (min_order_amount >= (0)::numeric))),
    CONSTRAINT item_policy_moq_check CHECK (((moq IS NULL) OR (moq > (0)::numeric))),
    CONSTRAINT item_policy_pack_size_check CHECK (((pack_size IS NULL) OR (pack_size > (0)::numeric))),
    CONSTRAINT item_policy_service_level_check CHECK (((service_level IS NULL) OR ((service_level > (0)::numeric) AND (service_level < (1)::numeric)))),
    CONSTRAINT item_policy_target_dos_days_check CHECK (((target_dos_days IS NULL) OR (target_dos_days > (0)::numeric))),
    CONSTRAINT item_policy_target_stock_qty_check CHECK (((target_stock_qty IS NULL) OR (target_stock_qty >= (0)::numeric))),
    CONSTRAINT item_policy_unit_price_check CHECK (((unit_price IS NULL) OR (unit_price >= (0)::numeric)))
);


--
-- Name: COLUMN item_policy.moq; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.item_policy.moq IS 'stage1 §7 — 최소주문수량. 미설정이면 1 로 봅니다 (목표 DoS 와 달리 계산을 멈추지 않습니다)';


--
-- Name: COLUMN item_policy.pack_size; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.item_policy.pack_size IS 'stage1 §7 — 포장단위. ★ 현재 발주 계산에 적용하지 않습니다. 향후 확장을 위한 자리입니다';


--
-- Name: COLUMN item_policy.target_dos_days; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.item_policy.target_dos_days IS 'stage1 §6 — 목표 DoS 일수. ★ 미설정이면 발주 확정을 차단합니다. 임의값을 넣지 않습니다';


--
-- Name: COLUMN item_policy.unit_price_basis; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.item_policy.unit_price_basis IS '표준원가 · 최근매입가 중 무엇인지. 현업 확인 전까지 null';


--
-- Name: COLUMN item_policy.min_order_amount; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.item_policy.min_order_amount IS 'stage1 §7 — 최소주문금액. ★ 현재 발주 계산에 적용하지 않습니다. 향후 확장을 위한 자리입니다';


--
-- Name: v_item_policy; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_item_policy AS
 SELECT item_id,
    target_dos_days,
    allocation_mode,
    target_stock_qty,
    unit_price,
    unit_price_basis,
    moq,
    pack_size,
    min_order_amount,
    item_grade,
    service_level,
    updated_at,
    COALESCE(moq, (1)::numeric) AS effective_moq,
    (target_dos_days IS NULL) AS order_blocked,
        CASE
            WHEN (target_dos_days IS NULL) THEN 'TARGET_DOS_UNSET'::text
            ELSE NULL::text
        END AS reason_code
   FROM core.item_policy p;


--
-- Name: shipment_log; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.shipment_log (
    shipment_id text,
    po_no text,
    item_id text,
    supplier_id text,
    country text,
    transport_mode text,
    order_date date,
    due_date date,
    supplier_ship_date date,
    port_departure_date date,
    port_arrival_date date,
    customs_clear_date date,
    warehouse_receipt_date date,
    qc_release_date date,
    qty numeric,
    warehouse text,
    status text,
    incident_note text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);


--
-- Name: v_fact_shipment; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_fact_shipment AS
 SELECT shipment_id,
    upper(regexp_replace(COALESCE(po_no, ''::text), '[\s\-_]'::text, ''::text, 'g'::text)) AS po_no,
    upper(regexp_replace(COALESCE(item_id, ''::text), '[\s\-_]'::text, ''::text, 'g'::text)) AS item_id,
    supplier_id,
    country,
        CASE upper(TRIM(BOTH FROM transport_mode))
            WHEN '해상'::text THEN 'SEA'::text
            WHEN '항공'::text THEN 'AIR'::text
            ELSE upper(TRIM(BOTH FROM transport_mode))
        END AS transport_mode,
    order_date,
    due_date,
    supplier_ship_date,
    port_departure_date,
    port_arrival_date,
    customs_clear_date,
    warehouse_receipt_date,
    qc_release_date,
    qty,
    status,
    NULLIF(TRIM(BOTH FROM COALESCE(incident_note, ''::text)), ''::text) AS incident_note,
    (supplier_ship_date - order_date) AS seg_order_to_ship,
    (qc_release_date - supplier_ship_date) AS seg_ship_to_receive,
    (qc_release_date - order_date) AS lt_total,
        CASE
            WHEN (status = 'IN_TRANSIT'::text) THEN 'IN_TRANSIT'::text
            WHEN ((order_date IS NULL) OR (qc_release_date IS NULL)) THEN 'MISSING_DATE'::text
            WHEN (qc_release_date < warehouse_receipt_date) THEN 'IMPOSSIBLE_ORDER'::text
            WHEN (warehouse_receipt_date < order_date) THEN 'IMPOSSIBLE_ORDER'::text
            ELSE 'OK'::text
        END AS quality_flag
   FROM raw.shipment_log s;


--
-- Name: v_shipment_valid; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_shipment_valid AS
 SELECT shipment_id,
    po_no,
    item_id,
    supplier_id,
    country,
    transport_mode,
    order_date,
    due_date,
    supplier_ship_date,
    port_departure_date,
    port_arrival_date,
    customs_clear_date,
    warehouse_receipt_date,
    qc_release_date,
    qty,
    status,
    incident_note,
    seg_order_to_ship,
    seg_ship_to_receive,
    lt_total,
    quality_flag
   FROM core.v_fact_shipment
  WHERE ((status = 'COMPLETED'::text) AND (quality_flag = 'OK'::text) AND (lt_total > 0));


--
-- Name: supplier_master; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.supplier_master (
    "공급업체코드" text,
    "공급업체명" text,
    "국가" text,
    "표준리드타임(일)" text,
    "담당자" text,
    "사용여부" text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);


--
-- Name: v_leadtime_stat; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_leadtime_stat AS
 SELECT v.supplier_id,
    s."공급업체명" AS supplier_name,
    v.country,
    count(*) AS n_samples,
    round(avg(v.seg_order_to_ship), 1) AS avg_order_to_ship,
    round(avg(v.seg_ship_to_receive), 1) AS avg_ship_to_receive,
    round(avg(v.lt_total), 1) AS mean_days,
    (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((v.lt_total)::double precision)))::integer AS p50_days,
    (percentile_cont((0.8)::double precision) WITHIN GROUP (ORDER BY ((v.lt_total)::double precision)))::integer AS p80_days,
    (percentile_cont((0.9)::double precision) WITHIN GROUP (ORDER BY ((v.lt_total)::double precision)))::integer AS p90_days,
    round(stddev_samp(v.lt_total), 1) AS std_days,
    max(v.lt_total) AS max_days,
        CASE
            WHEN (count(*) >= 30) THEN 'HIGH'::text
            WHEN (count(*) >= 10) THEN 'MEDIUM'::text
            ELSE 'LOW'::text
        END AS confidence
   FROM (core.v_shipment_valid v
     JOIN raw.supplier_master s ON ((s."공급업체코드" = v.supplier_id)))
  GROUP BY v.supplier_id, s."공급업체명", v.country;


--
-- Name: v_leadtime_gap; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_leadtime_gap AS
 SELECT m."공급업체코드" AS supplier_id,
    m."공급업체명" AS supplier_name,
    m."국가" AS country,
    (m."표준리드타임(일)")::integer AS std_lead_time,
    s.n_samples,
    s.avg_order_to_ship,
    s.avg_ship_to_receive,
    s.mean_days,
    s.p50_days,
    s.p80_days,
    s.p90_days,
    s.std_days,
    (s.p80_days - (m."표준리드타임(일)")::integer) AS gap_days,
    s.confidence
   FROM (raw.supplier_master m
     JOIN core.v_leadtime_stat s ON ((s.supplier_id = m."공급업체코드")))
  WHERE (m."사용여부" = 'Y'::text);


--
-- Name: VIEW v_leadtime_gap; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_leadtime_gap IS '[DEPRECATED 2026-09-04] 5회차 더미 데이터 기준 뷰. 실데이터에는 재고·리드타임이 없으므로 더 이상 갱신되지 않습니다. 신규 코드는 analytics.v_shipment_trend · v_item_demand_profile · v_ol_accuracy · v_bom_requirement_x 를 사용하십시오.';


--
-- Name: business_calendar; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.business_calendar (
    country_code text NOT NULL,
    calendar_date date NOT NULL,
    is_business_day boolean NOT NULL,
    holiday_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE business_calendar; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.business_calendar IS 'stage1 §8 — 영업일 판정. 행이 없는 날짜는 주말 여부로만 판정합니다';


--
-- Name: supplier; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.supplier (
    supplier_id text NOT NULL,
    supplier_name text NOT NULL,
    entity_id text,
    lead_time_days integer,
    active boolean DEFAULT true NOT NULL,
    valid_from date,
    valid_to date,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supplier_check CHECK (((valid_to IS NULL) OR (valid_from IS NULL) OR (valid_from <= valid_to))),
    CONSTRAINT supplier_lead_time_days_check CHECK (((lead_time_days IS NULL) OR (lead_time_days >= 0)))
);


--
-- Name: COLUMN supplier.lead_time_days; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.supplier.lead_time_days IS 'stage1 §4 — 이 값이 없으면 조정 범위의 시작 월을 정할 수 없어 발주량 계산이 멈춥니다';


--
-- Name: supplier_departure; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.supplier_departure (
    departure_id bigint NOT NULL,
    supplier_id text NOT NULL,
    weekday smallint,
    day_of_month smallint,
    valid_from date,
    valid_to date,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supplier_departure_check CHECK (((weekday IS NULL) <> (day_of_month IS NULL))),
    CONSTRAINT supplier_departure_check1 CHECK (((valid_to IS NULL) OR (valid_from IS NULL) OR (valid_from <= valid_to))),
    CONSTRAINT supplier_departure_day_of_month_check CHECK (((day_of_month IS NULL) OR ((day_of_month >= 1) AND (day_of_month <= 31)))),
    CONSTRAINT supplier_departure_weekday_check CHECK (((weekday IS NULL) OR ((weekday >= 0) AND (weekday <= 6))))
);


--
-- Name: supply_entity; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.supply_entity (
    entity_id text NOT NULL,
    entity_name text NOT NULL,
    country_code text NOT NULL,
    prep_days integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    valid_from date,
    valid_to date,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supply_entity_check CHECK (((valid_to IS NULL) OR (valid_from IS NULL) OR (valid_from <= valid_to))),
    CONSTRAINT supply_entity_prep_days_check CHECK ((prep_days >= 0))
);


--
-- Name: TABLE supply_entity; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.supply_entity IS 'stage1 §8 — 조달 대상 해외법인. 운영 대상은 5곳이며 과거 법인은 지우지 않고 active 로 관리합니다';


--
-- Name: COLUMN supply_entity.prep_days; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.supply_entity.prep_days IS '출항 준비기간(일). 발주일 = 공급처 출항일 − 이 값';


--
-- Name: v_master_readiness; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_master_readiness AS
 SELECT ( SELECT count(*) AS count
           FROM core.supply_entity
          WHERE supply_entity.active) AS n_entities,
    ( SELECT count(*) AS count
           FROM core.supply_entity
          WHERE (supply_entity.active AND (supply_entity.prep_days = 0))) AS n_prep_days_unset,
    ( SELECT count(*) AS count
           FROM core.supplier
          WHERE supplier.active) AS n_suppliers,
    ( SELECT count(*) AS count
           FROM core.supplier
          WHERE (supplier.active AND (supplier.lead_time_days IS NULL))) AS n_leadtime_unset,
    ( SELECT count(*) AS count
           FROM core.supplier_departure) AS n_departure_rules,
    ( SELECT count(*) AS count
           FROM core.business_calendar) AS n_calendar_days,
    ( SELECT count(*) AS count
           FROM core.item_policy) AS n_item_policies,
    ( SELECT count(*) AS count
           FROM core.item_policy
          WHERE (item_policy.target_dos_days IS NULL)) AS n_target_dos_unset;


--
-- Name: VIEW v_master_readiness; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_master_readiness IS 'Phase 1 준비 상태. 아직 못 받은 값이 몇 건인지 한 줄로 보여 줍니다';


--
-- Name: v_model_comparison_detail; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_model_comparison_detail AS
 WITH actual AS (
         SELECT v_test_actual.item_id,
            (date_trunc('month'::text, (v_test_actual.use_date)::timestamp with time zone))::date AS period,
            sum(v_test_actual.qty) AS actual_qty,
            count(v_test_actual.qty) AS n_qty
           FROM core.v_test_actual
          GROUP BY v_test_actual.item_id, ((date_trunc('month'::text, (v_test_actual.use_date)::timestamp with time zone))::date)
        )
 SELECT f.run_id,
    f.model_id,
    f.item_id,
    f.period,
    f.p50,
    f.p80,
    f.p90,
    f.predicted_qty,
        CASE
            WHEN (a.n_qty = 0) THEN NULL::numeric
            ELSE a.actual_qty
        END AS actual_qty
   FROM (core.forecast_result f
     LEFT JOIN actual a ON (((a.item_id = f.item_id) AND (a.period = f.period))));


--
-- Name: model_config; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.model_config (
    model_id text NOT NULL,
    model_name text NOT NULL,
    family text NOT NULL,
    engine text NOT NULL,
    version text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    applicable_demand_type text[] NOT NULL,
    parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    description text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT model_config_applicable_demand_type_check CHECK ((applicable_demand_type <@ ARRAY['SMOOTH'::text, 'INTERMITTENT'::text, 'ERRATIC'::text, 'LUMPY'::text])),
    CONSTRAINT model_config_engine_check CHECK ((engine = ANY (ARRAY['SQL'::text, 'PYTHON'::text])))
);


--
-- Name: v_model_config; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_model_config AS
 SELECT model_id,
    model_name,
    family,
    engine,
    version,
    enabled,
    is_default,
    applicable_demand_type,
    parameters,
    description,
    updated_at,
    updated_by
   FROM core.model_config;


--
-- Name: model_performance; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.model_performance (
    backtest_run_id uuid NOT NULL,
    forecast_run_id uuid NOT NULL,
    model_id text NOT NULL,
    model_version uuid NOT NULL,
    item_id text NOT NULL,
    n_periods integer DEFAULT 0 NOT NULL,
    wape numeric,
    mape numeric,
    bias numeric,
    rmse numeric,
    mae numeric,
    baseline_improvement numeric,
    rank integer,
    calculation_status text DEFAULT 'SUCCESS'::text NOT NULL,
    reason_code text,
    calculated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE model_performance; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.model_performance IS 'Bias = 평균(Forecast - Actual): 양수는 과대예측, 음수는 과소예측. MAPE는 Actual=0 기간을 제외한다.';


--
-- Name: COLUMN model_performance.wape; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.model_performance.wape IS 'sum(abs(forecast-actual))/sum(abs(actual)); Actual 절대합 0이면 null.';


--
-- Name: v_model_performance; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_model_performance AS
 SELECT p.backtest_run_id,
    p.forecast_run_id,
    p.model_id,
    p.model_version,
    p.item_id,
    p.n_periods,
    p.wape,
    p.mape,
    p.bias,
    p.rmse,
    p.mae,
    p.baseline_improvement,
    p.rank,
    p.calculation_status,
    p.reason_code,
    p.calculated_at,
    r.metric,
    r.test_start,
    r.test_end
   FROM (core.model_performance p
     JOIN core.backtest_run r USING (backtest_run_id));


--
-- Name: fact_mc_plan_actual; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.fact_mc_plan_actual (
    fy_sheet text,
    model_key text NOT NULL,
    model_base text,
    biz text,
    iot_code text,
    ym character(7) NOT NULL,
    sales_ol numeric(18,4),
    scm_ol numeric(18,4),
    act numeric(18,4)
);


--
-- Name: TABLE fact_mc_plan_actual; Type: COMMENT; Schema: raw; Owner: -
--

COMMENT ON TABLE raw.fact_mc_plan_actual IS '기계 OL vs 실적. Bias = SUM(ol-act)/SUM(act), 양수가 과대예측';


--
-- Name: v_ol_accuracy; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_ol_accuracy AS
 SELECT COALESCE(NULLIF(btrim(model_base), ''::text), '(미분류)'::text) AS model_base,
    fy_sheet,
    max(biz) AS biz,
    (count(*))::integer AS n_rows,
    min(ym) AS first_ym,
    max(ym) AS last_ym,
    round(sum(act) FILTER (WHERE (act IS NOT NULL)), 1) AS total_act,
    (count(*) FILTER (WHERE ((sales_ol IS NOT NULL) AND (act IS NOT NULL))))::integer AS n_scored_sales,
    round((sum(abs((sales_ol - act))) FILTER (WHERE ((sales_ol IS NOT NULL) AND (act IS NOT NULL))) / NULLIF(sum(act) FILTER (WHERE ((sales_ol IS NOT NULL) AND (act IS NOT NULL))), (0)::numeric)), 3) AS sales_wape,
    round((sum((sales_ol - act)) FILTER (WHERE ((sales_ol IS NOT NULL) AND (act IS NOT NULL))) / NULLIF(sum(act) FILTER (WHERE ((sales_ol IS NOT NULL) AND (act IS NOT NULL))), (0)::numeric)), 3) AS sales_bias,
    (count(*) FILTER (WHERE ((scm_ol IS NOT NULL) AND (act IS NOT NULL))))::integer AS n_scored_scm,
    round((sum(abs((scm_ol - act))) FILTER (WHERE ((scm_ol IS NOT NULL) AND (act IS NOT NULL))) / NULLIF(sum(act) FILTER (WHERE ((scm_ol IS NOT NULL) AND (act IS NOT NULL))), (0)::numeric)), 3) AS scm_wape,
    round((sum((scm_ol - act)) FILTER (WHERE ((scm_ol IS NOT NULL) AND (act IS NOT NULL))) / NULLIF(sum(act) FILTER (WHERE ((scm_ol IS NOT NULL) AND (act IS NOT NULL))), (0)::numeric)), 3) AS scm_bias,
        CASE
            WHEN ((sum(act) FILTER (WHERE (act IS NOT NULL)) IS NULL) OR (sum(act) FILTER (WHERE (act IS NOT NULL)) = (0)::numeric)) THEN 'NO_ACTUAL'::text
            ELSE NULL::text
        END AS reason_code
   FROM raw.fact_mc_plan_actual
  GROUP BY COALESCE(NULLIF(btrim(model_base), ''::text), '(미분류)'::text), fy_sheet;


--
-- Name: VIEW v_ol_accuracy; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_ol_accuracy IS '기종 × 회계연도 OL 정확도. Bias 양수 = 과대예측. act null 행은 채점 제외';


--
-- Name: v_ol_accuracy_fy; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_ol_accuracy_fy AS
 SELECT fy_sheet,
    (count(*))::integer AS n_rows,
    (count(*) FILTER (WHERE ((sales_ol IS NOT NULL) AND (scm_ol IS NOT NULL) AND (act IS NOT NULL))))::integer AS n_scored,
    round((sum(abs((sales_ol - act))) FILTER (WHERE ((sales_ol IS NOT NULL) AND (scm_ol IS NOT NULL) AND (act IS NOT NULL))) / NULLIF(sum(act) FILTER (WHERE ((sales_ol IS NOT NULL) AND (scm_ol IS NOT NULL) AND (act IS NOT NULL))), (0)::numeric)), 3) AS sales_wape,
    round((sum(abs((scm_ol - act))) FILTER (WHERE ((sales_ol IS NOT NULL) AND (scm_ol IS NOT NULL) AND (act IS NOT NULL))) / NULLIF(sum(act) FILTER (WHERE ((sales_ol IS NOT NULL) AND (scm_ol IS NOT NULL) AND (act IS NOT NULL))), (0)::numeric)), 3) AS scm_wape,
    round((sum((sales_ol - act)) FILTER (WHERE ((sales_ol IS NOT NULL) AND (scm_ol IS NOT NULL) AND (act IS NOT NULL))) / NULLIF(sum(act) FILTER (WHERE ((sales_ol IS NOT NULL) AND (scm_ol IS NOT NULL) AND (act IS NOT NULL))), (0)::numeric)), 3) AS sales_bias,
    round((sum((scm_ol - act)) FILTER (WHERE ((sales_ol IS NOT NULL) AND (scm_ol IS NOT NULL) AND (act IS NOT NULL))) / NULLIF(sum(act) FILTER (WHERE ((sales_ol IS NOT NULL) AND (scm_ol IS NOT NULL) AND (act IS NOT NULL))), (0)::numeric)), 3) AS scm_bias
   FROM raw.fact_mc_plan_actual
  GROUP BY fy_sheet;


--
-- Name: v_part_linkage; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_part_linkage AS
 SELECT x.related_item,
    xi.description AS related_desc,
    x.hoc_item,
    hi.description AS hoc_desc,
    hi.family
   FROM ((core.v_part_linkage x
     LEFT JOIN core.v_item xi ON ((xi.item_code = x.related_item)))
     LEFT JOIN core.v_item hi ON ((hi.item_code = x.hoc_item)));


--
-- Name: dim_model; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.dim_model (
    model_key text NOT NULL,
    model_base text,
    biz text,
    iot_code text,
    sources text
);


--
-- Name: COLUMN dim_model.model_base; Type: COMMENT; Schema: raw; Owner: -
--

COMMENT ON COLUMN raw.dim_model.model_base IS 'NULL/빈값인 8행은 기종이 아니라 Option MAP 헤더에서 온 그룹 키(DT Common · Newline Q+ 02" 등). 조회 시 반드시 제외';


--
-- Name: v_model; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_model AS
 SELECT model_key,
    model_base,
    NULLIF(btrim(biz), ''::text) AS biz,
    NULLIF(btrim(iot_code), ''::text) AS iot_code,
    sources
   FROM raw.dim_model
  WHERE ((model_base IS NOT NULL) AND (btrim(model_base) <> ''::text));


--
-- Name: v_realdata_kpi; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_realdata_kpi AS
 SELECT ( SELECT count(*) AS count
           FROM raw.dim_item) AS n_items,
    ( SELECT count(*) AS count
           FROM core.v_model) AS n_models,
    ( SELECT count(*) AS count
           FROM raw.fact_shipment) AS n_shipment_rows,
    ( SELECT max(fact_shipment.ym) AS max
           FROM raw.fact_shipment) AS data_as_of,
    ( SELECT min(fact_shipment.ym) AS min
           FROM raw.fact_shipment) AS data_from,
    ( SELECT count(*) AS count
           FROM analytics.v_item_demand_profile
          WHERE (v_item_demand_profile.demand_type = ANY (ARRAY['INTERMITTENT'::text, 'LUMPY'::text]))) AS n_croston_candidate,
    ( SELECT count(*) AS count
           FROM analytics.v_item_demand_profile
          WHERE (v_item_demand_profile.reason_code = 'INSUFFICIENT_HISTORY'::text)) AS n_insufficient,
    ( SELECT count(*) AS count
           FROM raw.bridge_xcn) AS n_xcn_links;


--
-- Name: v_shipment_trend; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_shipment_trend AS
 WITH bound AS (
         SELECT max(fact_shipment.ym) AS max_ym,
            max((((SUBSTRING(fact_shipment.ym FROM 1 FOR 4))::integer * 12) + (SUBSTRING(fact_shipment.ym FROM 6 FOR 2))::integer)) AS max_idx
           FROM raw.fact_shipment
        ), s AS (
         SELECT h.hoc_item,
            h.item_type,
            h.ym,
            h.qty,
            (((SUBSTRING(h.ym FROM 1 FOR 4))::integer * 12) + (SUBSTRING(h.ym FROM 6 FOR 2))::integer) AS idx
           FROM core.v_shipment_by_hoc h
        )
 SELECT s.hoc_item AS item_code,
    i.description,
    i.family,
    max(s.item_type) AS item_type,
    b.max_ym AS data_as_of,
    (count(*))::integer AS n_months,
    min(s.ym) AS first_ym,
    max(s.ym) AS last_ym,
    (b.max_idx - max(s.idx)) AS months_since_last,
    ((b.max_idx - min(s.idx)) + 1) AS n_span,
    round(sum(s.qty), 1) AS total_qty,
    round(COALESCE(max(s.qty) FILTER (WHERE (s.idx = b.max_idx)), (0)::numeric), 1) AS latest_qty,
    round((COALESCE(sum(s.qty) FILTER (WHERE (s.idx > (b.max_idx - 3))), (0)::numeric) / 3.0), 1) AS avg_3m,
    round((COALESCE(sum(s.qty) FILTER (WHERE (s.idx > (b.max_idx - 6))), (0)::numeric) / 6.0), 1) AS avg_6m,
    round((COALESCE(sum(s.qty) FILTER (WHERE (s.idx > (b.max_idx - 12))), (0)::numeric) / 12.0), 1) AS avg_12m,
    round(((COALESCE(sum(s.qty) FILTER (WHERE (s.idx > (b.max_idx - 3))), (0)::numeric) / 3.0) / NULLIF((COALESCE(sum(s.qty) FILTER (WHERE (s.idx > (b.max_idx - 12))), (0)::numeric) / 12.0), (0)::numeric)), 2) AS trend_3m_vs_12m,
        CASE
            WHEN (((b.max_idx - min(s.idx)) + 1) < 6) THEN 'INSUFFICIENT_HISTORY'::text
            ELSE NULL::text
        END AS reason_code
   FROM ((s
     CROSS JOIN bound b)
     LEFT JOIN core.v_item i ON ((i.item_code = s.hoc_item)))
  GROUP BY s.hoc_item, i.description, i.family, b.max_ym, b.max_idx;


--
-- Name: VIEW v_shipment_trend; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_shipment_trend IS 'XCN 합산 기준 품목별 출고 추이. 이동평균은 0인 달을 포함해 계산(합계÷고정개월수)';


--
-- Name: leadtime_plan; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.leadtime_plan (
    supplier_id text NOT NULL,
    planned_lead_time integer,
    basis text,
    service_level numeric,
    confirmed_reason text,
    confirmed_at timestamp with time zone DEFAULT now()
);


--
-- Name: usage_profile; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.usage_profile (
    item_id text NOT NULL,
    valid_days integer,
    daily_usage_avg numeric,
    daily_usage_sd numeric,
    cv numeric,
    confirmed_at timestamp with time zone DEFAULT now()
);


--
-- Name: v_leadtime_effective; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_leadtime_effective AS
 SELECT st.supplier_id,
    st.supplier_name,
    st.country,
    st.n_samples,
    st.p80_days,
    p.planned_lead_time,
    COALESCE(p.planned_lead_time, st.p80_days) AS effective_lead_time,
        CASE
            WHEN (p.planned_lead_time IS NOT NULL) THEN '확정값'::text
            ELSE '실적 P80'::text
        END AS source
   FROM (core.v_leadtime_stat st
     LEFT JOIN core.leadtime_plan p ON ((p.supplier_id = st.supplier_id)));


--
-- Name: v_inbound_qty; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_inbound_qty AS
 SELECT item_id,
    sum(qty) AS inbound_qty,
    count(*) AS inbound_shipments,
    min((order_date + COALESCE(( SELECT e.effective_lead_time
           FROM core.v_leadtime_effective e
          WHERE (e.supplier_id = f.supplier_id)), 30))) AS earliest_eta
   FROM core.v_fact_shipment f
  WHERE (status = 'IN_TRANSIT'::text)
  GROUP BY item_id;


--
-- Name: inventory; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.inventory (
    "품목코드" text,
    "창고" text,
    "현재고" text,
    "기준일자" text,
    "안전재고" text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);


--
-- Name: v_stock_on_hand; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_stock_on_hand AS
 SELECT upper(regexp_replace("품목코드", '[\s\-_]'::text, ''::text, 'g'::text)) AS item_id,
    sum((NULLIF("현재고", ''::text))::numeric) AS current_stock
   FROM raw.inventory
  GROUP BY (upper(regexp_replace("품목코드", '[\s\-_]'::text, ''::text, 'g'::text)));


--
-- Name: v_usage_effective; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_usage_effective AS
 WITH calc AS (
         SELECT upper(regexp_replace(usage_history.item_id, '[\s\-_]'::text, ''::text, 'g'::text)) AS item_id,
            count(*) AS valid_days,
            round(avg(usage_history.qty), 2) AS daily_usage_avg,
            round(stddev_samp(usage_history.qty), 2) AS daily_usage_sd
           FROM raw.usage_history
          WHERE ((usage_history.qty >= (0)::numeric) AND (COALESCE(usage_history.note, ''::text) !~~* '%프로젝트%'::text))
          GROUP BY (upper(regexp_replace(usage_history.item_id, '[\s\-_]'::text, ''::text, 'g'::text)))
        )
 SELECT c.item_id,
    COALESCE((p.valid_days)::bigint, c.valid_days) AS valid_days,
    COALESCE(p.daily_usage_avg, c.daily_usage_avg) AS daily_usage_avg,
    COALESCE(p.daily_usage_sd, c.daily_usage_sd) AS daily_usage_sd,
    round(COALESCE(p.daily_usage_avg, c.daily_usage_avg), 2) AS usage_used,
    round((COALESCE(p.daily_usage_sd, c.daily_usage_sd) / NULLIF(COALESCE(p.daily_usage_avg, c.daily_usage_avg), (0)::numeric)), 2) AS cv,
        CASE
            WHEN (p.item_id IS NOT NULL) THEN '확정값'::text
            ELSE '정제 기준'::text
        END AS source
   FROM (calc c
     LEFT JOIN core.usage_profile p ON ((p.item_id = c.item_id)));


--
-- Name: v_stockout_risk; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_stockout_risk AS
 WITH base AS (
         SELECT i.item_id,
            i.item_name,
            i.supplier_id,
            COALESCE(st.current_stock, (0)::numeric) AS current_stock,
            COALESCE(ib.inbound_qty, (0)::numeric) AS inbound_qty,
            ue.daily_usage_avg,
            ue.cv,
            le.effective_lead_time
           FROM ((((core.v_item_master i
             LEFT JOIN core.v_stock_on_hand st ON ((st.item_id = i.item_id)))
             LEFT JOIN core.v_inbound_qty ib ON ((ib.item_id = i.item_id)))
             LEFT JOIN core.v_usage_effective ue ON ((ue.item_id = i.item_id)))
             LEFT JOIN core.v_leadtime_effective le ON ((le.supplier_id = i.supplier_id)))
          WHERE (i.is_active = 'Y'::text)
        )
 SELECT item_id,
    item_name,
    supplier_id,
    current_stock,
    inbound_qty,
    (current_stock + inbound_qty) AS available_qty,
    daily_usage_avg,
    cv,
    effective_lead_time AS planned_lead_time,
        CASE
            WHEN (COALESCE(daily_usage_avg, (0)::numeric) > (0)::numeric) THEN round(((current_stock + inbound_qty) / daily_usage_avg), 1)
            ELSE NULL::numeric
        END AS stockout_days,
        CASE
            WHEN (COALESCE(daily_usage_avg, (0)::numeric) > (0)::numeric) THEN (CURRENT_DATE + (floor(((current_stock + inbound_qty) / daily_usage_avg)))::integer)
            ELSE NULL::date
        END AS stockout_date,
        CASE
            WHEN (COALESCE(daily_usage_avg, (0)::numeric) = (0)::numeric) THEN 'UNKNOWN'::text
            WHEN (effective_lead_time IS NULL) THEN 'UNKNOWN'::text
            WHEN (((current_stock + inbound_qty) / daily_usage_avg) <= (effective_lead_time)::numeric) THEN 'CRITICAL'::text
            ELSE 'SAFE'::text
        END AS risk_status,
        CASE
            WHEN (COALESCE(daily_usage_avg, (0)::numeric) = (0)::numeric) THEN 'NO_USAGE'::text
            WHEN (effective_lead_time IS NULL) THEN 'NO_LEADTIME'::text
            ELSE NULL::text
        END AS reason
   FROM base;


--
-- Name: VIEW v_stockout_risk; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_stockout_risk IS '[DEPRECATED 2026-09-04] 5회차 더미 데이터 기준 뷰. 실데이터에는 재고·리드타임이 없으므로 더 이상 갱신되지 않습니다. 신규 코드는 analytics.v_shipment_trend · v_item_demand_profile · v_ol_accuracy · v_bom_requirement_x 를 사용하십시오.';


--
-- Name: v_stockout_kpi; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_stockout_kpi AS
 SELECT count(*) AS n_items,
    count(*) FILTER (WHERE (risk_status = 'CRITICAL'::text)) AS n_critical,
    count(*) FILTER (WHERE (risk_status = 'SAFE'::text)) AS n_safe,
    count(*) FILTER (WHERE (risk_status = 'UNKNOWN'::text)) AS n_unknown,
    count(*) FILTER (WHERE (stockout_days <= (30)::numeric)) AS n_within_30d,
    round(avg(stockout_days), 1) AS avg_stockout_days
   FROM analytics.v_stockout_risk;


--
-- Name: VIEW v_stockout_kpi; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_stockout_kpi IS '[DEPRECATED 2026-09-04] 5회차 더미 데이터 기준 뷰. 실데이터에는 재고·리드타임이 없으므로 더 이상 갱신되지 않습니다. 신규 코드는 analytics.v_shipment_trend · v_item_demand_profile · v_ol_accuracy · v_bom_requirement_x 를 사용하십시오.';


--
-- Name: v_supplier; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_supplier AS
 SELECT s.supplier_id,
    s.supplier_name,
    s.entity_id,
    e.entity_name,
    e.country_code,
    s.lead_time_days,
    s.active,
    s.valid_from,
    s.valid_to,
    s.note,
    ( SELECT count(*) AS count
           FROM core.supplier_departure d
          WHERE (d.supplier_id = s.supplier_id)) AS n_departure_rules,
        CASE
            WHEN (s.lead_time_days IS NULL) THEN 'LEADTIME_UNSET'::text
            ELSE NULL::text
        END AS reason_code
   FROM (core.supplier s
     LEFT JOIN core.supply_entity e ON ((e.entity_id = s.entity_id)));


--
-- Name: v_supplier_departure; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_supplier_departure AS
 SELECT d.departure_id,
    d.supplier_id,
    s.supplier_name,
    s.entity_id,
    d.weekday,
    d.day_of_month,
    d.valid_from,
    d.valid_to,
    d.note
   FROM (core.supplier_departure d
     JOIN core.supplier s ON ((s.supplier_id = d.supplier_id)));


--
-- Name: v_supply_entity; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_supply_entity AS
 SELECT entity_id,
    entity_name,
    country_code,
    prep_days,
    active,
    valid_from,
    valid_to,
    note,
    ( SELECT count(*) AS count
           FROM core.supplier s
          WHERE ((s.entity_id = e.entity_id) AND s.active)) AS n_active_suppliers,
        CASE
            WHEN (prep_days = 0) THEN 'PREP_DAYS_UNSET'::text
            ELSE NULL::text
        END AS reason_code
   FROM core.supply_entity e;


--
-- Name: v_usage_anomaly; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_usage_anomaly AS
 WITH stat AS (
         SELECT usage_history.item_id,
            avg(usage_history.qty) AS avg_qty,
            stddev_samp(usage_history.qty) AS sd_qty
           FROM raw.usage_history
          GROUP BY usage_history.item_id
        )
 SELECT u.usage_id,
    u.item_id,
    u.use_date,
    u.qty,
    round(s.avg_qty, 1) AS avg_qty,
    round((u.qty / NULLIF(s.avg_qty, (0)::numeric)), 1) AS ratio,
    u.note,
        CASE
            WHEN (u.qty < (0)::numeric) THEN 'RETURN'::text
            WHEN (COALESCE(u.note, ''::text) ~~* '%프로젝트%'::text) THEN 'PROJECT'::text
            ELSE 'UNEXPLAINED'::text
        END AS anomaly_type
   FROM (raw.usage_history u
     JOIN stat s ON ((s.item_id = u.item_id)))
  WHERE ((u.qty > (s.avg_qty + ((3)::numeric * s.sd_qty))) OR (u.qty < (0)::numeric));


--
-- Name: VIEW v_usage_anomaly; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_usage_anomaly IS '[DEPRECATED 2026-09-04] 5회차 더미 데이터 기준 뷰. 실데이터에는 재고·리드타임이 없으므로 더 이상 갱신되지 않습니다. 신규 코드는 analytics.v_shipment_trend · v_item_demand_profile · v_ol_accuracy · v_bom_requirement_x 를 사용하십시오.';


--
-- Name: v_usage_profile; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_usage_profile AS
 SELECT u.item_id,
    i.item_name,
    i.item_type,
    i.supplier_id,
    u.valid_days,
    u.daily_usage_avg,
    u.daily_usage_sd,
    u.cv,
        CASE
            WHEN (u.cv >= 0.5) THEN '변동 큼'::text
            WHEN (u.cv >= 0.3) THEN '보통'::text
            ELSE '안정'::text
        END AS stability,
    u.source
   FROM (core.v_usage_effective u
     JOIN core.v_item_master i ON ((i.item_id = u.item_id)));


--
-- Name: VIEW v_usage_profile; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_usage_profile IS '[DEPRECATED 2026-09-04] 5회차 더미 데이터 기준 뷰. 실데이터에는 재고·리드타임이 없으므로 더 이상 갱신되지 않습니다. 신규 코드는 analytics.v_shipment_trend · v_item_demand_profile · v_ol_accuracy · v_bom_requirement_x 를 사용하십시오.';


--
-- Name: agent_conversation; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.agent_conversation (
    conversation_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_message_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE agent_conversation; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.agent_conversation IS 'STEP 16 — AI Agent 대화. 본인 대화만 조회·기록하고 관리자는 감사 목적으로 전체 조회';


--
-- Name: agent_conversation_legacy_202609092017; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.agent_conversation_legacy_202609092017 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    user_email text,
    title text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_message; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.agent_message (
    message_id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    question text NOT NULL,
    answer jsonb,
    tool_trace jsonb DEFAULT '[]'::jsonb NOT NULL,
    guardrail jsonb,
    token_usage jsonb,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE agent_message; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.agent_message IS 'STEP 16 — 질문 · 답변(JSON 계약) · Tool Trace · Guardrail 결과. 저장 실패가 답변을 없애지 않습니다';


--
-- Name: agent_message_legacy_202609092017; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.agent_message_legacy_202609092017 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    role text NOT NULL,
    content text,
    answer jsonb,
    tool_trace jsonb,
    usage jsonb,
    guardrail jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_message_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
);


--
-- Name: app_user; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.app_user (
    user_id uuid NOT NULL,
    email text NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    department text,
    role text DEFAULT 'USER'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_user_role_check CHECK ((role = ANY (ARRAY['ADMIN'::text, 'USER'::text])))
);


--
-- Name: audit_log; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.audit_log (
    id bigint NOT NULL,
    actor uuid,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    before jsonb,
    after jsonb,
    at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.audit_log ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: column_mapping; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.column_mapping (
    mapping_id uuid DEFAULT gen_random_uuid() NOT NULL,
    import_type text NOT NULL,
    source_column text NOT NULL,
    target_column text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: import_row_backup; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.import_row_backup (
    backup_id bigint NOT NULL,
    batch_id uuid NOT NULL,
    target_table text NOT NULL,
    row_data jsonb NOT NULL,
    backup_reason text NOT NULL,
    CONSTRAINT import_row_backup_backup_reason_check CHECK ((backup_reason = ANY (ARRAY['UPSERT'::text, 'REPLACE'::text])))
);


--
-- Name: import_row_backup_backup_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.import_row_backup ALTER COLUMN backup_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.import_row_backup_backup_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: import_staging; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.import_staging (
    staging_id bigint NOT NULL,
    batch_id uuid NOT NULL,
    row_number integer NOT NULL,
    original_data jsonb NOT NULL,
    mapped_data jsonb,
    validation_status text DEFAULT 'PENDING'::text NOT NULL,
    CONSTRAINT import_staging_validation_status_check CHECK ((validation_status = ANY (ARRAY['PENDING'::text, 'SUCCESS'::text, 'WARNING'::text, 'ERROR'::text])))
);


--
-- Name: import_staging_staging_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.import_staging ALTER COLUMN staging_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.import_staging_staging_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: model_version; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.model_version (
    model_version uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    model_id text NOT NULL,
    version text NOT NULL,
    definition jsonb NOT NULL,
    parameters jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- Name: outlier_rule; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.outlier_rule (
    rule_id uuid DEFAULT gen_random_uuid() NOT NULL,
    rule_type text NOT NULL,
    rule_name text NOT NULL,
    rule_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    exclude_from_training boolean DEFAULT true NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT outlier_rule_rule_type_check CHECK ((rule_type = ANY (ARRAY['PROJECT'::text, 'RETURN'::text, 'DUPLICATE'::text, 'CUSTOM'::text])))
);


--
-- Name: supplier_alias; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.supplier_alias (
    alias text NOT NULL,
    supplier_id text
);


--
-- Name: supplier_departure_departure_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

CREATE SEQUENCE core.supplier_departure_departure_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: supplier_departure_departure_id_seq; Type: SEQUENCE OWNED BY; Schema: core; Owner: -
--

ALTER SEQUENCE core.supplier_departure_departure_id_seq OWNED BY core.supplier_departure.departure_id;


--
-- Name: v_import_supplier_reference; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_import_supplier_reference AS
 SELECT DISTINCT "공급업체코드" AS supplier_id
   FROM raw.supplier_master
  WHERE ("공급업체코드" IS NOT NULL);


--
-- Name: v_ym_calendar; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_ym_calendar AS
 SELECT DISTINCT ym
   FROM raw.fact_shipment;


--
-- Name: VIEW v_ym_calendar; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON VIEW core.v_ym_calendar IS '출고 데이터에 존재하는 월 목록. 희소 저장 보정용';


--
-- Name: validation_error; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.validation_error (
    validation_error_id bigint NOT NULL,
    batch_id uuid NOT NULL,
    row_number integer NOT NULL,
    field_name text NOT NULL,
    error_code text NOT NULL,
    error_message text NOT NULL,
    severity text NOT NULL,
    original_value text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT validation_error_severity_check CHECK ((severity = ANY (ARRAY['WARNING'::text, 'ERROR'::text])))
);


--
-- Name: validation_error_validation_error_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.validation_error ALTER COLUMN validation_error_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.validation_error_validation_error_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: bridge_scc_config; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.bridge_scc_config (
    model_key text,
    model_base text,
    neutral_item_code text,
    neutral_desc text,
    scc_item_code text,
    scc_desc text,
    qty numeric(18,4)
);


--
-- Name: business_event; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.business_event (
    business_event_id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_date date NOT NULL,
    event_type text NOT NULL,
    item_id text,
    supplier_id text,
    quantity numeric,
    note text,
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);


--
-- Name: forecast; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.forecast (
    "품목코드" text,
    "품목명" text,
    "2026-09" text,
    "2026-10" text,
    "2026-11" text,
    "2026-12" text,
    "2027-01" text,
    "2027-02" text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);


--
-- Name: goods_receipt; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.goods_receipt (
    "입고번호" text,
    "발주번호" text,
    "품목코드" text,
    "입고수량" text,
    "입고일" text,
    "입고창고" text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);


--
-- Name: item_substitute; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.item_substitute (
    item_substitute_id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id text NOT NULL,
    substitute_item_id text NOT NULL,
    priority integer,
    valid_from date,
    valid_to date,
    note text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text,
    CONSTRAINT item_substitute_check CHECK ((item_id <> substitute_item_id)),
    CONSTRAINT item_substitute_check1 CHECK (((valid_to IS NULL) OR (valid_from IS NULL) OR (valid_from <= valid_to)))
);


--
-- Name: purchase_order; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.purchase_order (
    "발주번호" text,
    "발주일" text,
    "공급업체" text,
    "품목코드" text,
    "발주수량" text,
    "단가" text,
    "납기예정일" text,
    "발주담당" text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);


--
-- Name: sales_order; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.sales_order (
    sales_order_id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_no text,
    order_date date,
    requested_date date,
    customer_id text,
    item_id text,
    quantity numeric,
    unit text,
    order_status text,
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);


--
-- Name: supplier_departure departure_id; Type: DEFAULT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.supplier_departure ALTER COLUMN departure_id SET DEFAULT nextval('core.supplier_departure_departure_id_seq'::regclass);


--
-- Name: agent_conversation_legacy_202609092017 agent_conversation_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.agent_conversation_legacy_202609092017
    ADD CONSTRAINT agent_conversation_pkey PRIMARY KEY (id);


--
-- Name: agent_conversation agent_conversation_pkey1; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.agent_conversation
    ADD CONSTRAINT agent_conversation_pkey1 PRIMARY KEY (conversation_id);


--
-- Name: agent_message_legacy_202609092017 agent_message_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.agent_message_legacy_202609092017
    ADD CONSTRAINT agent_message_pkey PRIMARY KEY (id);


--
-- Name: agent_message agent_message_pkey1; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.agent_message
    ADD CONSTRAINT agent_message_pkey1 PRIMARY KEY (message_id);


--
-- Name: app_user app_user_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.app_user
    ADD CONSTRAINT app_user_pkey PRIMARY KEY (user_id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: backtest_run backtest_run_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.backtest_run
    ADD CONSTRAINT backtest_run_pkey PRIMARY KEY (backtest_run_id);


--
-- Name: business_calendar business_calendar_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.business_calendar
    ADD CONSTRAINT business_calendar_pkey PRIMARY KEY (country_code, calendar_date);


--
-- Name: champion_model_selection champion_model_selection_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.champion_model_selection
    ADD CONSTRAINT champion_model_selection_pkey PRIMARY KEY (selection_id);


--
-- Name: column_mapping column_mapping_import_type_source_column_target_column_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.column_mapping
    ADD CONSTRAINT column_mapping_import_type_source_column_target_column_key UNIQUE (import_type, source_column, target_column);


--
-- Name: column_mapping column_mapping_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.column_mapping
    ADD CONSTRAINT column_mapping_pkey PRIMARY KEY (mapping_id);


--
-- Name: forecast_result forecast_result_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.forecast_result
    ADD CONSTRAINT forecast_result_pkey PRIMARY KEY (run_id, model_id, item_id, period);


--
-- Name: forecast_run forecast_run_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.forecast_run
    ADD CONSTRAINT forecast_run_pkey PRIMARY KEY (run_id);


--
-- Name: forecast_setting forecast_setting_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.forecast_setting
    ADD CONSTRAINT forecast_setting_pkey PRIMARY KEY (setting_id);


--
-- Name: import_row_backup import_row_backup_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.import_row_backup
    ADD CONSTRAINT import_row_backup_pkey PRIMARY KEY (backup_id);


--
-- Name: import_staging import_staging_batch_id_row_number_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.import_staging
    ADD CONSTRAINT import_staging_batch_id_row_number_key UNIQUE (batch_id, row_number);


--
-- Name: import_staging import_staging_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.import_staging
    ADD CONSTRAINT import_staging_pkey PRIMARY KEY (staging_id);


--
-- Name: item_policy item_policy_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.item_policy
    ADD CONSTRAINT item_policy_pkey PRIMARY KEY (item_id);


--
-- Name: leadtime_plan leadtime_plan_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.leadtime_plan
    ADD CONSTRAINT leadtime_plan_pkey PRIMARY KEY (supplier_id);


--
-- Name: model_config model_config_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.model_config
    ADD CONSTRAINT model_config_pkey PRIMARY KEY (model_id);


--
-- Name: model_performance model_performance_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.model_performance
    ADD CONSTRAINT model_performance_pkey PRIMARY KEY (backtest_run_id, model_id, item_id);


--
-- Name: model_version model_version_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.model_version
    ADD CONSTRAINT model_version_pkey PRIMARY KEY (model_version);


--
-- Name: model_version model_version_run_id_model_id_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.model_version
    ADD CONSTRAINT model_version_run_id_model_id_key UNIQUE (run_id, model_id);


--
-- Name: outlier_rule outlier_rule_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.outlier_rule
    ADD CONSTRAINT outlier_rule_pkey PRIMARY KEY (rule_id);


--
-- Name: outlier_rule outlier_rule_rule_type_rule_name_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.outlier_rule
    ADD CONSTRAINT outlier_rule_rule_type_rule_name_key UNIQUE (rule_type, rule_name);


--
-- Name: policy_config policy_config_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.policy_config
    ADD CONSTRAINT policy_config_pkey PRIMARY KEY (policy_key);


--
-- Name: supplier_alias supplier_alias_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.supplier_alias
    ADD CONSTRAINT supplier_alias_pkey PRIMARY KEY (alias);


--
-- Name: supplier_departure supplier_departure_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.supplier_departure
    ADD CONSTRAINT supplier_departure_pkey PRIMARY KEY (departure_id);


--
-- Name: supplier supplier_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.supplier
    ADD CONSTRAINT supplier_pkey PRIMARY KEY (supplier_id);


--
-- Name: supply_entity supply_entity_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.supply_entity
    ADD CONSTRAINT supply_entity_pkey PRIMARY KEY (entity_id);


--
-- Name: upload_batch upload_batch_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.upload_batch
    ADD CONSTRAINT upload_batch_pkey PRIMARY KEY (batch_id);


--
-- Name: usage_profile usage_profile_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.usage_profile
    ADD CONSTRAINT usage_profile_pkey PRIMARY KEY (item_id);


--
-- Name: validation_error validation_error_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.validation_error
    ADD CONSTRAINT validation_error_pkey PRIMARY KEY (validation_error_id);


--
-- Name: business_event business_event_pkey; Type: CONSTRAINT; Schema: raw; Owner: -
--

ALTER TABLE ONLY raw.business_event
    ADD CONSTRAINT business_event_pkey PRIMARY KEY (business_event_id);


--
-- Name: dim_item dim_item_pkey; Type: CONSTRAINT; Schema: raw; Owner: -
--

ALTER TABLE ONLY raw.dim_item
    ADD CONSTRAINT dim_item_pkey PRIMARY KEY (item_code);


--
-- Name: dim_model dim_model_pkey; Type: CONSTRAINT; Schema: raw; Owner: -
--

ALTER TABLE ONLY raw.dim_model
    ADD CONSTRAINT dim_model_pkey PRIMARY KEY (model_key);


--
-- Name: item_substitute item_substitute_pkey; Type: CONSTRAINT; Schema: raw; Owner: -
--

ALTER TABLE ONLY raw.item_substitute
    ADD CONSTRAINT item_substitute_pkey PRIMARY KEY (item_substitute_id);


--
-- Name: sales_order sales_order_pkey; Type: CONSTRAINT; Schema: raw; Owner: -
--

ALTER TABLE ONLY raw.sales_order
    ADD CONSTRAINT sales_order_pkey PRIMARY KEY (sales_order_id);


--
-- Name: agent_conversation_user_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX agent_conversation_user_idx ON core.agent_conversation USING btree (user_id, last_message_at DESC);


--
-- Name: agent_message_conversation_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX agent_message_conversation_idx ON core.agent_message USING btree (conversation_id, created_at);


--
-- Name: app_user_role_active_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX app_user_role_active_idx ON core.app_user USING btree (role, active);


--
-- Name: audit_log_actor_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX audit_log_actor_idx ON core.audit_log USING btree (actor, at DESC);


--
-- Name: audit_log_target_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX audit_log_target_idx ON core.audit_log USING btree (target_type, target_id, at DESC);


--
-- Name: champion_selection_item_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX champion_selection_item_idx ON core.champion_model_selection USING btree (item_id, selected_at DESC);


--
-- Name: forecast_result_run_item_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX forecast_result_run_item_idx ON core.forecast_result USING btree (run_id, item_id, period);


--
-- Name: forecast_run_status_started_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX forecast_run_status_started_idx ON core.forecast_run USING btree (status, started_at DESC);


--
-- Name: forecast_setting_one_active_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE UNIQUE INDEX forecast_setting_one_active_idx ON core.forecast_setting USING btree (active) WHERE active;


--
-- Name: import_staging_batch_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX import_staging_batch_idx ON core.import_staging USING btree (batch_id, row_number);


--
-- Name: ix_agent_conv_user; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX ix_agent_conv_user ON core.agent_conversation_legacy_202609092017 USING btree (user_id, last_at DESC);


--
-- Name: ix_agent_msg_conv; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX ix_agent_msg_conv ON core.agent_message_legacy_202609092017 USING btree (conversation_id, created_at);


--
-- Name: model_performance_run_item_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX model_performance_run_item_idx ON core.model_performance USING btree (backtest_run_id, item_id, rank);


--
-- Name: model_version_run_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX model_version_run_idx ON core.model_version USING btree (run_id, model_id);


--
-- Name: outlier_rule_active_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX outlier_rule_active_idx ON core.outlier_rule USING btree (active, rule_type);


--
-- Name: supplier_departure_supplier_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX supplier_departure_supplier_idx ON core.supplier_departure USING btree (supplier_id);


--
-- Name: supplier_entity_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX supplier_entity_idx ON core.supplier USING btree (entity_id) WHERE active;


--
-- Name: validation_error_batch_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX validation_error_batch_idx ON core.validation_error USING btree (batch_id, row_number);


--
-- Name: ix_bom_item; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_bom_item ON raw.bridge_bom USING btree (item_code);


--
-- Name: ix_bom_model; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_bom_model ON raw.bridge_bom USING btree (model_base);


--
-- Name: ix_cap_model; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_cap_model ON raw.bridge_mc_cap USING btree (model_base);


--
-- Name: ix_capopt_cap; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_capopt_cap ON raw.bridge_cap_option USING btree (cap_item_code);


--
-- Name: ix_item_hoc; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_item_hoc ON raw.dim_item USING btree (hoc_code);


--
-- Name: ix_item_type; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_item_type ON raw.dim_item USING btree (item_type);


--
-- Name: ix_mc_fy; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_mc_fy ON raw.fact_mc_plan_actual USING btree (fy_sheet);


--
-- Name: ix_mc_model; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_mc_model ON raw.fact_mc_plan_actual USING btree (model_base, ym);


--
-- Name: ix_optmodel; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_optmodel ON raw.bridge_option_model USING btree (item_code, model_base);


--
-- Name: ix_scc_model; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_scc_model ON raw.bridge_scc_config USING btree (model_base);


--
-- Name: ix_scc_neutral; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_scc_neutral ON raw.bridge_scc_config USING btree (neutral_item_code);


--
-- Name: ix_ship_item; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_ship_item ON raw.fact_shipment USING btree (item_code);


--
-- Name: ix_ship_type_ym; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_ship_type_ym ON raw.fact_shipment USING btree (item_type, ym);


--
-- Name: ix_ship_ym; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_ship_ym ON raw.fact_shipment USING btree (ym);


--
-- Name: ix_xcn_hoc; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_xcn_hoc ON raw.bridge_xcn USING btree (hoc_item);


--
-- Name: ix_xcn_rel; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_xcn_rel ON raw.bridge_xcn USING btree (related_item);


--
-- Name: raw_business_event_date_idx; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX raw_business_event_date_idx ON raw.business_event USING btree (event_date, item_id);


--
-- Name: raw_item_substitute_item_idx; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX raw_item_substitute_item_idx ON raw.item_substitute USING btree (item_id, substitute_item_id);


--
-- Name: raw_sales_order_date_idx; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX raw_sales_order_date_idx ON raw.sales_order USING btree (order_date, item_id);


--
-- Name: raw_usage_history_use_date_idx; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX raw_usage_history_use_date_idx ON raw.usage_history USING btree (use_date, item_id);


--
-- Name: app_user app_user_audit_change; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER app_user_audit_change AFTER UPDATE OF role, active ON core.app_user FOR EACH ROW EXECUTE FUNCTION core.audit_app_user_change();


--
-- Name: app_user app_user_protect_self_change; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER app_user_protect_self_change BEFORE UPDATE OF role, active ON core.app_user FOR EACH ROW EXECUTE FUNCTION core.protect_self_admin_change();


--
-- Name: app_user app_user_set_updated_at; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER app_user_set_updated_at BEFORE UPDATE ON core.app_user FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


--
-- Name: forecast_setting forecast_setting_set_updated_at; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER forecast_setting_set_updated_at BEFORE UPDATE ON core.forecast_setting FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


--
-- Name: item_policy item_policy_set_updated_at; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER item_policy_set_updated_at BEFORE UPDATE ON core.item_policy FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


--
-- Name: model_config model_config_set_updated_at; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER model_config_set_updated_at BEFORE UPDATE ON core.model_config FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


--
-- Name: outlier_rule outlier_rule_set_updated_at; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER outlier_rule_set_updated_at BEFORE UPDATE ON core.outlier_rule FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


--
-- Name: policy_config policy_config_set_updated_at; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER policy_config_set_updated_at BEFORE UPDATE ON core.policy_config FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


--
-- Name: agent_conversation_legacy_202609092017 agent_conversation_user_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.agent_conversation_legacy_202609092017
    ADD CONSTRAINT agent_conversation_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: agent_conversation agent_conversation_user_id_fkey1; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.agent_conversation
    ADD CONSTRAINT agent_conversation_user_id_fkey1 FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: agent_message_legacy_202609092017 agent_message_conversation_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.agent_message_legacy_202609092017
    ADD CONSTRAINT agent_message_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES core.agent_conversation_legacy_202609092017(id) ON DELETE CASCADE;


--
-- Name: agent_message agent_message_conversation_id_fkey1; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.agent_message
    ADD CONSTRAINT agent_message_conversation_id_fkey1 FOREIGN KEY (conversation_id) REFERENCES core.agent_conversation(conversation_id) ON DELETE CASCADE;


--
-- Name: agent_message agent_message_user_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.agent_message
    ADD CONSTRAINT agent_message_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: app_user app_user_user_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.app_user
    ADD CONSTRAINT app_user_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: audit_log audit_log_actor_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.audit_log
    ADD CONSTRAINT audit_log_actor_fkey FOREIGN KEY (actor) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: backtest_run backtest_run_forecast_run_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.backtest_run
    ADD CONSTRAINT backtest_run_forecast_run_id_fkey FOREIGN KEY (forecast_run_id) REFERENCES core.forecast_run(run_id);


--
-- Name: backtest_run backtest_run_triggered_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.backtest_run
    ADD CONSTRAINT backtest_run_triggered_by_fkey FOREIGN KEY (triggered_by) REFERENCES auth.users(id);


--
-- Name: champion_model_selection champion_model_selection_backtest_run_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.champion_model_selection
    ADD CONSTRAINT champion_model_selection_backtest_run_id_fkey FOREIGN KEY (backtest_run_id) REFERENCES core.backtest_run(backtest_run_id);


--
-- Name: champion_model_selection champion_model_selection_model_version_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.champion_model_selection
    ADD CONSTRAINT champion_model_selection_model_version_fkey FOREIGN KEY (model_version) REFERENCES core.model_version(model_version);


--
-- Name: champion_model_selection champion_model_selection_selected_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.champion_model_selection
    ADD CONSTRAINT champion_model_selection_selected_by_fkey FOREIGN KEY (selected_by) REFERENCES auth.users(id);


--
-- Name: column_mapping column_mapping_created_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.column_mapping
    ADD CONSTRAINT column_mapping_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: forecast_result forecast_result_model_version_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.forecast_result
    ADD CONSTRAINT forecast_result_model_version_fkey FOREIGN KEY (model_version) REFERENCES core.model_version(model_version);


--
-- Name: forecast_result forecast_result_run_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.forecast_result
    ADD CONSTRAINT forecast_result_run_id_fkey FOREIGN KEY (run_id) REFERENCES core.forecast_run(run_id) ON DELETE CASCADE;


--
-- Name: forecast_run forecast_run_triggered_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.forecast_run
    ADD CONSTRAINT forecast_run_triggered_by_fkey FOREIGN KEY (triggered_by) REFERENCES auth.users(id);


--
-- Name: import_row_backup import_row_backup_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.import_row_backup
    ADD CONSTRAINT import_row_backup_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES core.upload_batch(batch_id) ON DELETE CASCADE;


--
-- Name: import_staging import_staging_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.import_staging
    ADD CONSTRAINT import_staging_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES core.upload_batch(batch_id) ON DELETE CASCADE;


--
-- Name: model_config model_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.model_config
    ADD CONSTRAINT model_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);


--
-- Name: model_performance model_performance_backtest_run_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.model_performance
    ADD CONSTRAINT model_performance_backtest_run_id_fkey FOREIGN KEY (backtest_run_id) REFERENCES core.backtest_run(backtest_run_id) ON DELETE CASCADE;


--
-- Name: model_performance model_performance_forecast_run_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.model_performance
    ADD CONSTRAINT model_performance_forecast_run_id_fkey FOREIGN KEY (forecast_run_id) REFERENCES core.forecast_run(run_id);


--
-- Name: model_performance model_performance_model_version_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.model_performance
    ADD CONSTRAINT model_performance_model_version_fkey FOREIGN KEY (model_version) REFERENCES core.model_version(model_version);


--
-- Name: model_version model_version_created_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.model_version
    ADD CONSTRAINT model_version_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: model_version model_version_run_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.model_version
    ADD CONSTRAINT model_version_run_id_fkey FOREIGN KEY (run_id) REFERENCES core.forecast_run(run_id) ON DELETE CASCADE;


--
-- Name: supplier_departure supplier_departure_supplier_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.supplier_departure
    ADD CONSTRAINT supplier_departure_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES core.supplier(supplier_id) ON DELETE CASCADE;


--
-- Name: supplier supplier_entity_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.supplier
    ADD CONSTRAINT supplier_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES core.supply_entity(entity_id);


--
-- Name: upload_batch upload_batch_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.upload_batch
    ADD CONSTRAINT upload_batch_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id);


--
-- Name: validation_error validation_error_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.validation_error
    ADD CONSTRAINT validation_error_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES core.upload_batch(batch_id) ON DELETE CASCADE;


--
-- Name: agent_conversation; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.agent_conversation ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_conversation_legacy_202609092017; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.agent_conversation_legacy_202609092017 ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_conversation agent_conversation_owner_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY agent_conversation_owner_select ON core.agent_conversation FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR core.is_admin()));


--
-- Name: agent_conversation agent_conversation_owner_write; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY agent_conversation_owner_write ON core.agent_conversation TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: agent_message; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.agent_message ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_message_legacy_202609092017; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.agent_message_legacy_202609092017 ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_message agent_message_owner_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY agent_message_owner_select ON core.agent_message FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR core.is_admin()));


--
-- Name: agent_message agent_message_owner_write; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY agent_message_owner_write ON core.agent_message TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: app_user; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.app_user ENABLE ROW LEVEL SECURITY;

--
-- Name: app_user app_user_admin_update; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY app_user_admin_update ON core.app_user FOR UPDATE TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: app_user app_user_select_self_or_admin; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY app_user_select_self_or_admin ON core.app_user FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR core.is_admin()));


--
-- Name: audit_log; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log audit_log_admin_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY audit_log_admin_select ON core.audit_log FOR SELECT TO authenticated USING (core.is_admin());


--
-- Name: backtest_run; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.backtest_run ENABLE ROW LEVEL SECURITY;

--
-- Name: backtest_run backtest_run_active_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY backtest_run_active_select ON core.backtest_run FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: backtest_run backtest_run_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY backtest_run_admin_mutation ON core.backtest_run TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: business_calendar; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.business_calendar ENABLE ROW LEVEL SECURITY;

--
-- Name: business_calendar business_calendar_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY business_calendar_read ON core.business_calendar FOR SELECT TO authenticated USING (true);


--
-- Name: business_calendar business_calendar_write_admin; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY business_calendar_write_admin ON core.business_calendar TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: champion_model_selection; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.champion_model_selection ENABLE ROW LEVEL SECURITY;

--
-- Name: champion_model_selection champion_model_selection_active_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY champion_model_selection_active_select ON core.champion_model_selection FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: champion_model_selection champion_model_selection_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY champion_model_selection_admin_mutation ON core.champion_model_selection TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: column_mapping; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.column_mapping ENABLE ROW LEVEL SECURITY;

--
-- Name: column_mapping column_mapping_active_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY column_mapping_active_select ON core.column_mapping FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: column_mapping column_mapping_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY column_mapping_admin_mutation ON core.column_mapping TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: agent_conversation_legacy_202609092017 conv_insert_own; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY conv_insert_own ON core.agent_conversation_legacy_202609092017 FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: agent_conversation_legacy_202609092017 conv_select_admin; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY conv_select_admin ON core.agent_conversation_legacy_202609092017 FOR SELECT TO authenticated USING (core.is_admin());


--
-- Name: agent_conversation_legacy_202609092017 conv_select_own; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY conv_select_own ON core.agent_conversation_legacy_202609092017 FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: agent_conversation_legacy_202609092017 conv_update_own; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY conv_update_own ON core.agent_conversation_legacy_202609092017 FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: forecast_result; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.forecast_result ENABLE ROW LEVEL SECURITY;

--
-- Name: forecast_result forecast_result_active_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY forecast_result_active_select ON core.forecast_result FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: forecast_result forecast_result_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY forecast_result_admin_mutation ON core.forecast_result TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: forecast_run; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.forecast_run ENABLE ROW LEVEL SECURITY;

--
-- Name: forecast_run forecast_run_active_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY forecast_run_active_select ON core.forecast_run FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: forecast_run forecast_run_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY forecast_run_admin_mutation ON core.forecast_run TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: forecast_setting; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.forecast_setting ENABLE ROW LEVEL SECURITY;

--
-- Name: forecast_setting forecast_setting_active_user_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY forecast_setting_active_user_select ON core.forecast_setting FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: forecast_setting forecast_setting_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY forecast_setting_admin_mutation ON core.forecast_setting TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: import_row_backup; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.import_row_backup ENABLE ROW LEVEL SECURITY;

--
-- Name: import_row_backup import_row_backup_active_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY import_row_backup_active_select ON core.import_row_backup FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: import_row_backup import_row_backup_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY import_row_backup_admin_mutation ON core.import_row_backup TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: import_staging; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.import_staging ENABLE ROW LEVEL SECURITY;

--
-- Name: import_staging import_staging_active_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY import_staging_active_select ON core.import_staging FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: import_staging import_staging_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY import_staging_admin_mutation ON core.import_staging TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: item_policy; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.item_policy ENABLE ROW LEVEL SECURITY;

--
-- Name: item_policy item_policy_active_user_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY item_policy_active_user_select ON core.item_policy FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: item_policy item_policy_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY item_policy_admin_mutation ON core.item_policy TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: leadtime_plan; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.leadtime_plan ENABLE ROW LEVEL SECURITY;

--
-- Name: leadtime_plan leadtime_plan_admin_delete; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY leadtime_plan_admin_delete ON core.leadtime_plan FOR DELETE TO authenticated USING (core.is_admin());


--
-- Name: leadtime_plan leadtime_plan_admin_insert; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY leadtime_plan_admin_insert ON core.leadtime_plan FOR INSERT TO authenticated WITH CHECK (core.is_admin());


--
-- Name: leadtime_plan leadtime_plan_admin_update; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY leadtime_plan_admin_update ON core.leadtime_plan FOR UPDATE TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: leadtime_plan leadtime_plan_user_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY leadtime_plan_user_select ON core.leadtime_plan FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: model_config; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.model_config ENABLE ROW LEVEL SECURITY;

--
-- Name: model_config model_config_active_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY model_config_active_select ON core.model_config FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: model_config model_config_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY model_config_admin_mutation ON core.model_config TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: model_performance; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.model_performance ENABLE ROW LEVEL SECURITY;

--
-- Name: model_performance model_performance_active_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY model_performance_active_select ON core.model_performance FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: model_performance model_performance_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY model_performance_admin_mutation ON core.model_performance TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: model_version; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.model_version ENABLE ROW LEVEL SECURITY;

--
-- Name: model_version model_version_active_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY model_version_active_select ON core.model_version FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: model_version model_version_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY model_version_admin_mutation ON core.model_version TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: agent_message_legacy_202609092017 msg_insert_own; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY msg_insert_own ON core.agent_message_legacy_202609092017 FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM core.agent_conversation_legacy_202609092017 c
  WHERE ((c.id = agent_message_legacy_202609092017.conversation_id) AND (c.user_id = auth.uid())))));


--
-- Name: agent_message_legacy_202609092017 msg_select_admin; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY msg_select_admin ON core.agent_message_legacy_202609092017 FOR SELECT TO authenticated USING (core.is_admin());


--
-- Name: agent_message_legacy_202609092017 msg_select_own; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY msg_select_own ON core.agent_message_legacy_202609092017 FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM core.agent_conversation_legacy_202609092017 c
  WHERE ((c.id = agent_message_legacy_202609092017.conversation_id) AND (c.user_id = auth.uid())))));


--
-- Name: outlier_rule; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.outlier_rule ENABLE ROW LEVEL SECURITY;

--
-- Name: outlier_rule outlier_rule_active_user_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY outlier_rule_active_user_select ON core.outlier_rule FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: outlier_rule outlier_rule_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY outlier_rule_admin_mutation ON core.outlier_rule TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: policy_config; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.policy_config ENABLE ROW LEVEL SECURITY;

--
-- Name: policy_config policy_config_active_user_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY policy_config_active_user_select ON core.policy_config FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: policy_config policy_config_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY policy_config_admin_mutation ON core.policy_config TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: supplier; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.supplier ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_alias; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.supplier_alias ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_departure; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.supplier_departure ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_departure supplier_departure_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY supplier_departure_read ON core.supplier_departure FOR SELECT TO authenticated USING (true);


--
-- Name: supplier_departure supplier_departure_write_admin; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY supplier_departure_write_admin ON core.supplier_departure TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: supplier supplier_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY supplier_read ON core.supplier FOR SELECT TO authenticated USING (true);


--
-- Name: supplier supplier_write_admin; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY supplier_write_admin ON core.supplier TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: supply_entity; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.supply_entity ENABLE ROW LEVEL SECURITY;

--
-- Name: supply_entity supply_entity_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY supply_entity_read ON core.supply_entity FOR SELECT TO authenticated USING (true);


--
-- Name: supply_entity supply_entity_write_admin; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY supply_entity_write_admin ON core.supply_entity TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: upload_batch; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.upload_batch ENABLE ROW LEVEL SECURITY;

--
-- Name: upload_batch upload_batch_active_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY upload_batch_active_select ON core.upload_batch FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: upload_batch upload_batch_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY upload_batch_admin_mutation ON core.upload_batch TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: usage_profile; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.usage_profile ENABLE ROW LEVEL SECURITY;

--
-- Name: usage_profile usage_profile_admin_delete; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY usage_profile_admin_delete ON core.usage_profile FOR DELETE TO authenticated USING (core.is_admin());


--
-- Name: usage_profile usage_profile_admin_insert; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY usage_profile_admin_insert ON core.usage_profile FOR INSERT TO authenticated WITH CHECK (core.is_admin());


--
-- Name: usage_profile usage_profile_admin_update; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY usage_profile_admin_update ON core.usage_profile FOR UPDATE TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: usage_profile usage_profile_user_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY usage_profile_user_select ON core.usage_profile FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: validation_error; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.validation_error ENABLE ROW LEVEL SECURITY;

--
-- Name: validation_error validation_error_active_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY validation_error_active_select ON core.validation_error FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: validation_error validation_error_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY validation_error_admin_mutation ON core.validation_error TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: bridge_bom; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.bridge_bom ENABLE ROW LEVEL SECURITY;

--
-- Name: bridge_cap_option; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.bridge_cap_option ENABLE ROW LEVEL SECURITY;

--
-- Name: bridge_mc_cap; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.bridge_mc_cap ENABLE ROW LEVEL SECURITY;

--
-- Name: bridge_option_model; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.bridge_option_model ENABLE ROW LEVEL SECURITY;

--
-- Name: bridge_scc_config; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.bridge_scc_config ENABLE ROW LEVEL SECURITY;

--
-- Name: bridge_xcn; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.bridge_xcn ENABLE ROW LEVEL SECURITY;

--
-- Name: business_event; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.business_event ENABLE ROW LEVEL SECURITY;

--
-- Name: dim_item; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.dim_item ENABLE ROW LEVEL SECURITY;

--
-- Name: dim_model; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.dim_model ENABLE ROW LEVEL SECURITY;

--
-- Name: fact_mc_plan_actual; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.fact_mc_plan_actual ENABLE ROW LEVEL SECURITY;

--
-- Name: fact_shipment; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.fact_shipment ENABLE ROW LEVEL SECURITY;

--
-- Name: forecast; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.forecast ENABLE ROW LEVEL SECURITY;

--
-- Name: goods_receipt; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.goods_receipt ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.inventory ENABLE ROW LEVEL SECURITY;

--
-- Name: item_master; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.item_master ENABLE ROW LEVEL SECURITY;

--
-- Name: item_substitute; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.item_substitute ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_order; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.purchase_order ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_order; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.sales_order ENABLE ROW LEVEL SECURITY;

--
-- Name: shipment_log; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.shipment_log ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_master; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.supplier_master ENABLE ROW LEVEL SECURITY;

--
-- Name: usage_history; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.usage_history ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA analytics; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA analytics TO authenticated;


--
-- Name: SCHEMA core; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA core TO authenticated;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION audit_app_user_change(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.audit_app_user_change() FROM PUBLIC;


--
-- Name: FUNCTION commit_import_batch(p_batch_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.commit_import_batch(p_batch_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION core.commit_import_batch(p_batch_id uuid) TO authenticated;


--
-- Name: FUNCTION handle_new_auth_user(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.handle_new_auth_user() FROM PUBLIC;


--
-- Name: FUNCTION import_target_table(p_type text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.import_target_table(p_type text) FROM PUBLIC;


--
-- Name: FUNCTION is_active_user(check_user_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.is_active_user(check_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION core.is_active_user(check_user_id uuid) TO authenticated;


--
-- Name: FUNCTION is_admin(check_user_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.is_admin(check_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION core.is_admin(check_user_id uuid) TO authenticated;


--
-- Name: FUNCTION is_business_day(p_date date, p_country text); Type: ACL; Schema: core; Owner: -
--

GRANT ALL ON FUNCTION core.is_business_day(p_date date, p_country text) TO authenticated;


--
-- Name: FUNCTION is_valid_forecast_window(p_train_start date, p_train_end date, p_test_start date, p_test_end date, p_granularity text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.is_valid_forecast_window(p_train_start date, p_train_end date, p_test_start date, p_test_end date, p_granularity text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.is_valid_forecast_window(p_train_start date, p_train_end date, p_test_start date, p_test_end date, p_granularity text) TO authenticated;


--
-- Name: FUNCTION mark_login(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.mark_login() FROM PUBLIC;
GRANT ALL ON FUNCTION core.mark_login() TO authenticated;


--
-- Name: FUNCTION previous_business_day(p_date date, p_country text); Type: ACL; Schema: core; Owner: -
--

GRANT ALL ON FUNCTION core.previous_business_day(p_date date, p_country text) TO authenticated;


--
-- Name: FUNCTION protect_self_admin_change(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.protect_self_admin_change() FROM PUBLIC;


--
-- Name: FUNCTION rollback_import_batch(p_batch_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.rollback_import_batch(p_batch_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION core.rollback_import_batch(p_batch_id uuid) TO authenticated;


--
-- Name: FUNCTION run_backtest(p_forecast_run_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.run_backtest(p_forecast_run_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION core.run_backtest(p_forecast_run_id uuid) TO authenticated;


--
-- Name: FUNCTION run_baseline_forecast(p_note text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.run_baseline_forecast(p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.run_baseline_forecast(p_note text) TO authenticated;


--
-- Name: FUNCTION select_manual_champion(p_backtest_run_id uuid, p_item_id text, p_model_id text, p_reason text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.select_manual_champion(p_backtest_run_id uuid, p_item_id text, p_model_id text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.select_manual_champion(p_backtest_run_id uuid, p_item_id text, p_model_id text, p_reason text) TO authenticated;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.set_updated_at() FROM PUBLIC;


--
-- Name: TABLE backtest_run; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.backtest_run TO authenticated;


--
-- Name: TABLE v_backtest_run; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_backtest_run TO authenticated;


--
-- Name: TABLE v_item; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_item TO authenticated;


--
-- Name: TABLE v_bom_requirement; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_bom_requirement TO authenticated;


--
-- Name: TABLE v_option_commonality; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_option_commonality TO authenticated;


--
-- Name: TABLE v_bom_requirement_x; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_bom_requirement_x TO authenticated;


--
-- Name: TABLE champion_model_selection; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.champion_model_selection TO authenticated;


--
-- Name: TABLE v_champion_model; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_champion_model TO authenticated;


--
-- Name: TABLE forecast_setting; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.forecast_setting TO authenticated;


--
-- Name: TABLE v_test_actual; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_test_actual TO authenticated;


--
-- Name: TABLE v_train_demand; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_train_demand TO authenticated;


--
-- Name: TABLE v_data_coverage; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_data_coverage TO authenticated;


--
-- Name: TABLE policy_config; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.policy_config TO authenticated;


--
-- Name: TABLE v_item_master; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_item_master TO authenticated;


--
-- Name: TABLE v_sku_demand_profile; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_sku_demand_profile TO authenticated;


--
-- Name: TABLE v_demand_profile_kpi; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_demand_profile_kpi TO authenticated;


--
-- Name: TABLE forecast_result; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.forecast_result TO authenticated;


--
-- Name: TABLE v_forecast_result; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_forecast_result TO authenticated;


--
-- Name: TABLE forecast_run; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.forecast_run TO authenticated;


--
-- Name: TABLE upload_batch; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.upload_batch TO authenticated;


--
-- Name: TABLE v_forecast_run; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_forecast_run TO authenticated;


--
-- Name: TABLE v_forecast_run_kpi; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_forecast_run_kpi TO authenticated;


--
-- Name: TABLE v_part_linkage; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_part_linkage TO authenticated;


--
-- Name: TABLE v_shipment_by_hoc; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_shipment_by_hoc TO authenticated;


--
-- Name: TABLE v_item_demand_profile; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_item_demand_profile TO authenticated;


--
-- Name: TABLE v_item_demand_kpi; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_item_demand_kpi TO authenticated;


--
-- Name: TABLE item_policy; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.item_policy TO authenticated;


--
-- Name: TABLE v_item_policy; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_item_policy TO authenticated;


--
-- Name: TABLE v_fact_shipment; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_fact_shipment TO authenticated;


--
-- Name: TABLE v_shipment_valid; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_shipment_valid TO authenticated;


--
-- Name: TABLE v_leadtime_stat; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_leadtime_stat TO authenticated;


--
-- Name: TABLE v_leadtime_gap; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_leadtime_gap TO authenticated;


--
-- Name: TABLE business_calendar; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.business_calendar TO authenticated;


--
-- Name: TABLE supplier; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.supplier TO authenticated;


--
-- Name: TABLE supplier_departure; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.supplier_departure TO authenticated;


--
-- Name: TABLE supply_entity; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.supply_entity TO authenticated;


--
-- Name: TABLE v_master_readiness; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_master_readiness TO authenticated;


--
-- Name: TABLE v_model_comparison_detail; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_model_comparison_detail TO authenticated;


--
-- Name: TABLE model_config; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.model_config TO authenticated;


--
-- Name: TABLE v_model_config; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_model_config TO authenticated;


--
-- Name: TABLE model_performance; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.model_performance TO authenticated;


--
-- Name: TABLE v_model_performance; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_model_performance TO authenticated;


--
-- Name: TABLE v_ol_accuracy; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_ol_accuracy TO authenticated;


--
-- Name: TABLE v_ol_accuracy_fy; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_ol_accuracy_fy TO authenticated;


--
-- Name: TABLE v_part_linkage; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_part_linkage TO authenticated;


--
-- Name: TABLE v_model; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_model TO authenticated;


--
-- Name: TABLE v_realdata_kpi; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_realdata_kpi TO authenticated;


--
-- Name: TABLE v_shipment_trend; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_shipment_trend TO authenticated;


--
-- Name: TABLE leadtime_plan; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.leadtime_plan TO authenticated;


--
-- Name: TABLE usage_profile; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.usage_profile TO authenticated;


--
-- Name: TABLE v_leadtime_effective; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_leadtime_effective TO authenticated;


--
-- Name: TABLE v_inbound_qty; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_inbound_qty TO authenticated;


--
-- Name: TABLE v_stock_on_hand; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_stock_on_hand TO authenticated;


--
-- Name: TABLE v_usage_effective; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_usage_effective TO authenticated;


--
-- Name: TABLE v_stockout_risk; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_stockout_risk TO authenticated;


--
-- Name: TABLE v_stockout_kpi; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_stockout_kpi TO authenticated;


--
-- Name: TABLE v_supplier; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_supplier TO authenticated;


--
-- Name: TABLE v_supplier_departure; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_supplier_departure TO authenticated;


--
-- Name: TABLE v_supply_entity; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_supply_entity TO authenticated;


--
-- Name: TABLE v_usage_anomaly; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_usage_anomaly TO authenticated;


--
-- Name: TABLE v_usage_profile; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_usage_profile TO authenticated;


--
-- Name: TABLE agent_conversation; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.agent_conversation TO authenticated;


--
-- Name: TABLE agent_conversation_legacy_202609092017; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE core.agent_conversation_legacy_202609092017 TO authenticated;


--
-- Name: TABLE agent_message; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.agent_message TO authenticated;


--
-- Name: TABLE agent_message_legacy_202609092017; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT ON TABLE core.agent_message_legacy_202609092017 TO authenticated;


--
-- Name: TABLE app_user; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.app_user TO authenticated;


--
-- Name: COLUMN app_user.role; Type: ACL; Schema: core; Owner: -
--

GRANT UPDATE(role) ON TABLE core.app_user TO authenticated;


--
-- Name: COLUMN app_user.active; Type: ACL; Schema: core; Owner: -
--

GRANT UPDATE(active) ON TABLE core.app_user TO authenticated;


--
-- Name: TABLE audit_log; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.audit_log TO authenticated;


--
-- Name: SEQUENCE audit_log_id_seq; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE core.audit_log_id_seq TO authenticated;


--
-- Name: TABLE column_mapping; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.column_mapping TO authenticated;


--
-- Name: TABLE import_row_backup; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.import_row_backup TO authenticated;


--
-- Name: SEQUENCE import_row_backup_backup_id_seq; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE core.import_row_backup_backup_id_seq TO authenticated;


--
-- Name: TABLE import_staging; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.import_staging TO authenticated;


--
-- Name: SEQUENCE import_staging_staging_id_seq; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE core.import_staging_staging_id_seq TO authenticated;


--
-- Name: TABLE model_version; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.model_version TO authenticated;


--
-- Name: TABLE outlier_rule; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.outlier_rule TO authenticated;


--
-- Name: TABLE supplier_alias; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.supplier_alias TO authenticated;


--
-- Name: SEQUENCE supplier_departure_departure_id_seq; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE core.supplier_departure_departure_id_seq TO authenticated;


--
-- Name: TABLE v_import_supplier_reference; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_import_supplier_reference TO authenticated;


--
-- Name: TABLE v_ym_calendar; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_ym_calendar TO authenticated;


--
-- Name: TABLE validation_error; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.validation_error TO authenticated;


--
-- Name: SEQUENCE validation_error_validation_error_id_seq; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE core.validation_error_validation_error_id_seq TO authenticated;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: analytics; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA analytics GRANT SELECT ON TABLES TO authenticated;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: core; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA core GRANT SELECT ON TABLES TO authenticated;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict JYwI5f0Nhx4pGxuyZtmaO5LeNsVhacVeaEZZwtmztZi9igE3rxmNVNexndWkAcn

