-- ──────────────────────────────────────────────────────────────
-- STEP 20 · Admin 강화 · 운영 모니터링
--
-- renew.prd 30.1(관리자 메뉴) · 31.5(데이터 품질) · 8.6(대량 변경 통지) · 12.1(학습/검증 경계)
--
-- 이 파일이 푸는 문제 두 가지
--
--   ① 검증 실행과 운영 실행이 같은 것으로 취급되고 있었습니다.
--      core.forecast_setting.train_end 까지만 학습한 예측은 **과거 구간**(검증 구간)을
--      예측합니다. 그래서 재고 전개·발주 추천이 "오늘 이후" 예측을 찾지 못해
--      NO_FORECAST 가 됩니다. 운영에는 최신 데이터까지 학습한 예측이 따로 필요합니다.
--      → core.forecast_setting.production_train_end 를 더하고,
--        core.forecast_run.mode ('VALIDATION' | 'PRODUCTION') 를 더하고,
--        core.v_ai_forecast 가 PRODUCTION 실행을 먼저 고르게 하고,
--        core.run_backtest 는 VALIDATION 실행만 채점하게 합니다.
--
--   ② 실패한 실행이 이력에 남지 않았습니다 (STEP 11 검토 이월).
--      core.run_backtest · core.run_virtual_operation 의 최상위 exception 블록은
--      블록 시작점까지 되돌리므로, 맨 처음의 `insert … status='RUNNING'` 까지 사라지고
--      뒤이은 `update … status='FAILED'` 가 0행을 갱신했습니다.
--      → 본문을 `begin … exception` **서브블록**으로 감싸, RUNNING 행을 넣는 insert 가
--        롤백 범위 밖에 있게 했습니다. 이제 실패해도 FAILED 행이 남습니다.
--
-- 여기서 만드는 것
--   core       forecast_setting.production_train_end   운영 학습 종료일 (컬럼 추가)
--   core       forecast_run.mode                       VALIDATION | PRODUCTION (컬럼 추가)
--   core       v_production_demand · v_production_grid 운영 학습 구간 수요/격자
--   core       v_forecast_grid · v_forecast_fit        모드별 격자와 적합값(잔차 → sigma)
--   core       run_baseline_forecast(p_note, p_mode)★  sql/11 의 함수를 덮어씁니다
--   core       run_backtest(...)                       sql/13 의 함수를 덮어씁니다
--   core       run_virtual_operation(...)              sql/17 의 함수를 덮어씁니다
--   core       v_ai_forecast                           sql/15 의 뷰를 덮어씁니다
--   core       notify_bulk_change()                    대량 적재 → Alert 트리거
--   core       alert_type_label()                      13번째 유형 BULK_DATA_CHANGE
--   analytics  v_model_version · v_forecast_run_detail · v_system_log · v_stale_summary
--
-- ★ sql/26-api.sql 까지 먼저 실행하세요. sql/26 이 아직 없어도 적용됩니다
--   (analytics.v_system_log 의 API 갈래를 to_regclass 로 감쌌습니다).
--   이 파일 **다음에 sql/28-anon-lockdown.sql 을 실행하세요.** 그 파일이 순서의 맨
--   마지막이고, 이 파일이 새로 만든 함수에 anon 권한이 딸려 붙는 것을 거둡니다.
--
-- ★★ 재실행 규칙
--   이 파일은 `drop view … cascade` 를 쓰지 않고, 뒤 번호 파일이 이 파일의 뷰 위에
--   뷰를 만들지도 않습니다. 그래서 이 파일만 다시 실행해도 됩니다 — 다만 끝나면
--   sql/28 을 한 번 더 실행하세요. 그리고 §1-2 의 do 블록은
--   analytics.v_forecast_run 을 한 번 다시 만듭니다 — 이유는 그 블록 주석에 있습니다.
--
-- ★★★ 파일 끝의 확인 블록은 읽기 전용 select 뿐입니다.
--   관리자 전용 함수를 파일 안에서 부르지 않습니다 (error.md #22).
-- ──────────────────────────────────────────────────────────────

-- ══ 1. 운영 실행을 위한 스키마 확장 ════════════════════════════

-- ── 1-1. 운영 학습 종료일 ───────────────────────────────────────
--
-- renew.prd 12.1 은 학습/검증 경계를 고정합니다 (2023~24 학습 · 2025 검증).
-- 그 경계는 **모델을 고르기 위한** 것입니다. 운영에서 쓸 예측은 마지막 데이터까지
-- 학습해야 오늘 이후를 덮습니다. 두 경계를 한 컬럼에 겹쳐 두면 백테스트가 자기가
-- 맞혀야 할 답을 학습하게 되므로, 컬럼을 따로 둡니다.

alter table core.forecast_setting
  add column if not exists production_train_end date;

comment on column core.forecast_setting.production_train_end is
  '운영(PRODUCTION) 실행의 학습 종료일. 비어 있으면 train_end 를 씁니다. 검증 경계와 별개입니다';

-- 기본값은 데이터의 마지막 날입니다. 값이 이미 있으면 건드리지 않습니다.
update core.forecast_setting s
   set production_train_end = (select max(d.period) from core.v_demand_monthly d)
 where s.id = 1
   and s.production_train_end is null;

-- ── 1-2. 실행 모드 ─────────────────────────────────────────────
--
-- ★ 이 alter 하나가 sql/11 의 재실행을 깨뜨릴 수 있어 조심해야 합니다.
--
--   sql/11 은 analytics.v_forecast_run 을 `select r.*, result_rows, is_stale` 로
--   만듭니다. mode 컬럼이 생기면 `r.*` 가 한 칸 늘어나므로, 지금 있는 뷰
--   (… message, result_rows, is_stale) 와 새로 만들 뷰
--   (… message, mode, result_rows, is_stale) 의 **컬럼 순서가 달라집니다.**
--   PostgreSQL 은 create or replace view 에서 컬럼을 끝에 더하는 것만 허용하므로
--   (공통규칙 15), 그대로 두면 sql/11 을 다시 실행하는 순간
--   "cannot change name of view column" 으로 막힙니다.
--
--   그래서 이 파일이 analytics.v_forecast_run 을 **sql/11 이 만들 모양 그대로**
--   미리 다시 만들어 둡니다. 그러면 sql/11 재실행은 같은 모양을 다시 쓰는 셈이 되어
--   조용히 통과합니다.
--
--   그 뷰에 기대는 뷰(analytics.v_sku_detail · v_dashboard_kpi …)가 있으므로
--   drop 은 cascade 여야 하는데, 이 파일 뒤에는 다시 실행할 파일이 없습니다.
--   그래서 지우기 전에 의존 뷰의 정의를 pg_get_viewdef 로 받아 두었다가
--   같은 순서로 되살립니다. 한 번 맞춰지면(뷰에 mode 가 보이면) 다시 하지 않습니다.

-- ★ STEP 20 수정 라운드 1 — 이 컬럼의 선언은 sql/11-forecast-engine.sql 로 옮겼습니다.
--   sql/21-dashboard.sql 이 이 컬럼으로 실행을 고르는데 sql/21 은 이 파일보다 먼저
--   실행되기 때문입니다. 아래 네 줄은 STEP 20 이전에 깔린 DB 를 위해 그대로 둡니다
--   (새로 까는 DB 에서는 전부 no-op 입니다).
alter table core.forecast_run add column if not exists mode text;

update core.forecast_run r set mode = 'VALIDATION' where r.mode is null;

alter table core.forecast_run alter column mode set default 'VALIDATION';
alter table core.forecast_run alter column mode set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'core.forecast_run'::regclass
       and c.conname  = 'forecast_run_mode_chk'
  ) then
    alter table core.forecast_run
      add constraint forecast_run_mode_chk check (mode in ('VALIDATION', 'PRODUCTION'));
  end if;
end $$;

comment on column core.forecast_run.mode is
  'VALIDATION = 검증(train_end 까지 학습 · 백테스트 대상) · PRODUCTION = 운영(production_train_end 까지 학습 · 화면이 씁니다)';

create index if not exists forecast_run_mode_idx
  on core.forecast_run(mode, status, started_at desc);

-- analytics.v_forecast_run 을 sql/11 이 만드는 모양(r.*)으로 맞춥니다.
do $$
declare
  v_names text[] := '{}';
  v_defs  text[] := '{}';
  v_cmts  text[] := '{}';
  r       record;
  i       int;
begin
  if to_regclass('analytics.v_forecast_run') is null then
    raise exception 'analytics.v_forecast_run 이 없습니다. sql/11-forecast-engine.sql 을 먼저 실행하세요';
  end if;

  -- 이미 맞춰져 있으면 아무것도 하지 않습니다 (재실행 안전).
  if exists (
    select 1 from information_schema.columns c
     where c.table_schema = 'analytics'
       and c.table_name   = 'v_forecast_run'
       and c.column_name  = 'mode'
  ) then
    return;
  end if;

  -- 의존 뷰를 깊이 순으로 모읍니다. 얕은 것부터 되살려야 하기 때문입니다.
  for r in
    with recursive dep(relid, lvl) as (
      select 'analytics.v_forecast_run'::regclass::oid, 0
      union all
      select rw.ev_class, d.lvl + 1
        from dep d
        join pg_depend pd
          on pd.refobjid = d.relid
         and pd.classid  = 'pg_rewrite'::regclass
        join pg_rewrite rw
          on rw.oid = pd.objid
       where rw.ev_class <> d.relid
         and d.lvl < 10
    )
    select c.oid::regclass::text           as vname,
           max(dep.lvl)                    as lvl,
           pg_get_viewdef(c.oid, true)     as vdef,
           obj_description(c.oid, 'pg_class') as vcmt
      from dep
      join pg_class c on c.oid = dep.relid
     where dep.lvl > 0
       and c.relkind = 'v'
     group by c.oid
     order by 2, 1
  loop
    v_names := v_names || r.vname;
    v_defs  := v_defs  || r.vdef;
    v_cmts  := v_cmts  || coalesce(r.vcmt, '');
  end loop;

  execute 'drop view analytics.v_forecast_run cascade';

  execute $v$
    create view analytics.v_forecast_run as
    select r.*,
           (select count(*) from core.forecast_result f where f.run_id = r.run_id) as result_rows,
           (r.data_snapshot_at is not null
            and r.data_snapshot_at < (select d.data_loaded_at from core.v_data_loaded_at d)) as is_stale
      from core.forecast_run r
  $v$;
  execute 'grant select on analytics.v_forecast_run to authenticated';

  for i in 1 .. coalesce(array_length(v_names, 1), 0) loop
    execute 'create view ' || v_names[i] || ' as ' || v_defs[i];
    execute 'grant select on ' || v_names[i] || ' to authenticated';
    if v_cmts[i] <> '' then
      execute 'comment on view ' || v_names[i] || ' is ' || quote_literal(v_cmts[i]);
    end if;
  end loop;
end $$;

-- ── 1-3. 대량 변경 임계값 ──────────────────────────────────────

insert into core.policy_config (key, value_num, unit, description)
select 'BULK_CHANGE_ROWS', 1000, '행',
       '한 배치에 이 행수 이상이 적재되면 관리자에게 알림을 만듭니다 (renew.prd 8.6)'
 where not exists (select 1 from core.policy_config pc where pc.key = 'BULK_CHANGE_ROWS');

-- ══ 2. 운영 학습 구간 뷰 ═══════════════════════════════════════
--
-- core.v_train_demand 는 검증 경계(train_end)를 지키는 격리 지점이라 그대로 둡니다
-- (renew.prd 7.9). 운영용은 경계가 다르므로 뷰를 따로 만듭니다.
-- 이상치 제외와 반품 제외 규칙은 학습 뷰와 똑같이 적용합니다.

create or replace view core.v_production_demand as
select
  d.item_id,
  d.period,
  sum(d.qty)             as quantity,
  sum(d.n_source_codes)  as tx_count,
  min(d.period)          as first_use_date,
  max(d.period)          as last_use_date
from core.v_demand_monthly d
cross join core.forecast_setting s
where s.id = 1
  and d.period >= s.train_start
  and d.period <= coalesce(s.production_train_end, s.train_end)
  and d.qty > 0
  and not exists (
        select 1 from core.outlier_exclusion e
         where e.item_id = d.item_id and e.use_date = d.period
      )
group by 1, 2;

comment on view core.v_production_demand is
  '운영(PRODUCTION) 실행 전용 학습 수요. 경계는 forecast_setting.production_train_end 입니다';

create or replace view core.v_production_grid as
with s as (select * from core.forecast_setting where id = 1),
periods as (
  select generate_series(
           date_trunc('month', s.train_start),
           date_trunc('month', coalesce(s.production_train_end, s.train_end)),
           interval '1 month'
         )::date as period
    from s
),
items as (select distinct d.item_id from core.v_production_demand d)
select
  i.item_id,
  p.period,
  coalesce(d.quantity, 0)          as quantity,
  (d.quantity is not null)         as has_demand,
  row_number() over (partition by i.item_id order by p.period) as period_index
from items i
cross join periods p
left join core.v_production_demand d
       on d.item_id = i.item_id and d.period = p.period;

comment on view core.v_production_grid is
  '운영 학습 구간의 품목 × 기간 격자. 구조는 core.v_demand_grid 와 같습니다';

-- 모드별 격자를 한 뷰로 모읍니다. 실행 함수가 뷰 이름을 분기하지 않게 하려는 것입니다.
create or replace view core.v_forecast_grid as
select 'VALIDATION'::text as mode, g.item_id, g.period, g.quantity, g.has_demand, g.period_index
  from core.v_demand_grid g
union all
select 'PRODUCTION'::text, g.item_id, g.period, g.quantity, g.has_demand, g.period_index
  from core.v_production_grid g;

comment on view core.v_forecast_grid is
  '검증/운영 두 학습 구간의 격자. mode 로 고릅니다';

-- 잔차 표준편차(→ P80 · P90)를 내려면 각 모델의 학습 구간 적합값이 필요합니다.
-- core.v_baseline_fit(sql/11)의 모드 버전입니다.
create or replace view core.v_forecast_fit as
with lagged as (
  select
    g.mode, g.item_id, g.period, g.quantity,
    lag(g.quantity, 1)  over w as l1,
    lag(g.quantity, 2)  over w as l2,
    lag(g.quantity, 3)  over w as l3,
    lag(g.quantity, 12) over w as l12,
    avg(g.quantity) over (partition by g.mode, g.item_id order by g.period
                          rows between 3 preceding and 1 preceding) as ma3,
    avg(g.quantity) over (partition by g.mode, g.item_id order by g.period
                          rows between 6 preceding and 1 preceding) as ma6
  from core.v_forecast_grid g
  window w as (partition by g.mode, g.item_id order by g.period)
)
select mode, item_id, period, quantity,
       ma3                                        as fit_ma_3m,
       ma6                                        as fit_ma_6m,
       case when l1 is not null and l2 is not null and l3 is not null
            then (3 * l1 + 2 * l2 + 1 * l3) / 6.0 end as fit_wma_3m,
       l12                                        as fit_py_same_month,
       l12                                        as fit_seasonal_naive
  from lagged;

comment on view core.v_forecast_fit is
  '모드별 학습 구간 적합값. 잔차 표준편차가 P80·P90 을 만듭니다';

grant select on core.v_production_demand to authenticated;
grant select on core.v_production_grid   to authenticated;
grant select on core.v_forecast_grid     to authenticated;
grant select on core.v_forecast_fit      to authenticated;

-- ══ 3. 예측 실행 함수 ★ (sql/11 의 함수를 덮어씁니다) ═══════════
--
-- 달라진 점은 하나뿐입니다 — 모드.
--   VALIDATION  train_start ~ train_end            로 학습 → 검증 구간을 예측합니다.
--               백테스트가 채점할 수 있는 유일한 모드입니다.
--   PRODUCTION  train_start ~ production_train_end 로 학습 → 오늘 이후를 예측합니다.
--               재고 전개·발주 추천·대시보드가 쓰는 예측입니다.
--
-- 인자가 하나 늘었으므로 sql/11 의 1인자 함수를 먼저 지웁니다. 남겨 두면
-- 인자 하나로 부를 때 "function is not unique" 가 납니다.
--
-- ★ error.md #11 — 반환 컬럼 이름(run_id · n_models · n_items · n_rows · message)이
--   테이블 컬럼과 겹칩니다. 본문에서 테이블 컬럼은 항상 별칭으로 한정합니다.

drop function if exists core.run_baseline_forecast(text);

create or replace function core.run_baseline_forecast(
  p_note text default null,
  p_mode text default 'VALIDATION'
)
returns table (run_id text, n_models int, n_items int, n_rows int, message text)
language plpgsql
security definer
set search_path = core, public
as $$
declare
  s           core.forecast_setting%rowtype;
  v_mode      text;
  v_train_end date;
  v_run_id    text;
  v_started   timestamptz := clock_timestamp();
  v_snapshot  timestamptz;
  v_models    jsonb;
  v_n_models  int;
  v_n_items   int;
  v_n_rows    int;
  v_err       text;
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다';
  end if;

  v_mode := upper(coalesce(nullif(btrim(p_mode), ''), 'VALIDATION'));
  if v_mode not in ('VALIDATION', 'PRODUCTION') then
    return query select null::text, 0, 0, 0,
      ('알 수 없는 실행 모드입니다: ' || p_mode || ' (VALIDATION 또는 PRODUCTION)')::text;
    return;
  end if;

  select * into s from core.forecast_setting where id = 1;
  if not found then
    return query select null::text, 0, 0, 0, '예측 설정이 없습니다. sql/06-core-extend.sql 을 실행하세요'::text;
    return;
  end if;

  v_train_end := case when v_mode = 'PRODUCTION'
                      then coalesce(s.production_train_end, s.train_end)
                      else s.train_end end;

  if v_mode = 'PRODUCTION' and s.production_train_end is null then
    return query select null::text, 0, 0, 0,
      '운영 학습 종료일이 비어 있습니다. 예측 기본 설정 화면에서 먼저 지정하세요'::text;
    return;
  end if;

  select count(*) into v_n_models
    from core.model_config where enabled and engine = 'SQL';
  if v_n_models = 0 then
    return query select null::text, 0, 0, 0, '켜져 있는 SQL 모델이 없습니다'::text;
    return;
  end if;

  -- 데이터 기준 시각. 이후 데이터가 바뀌면 이 예측은 stale 합니다.
  -- 수요뿐 아니라 **모든 적재**를 봅니다 (core.v_data_loaded_at · sql/11).
  select d.data_loaded_at into v_snapshot from core.v_data_loaded_at d;

  v_run_id := 'run_' || to_char(v_started, 'YYYYMMDDHH24MISS') || '_' ||
              lpad((extract(milliseconds from v_started)::int % 1000)::text, 3, '0');

  -- 모델 정의를 버전으로 남깁니다 (재현성)
  insert into core.model_version (model_id, version, definition)
  select model_id, version,
         jsonb_build_object('model_name', model_name, 'family', family,
                            'engine', engine, 'parameters', parameters)
    from core.model_config
   where enabled and engine = 'SQL'
  on conflict do nothing;

  select jsonb_agg(jsonb_build_object('model_id', model_id, 'version', version,
                                      'parameters', parameters))
    into v_models
    from core.model_config where enabled and engine = 'SQL';

  insert into core.forecast_run
    (run_id, status, mode, granularity, train_start, train_end, horizon, champion_metric,
     data_snapshot_at, models, n_models, triggered_by, triggered_email, note)
  select v_run_id, 'RUNNING', v_mode, s.granularity, s.train_start, v_train_end,
         s.forecast_horizon, s.champion_metric, v_snapshot, v_models, v_n_models,
         auth.uid(), (select au.email from core.app_user au where au.user_id = auth.uid()), p_note;

  -- ★ 여기부터가 서브블록입니다. 실패해도 위 RUNNING 행은 살아남습니다
  --   (STEP 11 이월 항목 — sql/13 · sql/17 과 같은 구조).
  begin

  -- ── 예측 ────────────────────────────────────────────────────
  --
  -- Baseline 은 미래 전 구간에 같은 값을 냅니다(평평한 예측).
  -- 전년동월·계절나이브만 기간마다 다른 값을 씁니다.
  -- 학습 데이터가 모자라 값을 낼 수 없으면 **행을 만들지 않습니다.**
  -- 0 이나 임의 값으로 채우지 않습니다 (AGENTS.md 규칙 5).

  with horizon_periods as (
    select h,
           (date_trunc('month', v_train_end) + (h || ' month')::interval)::date as period
      from generate_series(1, s.forecast_horizon) as h
  ),
  -- ★ materialized — 격자를 한 번만 계산해 둡니다. 인라인되면 계획기가 PRODUCTION 모드에서
  --   아래 tail · py 조인마다 격자 뷰를 다시 돌려(Nested Loop) 10분을 넘겼습니다 (error.md #34).
  grid as materialized (
    select g.item_id, g.period, g.quantity
      from core.v_forecast_grid g
     where g.mode = v_mode
  ),
  -- 학습 구간 마지막 값들
  tail as materialized (
    select item_id,
           avg(quantity) filter (where rn <= 3) as last3,
           avg(quantity) filter (where rn <= 6) as last6,
           max(quantity) filter (where rn = 1)  as l1,
           max(quantity) filter (where rn = 2)  as l2,
           max(quantity) filter (where rn = 3)  as l3
      from (select item_id, quantity,
                   row_number() over (partition by item_id order by period desc) as rn
              from grid) t
     group by item_id
  ),
  -- 모델별 잔차 표준편차
  resid as materialized (
    select item_id,
           stddev_samp(quantity - fit_ma_3m)          as sd_ma_3m,
           stddev_samp(quantity - fit_ma_6m)          as sd_ma_6m,
           stddev_samp(quantity - fit_wma_3m)         as sd_wma_3m,
           stddev_samp(quantity - fit_py_same_month)  as sd_py,
           stddev_samp(quantity - fit_seasonal_naive) as sd_sn
      from core.v_forecast_fit ff
     where ff.mode = v_mode
     group by item_id
  ),
  -- 전년 동월 실적 (없으면 null → 행을 만들지 않습니다)
  -- ★ 상관 서브쿼리가 아니라 조인입니다. 서브쿼리로 쓰면 (품목 × 지평) 칸마다 격자 CTE 를
  --   통째로 다시 훑어 11,000 품목에서 몇 분이 걸립니다 (error.md #34). 해시 조인이면 1초 안입니다.
  py as materialized (
    select g.item_id, hp.period, d.quantity as py_qty
      from (select distinct item_id from grid) g
      cross join horizon_periods hp
      left join grid d
        on d.item_id = g.item_id
       and d.period  = (hp.period - interval '12 months')::date
  ),
  points as (
    select m.model_id, m.version, t.item_id, hp.period,
           case m.model_id
             when 'MA_3M'          then t.last3
             when 'MA_6M'          then t.last6
             when 'WMA_3M'         then case when t.l1 is not null and t.l2 is not null and t.l3 is not null
                                             then (3 * t.l1 + 2 * t.l2 + t.l3) / 6.0 end
             when 'PY_SAME_MONTH'  then py.py_qty
             when 'SEASONAL_NAIVE' then py.py_qty
           end as qty,
           case m.model_id
             when 'MA_3M'          then r.sd_ma_3m
             when 'MA_6M'          then r.sd_ma_6m
             when 'WMA_3M'         then r.sd_wma_3m
             when 'PY_SAME_MONTH'  then r.sd_py
             when 'SEASONAL_NAIVE' then r.sd_sn
           end as sigma
      from core.model_config m
      cross join tail t
      cross join horizon_periods hp
      left join resid r on r.item_id = t.item_id
      left join py on py.item_id = t.item_id and py.period = hp.period
     where m.enabled and m.engine = 'SQL'
  )
  insert into core.forecast_result
    (run_id, model_id, model_version, item_id, period, predicted_qty, p50, p80, p90, sigma, basis)
  select
    v_run_id, p.model_id, p.version, p.item_id, p.period,
    round(p.qty, 2),
    round(p.qty, 2),                                    -- P50 = 점추정
    -- 정규 근사. sigma 를 못 구하면 null 로 둡니다 (임의 값 금지)
    case when p.sigma is not null then round(p.qty + 0.8416 * p.sigma, 2) end,
    case when p.sigma is not null then round(p.qty + 1.2816 * p.sigma, 2) end,
    round(p.sigma, 3),
    jsonb_build_object('method', p.model_id, 'interval', 'normal-approx', 'mode', v_mode)
  from points p
  where p.qty is not null;      -- ★ 값을 못 내면 행을 만들지 않습니다

  get diagnostics v_n_rows = row_count;

  select count(distinct f.item_id) into v_n_items
    from core.forecast_result f where f.run_id = v_run_id;

  update core.forecast_run as r
     set status      = 'SUCCESS',
         n_items     = v_n_items,
         n_rows      = v_n_rows,
         finished_at = clock_timestamp(),
         duration_ms = (extract(epoch from (clock_timestamp() - v_started)) * 1000)::int,
         message     = v_n_rows || '행을 생성했습니다'
   where r.run_id = v_run_id;

  -- ★ 대량 적재 알림을 닫습니다 (운영 실행일 때만).
  --   그 알림의 권고 문구가 "운영 실행을 한 번 돌려 주세요" 이므로, 돌린 순간 할 일이
  --   없어집니다. core.scan_alerts 는 자기가 낸 유형만 닫으므로 여기서 닫지 않으면
  --   배너가 사라진 뒤에도 배치마다 한 건씩 쌓입니다.
  --   이력은 지우지 않습니다 — resolved_at 만 채웁니다 (sql/20 §2).
  if v_mode = 'PRODUCTION' then
    update core.alert a
       set resolved_at = now()
     where a.resolved_at is null
       and a.type = 'BULK_DATA_CHANGE';
  end if;

  -- ★ 실체화 (sql/35). 화면이 쓰는 예측 표를 이 실행으로 다시 씁니다. 함수는 sql/35 가
  --   만들므로 실행 시점에만 있으면 됩니다 (plpgsql 은 호출 때 이름을 찾습니다).
  perform core.refresh_forecast_current();
  perform core.build_dependent_demand();

  exception
    when others then
      v_err := SQLERRM;
  end;
  -- ★ 서브블록 끝. 아래는 RUNNING 행이 살아 있는 바깥입니다.

  if v_err is not null then
    update core.forecast_run as r
       set status = 'FAILED', finished_at = clock_timestamp(), message = v_err
     where r.run_id = v_run_id;
    return query select v_run_id, 0, 0, 0, ('실행에 실패했습니다: ' || v_err)::text;
    return;
  end if;

  return query select v_run_id, v_n_models, v_n_items, v_n_rows,
                      (v_n_rows || '행을 생성했습니다')::text;
end;
$$;

revoke all on function core.run_baseline_forecast(text, text) from public, anon;
grant execute on function core.run_baseline_forecast(text, text) to authenticated;

comment on function core.run_baseline_forecast(text, text) is
  'STEP 20 — p_mode 로 검증/운영 실행을 나눕니다. 최초 정의는 sql/11-forecast-engine.sql';

-- ══ 4. AI 예측 대표값 ★ (sql/15 의 뷰를 덮어씁니다) ═════════════
--
-- 달라진 점은 "어느 실행을 볼 것인가" 한 줄뿐입니다.
--   운영(PRODUCTION) 성공 실행이 있으면 그중 가장 최근 것,
--   없으면 예전처럼 가장 최근 성공 실행.
-- 컬럼은 하나도 바뀌지 않으므로 create or replace 로 바꿀 수 있습니다 (공통규칙 15).
--
-- ★ 이 규칙이 화면 전체의 기준입니다. 재고 전개 · 발주 추천 · 대시보드 ·
--   Consensus · 알림이 전부 이 뷰를 지나갑니다.

create or replace view core.v_ai_forecast as
with lr as (
  -- 운영 실행 우선. case 식이 PRODUCTION 을 0, 그 밖을 1 로 두어 앞으로 보냅니다.
  -- ★ (r.mode = 'PRODUCTION') desc 형태의 괄호 있는 불린 정렬식은 컬럼 이름이
  --   `mode` 인 것과 엮여 "WITHIN GROUP is required for ordered-set aggregate mode"
  --   (42809) 로 거부되는 환경이 있었습니다 (error.md #27). case 식으로 피합니다.
  select r.run_id, r.data_snapshot_at
    from core.forecast_run r
   where r.status = 'SUCCESS'
   order by case when r.mode = 'PRODUCTION' then 0 else 1 end,
            r.started_at desc
   limit 1
),
dm as (
  select m.model_id
    from core.model_config m
   where m.is_default
   order by m.model_id
   limit 1
),
avail as (
  -- 이번 실행에 결과가 있는 (품목 × 모델)
  select distinct f.item_id, f.model_id
    from core.forecast_result f
    join lr on lr.run_id = f.run_id
),
champ as (
  select a.item_id, a.model_id
    from avail a
    join core.champion_model c
      on c.item_id = a.item_id
     and c.champion_model_id = a.model_id
),
pick as (
  select i.item_id,
         coalesce(ch.model_id, d.model_id) as model_id,
         case when ch.model_id is not null then 'CHAMPION' else 'DEFAULT' end as source
    from (select distinct a.item_id from avail a) i
    left join champ ch on ch.item_id = i.item_id
    left join dm d on true
)
select lr.run_id,
       p.model_id,
       f.model_version,
       f.item_id,
       f.period,
       f.predicted_qty,
       f.p50,
       f.p80,
       f.p90,
       f.sigma,
       lr.data_snapshot_at,
       p.source
  from pick p
  cross join lr
  join core.forecast_result f
    on f.run_id = lr.run_id
   and f.item_id = p.item_id
   and f.model_id = p.model_id;

comment on view core.v_ai_forecast is
  'renew.prd 17.1 — 품목별 대표 예측. 운영(PRODUCTION) 실행을 먼저 고릅니다. 최초 정의는 sql/15';

-- ══ 5. 백테스트 ★ (sql/13 의 함수를 덮어씁니다) ════════════════
--
-- 달라진 점 두 가지
--   ① VALIDATION 실행만 채점합니다. 운영 실행은 production_train_end 까지 학습해
--      검증 구간을 이미 본 상태라, 채점하면 자기가 맞힐 답을 학습한 셈이 됩니다.
--   ② 실패해도 이력 행이 남습니다 (STEP 11 이월). 본문을 서브블록으로 감싸
--      맨 처음 RUNNING insert 가 롤백 범위 밖에 있게 했습니다.
--
-- ★ error.md #11 — 반환 컬럼 이름이 테이블 컬럼과 겹칩니다. 항상 별칭으로 한정합니다.

create or replace function core.run_backtest(
  p_forecast_run_id text default null,
  p_note            text default null
)
returns table (backtest_run_id text, n_models int, n_items int, n_rows int, message text)
language plpgsql
security definer
-- ★ enable_nestloop off — 방금 쌓인 run 의 통계가 없을 때 계획기가 Nested Loop 를 골라 10분을 넘깁니다 (error.md #34)
set enable_nestloop = off
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
  v_err      text;
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다';
  end if;

  select * into s from core.forecast_setting where id = 1;

  -- 지정하지 않으면 가장 최근에 성공한 **검증** 실행을 채점합니다.
  if p_forecast_run_id is null then
    select * into fr from core.forecast_run r
     where r.status = 'SUCCESS' and r.mode = 'VALIDATION'
     order by r.started_at desc limit 1;
  else
    select * into fr from core.forecast_run r where r.run_id = p_forecast_run_id;
  end if;

  if not found then
    return query select null::text, 0, 0, 0, '채점할 검증 실행이 없습니다'::text;
    return;
  end if;

  -- ★ 운영 실행은 채점하지 않습니다. 검증 구간을 학습에 이미 썼기 때문입니다.
  if fr.mode is distinct from 'VALIDATION' then
    return query select null::text, 0, 0, 0,
      (fr.run_id || ' 은(는) 운영(PRODUCTION) 실행이라 채점하지 않습니다. 검증 실행을 고르세요')::text;
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
         (select au.email from core.app_user au where au.user_id = auth.uid()), p_note;

  -- ★ 여기부터가 서브블록입니다. 실패해도 위 RUNNING 행은 살아남습니다.
  begin

  -- ── 지표 계산 ───────────────────────────────────────────────
  --
  -- 예측과 실적이 같은 기간에 둘 다 있을 때만 채점합니다.
  -- 겹치는 기간이 없으면 행을 만들지 않습니다.

  -- 방금 쌓인 결과의 통계를 먼저 갱신합니다 (error.md #34).
  analyze core.forecast_result;

  with matched as materialized (
    select f.model_id, f.model_version, f.item_id, f.period,
           f.predicted_qty as fcst,
           a.quantity      as actual
      from core.forecast_result f
      join core.v_test_actual a
        on a.item_id = f.item_id and a.period = f.period
     where f.run_id = fr.run_id
       and f.predicted_qty is not null
  ),
  agg as materialized (
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

  -- ★ Champion 이 바뀌었으니 화면이 쓰는 예측 표를 다시 씁니다 (sql/35).
  perform core.refresh_forecast_current();
  perform core.build_dependent_demand();

  exception
    when others then
      v_err := SQLERRM;
  end;
  -- ★ 서브블록 끝. 아래는 RUNNING 행이 살아 있는 바깥입니다.

  if v_err is not null then
    update core.backtest_run as r
       set status = 'FAILED', finished_at = clock_timestamp(), message = v_err
     where r.backtest_run_id = v_id;
    return query select v_id, 0, 0, 0, ('채점에 실패했습니다: ' || v_err)::text;
    return;
  end if;

  return query select v_id, v_models, v_items, v_rows,
                      (v_rows || '행을 채점했습니다')::text;
end;
$$;

revoke all on function core.run_backtest(text, text) from public, anon;
grant execute on function core.run_backtest(text, text) to authenticated;

comment on function core.run_backtest(text, text) is
  'STEP 20 — 검증(VALIDATION) 실행만 채점하고, 실패해도 이력을 남깁니다. 최초 정의는 sql/13-backtest.sql';

-- ══ 6. 가상 운영 ★ (sql/17 의 함수를 덮어씁니다) ═══════════════
--
-- 달라진 점 두 가지. 계산식은 한 줄도 건드리지 않았습니다.
--   ① 실패해도 이력 행이 남습니다 (STEP 11 이월). 본문을 서브블록으로 감쌌습니다.
--   ② 실행을 지정하지 않으면 가장 최근 **검증** 실행을 씁니다.
--      시뮬레이션 구간이 test_start ~ test_end 이므로, 그 구간을 예측한 실행이
--      검증 실행뿐이기 때문입니다. 운영 실행을 집으면 예측이 하나도 겹치지 않아
--      전 품목이 "근거 없음" 으로 빠집니다.
create or replace function core.run_virtual_operation(
  p_forecast_run_id text default null,
  p_note            text default null
)
returns table (simulation_id text, n_items int, message text)
language plpgsql
security definer
set search_path = core, public
as $$
declare
  s            core.forecast_setting%rowtype;
  fr           core.forecast_run%rowtype;
  it           record;
  v_sim_id     text;
  v_run_id     text;
  v_bt_id      text;
  v_started    timestamptz := clock_timestamp();
  v_sim_start  date;
  v_sim_end    date;
  v_n_months   int;
  v_review     numeric;
  v_excess     numeric;
  v_params     jsonb;
  v_kpis       jsonb;
  v_sentence   text;
  v_message    text;
  v_n_items    int := 0;
  v_skipped    int := 0;
  v_clamped    int := 0;
  v_seed_rows  int := 0;
  v_unmatched  int := 0;
  v_truncated  int := 0;
  v_seed       record;
  -- 품목별 월 배열
  v_demand     numeric[];
  v_receipt    numeric[];
  v_po_qty     numeric[];
  v_po_cnt     int[];
  v_fc         numeric[];
  v_arrival    numeric[];
  -- 루프 안 스칼라
  v_i          int;
  v_k          int;
  v_lead_m     int;
  v_win_m      int;
  v_window     numeric;
  v_pipeline   numeric;
  v_need       numeric;
  v_order      numeric;
  v_ss         numeric;
  v_sigma_dlt  numeric;
  v_daily_d    numeric;
  v_avg_demand numeric;
  v_fc_last    int;
  v_period     date;
  v_a_open     numeric;
  v_a_close    numeric;
  v_a_out      boolean;
  v_a_excess   boolean;
  v_s_open     numeric;
  v_s_close    numeric;
  v_s_out      boolean;
  v_s_excess   boolean;
  v_recv       numeric;
  v_err        text;
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다';
  end if;

  select * into s from core.forecast_setting fs where fs.id = 1;
  if not found then
    return query select null::text, 0, '예측 설정이 없습니다. sql/06-core-extend.sql 을 실행하세요'::text;
    return;
  end if;

  -- 대상 예측 실행. 지정하지 않으면 가장 최근 성공한 **검증** 실행입니다.
  -- 예측 시작이 train_end 다음 달이므로 검증 구간을 덮습니다.
  if p_forecast_run_id is null then
    select * into fr from core.forecast_run r
     where r.status = 'SUCCESS' and r.mode = 'VALIDATION'
     order by r.started_at desc limit 1;
  else
    select * into fr from core.forecast_run r where r.run_id = p_forecast_run_id;
  end if;

  if not found then
    return query select null::text, 0, '시뮬레이션할 예측 실행이 없습니다'::text;
    return;
  end if;

  -- ★ 운영 실행은 시뮬레이션하지 않습니다. §5 의 백테스트와 같은 가드입니다.
  --
  --   기본 선택만 막고 여기를 비워 두면, 호출자가 운영 실행을 **직접 지정**해 통과합니다.
  --   그 실행의 예측은 전부 시뮬 구간(test_start ~ test_end) **뒤**에 있어 매달 창 수요가
  --   0 으로 읽힙니다. 시스템은 거의 발주하지 않고 결품이 폭증한 것처럼 보이는데,
  --   실행은 SUCCESS 로 끝나고 skipped_items 도 window_truncated 도 0 이라 아무 경고가
  --   없습니다 (v_fc_last 는 v_sim_start 이후 기간만 찾기 때문입니다).
  --   이 화면이 도입 판단의 근거(renew.prd 2장 성공기준 16)라, 조용히 틀린 숫자가
  --   가장 비쌉니다. 그래서 받지 않습니다.
  if fr.mode is distinct from 'VALIDATION' then
    return query select null::text, 0,
      (fr.run_id || ' 은(는) 운영(PRODUCTION) 실행이라 시뮬레이션하지 않습니다. '
       || '운영 실행의 예측은 검증 구간 뒤에 있어 비교가 성립하지 않습니다. 검증 실행을 고르세요')::text;
    return;
  end if;

  v_run_id := fr.run_id;

  -- 그 예측을 채점한 백테스트가 있으면 σ_d 를 그쪽 RMSE 로 씁니다 (sql/16 428~433행과 같은 우선순위).
  select b.backtest_run_id into v_bt_id
    from core.backtest_run b
   where b.forecast_run_id = v_run_id and b.status = 'SUCCESS'
   order by b.started_at desc
   limit 1;

  -- ★ 정책값은 실행 시점의 현재값입니다. 과거 정책 이력이 없기 때문입니다.
  --   params 에 스냅샷으로 남겨 "무엇으로 돌렸는지" 를 나중에 볼 수 있게 합니다.
  select max(pc.value_num) filter (where pc.key = 'REVIEW_PERIOD_DAYS'),
         max(pc.value_num) filter (where pc.key = 'EXCESS_STOCK_MONTHS')
    into v_review, v_excess
    from core.policy_config pc;

  if v_review is null then
    return query select null::text, 0,
      '정책값 REVIEW_PERIOD_DAYS 가 없습니다. 관리자 화면에서 먼저 채워주세요'::text;
    return;
  end if;

  v_sim_start := date_trunc('month', s.test_start)::date;
  v_sim_end   := date_trunc('month', s.test_end)::date;
  v_n_months  := ((date_part('year',  v_sim_end) - date_part('year',  v_sim_start)) * 12
                + (date_part('month', v_sim_end) - date_part('month', v_sim_start)))::int + 1;

  if v_n_months < 1 then
    return query select null::text, 0, '검증 구간이 비어 있습니다'::text;
    return;
  end if;

  v_sim_id := 'sim_' || to_char(v_started, 'YYYYMMDDHH24MISS') || '_' ||
              lpad((extract(milliseconds from v_started)::int % 1000)::text, 3, '0');

  v_params := jsonb_build_object(
    'review_period_days',  v_review,
    'excess_stock_months', v_excess,
    'forecast_run_id',     v_run_id,
    'backtest_run_id',     v_bt_id,
    'n_months',            v_n_months,
    -- 리드타임·서비스 수준은 품목/공급처마다 다르므로 스냅샷도 목록으로 남깁니다.
    'lead_time',           (select jsonb_object_agg(le.supplier_id, le.effective_lead_time)
                              from core.v_leadtime_effective le
                             where le.effective_lead_time is not null),
    'service_level',       (select jsonb_object_agg(sl.item_id,
                                     jsonb_build_object('service_level', sl.service_level,
                                                        'z_value', sl.z_value))
                              from core.v_item_service_level sl
                             where sl.z_value is not null)
  );

  insert into core.simulation_run
    (simulation_id, forecast_run_id, backtest_run_id, sim_start, sim_end, status,
     params, triggered_by, triggered_email, note)
  select v_sim_id, v_run_id, v_bt_id, v_sim_start, v_sim_end, 'RUNNING',
         v_params, auth.uid(),
         (select au.email from core.app_user au where au.user_id = auth.uid()), p_note;
  -- ★ 여기부터가 서브블록입니다. 실패해도 위 RUNNING 행은 살아남습니다.
  begin
  -- ── 품목 루프 ───────────────────────────────────────────────
  --
  -- 대상은 "그 실행에 예측이 있는 활성 품목" 입니다.
  -- 예측이 없으면 시스템이 발주를 낼 수 없어, 비교가 시스템의 불리 쪽으로 기울지 않게
  -- 아예 제외합니다. 제외 건수는 kpis.skipped_items 로 밝힙니다 (design.md §8.2).
  for it in
    with dm as (
      select mc.model_id from core.model_config mc where mc.is_default
       order by mc.model_id limit 1
    ),
    avail as (
      select distinct f.item_id, f.model_id
        from core.forecast_result f
       where f.run_id = v_run_id
    ),
    champ as (
      -- Champion 이 이번 실행에 결과를 가지면 Champion, 아니면 기본 모델 (core.v_ai_forecast 와 같은 규칙)
      select a.item_id, a.model_id
        from avail a
        join core.champion_model c
          on c.item_id = a.item_id and c.champion_model_id = a.model_id
    ),
    pick as (
      select b.item_id, coalesce(ch.model_id, d.model_id) as model_id
        from (select distinct av.item_id from avail av) b
        left join champ ch on ch.item_id = b.item_id
        left join dm d on true
    ),
    perf as (
      select p.item_id, p.model_id, p.rmse
        from core.model_performance p
       where p.backtest_run_id = v_bt_id
    ),
    ins as (
      select f.item_id, f.model_id, avg(f.sigma) as sigma_avg
        from core.forecast_result f
       where f.run_id = v_run_id and f.sigma is not null
       group by f.item_id, f.model_id
    )
    select im.item_id                        as item_id,
           im.supplier_id                    as supplier_id,
           pk.model_id                       as model_id,
           le.effective_lead_time            as lead_days,
           st.std_days                       as sigma_l,
           sl.z_value                        as z_value,
           ip.moq                            as moq,
           ip.pack_size                      as pack_size,
           soh.current_stock                 as current_stock,
           coalesce(pf.rmse, ia.sigma_avg)   as sigma_d_monthly
      from core.v_item_master im
      join pick pk on pk.item_id = im.item_id
      left join core.v_leadtime_effective  le  on le.supplier_id = im.supplier_id
      left join core.v_leadtime_stat       st  on st.supplier_id = im.supplier_id
      left join core.v_item_service_level  sl  on sl.item_id     = im.item_id
      left join core.item_policy           ip  on ip.item_id     = im.item_id
      left join core.v_stock_on_hand       soh on soh.item_id    = im.item_id
      left join perf pf on pf.item_id = im.item_id and pf.model_id = pk.model_id
      left join ins  ia on ia.item_id = im.item_id and ia.model_id = pk.model_id
     where im.is_active = 'Y'
     order by im.item_id
  loop
    -- 근거가 하나라도 없으면 숫자를 지어내지 않고 건너뜁니다 (AGENTS.md 규칙 5).
    -- 실제 쪽만 전개하면 실제와 시뮬의 대상 품목이 달라져 KPI 비교가 성립하지 않습니다.
    if it.current_stock is null
       or it.lead_days is null
       or it.z_value is null
       or it.sigma_d_monthly is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- 도착까지 걸리는 개월 수와 커버해야 하는 개월 수.
    -- 30.4 는 한 달 평균 일수(달력 상수)입니다. 정책값이 아닙니다 (sql/16 481행과 같은 근거).
    v_lead_m := greatest(1, ceil(it.lead_days::numeric / 30.4)::int);
    v_win_m  := greatest(1, ceil((it.lead_days + v_review) / 30.4)::int);

    -- 월별 실제값을 한 번에 배열로 읽습니다. 안쪽 루프는 산술만 합니다.
    select array_agg(coalesce(d.q, 0)      order by mon.idx),
           array_agg(coalesce(r.q, 0)      order by mon.idx),
           array_agg(coalesce(o.q, 0)      order by mon.idx),
           array_agg(coalesce(o.c, 0)::int order by mon.idx)
      into v_demand, v_receipt, v_po_qty, v_po_cnt
      from (
        select g.idx as idx,
               (v_sim_start + ((g.idx - 1) || ' months')::interval)::date as period
          from generate_series(1, v_n_months) g(idx)
      ) mon
      left join lateral (
        -- 검증 구간 실적. 백테스트 채점과 같은 뷰입니다 (sql/07).
        select sum(a.quantity) as q
          from core.v_test_actual a
         where upper(regexp_replace(coalesce(a.item_id, ''), '[\s\-_]', '', 'g')) = it.item_id
           and a.period = mon.period
      ) d on true
      left join lateral (
        select sum(gr.qty) as q
          from core.v_goods_receipt gr
         where gr.item_id = it.item_id
           and gr.receipt_date >= mon.period
           and gr.receipt_date <  (mon.period + interval '1 month')::date
      ) r on true
      left join lateral (
        select sum(po.qty) as q, count(*) as c
          from core.v_purchase_order po
         where po.item_id = it.item_id
           and po.qty > 0
           and po.order_date >= mon.period
           and po.order_date <  (mon.period + interval '1 month')::date
      ) o on true;

    -- 예측은 창 길이만큼 뒤까지 필요합니다. horizon 밖은 0 으로 둡니다
    -- (없는 예측을 지어내지 않습니다. 그만큼 시뮬레이션은 보수적으로 발주합니다).
    select array_agg(coalesce(f.q, 0) order by mon.idx)
      into v_fc
      from (
        select g.idx as idx,
               (v_sim_start + ((g.idx - 1) || ' months')::interval)::date as period
          from generate_series(1, v_n_months + v_win_m) g(idx)
      ) mon
      left join lateral (
        select sum(fc.predicted_qty) as q
          from core.forecast_result fc
         where fc.run_id   = v_run_id
           and fc.model_id = it.model_id
           and fc.item_id  = it.item_id
           and fc.period   = mon.period
      ) f on true;

    -- 예측이 있는 마지막 달의 인덱스. 창이 이 뒤로 넘어가면 그만큼 창 수요가 작게 잡힙니다.
    -- 몇 번이나 넘었는지는 kpis.window_truncated 로 밝힙니다 (숫자를 지어내지 않되, 숨기지도 않습니다).
    select coalesce(max(((date_part('year',  fc.period) - date_part('year',  v_sim_start)) * 12
                       + (date_part('month', fc.period) - date_part('month', v_sim_start)))::int) + 1, 0)
      into v_fc_last
      from core.forecast_result fc
     where fc.run_id   = v_run_id
       and fc.model_id = it.model_id
       and fc.item_id  = it.item_id
       and fc.predicted_qty is not null
       and fc.period  >= v_sim_start;

    -- 과잉 발주 판정의 분모. 실제와 시뮬이 같은 분모를 봐야 비교가 성립합니다.
    v_avg_demand := (select avg(t.x) from unnest(v_demand) as t(x));

    -- ★ 검증 구간 시작 시점의 재고는 기록이 없습니다. 현재고에서 역산합니다.
    --   opening = 현재고 − Σ입고(sim_start..오늘) + Σ사용(sim_start..오늘)
    --   추정치이며, 화면에도 그렇게 밝힙니다.
    v_a_open := it.current_stock
      - coalesce((select sum(gr.qty) from core.v_goods_receipt gr
                   where gr.item_id = it.item_id
                     and gr.receipt_date >= v_sim_start
                     and gr.receipt_date <= current_date), 0)
      + coalesce((select sum(um.quantity) from core.v_usage_monthly um
                   where um.item_id = it.item_id
                     and um.period >= v_sim_start
                     and um.period <= date_trunc('month', current_date)::date), 0);

    -- 역산 결과가 음수면 실적끼리 아귀가 맞지 않는다는 뜻입니다.
    -- 그대로 두면 모든 달이 결품이 되어 비교가 무의미해지므로 0 에서 시작합니다.
    -- 그런 품목이 몇 개인지는 kpis.opening_clamped_items 가 밝힙니다.
    if v_a_open < 0 then
      v_a_open  := 0;
      v_clamped := v_clamped + 1;
    end if;

    v_s_open   := v_a_open;
    v_arrival  := array_fill(0::numeric, array[v_n_months + v_lead_m + 1]);
    v_pipeline := 0;

    -- ★ 시뮬레이션도 빈 파이프라인으로 시작하지 않습니다.
    --   sim_start 이전에 사람이 낸 발주 중 시뮬 구간에 도착한 입고는 양쪽이 함께 물려받는 것입니다.
    --   시드하지 않으면 첫 ceil(L/30.4) 개월 동안 시뮬에만 아무것도 도착하지 않아,
    --   실제로는 겪지 않았을 결품이 시뮬 쪽에 기록됩니다 (KPI 4개가 전부 흔들립니다).
    --   발주와 입고는 (po_no, item_id) 로 잇습니다. 한 발주번호에 품목이 여럿이면
    --   po_no 만으로 이으면 같은 입고가 여러 번 세어집니다.
    --   조인이 아니라 exists 로 거릅니다 — 같은 (po_no, item_id) 에 발주 라인이 둘이면
    --   조인은 그 입고를 두 번 세어 시드 수량이 부풀려집니다.
    for v_seed in
      select ((date_part('year',  gr.receipt_date) - date_part('year',  v_sim_start)) * 12
            + (date_part('month', gr.receipt_date) - date_part('month', v_sim_start)))::int + 1 as idx,
             sum(gr.qty)      as qty,
             count(*)::int    as n
        from core.v_goods_receipt gr
       where gr.item_id = it.item_id
         and gr.qty > 0
         and gr.receipt_date >= v_sim_start
         and gr.receipt_date <  (v_sim_end + interval '1 month')::date
         and exists (
               select 1 from core.v_purchase_order po
                where po.po_no   = gr.po_no
                  and po.item_id = gr.item_id
                  and po.order_date is not null
                  and po.order_date < v_sim_start)
       group by 1
    loop
      v_arrival[v_seed.idx] := coalesce(v_arrival[v_seed.idx], 0) + v_seed.qty;
      v_pipeline  := v_pipeline + v_seed.qty;
      v_seed_rows := v_seed_rows + v_seed.n;
    end loop;

    -- 발주와 이어지지 않는 입고는 언제 발주된 것인지 알 수 없어 시드에서 뺐습니다.
    -- 몇 건을 그렇게 흘려보냈는지는 kpis.pipeline_seed_unmatched 가 밝힙니다.
    v_unmatched := v_unmatched + coalesce((
      select count(*)::int
        from core.v_goods_receipt gr
       where gr.item_id = it.item_id
         and gr.qty > 0
         and gr.receipt_date >= v_sim_start
         and gr.receipt_date <  (v_sim_end + interval '1 month')::date
         and not exists (
               select 1 from core.v_purchase_order po
                where po.po_no = gr.po_no
                  and po.item_id = gr.item_id
                  and po.order_date is not null)
    ), 0);

    -- ── 월 루프 ───────────────────────────────────────────────
    for v_i in 1 .. v_n_months loop
      v_period := (v_sim_start + ((v_i - 1) || ' months')::interval)::date;

      -- ① 그 달 초에 시스템이 봤을 창 수요 = 그 달부터 v_win_m 개월의 예측 합
      v_window := 0;
      for v_k in v_i .. (v_i + v_win_m - 1) loop
        v_window := v_window + coalesce(v_fc[v_k], 0);
      end loop;

      -- 창이 예측이 있는 마지막 달(v_fc_last)을 넘으면 그만큼 창 수요가 작게 잡힙니다.
      -- 없는 예측을 지어내지 않는 대신, 몇 품목-월이 그랬는지를 kpis.window_truncated 로 밝힙니다.
      if (v_i + v_win_m - 1) > v_fc_last then
        v_truncated := v_truncated + 1;
      end if;

      -- ② 안전재고 — sql/16 475 · 481 · 505~512 · 530행과 같은 식
      --    d      = 창 수요 ÷ 창 일수
      --    σ_d(일) = σ_d(월) / √30.4          (일별 오차 독립 가정)
      --    σ_DLT  = √( L σ_d² + d² σ_L² )
      --    SS     = round(Z × σ_DLT)
      v_daily_d   := v_window / (v_win_m * 30.4);
      v_sigma_dlt := sqrt( it.lead_days * power(it.sigma_d_monthly / sqrt(30.4), 2)
                         + power(v_daily_d, 2) * power(coalesce(it.sigma_l, 0), 2) );
      v_ss        := round(it.z_value * v_sigma_dlt);

      -- ③ 발주 판단. pipeline 은 아직 도착하지 않은 시뮬 발주입니다
      --    (이번 달 도착분도 월초 시점에는 아직 손에 없습니다).
      v_recv := coalesce(v_arrival[v_i], 0);
      v_need := v_window + v_ss - v_s_open - v_pipeline;

      if v_need > 0 then
        -- MOQ · 포장 단위 — sql/16 626~630행과 같은 식
        if it.pack_size is null or it.pack_size <= 0 then
          v_order := greatest(v_need, coalesce(it.moq, 0));
        else
          v_order := ceil(greatest(v_need, coalesce(it.moq, 0)) / it.pack_size) * it.pack_size;
        end if;
        v_arrival[v_i + v_lead_m] := coalesce(v_arrival[v_i + v_lead_m], 0) + v_order;
        v_pipeline := v_pipeline + v_order;
      else
        v_order := 0;
      end if;

      -- 이번 달 도착분은 파이프라인에서 빠집니다.
      v_pipeline := v_pipeline - v_recv;

      -- ④ 그 달의 재고 이동. 입고는 월초 도착으로 봅니다 (sql/15 473~479행과 같은 가정).
      --    미충족 수요는 유실입니다. 이월하지 않습니다.
      v_s_close := v_s_open + v_recv - v_demand[v_i];
      v_s_out   := v_s_close < 0;
      if v_s_out then v_s_close := 0; end if;

      v_a_close := v_a_open + v_receipt[v_i] - v_demand[v_i];
      v_a_out   := v_a_close < 0;
      if v_a_out then v_a_close := 0; end if;

      -- ⑤ 과잉 발주 — (발주 직전 재고 + 그 발주량) ÷ 월평균 수요 > EXCESS_STOCK_MONTHS.
      --    실제 미착 발주 잔량은 기록이 없어, 양쪽 모두 파이프라인을 빼고 같은 식으로 셉니다.
      --    ★ null 이 되는 경우는 하나뿐입니다 — 정책값 EXCESS_STOCK_MONTHS 가 없을 때.
      --      v_avg_demand 는 coalesce 한 배열의 평균이라 null 이 될 수 없습니다.
      --      0 이면(그 품목의 검증 구간 수요가 통째로 0) 개월치를 낼 수 없어 양쪽 모두 세지 않습니다.
      if v_excess is null then
        v_s_excess := null;
        v_a_excess := null;
      else
        v_s_excess := (v_order > 0 and v_avg_demand > 0
                       and (v_s_open + v_order) / v_avg_demand > v_excess);
        v_a_excess := (v_po_qty[v_i] > 0 and v_avg_demand > 0
                       and (v_a_open + v_po_qty[v_i]) / v_avg_demand > v_excess);
      end if;

      insert into core.simulation_result
        (simulation_id, item_id, period,
         actual_opening, actual_receipt, actual_demand, actual_closing, actual_stockout,
         actual_order_qty, actual_order_count, actual_excess,
         sim_opening, sim_order_qty, sim_receipt, sim_demand, sim_closing, sim_stockout,
         sim_excess, sim_safety_stock, sim_forecast_window)
      values
        (v_sim_id, it.item_id, v_period,
         v_a_open, v_receipt[v_i], v_demand[v_i], v_a_close, v_a_out,
         v_po_qty[v_i], v_po_cnt[v_i], v_a_excess,
         v_s_open, v_order, v_recv, v_demand[v_i], v_s_close, v_s_out,
         v_s_excess, v_ss, v_window);

      v_a_open := v_a_close;
      v_s_open := v_s_close;
    end loop;

    v_n_items := v_n_items + 1;
  end loop;

  -- ── KPI ─────────────────────────────────────────────────────
  -- ★ 평균 재고 = "전 품목 합계 재고" 의 기간 평균입니다.
  --   품목×월 행의 평균(품목 하나당 재고)으로 잡으면 분자인 기간 수요 합(전 품목)과
  --   단위가 어긋나 회전율이 대략 품목 수만큼 부풀려집니다.
  --   이 정의는 차트가 쓰는 analytics.v_simulation_totals 와 같은 단위입니다.
  --   품목별 평균(v_simulation_item.actual_avg_inv)은 품목 하나당 값으로 따로 둡니다.
  -- ★ 발주 건수는 양쪽 모두 "발주가 있었던 품목-월" 입니다.
  --   실제 쪽 발주 라인 수는 core.simulation_result.actual_order_count 에 그대로 남습니다.
  with per_month as (
    select r.period              as period,
           sum(r.actual_closing) as a_tot,
           sum(r.sim_closing)    as s_tot
      from core.simulation_result r
     where r.simulation_id = v_sim_id
     group by r.period
  ),
  by_row as (
    select count(*) filter (where r.actual_stockout)      as a_out,
           count(*) filter (where r.sim_stockout)         as s_out,
           sum(r.actual_demand)                           as demand,
           count(*) filter (where r.actual_order_qty > 0) as a_ord,
           count(*) filter (where r.sim_order_qty > 0)    as s_ord,
           count(*) filter (where r.actual_excess)        as a_ex,
           count(*) filter (where r.sim_excess)           as s_ex
      from core.simulation_result r
     where r.simulation_id = v_sim_id
  ),
  inv as (
    select avg(pm.a_tot) as a_inv,
           avg(pm.s_tot) as s_inv
      from per_month pm
  )
  select jsonb_build_object(
           'n_items',                v_n_items,
           'n_periods',              v_n_months,
           'actual_stockout_months', a.a_out,
           'sim_stockout_months',    a.s_out,
           'prevented',              greatest(a.a_out - a.s_out, 0),
           'actual_avg_inventory',   round(iv.a_inv, 1),
           'sim_avg_inventory',      round(iv.s_inv, 1),
           'inventory_change_pct',   case when iv.a_inv is null or iv.a_inv = 0 then null
                                          else round((iv.s_inv - iv.a_inv) / iv.a_inv * 100, 1) end,
           'actual_orders',          coalesce(a.a_ord, 0),
           'sim_orders',             a.s_ord,
           'excess_orders_actual',   a.a_ex,
           'excess_orders_sim',      a.s_ex,
           -- 회전율 = 기간 수요 합 ÷ 평균 재고 (둘 다 전 품목 합계 기준)
           'actual_turnover',        case when iv.a_inv is null or iv.a_inv = 0 then null
                                          else round(a.demand / iv.a_inv, 2) end,
           'sim_turnover',           case when iv.s_inv is null or iv.s_inv = 0 then null
                                          else round(a.demand / iv.s_inv, 2) end,
           'skipped_items',          v_skipped,
           'opening_clamped_items',  v_clamped,
           -- 창이 예측 밖으로 넘어간 품목-월 수. 0 보다 크면 시뮬이 그만큼 덜 발주했습니다.
           'window_truncated',       v_truncated,
           -- sim_start 이전 발주로 시뮬 파이프라인을 채운 입고 건수와, 잇지 못해 흘려보낸 건수.
           'pipeline_seed_rows',      v_seed_rows,
           'pipeline_seed_unmatched', v_unmatched
         )
    into v_kpis
    from by_row a
    cross join inv iv;

  -- ── 문장 ★ ──────────────────────────────────────────────────
  --
  -- renew.prd 13.2 의 산출 문장을 SQL 이 만듭니다.
  -- 화면·AI·보고서가 같은 문장을 쓰려면 한 곳에서 만들어야 합니다 (sql/16 의 explanation 과 같은 취지).
  if v_n_items = 0 then
    v_sentence := '비교할 데이터가 없습니다';
  else
    v_sentence :=
      'AI 추천대로 발주했다면 '
      || to_char(v_sim_start, 'YYYY-MM') || ' ~ ' || to_char(v_sim_end, 'YYYY-MM') || ' '
      || case
           when coalesce((v_kpis->>'actual_stockout_months')::numeric, 0) = 0
             then '실제 결품은 없었고, '
           else '실제 결품 ' || (v_kpis->>'actual_stockout_months') || '회 중 '
                || (v_kpis->>'prevented') || '회를 막을 수 있었고, '
         end
      || case
           when v_kpis->>'inventory_change_pct' is null
             then '평균 재고는 비교할 수 없다.'
           when abs((v_kpis->>'inventory_change_pct')::numeric) < 0.05
             then '평균 재고는 실제와 거의 같았을 것이다.'
           else '평균 재고는 '
                || trim(to_char(abs((v_kpis->>'inventory_change_pct')::numeric), 'FM999,990.0'))
                || '% '
                || case when (v_kpis->>'inventory_change_pct')::numeric < 0 then '낮게' else '높게' end
                || ' 유지됐을 것이다.'
         end;
  end if;

  v_message := v_n_items || '개 품목 × ' || v_n_months || '개월을 시뮬레이션했습니다'
               || case when v_skipped > 0
                       then ' (근거가 없어 제외한 품목 ' || v_skipped || '개)'
                       else '' end;

  update core.simulation_run as r
     set status      = 'SUCCESS',
         n_items     = v_n_items,
         kpis        = v_kpis,
         sentence    = v_sentence,
         finished_at = clock_timestamp(),
         duration_ms = (extract(epoch from (clock_timestamp() - v_started)) * 1000)::int,
         message     = v_message
   where r.simulation_id = v_sim_id;

  exception
    when others then
      v_err := SQLERRM;
  end;
  -- ★ 서브블록 끝. 아래는 RUNNING 행이 살아 있는 바깥입니다.

  if v_err is not null then
    update core.simulation_run as r
       set status = 'FAILED', finished_at = clock_timestamp(), message = v_err
     where r.simulation_id = v_sim_id;
    return query select v_sim_id, 0, ('시뮬레이션에 실패했습니다: ' || v_err)::text;
    return;
  end if;

  return query select v_sim_id, v_n_items, v_message;
end;
$$;

revoke all on function core.run_virtual_operation(text, text) from public, anon;
grant execute on function core.run_virtual_operation(text, text) to authenticated;

comment on function core.run_virtual_operation(text, text) is
  'STEP 20 — 실패해도 이력을 남기고, 기본 대상은 검증 실행입니다. 최초 정의는 sql/17-virtual-operation.sql';

-- ══ 7. 대량 적재 통지 ★ ════════════════════════════════════════
--
-- renew.prd 8.6 — "대량 변경 시 관리자에게 통지한다."
-- 별도 통지 채널(메일·슬랙)이 없으므로 Alert Center 에 INFO 알림을 하나 만듭니다.
-- 임계값은 core.policy_config.BULK_CHANGE_ROWS 에서 읽습니다 (하드코딩 금지).

create or replace function core.alert_type_label(p_type text)
returns text
language sql
immutable
as $$
  select case p_type
           when 'STOCKOUT_RISK'          then '결품 위험'
           when 'ORDER_TOO_LATE'         then '발주 시점 초과'
           when 'EXCESS_INVENTORY'       then '과잉 재고'
           when 'DEMAND_SPIKE'           then '수요 급변'
           when 'FORECAST_OUTLIER'       then '예측 이상'
           when 'OPEN_PO_DELAY'          then '발주 지연'
           when 'LEADTIME_DETERIORATION' then '리드타임 악화'
           when 'FORECAST_ACCURACY_DROP' then '예측 정확도 하락'
           when 'EXCESSIVE_OVERRIDE'     then '반복 보정'
           when 'DELIVERY_PROMISE_RISK'  then '납기 약속 위험'
           when 'SOFT_ALLOC_EXPIRING'    then '가예약 만료 임박'
           when 'INQUIRY_SPIKE'          then '문의 급증'
           when 'BULK_DATA_CHANGE'       then '대량 데이터 변경'
           else p_type
         end;
$$;

revoke all on function core.alert_type_label(text) from public, anon;
grant execute on function core.alert_type_label(text) to authenticated;

comment on function core.alert_type_label(text) is
  'renew.prd 24.1 — 탐지 유형 13종. lib/alerts-model.ts 의 ALERT_TYPES 와 같아야 합니다. 최초 정의는 sql/20-alert.sql';

create or replace function core.notify_bulk_change()
returns trigger
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_threshold numeric;
  v_rows      numeric;
begin
  -- IMPORTED 로 "바뀌는" 순간에만 봅니다. 같은 상태로 다시 저장하면 조용합니다.
  if new.status <> 'IMPORTED' then
    return new;
  end if;
  if old.status = 'IMPORTED' then
    return new;
  end if;

  select pc.value_num into v_threshold
    from core.policy_config pc
   where pc.key = 'BULK_CHANGE_ROWS';

  -- 정책값이 없으면 알리지 않습니다. 임계값을 코드에 적어 두지 않습니다.
  if v_threshold is null then
    return new;
  end if;

  v_rows := coalesce(new.imported_rows, 0);
  if v_rows < v_threshold then
    return new;
  end if;

  insert into core.alert
    (type, severity, item_id, supplier_id, reason, impact, recommended_action,
     metrics, priority_score, fingerprint)
  values (
    'BULK_DATA_CHANGE', 'INFO', null, null,
    '배치 ' || new.batch_id || ' 로 ' || v_rows || '행이 한 번에 적재되었습니다 (기준 '
      || v_threshold || '행)',
    '예측이 이전 데이터 기준이라 재고 전개 · 발주 추천 · 대시보드 숫자가 지금 데이터와 어긋납니다',
    '예측 실행 화면에서 운영 실행을 한 번 돌려 주세요',
    jsonb_build_object('batch_id', new.batch_id, 'data_type', new.data_type,
                       'imported_rows', v_rows, 'threshold', v_threshold),
    core.alert_priority('INFO', null, null),
    'BULK_DATA_CHANGE:' || new.batch_id
  )
  on conflict do nothing;   -- 같은 배치로 두 번 알리지 않습니다 (부분 유니크 인덱스)

  return new;
end;
$$;

revoke all on function core.notify_bulk_change() from public, anon;

comment on function core.notify_bulk_change() is
  'renew.prd 8.6 — 대량 적재를 Alert 로 통지합니다. 임계값은 policy_config.BULK_CHANGE_ROWS';

drop trigger if exists upload_batch_bulk_change on core.upload_batch;
create trigger upload_batch_bulk_change
  after update of status on core.upload_batch
  for each row execute function core.notify_bulk_change();

-- ══ 8. 관리자 조회 뷰 ══════════════════════════════════════════

-- ── 8-1. 모델 버전 ─────────────────────────────────────────────
--
-- renew.prd 31.2 — "모델 코드와 파라미터 버전을 추적한다."
-- 실행할 때 core.forecast_run.models 에 그 시점의 (model_id · version) 이 들어가므로,
-- 그 jsonb 를 되짚어 "이 버전을 몇 번 썼는가" 를 셉니다.

create or replace view analytics.v_model_version as
with usage as (
  select mv.id,
         count(distinct r.run_id)          as run_count,
         max(r.started_at)                 as last_used_at
    from core.model_version mv
    left join core.forecast_run r
      on r.models @> jsonb_build_array(
           jsonb_build_object('model_id', mv.model_id, 'version', mv.version))
   group by mv.id
)
select mv.id,
       mv.model_id,
       coalesce(mc.model_name, mv.definition->>'model_name') as model_name,
       coalesce(mc.family,     mv.definition->>'family')     as family,
       coalesce(mc.engine,     mv.definition->>'engine')     as engine,
       mv.version,
       mv.definition,
       mv.definition->'parameters'                           as parameters,
       mv.created_at,
       u.run_count,
       u.last_used_at,
       (mc.version = mv.version)                             as is_current,
       coalesce(mc.enabled, false)                           as model_enabled
  from core.model_version mv
  left join core.model_config mc on mc.model_id = mv.model_id
  left join usage u on u.id = mv.id;

comment on view analytics.v_model_version is
  'renew.prd 31.2 — 실행 시점의 모델 정의 스냅샷. run_count 는 core.forecast_run.models 를 되짚은 값입니다';

-- ── 8-2. 실행 상세 ─────────────────────────────────────────────
--
-- 한 줄 = 실행 하나 × 모델 하나. 실행 수준 값(총 품목 · 총 행 · 백테스트 여부 ·
-- 가상운영 여부 · stale)은 같은 줄에 함께 실어 화면이 합계를 다시 구하지 않게 합니다
-- (AGENTS.md 규칙 1). 결과가 한 행도 없는 실패 실행도 한 줄은 나옵니다.

create or replace view analytics.v_forecast_run_detail as
with per_model as (
  select f.run_id, f.model_id, f.model_version,
         count(distinct f.item_id)::int as n_items,
         count(*)::int                  as n_rows,
         min(f.period)                  as first_period,
         max(f.period)                  as last_period,
         count(*) filter (where f.p80 is not null)::int as n_with_interval
    from core.forecast_result f
   group by f.run_id, f.model_id, f.model_version
),
run_agg as (
  select f.run_id,
         count(distinct f.item_id)::int  as run_items,
         count(distinct f.model_id)::int as run_models,
         count(*)::int                   as run_rows,
         min(f.period)                   as run_first_period,
         max(f.period)                   as run_last_period
    from core.forecast_result f
   group by f.run_id
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

comment on view analytics.v_forecast_run_detail is
  '실행 하나 × 모델 하나. 실행 수준 값(run_*)은 모든 줄에 같은 값으로 실려 있습니다';

-- ── 8-3. stale 요약 ★ ──────────────────────────────────────────
--
-- renew.prd 8.6 · 31.5 — 데이터가 들어온 뒤 예측을 다시 돌렸는가.
-- 항상 한 줄입니다. 화면(components/ui/stale-banner.tsx)이 이 한 줄만 봅니다.
--
-- 판정 기준
--   is_stale             화면이 쓰는 실행(core.v_ai_forecast 가 고르는 그 실행)의
--                        data_snapshot_at 이 최신 loaded_at 보다 이르면 참.
--                        성공한 실행이 하나도 없으면 참 — 아직 아무것도 못 씁니다.
--   needs_production_run 화면이 쓰는 실행이 운영 실행이 아니면 참.
--                        검증 실행의 예측은 과거 구간이라 오늘 이후를 덮지 못합니다.

create or replace view analytics.v_stale_summary as
with loaded as (
  -- ★ 수요뿐 아니라 모든 적재를 봅니다 (core.v_data_loaded_at · sql/11).
  --   raw.usage_history 만 보면 재고·발주 적재가 배너를 띄우지 못하는데,
  --   대량 적재 트리거는 data_type 을 가리지 않고 울려 두 신호가 어긋납니다.
  select (select d.data_loaded_at from core.v_data_loaded_at d) as data_loaded_at,
         (select max(d.period)    from core.v_demand_monthly d)  as data_end
),
picked as (
  -- core.v_ai_forecast 와 같은 규칙으로 고릅니다. 두 곳이 다르면 배너와 숫자가 어긋납니다.
  -- case 식으로 정렬하는 이유는 error.md #27 (위 core.v_ai_forecast 의 lr 참조).
  select r.run_id, r.mode, r.status, r.data_snapshot_at, r.started_at, r.train_end
    from core.forecast_run r
   where r.status = 'SUCCESS'
   order by case when r.mode = 'PRODUCTION' then 0 else 1 end,
            r.started_at desc
   limit 1
),
last_batch as (
  select b.batch_id, b.data_type, b.imported_rows, b.imported_at
    from core.upload_batch b
   where b.status = 'IMPORTED'
   order by b.imported_at desc nulls last
   limit 1
),
setting as (
  select s.train_end, s.production_train_end from core.forecast_setting s where s.id = 1
)
select p.run_id                      as forecast_run_id,
       p.mode                        as forecast_mode,
       p.data_snapshot_at,
       p.started_at                  as forecast_run_at,
       p.train_end                   as forecast_train_end,
       l.data_loaded_at,
       l.data_end,
       st.train_end                  as setting_train_end,
       st.production_train_end,
       b.batch_id                    as last_batch_id,
       b.data_type                   as last_batch_data_type,
       b.imported_rows               as last_batch_rows,
       b.imported_at                 as last_batch_at,
       (p.run_id is null
        or (p.data_snapshot_at is not null
            and l.data_loaded_at is not null
            and p.data_snapshot_at < l.data_loaded_at))          as is_stale,
       (p.run_id is null or p.mode <> 'PRODUCTION')              as needs_production_run,
       array['/dashboard', '/forecast', '/model-comparison',
             '/inventory-projection', '/purchase-recommendation']::text[] as affected_screens
  from loaded l
  left join picked p    on true
  left join last_batch b on true
  left join setting st  on true;

comment on view analytics.v_stale_summary is
  'renew.prd 8.6 — 항상 한 줄. 데이터가 바뀐 뒤 예측을 다시 돌렸는지와, 영향받는 화면 목록';

-- ── 8-4. 이상치 규칙 ───────────────────────────────────────────

create or replace view analytics.v_outlier_rule as
select r.rule_id,
       r.rule_type,
       r.scope,
       r.item_id,
       im.item_name,
       r.threshold,
       r.active,
       r.note,
       r.created_at,
       -- 이 규칙 유형으로 실제 제외된 행 수. 규칙이 놀고 있는지 보이게 합니다.
       (select count(*) from core.outlier_exclusion e
         where e.reason_code = r.rule_type)::int as exclusion_count
  from core.outlier_rule r
  left join core.v_item_master im on im.item_id = r.item_id;

comment on view analytics.v_outlier_rule is
  'renew.prd 12.3 — 학습에서 제외할 데이터 규칙. core.v_train_demand 가 outlier_exclusion 을 봅니다';

create or replace view analytics.v_outlier_exclusion as
select e.item_id,
       im.item_name,
       e.use_date,
       e.reason_code,
       case e.reason_code
         when 'RETURN'    then '반품(음수 출고)'
         when 'PROJECT'   then '프로젝트성 대량 출고'
         when 'DUPLICATE' then '중복 입력'
         when 'MANUAL'    then '수동 제외'
         else e.reason_code
       end                                  as reason_label,
       e.note,
       e.excluded_at,
       au.email as excluded_email,
       -- 그날 그 품목의 원본 수량. 무엇을 뺐는지 눈으로 확인할 수 있어야 합니다.
       (select sum(d.qty) from core.v_demand_monthly d
         where d.item_id = e.item_id and d.period = e.use_date) as excluded_qty
  from core.outlier_exclusion e
  left join core.v_item_master im on im.item_id = e.item_id
  left join core.app_user au on au.user_id = e.excluded_by;

comment on view analytics.v_outlier_exclusion is
  'renew.prd 12.3 — 학습에서 실제로 뺀 행. core.v_train_demand · v_production_demand 가 이 표를 봅니다';

-- ── 8-5. 통합 로그 ★ ───────────────────────────────────────────
--
-- renew.prd 31.1 — "모든 수정과 승인에 근거와 이력이 남는다."
-- 감사 로그 · 외부 API 호출 · AI 답변을 한 표로 모읍니다. 최근 1,000건입니다.
--
-- ★ 관리자에게만 행이 나옵니다. analytics 뷰는 postgres 소유라 밑 테이블의 RLS 를
--   지나치므로(특히 core.agent_message 의 "본인 대화만" 정책), 뷰 안에서 막습니다.
--
-- ★★ core.api_log 는 sql/26-api.sql 이 만듭니다. 아직 없을 수도 있어
--    to_regclass 로 확인하고 그 갈래를 빼고 만듭니다. sql/26 을 나중에 적용했다면
--    이 파일을 한 번 더 실행하면 API 갈래가 붙습니다.

do $$
declare
  v_api text := '';
  v_sql text;
begin
  if to_regclass('core.api_log') is not null then
    v_api := $q$
      union all
      select 'API'::text                                          as kind,
             ('API:' || l.id)::text                               as log_id,
             l.at                                                 as at,
             coalesce(l.key_id, '익명')::text                     as actor,
             btrim(coalesce(l.method, '') || ' ' || coalesce(l.path, ''))::text as action,
             coalesce(l.batch_id, l.key_id)::text                 as target,
             jsonb_build_object('status', l.status, 'duration_ms', l.duration_ms,
                                'received', l.received, 'accepted', l.accepted,
                                'rejected', l.rejected, 'ip', l.ip,
                                'idempotency_key', l.idempotency_key) as detail
        from core.api_log l
    $q$;
  end if;

  v_sql := $q$
create or replace view analytics.v_system_log as
with merged as (
  select 'AUDIT'::text                                            as kind,
         ('AUDIT:' || a.id)::text                                 as log_id,
         a.at                                                     as at,
         coalesce(a.actor_email, '시스템')::text                  as actor,
         a.action::text                                           as action,
         btrim(coalesce(a.target_type, '') || ' ' || coalesce(a.target_id, ''))::text as target,
         jsonb_build_object('before', a.before, 'after', a.after)  as detail
    from core.audit_log a

  union all

  select 'AGENT'::text                                            as kind,
         ('AGENT:' || m.id)::text                                 as log_id,
         m.created_at                                             as at,
         coalesce(c.user_email, '알 수 없음')::text               as actor,
         'AGENT_ANSWER'::text                                     as action,
         m.conversation_id::text                                  as target,
         jsonb_build_object(
           'content', left(m.content, 300),
           'tools', case when jsonb_typeof(m.tool_trace) = 'array'
                         then (select jsonb_agg(t->>'name')
                                 from jsonb_array_elements(m.tool_trace) t) end,
           'guardrail_ok', m.guardrail->'ok',
           'total_tokens', m.usage->'totalTokens')                as detail
    from core.agent_message m
    left join core.agent_conversation c on c.conversation_id = m.conversation_id
   where m.role = 'assistant'
  $q$ || v_api || $q$
)
select g.kind,
       g.log_id,
       g.at,
       g.actor,
       g.action,
       nullif(g.target, '') as target,
       g.detail,
       lower(concat_ws(' ', g.actor, g.action, g.target, g.detail::text)) as search_text
  from merged g
 where core.is_admin()
 order by g.at desc
 limit 1000;
  $q$;

  execute v_sql;
end $$;

comment on view analytics.v_system_log is
  'renew.prd 31.1 — 감사 · 외부 API · AI 답변을 합친 최근 1,000건. 관리자에게만 행이 나옵니다';

-- ══ 9. 권한 ════════════════════════════════════════════════════

grant select on analytics.v_model_version       to authenticated;
grant select on analytics.v_forecast_run_detail to authenticated;
grant select on analytics.v_system_log          to authenticated;
grant select on analytics.v_stale_summary       to authenticated;
grant select on analytics.v_outlier_rule        to authenticated;
grant select on analytics.v_outlier_exclusion   to authenticated;

revoke all on analytics.v_system_log from anon;

-- ══ 10. 확인 ═══════════════════════════════════════════════════
--
-- ★ 읽기 전용 select 만 둡니다. 관리자 전용 함수를 여기서 부르면 SQL Editor 의
--   암묵적 트랜잭션이 파일 전체를 롤백합니다 (error.md #22).

-- (1) 새 컬럼과 정책값
select s.train_start, s.train_end, s.production_train_end,
       (select pc.value_num from core.policy_config pc where pc.key = 'BULK_CHANGE_ROWS') as bulk_change_rows
  from core.forecast_setting s where s.id = 1;

-- (2) 실행 모드별 건수
select r.mode, r.status, count(*) as n
  from core.forecast_run r
 group by 1, 2
 order by 1, 2;

-- (3) stale 요약 — 화면 배너가 보는 그 한 줄
select * from analytics.v_stale_summary;

-- (4) 새 뷰가 서는지
select 'v_model_version'       as v, count(*) from analytics.v_model_version
union all select 'v_forecast_run_detail', count(*) from analytics.v_forecast_run_detail
union all select 'v_system_log',          count(*) from analytics.v_system_log
union all select 'v_outlier_rule',        count(*) from analytics.v_outlier_rule
union all select 'v_outlier_exclusion',   count(*) from analytics.v_outlier_exclusion
order by 1;

-- 실행해 보려면 (관리자로 로그인한 세션에서):
--   select * from core.run_baseline_forecast('운영 첫 실행', 'PRODUCTION');
--   select * from core.run_backtest();          -- 검증 실행만 채점합니다
