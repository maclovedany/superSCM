-- ──────────────────────────────────────────────────────────────
-- sql/35 — 실체화 · 종속수요 (docs/superpowers/specs/2026-09-05-realdata-cutover-design.md §4 · §5)
--
-- ★ 왜 물리 표인가
--   품목 11,000개 × 모델 13종 × 12기간 = 실행당 170만 행이 core.forecast_result 에 쌓입니다.
--   화면이 요청마다 그것을 훑어 Champion 값을 고르면 시간 초과입니다 (error.md #30 의 20품목
--   에서도 그랬습니다). 그래서 실행이 끝날 때 "지금 화면이 쓰는 예측" 을 표 하나로 써 둡니다.
--
--   core.forecast_current   품목 × 기간, Champion(없으면 기본) 모델의 값. core.v_ai_forecast 가 읽습니다
--   core.dependent_demand   기종 예측 × BOM 구성수량 = 필수품 · 옵션의 종속수요
--
-- ★ 언제 갱신되나 — core.refresh_forecast_current() · core.build_dependent_demand()
--   run_baseline_forecast 끝(sql/27) · run_backtest 끝(sql/27) · set_champion_manual(sql/13) ·
--   Python 예측 서비스가 모델을 이어 붙인 뒤. 몇 번을 불러도 같은 결과입니다.
--
-- ★ 선행: sql/27 (v_ai_forecast 원 정의 · 실행 함수) · sql/34 (v_item_hierarchy · v_item_master)
-- ──────────────────────────────────────────────────────────────

-- ══ 1. 표 ═══════════════════════════════════════════════════════

create table if not exists core.forecast_current (
  item_id          text        not null,
  item_type        text,
  period           date        not null,
  model_id         text,
  model_version    text,
  qty              numeric,
  p50              numeric,
  p80              numeric,
  p90              numeric,
  sigma            numeric,
  source           text,                       -- CHAMPION / DEFAULT
  run_id           text,
  mode             text,
  data_snapshot_at timestamptz,
  refreshed_at     timestamptz not null default now(),
  primary key (item_id, period)
);
create index if not exists ix_forecast_current_type on core.forecast_current (item_type);
create index if not exists ix_forecast_current_run  on core.forecast_current (run_id);

comment on table core.forecast_current is
  '화면이 쓰는 현재 예측 (품목 × 기간, Champion 값). refresh_forecast_current() 가 실행 끝에 다시 씁니다';

create table if not exists core.dependent_demand (
  run_id        text    not null,
  model_base    text    not null,
  item_id       text    not null,
  period        date    not null,
  role          text    not null,
  qty_per_unit  numeric,
  machine_qty   numeric,
  qty           numeric,
  is_common     boolean,
  built_at      timestamptz not null default now(),
  primary key (run_id, model_base, item_id, period, role)
);
create index if not exists ix_dependent_demand_item on core.dependent_demand (item_id, period);

comment on table core.dependent_demand is
  '기종 Champion 예측 × BOM 구성수량 = 구성품의 종속수요. build_dependent_demand() 가 운영 실행 끝에 다시 씁니다';


-- ══ 2. 갱신 함수 ═══════════════════════════════════════════════

-- 실행을 고르는 규칙은 예전 core.v_ai_forecast 와 같습니다 — 운영(PRODUCTION) 성공 실행이
-- 있으면 그중 최근, 없으면 최근 성공 실행. 품목마다 Champion 이 이 실행에 결과가 있으면
-- 그 모델, 없으면 기본 모델(model_config.is_default).
-- ★ set enable_nestloop = off — 이 함수 안에서만. 실행 직후에는 방금 넣은 run_id 의 통계가 없어
--   계획기가 "1행" 으로 보고 Nested Loop 를 고르면 5분을 넘깁니다 (실측 · error.md #34).
--   analyze 로 통계도 갱신하지만, 계획이 어긋나도 해시 조인으로 끝나게 보험을 겁니다.
create or replace function core.refresh_forecast_current(p_run_id text default null)
returns int
language plpgsql
security definer
set search_path = core, public
set enable_nestloop = off
as $$
declare
  v_run  text;
  v_mode text;
  v_snap timestamptz;
  v_n    int := 0;
begin
  -- 방금 쌓인 결과의 통계를 먼저 갱신합니다 (analyze 는 트랜잭션 안에서도 됩니다).
  analyze core.forecast_result;
  if p_run_id is null then
    select r.run_id into v_run
      from core.forecast_run r
     where r.status = 'SUCCESS'
     order by case when r.mode = 'PRODUCTION' then 0 else 1 end, r.started_at desc
     limit 1;
  else
    v_run := p_run_id;
  end if;

  truncate core.forecast_current;
  if v_run is null then
    return 0;
  end if;

  select r.mode, r.data_snapshot_at into v_mode, v_snap
    from core.forecast_run r where r.run_id = v_run;

  insert into core.forecast_current
    (item_id, item_type, period, model_id, model_version, qty, p50, p80, p90, sigma,
     source, run_id, mode, data_snapshot_at, refreshed_at)
  with dm as materialized (
    select m.model_id from core.model_config m where m.is_default order by m.model_id limit 1
  ),
  avail as materialized (
    select distinct f.item_id, f.model_id from core.forecast_result f where f.run_id = v_run
  ),
  champ as materialized (
    select a.item_id, a.model_id
      from avail a
      join core.champion_model c on c.item_id = a.item_id and c.champion_model_id = a.model_id
  ),
  pick as materialized (
    select i.item_id,
           coalesce(ch.model_id, d.model_id) as model_id,
           case when ch.model_id is not null then 'CHAMPION' else 'DEFAULT' end as source
      from (select distinct a.item_id from avail a) i
      left join champ ch on ch.item_id = i.item_id
      left join dm d on true
  )
  select f.item_id, im.item_type, f.period, f.model_id, f.model_version,
         f.predicted_qty, f.p50, f.p80, f.p90, f.sigma,
         p.source, v_run, v_mode, v_snap, now()
    from pick p
    join core.forecast_result f
      on f.run_id = v_run and f.item_id = p.item_id and f.model_id = p.model_id
    left join core.v_item_master im on im.item_id = f.item_id;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- 기종 예측 × 구성수량. CAP(주문 단위)은 물건이 아니라 구성 묶음이므로 뺍니다.
-- 같은 (기종 · 구성품 · 역할)이 model_key 마다 여러 행이면 구성수량을 합칩니다.
create or replace function core.build_dependent_demand()
returns int
language plpgsql
security definer
set search_path = core, public
set enable_nestloop = off
as $$
declare v_n int := 0;
begin
  truncate core.dependent_demand;

  insert into core.dependent_demand
    (run_id, model_base, item_id, period, role, qty_per_unit, machine_qty, qty, is_common)
  with h as (
    select core.norm_code(x.model_base) as machine_id,
           x.model_base, x.role, x.item_id,
           sum(x.qty_per_unit)          as qty_per_unit,
           bool_or(x.is_common)         as is_common
      from core.v_item_hierarchy x
     where x.role <> 'CAP'
     group by 1, 2, 3, 4
  )
  select fc.run_id, h.model_base, h.item_id, fc.period, h.role,
         h.qty_per_unit, fc.qty, fc.qty * h.qty_per_unit, h.is_common
    from core.forecast_current fc
    join core.v_item_master im on im.item_id = fc.item_id and im.is_machine
    join h on h.machine_id = fc.item_id
   where fc.qty is not null;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function core.refresh_forecast_current(text) from public, anon;
revoke all on function core.build_dependent_demand()      from public, anon;
grant execute on function core.refresh_forecast_current(text) to authenticated;
grant execute on function core.build_dependent_demand()      to authenticated;


-- ══ 3. core.v_ai_forecast — 실체화 표를 읽습니다 ═══════════════
--
-- 컬럼 이름 · 순서 · 타입은 sql/27 §4 의 정의와 같습니다 (create or replace 조건).
-- v_consensus_forecast(sql/15) 와 그 위 재고 전개 · 발주 추천 · 대시보드는 그대로 동작합니다.

create or replace view core.v_ai_forecast as
select c.run_id, c.model_id, c.model_version, c.item_id, c.period,
       c.qty as predicted_qty, c.p50, c.p80, c.p90, c.sigma, c.data_snapshot_at, c.source
  from core.forecast_current c;

comment on view core.v_ai_forecast is
  'renew.prd 17.1 — 품목별 대표 예측. sql/35 부터 core.forecast_current(실체화)를 읽습니다. 최초 정의는 sql/15';


-- ══ 4. analytics 뷰 ════════════════════════════════════════════

-- 품목 × 기간 — 실적 · 독립 예측 · 종속수요를 한 행에. 모델 비교 오버레이의 "종속수요" 시리즈.
create or replace view analytics.v_demand_compare as
with dep as (
  select d.item_id, d.period,
         sum(d.qty)                     as dependent_qty,
         count(distinct d.model_base)   as n_machines,
         bool_or(d.is_common)           as is_common
    from core.dependent_demand d
   group by 1, 2
),
ind as (
  select c.item_id, c.period, c.qty as independent_qty, c.model_id as independent_model, c.source
    from core.forecast_current c
),
act as (
  select m.item_id, m.period, m.qty as actual_qty
    from core.v_demand_monthly m
   where m.period > (select max(period) from core.v_demand_monthly) - interval '36 months'
)
select coalesce(i.item_id, d.item_id, a.item_id) as item_id,
       coalesce(i.period, d.period, a.period)    as period,
       a.actual_qty,
       i.independent_qty,
       i.independent_model,
       i.source                                  as independent_source,
       d.dependent_qty,
       d.n_machines,
       d.is_common
  from ind i
  full join dep d on d.item_id = i.item_id and d.period = i.period
  full join act a on a.item_id = coalesce(i.item_id, d.item_id) and a.period = coalesce(i.period, d.period);

comment on view analytics.v_demand_compare is
  '품목 × 기간 — 실적 · 독립 예측(Champion) · 종속수요(기종 예측 × BOM). item_id 로 걸러 읽습니다';

-- 기종 화면의 표 — 기종 1대 구성품마다 독립 예측 합과 종속수요 합 (예측 지평 전체).
create or replace view analytics.v_machine_bom_forecast as
with mach as (
  select fc.item_id as machine_id, sum(fc.qty) as machine_h
    from core.forecast_current fc
    join core.v_item_master im on im.item_id = fc.item_id and im.is_machine
   group by 1
),
h as (
  select core.norm_code(x.model_base) as machine_id, x.model_base, x.role, x.item_id,
         sum(x.qty_per_unit) as qty_per_unit, bool_or(x.is_common) as is_common, max(x.n_models) as n_models
    from core.v_item_hierarchy x
   group by 1, 2, 3, 4
),
ind as (
  select c.item_id, sum(c.qty) as independent_h from core.forecast_current c group by 1
),
dep as (
  select d.model_base, d.item_id, d.role, sum(d.qty) as dependent_h from core.dependent_demand d group by 1, 2, 3
)
select h.model_base,
       h.machine_id,
       h.role,
       h.item_id,
       im.item_name,
       im.item_type,
       h.qty_per_unit,
       h.is_common,
       h.n_models,
       m.machine_h,
       d.dependent_h,
       i.independent_h,
       case when d.dependent_h is not null and i.independent_h is not null
            then i.independent_h - d.dependent_h end as gap_h,
       case when d.dependent_h is null and h.role <> 'CAP' and m.machine_h is null then 'NO_MACHINE_FORECAST'
            when i.independent_h is null then 'NO_ITEM_FORECAST' end as reason_code
  from h
  left join mach m on m.machine_id = h.machine_id
  left join core.v_item_master im on im.item_id = h.item_id
  left join ind i on i.item_id = h.item_id
  left join dep d on d.model_base = h.model_base and d.item_id = h.item_id and d.role = h.role;

comment on view analytics.v_machine_bom_forecast is
  '기종 → 구성품 — 구성수량 · 기종 예측 합 · 종속수요 합 · 독립 예측 합 · 차이. model_base 로 걸러 읽습니다';

-- 기종 × 월 — 영업 OL · SCM OL · 실적. 기종 차트의 "사람의 예측" 두 선.
create or replace view analytics.v_machine_plan_actual as
select core.norm_code(f.model_base)            as item_id,
       f.model_base,
       to_date(f.ym || '-01', 'YYYY-MM-DD')    as period,
       sum(f.sales_ol)                         as sales_ol,
       sum(f.scm_ol)                           as scm_ol,
       sum(f.act)                              as act
  from raw.fact_mc_plan_actual f
 where nullif(btrim(f.model_base), '') is not null
 group by 1, 2, 3;

comment on view analytics.v_machine_plan_actual is
  '기종 × 월 영업 OL · SCM OL · 실적 (raw.fact_mc_plan_actual). 기종 차트의 비교 시리즈';

do $$
declare v text;
begin
  foreach v in array array[
    'core.forecast_current', 'core.dependent_demand',
    'analytics.v_demand_compare', 'analytics.v_machine_bom_forecast', 'analytics.v_machine_plan_actual'
  ] loop
    execute format('grant select on %s to authenticated', v);
    execute format('revoke all on %s from anon', v);
  end loop;
end $$;

alter table core.forecast_current  enable row level security;
alter table core.dependent_demand  enable row level security;
drop policy if exists forecast_current_read on core.forecast_current;
create policy forecast_current_read on core.forecast_current for select to authenticated using (true);
drop policy if exists dependent_demand_read on core.dependent_demand;
create policy dependent_demand_read on core.dependent_demand for select to authenticated using (true);


-- ══ 5. 지금 상태로 한 번 채웁니다 ═══════════════════════════════

select core.refresh_forecast_current() as forecast_current_rows,
       core.build_dependent_demand()    as dependent_demand_rows;

-- ══ 6. 확인 ═══════════════════════════════════════════════════

select 'forecast_current' as t, count(*), count(distinct item_id) as items from core.forecast_current
union all select 'forecast_current.MACHINE', count(*), count(distinct item_id) from core.forecast_current where item_type = 'MACHINE'
union all select 'dependent_demand', count(*), count(distinct item_id) from core.dependent_demand
union all select 'v_machine_plan_actual', count(*), count(distinct item_id) from analytics.v_machine_plan_actual;
