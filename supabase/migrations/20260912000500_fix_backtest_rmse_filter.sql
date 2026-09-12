-- 보정 · STEP 7 core.run_backtest 의 RMSE 집계가 항상 실패하던 것을 고칩니다
--
-- ★ 증상 — core.run_backtest(...)를 부르면 **언제나** backtest_run.status = 'FAILED' 가 되고
--   message 에 다음이 남습니다.
--       FILTER specified, but sqrt is not an aggregate function
--
-- ★ 원인 — STEP 7(20260828000600_step7_backtest_champion.sql:75)의 RMSE 식에서 FILTER 절이
--   집계 함수가 아니라 그것을 감싼 sqrt() 에 붙어 있었습니다.
--
--       sqrt(avg(power(...))) filter (where ...)        ← sqrt 에 FILTER (문법 오류)
--       sqrt(avg(power(...)) filter (where ...))        ← avg 에 FILTER (올바름)
--
--   PostgreSQL 에서 FILTER 는 집계 함수에만 붙일 수 있습니다. 이 문장은 실행 시점에 파싱
--   단계에서 바로 실패하므로, 검증 데이터가 아무리 정상이어도 Backtest 는 한 번도 성공할 수
--   없었습니다. 같은 블록의 다른 FILTER(sum(abs(...)) · avg(abs(...)))는 집계가 바깥에 있어
--   정상입니다 — 틀린 곳은 RMSE 한 줄뿐입니다.
--
-- ★ 왜 지금까지 드러나지 않았는가 — run_backtest 는 본문 전체를 begin/exception 으로 감싸고
--   실패를 backtest_run 행에 FAILED 로 적은 뒤 **정상적으로 uuid 를 반환합니다.** 호출한 쪽은
--   예외를 보지 못합니다. 그리고 이 프로젝트의 기존 검증 스위트는 Backtest 결과 행을 fixture 로
--   직접 넣었기 때문에(supabase/tests/procurement_plan/fixtures.psql) 이 함수를 실제로 실행한
--   적이 없었습니다. Task 15 의 실제 경로 검증 스위트
--   (supabase/tests/practice_data/pipeline-fixtures.psql)가 처음으로 함수를 직접 불러 잡았습니다.
--
-- ★ 영향 — Backtest 가 실패하면 Champion 이 한 품목도 선정되지 않고, 그러면 Task 9b 의
--   발주계획이 모든 라인을 CHAMPION_UNAVAILABLE 로 계산 불가 처리합니다. 실습 데이터뿐 아니라
--   **실데이터로 Backtest 를 돌려도 똑같이 실패합니다.**
--
-- ★ 이미 적용된 STEP 7 파일은 고치지 않습니다(refactor.md §5-6 — 적용한 SQL 은 수정하지 않고
--   다음 번호의 보정 마이그레이션을 만듭니다). 아래 정의가 최종본이 됩니다.
--
-- ★ 이미 FAILED 로 남은 과거 backtest_run 행은 지우거나 고치지 않습니다 — 그때 실제로 실패한
--   것이 사실이기 때문입니다. 다시 실행하면 새 행이 생깁니다.
--
-- 다시 실행해도 안전합니다(create or replace function).

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
        -- ★ 보정 지점 — FILTER 를 sqrt() 가 아니라 avg() 에 붙입니다. 나머지 줄은 STEP 7 원본 그대로입니다.
        sqrt(avg(power(p.predicted_qty-p.actual_qty,2)) filter(where p.predicted_qty is not null and p.actual_qty is not null)) as rmse,
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

comment on function core.run_backtest(uuid) is
  'STEP 7 원본 + 2026-09-12 보정: RMSE 의 FILTER 를 sqrt() 가 아니라 avg() 에 붙인다. '
  '이전 정의는 "FILTER specified, but sqrt is not an aggregate function" 으로 항상 FAILED 였다';

-- create or replace 는 기존 GRANT 를 지우지 않지만, 적용 순서가 바뀌어도 항상 맞는 상태가 되도록
-- STEP 7 과 같은 권한을 명시적으로 다시 선언합니다.
grant execute on function core.run_backtest(uuid) to authenticated;
revoke execute on function core.run_backtest(uuid) from anon;


-- ══ 확인 쿼리 ═══════════════════════════════════════════════════════

-- (a) 정의에 고친 형태가 남아 있는지 — sqrt( ... filter ...) 안쪽에 FILTER 가 있어야 합니다.
-- select pg_get_functiondef(p.oid) like '%power(p.predicted_qty-p.actual_qty,2)) filter%' as fixed
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'core' and p.proname = 'run_backtest';
-- 기대: true

-- (b) 실제로 성공하는지 — SUCCESS 인 Forecast Run 하나로 돌려 봅니다(관리자 계정).
-- select core.run_backtest('<forecast run_id>');
-- select backtest_run_id, status, message from core.backtest_run order by started_at desc limit 1;
-- 기대: status = 'SUCCESS' · message = 'Backtest scoring 완료'
--       (이전에는 status='FAILED' · message='FILTER specified, but sqrt is not an aggregate function')

-- (c) Champion 이 실제로 선정됐는지
-- select count(*) from analytics.v_champion_model where champion_model_id is not null;
-- 기대: 0보다 큼
