-- ★ 영업 가림막 — core.v_purchase_order 의 최종 정의는 sql/29-sales-column-guard.sql 에 있습니다 (renew.prd 4.4 · 4.5).
-- ──────────────────────────────────────────────────────────────
-- ★ core.run_virtual_operation() 의 최종 정의는 sql/27-admin-ops.sql 입니다
--   (실패해도 이력 행이 남음 · 기본 대상은 검증 실행). 이 파일을 다시 실행했다면 sql/27 도 이어서 실행하세요.
-- STEP 11 · 가상 운영 결과 ★ (도입 판단의 근거)
--
-- renew.prd 13.2
--   "오차율만으로는 도입 판단이 어렵다. 2025년 1월 시점에서 시스템이 추천했을 발주량을
--    계산하고, 그대로 발주했을 경우의 재고 추이를 시뮬레이션한다. 실제 발주 실적과 비교한다.
--    결품 발생 횟수 · 평균 재고 수준 · 과잉 발주 건수 · 재고 회전율"
-- renew.prd 2장 성공기준 16
--   "16번이 도입 판단의 근거가 된다."
--
-- 여기서 만드는 것
--   core       v_supplier_alias           공급업체 표기 → 코드 (컬럼명을 훑어 만듭니다)
--   core       v_goods_receipt            실제 입고 정규화 (raw 한글 컬럼)
--   core       v_purchase_order           실제 발주 정규화 (raw 한글 컬럼)
--   core       v_usage_monthly            전 기간 월별 사용 실적 (운영용)
--   core       simulation_run             시뮬레이션 실행 이력 + KPI + 문장
--   core       simulation_result          품목 × 기간 실제/시뮬 재고 추이
--   core       run_virtual_operation()    ★ 시뮬레이션 실행 (관리자)
--   analytics  v_simulation_run · v_simulation_item · v_simulation_series · v_simulation_totals
--
-- sql/16-safety-stock-recommendation.sql 까지 먼저 실행하세요.
--
-- ★ 계산식은 STEP 9 · STEP 10 과 같은 것을 씁니다. 새로 만들지 않았습니다.
--     안전재고 σ_DLT        sql/16 505~512행 (v_safety_stock)
--     σ_d 월→일 환산        sql/16 481행     (√30.4)
--     d = 창 수요 ÷ 창 일수  sql/16 475행     (v_safety_stock)
--     MOQ · 포장 단위 올림   sql/16 626~630행 (v_purchase_recommendation)
--     입고는 월초 도착 가정  sql/15 473~479행 (v_stockout_risk 의 dated CTE)
--
-- ★ 이 파일은 raw 와 core 원본을 읽기만 합니다.
--   insert 는 core.simulation_run · core.simulation_result 두 곳뿐입니다.
--
-- ★ 다시 실행할 때 — 이 파일의 `drop view` 는 cascade 입니다.
--
--   99행의 core.v_supplier_alias 는 **같은 파일 170행**의 core.v_purchase_order 가
--   참조합니다. cascade 가 없으면 두 번째 실행은 언제나 99행에서 멈췄습니다.
--   cascade 로 지워지는 뷰는 전부 이 파일이 아래에서 다시 만드는 것뿐이고,
--   이 파일의 뷰 위에 뷰를 만드는 뒤 번호 파일은 없습니다.
--   따라서 이 파일은 혼자 다시 실행해도 됩니다.
-- ──────────────────────────────────────────────────────────────

-- ══ 1. 도우미 함수 ═════════════════════════════════════════════
--
-- raw 의 한글 컬럼은 전부 text 입니다. 숫자로 바꿀 수 없는 값을 0 으로 채우면
-- "수량이 0" 과 "값이 깨졌다" 가 구분되지 않습니다 (AGENTS.md 규칙 5).

create or replace function core.num_safe(p_text text)
returns numeric
language sql
immutable
as $$
  select case
           when btrim(regexp_replace(coalesce(p_text, ''), '[,\s₩원]', '', 'g'))
                ~ '^-?[0-9]+(\.[0-9]+)?$'
           then btrim(regexp_replace(p_text, '[,\s₩원]', '', 'g'))::numeric
         end;
$$;

comment on function core.num_safe(text) is
  '텍스트를 수량으로. 숫자가 아니면 null 입니다 (0 으로 채우지 않습니다)';

-- 날짜 표기가 네 가지로 섞여 들어옵니다.
--   2025-01-03 · 2025/01/03 · 20250103 · 09-MAY-26
-- ★ 마지막(DD-MON-YY)이 실데이터의 raw.purchase_order 92건 중 12건입니다.
--   이 분기가 없으면 그 발주가 order_date = null 이 되어 어느 달에도 잡히지 않고,
--   실제 발주 건수와 과잉 발주가 13% 만큼 조용히 줄어듭니다.
-- text::date 가 DateStyle 에 기대므로 immutable 이 아니라 stable 입니다 (core.fmt_qty 와 같은 이유).
create or replace function core.date_safe(p_text text)
returns date
language sql
stable
as $$
  select case
           when btrim(coalesce(p_text, '')) ~ '^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}'
           then translate(substring(btrim(p_text) from '^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}'),
                          '/.', '--')::date
           when btrim(coalesce(p_text, '')) ~ '^\d{8}$'
           then to_date(btrim(p_text), 'YYYYMMDD')
           -- MON 은 영문 약자만 받으므로 대문자로 올려 넘깁니다.
           -- YY 는 00~69 를 2000년대로 봅니다 (26 → 2026).
           when btrim(coalesce(p_text, '')) ~ '^\d{1,2}-[A-Za-z]{3}-\d{2}$'
           then to_date(upper(btrim(p_text)), 'DD-MON-YY')
         end;
$$;

comment on function core.date_safe(text) is
  '텍스트를 날짜로. 해석할 수 없으면 null 입니다';

revoke all on function core.num_safe(text)  from public, anon;
revoke all on function core.date_safe(text) from public, anon;
grant execute on function core.num_safe(text)  to authenticated;
grant execute on function core.date_safe(text) to authenticated;

-- ══ 2. core 뷰 — 실제 발주 · 입고 · 사용 ═══════════════════════
--
-- ★ 품목코드 정규화는 core.v_item_master 와 같은 규칙입니다.
--   upper(regexp_replace(..., '[\s\-_]', '', 'g'))
--   여기서만 다르게 정규화하면 같은 품목이 두 개로 갈라집니다.

-- ── 2-1. 공급업체 표기 매핑 ───────────────────────────────────
--
-- raw.purchase_order."공급업체" 는 표기가 25종입니다 (SCHEMA.md).
-- core.supplier_alias 가 그것을 코드로 모읍니다. 다만 이 테이블은 덤프에서 온 것이라
-- 리포지토리에 정의가 없어 컬럼 이름을 확정할 수 없습니다.
-- sql/16 의 core.v_item_price 와 같은 방식으로 후보를 훑고, 못 찾으면 0행 뷰를 만듭니다
-- (그 경우 공급업체 표기를 그대로 supplier_id 로 씁니다 — 지시서 규칙).
drop view if exists core.v_supplier_alias cascade;

do $$
declare
  alias_col text;
  id_col    text;
  alias_cands text[] := array['alias', 'alias_name', 'raw_name', 'source_name',
                              'supplier_name', '공급업체', '공급업체명', '표기', 'name'];
  id_cands    text[] := array['supplier_id', 'supplier_code', '공급업체코드', 'code', 'id'];
begin
  if to_regclass('core.supplier_alias') is null then
    execute 'create view core.v_supplier_alias as
             select null::text as alias, null::text as supplier_id where false';
    raise notice 'core.supplier_alias 가 없습니다. 발주의 공급업체 표기를 그대로 씁니다';
    return;
  end if;

  select c.column_name into alias_col
    from information_schema.columns c
   where c.table_schema = 'core' and c.table_name = 'supplier_alias'
     and c.column_name::text = any (alias_cands)
   order by array_position(alias_cands, c.column_name::text)
   limit 1;

  select c.column_name into id_col
    from information_schema.columns c
   where c.table_schema = 'core' and c.table_name = 'supplier_alias'
     and c.column_name::text = any (id_cands)
   order by array_position(id_cands, c.column_name::text)
   limit 1;

  if alias_col is null or id_col is null then
    execute 'create view core.v_supplier_alias as
             select null::text as alias, null::text as supplier_id where false';
    raise notice 'core.supplier_alias 에서 표기/코드 컬럼을 찾지 못했습니다. 표기를 그대로 씁니다';
    return;
  end if;

  -- 같은 표기가 여러 코드에 걸려 있으면 코드 순으로 하나만 씁니다.
  execute format($f$
    create view core.v_supplier_alias as
    select distinct on (btrim(a.%1$I::text))
           btrim(a.%1$I::text) as alias,
           btrim(a.%2$I::text) as supplier_id
      from core.supplier_alias a
     where nullif(btrim(a.%1$I::text), '') is not null
       and nullif(btrim(a.%2$I::text), '') is not null
     order by btrim(a.%1$I::text), btrim(a.%2$I::text)
  $f$, alias_col, id_col);

  raise notice '공급업체 표기를 core.supplier_alias.% → % 로 매핑합니다', alias_col, id_col;
end $$;

comment on view core.v_supplier_alias is
  '공급업체 표기 → 코드. 매핑이 없으면 0행이고, 그때는 표기를 그대로 씁니다';

-- ── 2-2. 실제 입고 ────────────────────────────────────────────
-- [DATA_PENDING: RECEIPT] 실데이터에 입고 실적이 없습니다. 파일이 오면 그 raw 표 위로 다시 씁니다 (sql/34 §8).
create or replace view core.v_goods_receipt as
select null::text as receipt_no, null::text as po_no, null::text as item_id,
       null::numeric as qty, null::date as receipt_date, null::text as warehouse
 where false;

comment on view core.v_goods_receipt is
  'renew.prd 13.2 — 실제 입고 실적. 가상 운영 결과의 "실제" 쪽 재고 추이가 이 값을 씁니다';

-- ── 2-3. 실제 발주 ────────────────────────────────────────────
-- [DATA_PENDING: PURCHASE_ORDER] 실데이터에 발주 실적이 없습니다 (sql/34 §8).
create or replace view core.v_purchase_order as
select null::text as po_no, null::date as order_date, null::text as supplier_id, null::text as item_id,
       null::numeric as qty, null::numeric as unit_price, null::date as due_date
 where false;

comment on view core.v_purchase_order is
  'renew.prd 13.2 — 실제 발주 실적. 과잉 발주 비교의 "실제" 쪽이 이 값을 씁니다';

-- ── 2-4. 전 기간 월별 사용 ────────────────────────────────────
--
-- ★ 이 뷰는 운영용입니다. 학습 격리(core.v_train_demand)와 무관하며,
--   검증 구간을 포함한 전 기간을 냅니다.
--   예측·백테스트 경로에서 이 뷰를 부르면 Data Leakage 입니다 (renew.prd 12.1).
--   여기서 쓰는 곳은 하나뿐입니다 — 검증 구간 시작 시점의 재고를 현재고에서 역산하는 것.
--
-- 반품(음수)은 sql/07 의 학습 뷰와 같은 규칙으로 제외합니다.
create or replace view core.v_usage_monthly as
select d.item_id,
       d.period,
       sum(d.qty) as quantity
  from core.v_demand_monthly d
 where d.qty > 0
 group by 1, 2;

comment on view core.v_usage_monthly is
  '★ 운영용 전 기간 월별 사용 실적. 학습 경로에서 부르면 Data Leakage 입니다 (renew.prd 12.1)';

-- ══ 3. 테이블 ══════════════════════════════════════════════════

create table if not exists core.simulation_run (
  simulation_id    text primary key,
  forecast_run_id  text references core.forecast_run(run_id) on delete cascade,
  backtest_run_id  text,
  sim_start        date,
  sim_end          date,
  status           text not null default 'RUNNING'
                     check (status in ('RUNNING', 'SUCCESS', 'FAILED')),
  n_items          int  not null default 0,
  -- 실행 시점의 정책값 스냅샷. 과거 정책 이력이 없으므로 "지금 값으로 돌렸다" 를 남깁니다.
  params           jsonb,
  kpis             jsonb,
  -- renew.prd 13.2 의 산출 문장. SQL 이 만들어 여기 저장합니다.
  sentence         text,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  duration_ms      int,
  triggered_by     uuid references auth.users(id) on delete set null,
  triggered_email  text,
  note             text,
  message          text
);

create index if not exists simulation_run_started_idx on core.simulation_run(started_at desc);

comment on table core.simulation_run is
  'renew.prd 13.2 — 가상 운영 결과 실행 이력. kpis 와 sentence 가 도입 판단의 근거입니다';

create table if not exists core.simulation_result (
  simulation_id      text not null references core.simulation_run(simulation_id) on delete cascade,
  item_id            text not null,
  period             date not null,
  -- ── 실제 쪽 ──
  actual_opening     numeric,
  actual_receipt     numeric,
  actual_demand      numeric,
  actual_closing     numeric,
  actual_stockout    boolean,
  -- 지시서 컬럼 목록에 더한 것 (더하기만 했습니다) — 과잉 발주와 발주 건수를 세려면 필요합니다.
  actual_order_qty   numeric,
  actual_order_count int,
  actual_excess      boolean,
  -- ── 시뮬레이션 쪽 ──
  sim_opening        numeric,
  sim_order_qty      numeric,
  sim_receipt        numeric,
  sim_demand         numeric,
  sim_closing        numeric,
  sim_stockout       boolean,
  sim_excess         boolean,
  sim_safety_stock   numeric,
  sim_forecast_window numeric,
  primary key (simulation_id, item_id, period)
);

create index if not exists simulation_result_item_idx
  on core.simulation_result(simulation_id, item_id);

comment on table core.simulation_result is
  '품목 × 기간의 실제/시뮬 재고 추이. 미충족 수요는 유실이며 이월하지 않습니다';

comment on column core.simulation_result.actual_excess is
  '발주 시점 재고 포지션 ÷ 월평균 수요 > EXCESS_STOCK_MONTHS. 정책값 EXCESS_STOCK_MONTHS 가 없으면 null 입니다';

-- ══ 4. 실행 함수 ★ ═════════════════════════════════════════════
--
-- 검증 구간 시작으로 돌아가, STEP 10 로직으로 매달 발주를 내고 재고를 전개합니다.
-- 실제 쪽은 같은 기간의 실제 입고·수요로 전개합니다. 수요는 양쪽이 같습니다 —
-- 비교하는 것은 예측 정확도가 아니라 "그 발주 판단이 나았는가" 이기 때문입니다.
--
-- 주의: 반환 컬럼 이름(simulation_id · n_items · message)이 두 테이블의 컬럼과 겹칩니다.
--       본문에서 테이블 컬럼을 참조할 때는 반드시 별칭을 붙이세요 (error.md #11).
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
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다';
  end if;

  select * into s from core.forecast_setting fs where fs.id = 1;
  if not found then
    return query select null::text, 0, '예측 설정이 없습니다. sql/06-core-extend.sql 을 실행하세요'::text;
    return;
  end if;

  -- 대상 예측 실행. 지정하지 않으면 가장 최근 성공한 실행입니다.
  -- 예측 시작이 train_end 다음 달이므로 검증 구간을 덮습니다.
  if p_forecast_run_id is null then
    select * into fr from core.forecast_run r
     where r.status = 'SUCCESS' order by r.started_at desc limit 1;
  else
    select * into fr from core.forecast_run r where r.run_id = p_forecast_run_id;
  end if;

  if not found then
    return query select null::text, 0, '시뮬레이션할 예측 실행이 없습니다'::text;
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

  -- ── 품목 루프 ───────────────────────────────────────────────
  --
  -- 대상은 "그 실행에 예측이 있는 활성 품목" 입니다.
  -- 예측이 없으면 시스템이 발주를 낼 수 없어, 비교가 시스템의 불리 쪽으로 기울지 않게
  -- 아예 제외합니다. 제외 건수는 kpis.skipped_items 로 밝힙니다 (design.md §8.2).
  -- ★ 검증 구간 실적을 한 번만 뽑아 둡니다 (error.md #35). 루프 안에서 품목 × 달마다
  --   v_test_actual 을 regexp 정규화하며 통째로 훑던 것이 품목 1만 개에서 300초를 넘겼습니다.
  drop table if exists _vo_actual;
  create temp table _vo_actual as
    select upper(regexp_replace(coalesce(a.item_id, ''), '[\s\-_]', '', 'g')) as item_id,
           a.period, sum(a.quantity) as q
      from core.v_test_actual a
     group by 1, 2;
  create index on _vo_actual (item_id, period);
  analyze _vo_actual;

  for it in
    with dm as (
      select mc.model_id from core.model_config mc where mc.is_default
       order by mc.model_id limit 1
    ),
    avail as materialized (
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
    ins as materialized (
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
        -- 검증 구간 실적. 백테스트 채점과 같은 뷰(sql/07)를 루프 앞에서 _vo_actual 로 떠 둔 것입니다.
        select sum(a.q) as q
          from _vo_actual a
         where a.item_id = it.item_id
           and a.period  = mon.period
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

  return query select v_sim_id, v_n_items, v_message;
exception
  when others then
    update core.simulation_run as r
       set status = 'FAILED', finished_at = clock_timestamp(), message = SQLERRM
     where r.simulation_id = v_sim_id;
    return query select v_sim_id, 0, ('시뮬레이션에 실패했습니다: ' || SQLERRM)::text;
end;
$$;

revoke all on function core.run_virtual_operation(text, text) from public, anon;
grant execute on function core.run_virtual_operation(text, text) to authenticated;

-- ══ 5. analytics 뷰 ════════════════════════════════════════════
--
-- 컬럼을 더하거나 순서를 바꾸면 create or replace 가 거부하므로 먼저 지웁니다 (공통규칙 15).
drop view if exists analytics.v_simulation_totals cascade;
drop view if exists analytics.v_simulation_series cascade;
drop view if exists analytics.v_simulation_item cascade;
drop view if exists analytics.v_simulation_run cascade;

-- 실행 목록. kpis 를 컬럼으로 펼칩니다 — 화면이 jsonb 를 파싱하지 않게 합니다.
create view analytics.v_simulation_run as
select r.simulation_id,
       r.forecast_run_id,
       r.backtest_run_id,
       r.sim_start,
       r.sim_end,
       r.status,
       r.n_items,
       (r.kpis->>'actual_stockout_months')::int     as actual_stockout_months,
       (r.kpis->>'sim_stockout_months')::int        as sim_stockout_months,
       (r.kpis->>'prevented')::int                  as prevented,
       (r.kpis->>'actual_avg_inventory')::numeric   as actual_avg_inventory,
       (r.kpis->>'sim_avg_inventory')::numeric      as sim_avg_inventory,
       (r.kpis->>'inventory_change_pct')::numeric   as inventory_change_pct,
       (r.kpis->>'actual_orders')::int              as actual_orders,
       (r.kpis->>'sim_orders')::int                 as sim_orders,
       (r.kpis->>'excess_orders_actual')::int       as excess_orders_actual,
       (r.kpis->>'excess_orders_sim')::int          as excess_orders_sim,
       (r.kpis->>'actual_turnover')::numeric        as actual_turnover,
       (r.kpis->>'sim_turnover')::numeric           as sim_turnover,
       (r.kpis->>'skipped_items')::int              as skipped_items,
       (r.kpis->>'opening_clamped_items')::int      as opening_clamped_items,
       (r.kpis->>'window_truncated')::int           as window_truncated,
       (r.kpis->>'pipeline_seed_rows')::int         as pipeline_seed_rows,
       (r.kpis->>'pipeline_seed_unmatched')::int    as pipeline_seed_unmatched,
       r.sentence,
       r.params,
       r.started_at,
       r.finished_at,
       r.duration_ms,
       r.triggered_email,
       r.note,
       r.message
  from core.simulation_run r;

comment on view analytics.v_simulation_run is
  'renew.prd 13.2 — 가상 운영 결과 실행 목록. sentence 가 화면의 주인공입니다';

-- 품목별 비교. 결품이 줄어든 품목과 늘어난 품목을 이 뷰로 찾습니다.
create view analytics.v_simulation_item as
select r.simulation_id,
       r.item_id,
       im.item_name,
       count(*) filter (where r.actual_stockout)      as actual_stockouts,
       count(*) filter (where r.sim_stockout)         as sim_stockouts,
       -- ★ 여기는 품목 하나당 평균입니다 (실행 KPI 의 평균 재고는 전 품목 합계 기준).
       round(avg(r.actual_closing), 1)                as actual_avg_inv,
       round(avg(r.sim_closing), 1)                   as sim_avg_inv,
       -- 양쪽 모두 "발주가 있었던 품목-월" 입니다. 실제 쪽 발주 라인 수는 따로 냅니다.
       count(*) filter (where r.actual_order_qty > 0) as actual_orders,
       count(*) filter (where r.sim_order_qty > 0)    as sim_orders,
       coalesce(sum(r.actual_order_count), 0)         as actual_order_lines,
       count(*) filter (where r.actual_excess)        as actual_excess_orders,
       count(*) filter (where r.sim_excess)           as sim_excess_orders,
       sum(r.actual_demand)                           as demand
  from core.simulation_result r
  left join core.v_item_master im on im.item_id = r.item_id
 group by r.simulation_id, r.item_id, im.item_name;

-- 한 품목의 기간별 추이. 차트가 이 뷰를 씁니다.
create view analytics.v_simulation_series as
select r.simulation_id,
       r.item_id,
       im.item_name,
       r.period,
       r.actual_closing,
       r.sim_closing,
       r.actual_receipt,
       r.sim_receipt,
       r.actual_demand                                as demand,
       r.actual_stockout,
       r.sim_stockout,
       r.sim_order_qty,
       r.sim_safety_stock,
       r.sim_forecast_window
  from core.simulation_result r
  left join core.v_item_master im on im.item_id = r.item_id;

-- 전 품목 합. 화면 상단의 비교 차트가 이 뷰를 씁니다.
create view analytics.v_simulation_totals as
select r.simulation_id,
       r.period,
       sum(r.actual_closing)                     as actual_total_inventory,
       sum(r.sim_closing)                        as sim_total_inventory,
       count(*) filter (where r.actual_stockout) as actual_stockout_items,
       count(*) filter (where r.sim_stockout)    as sim_stockout_items,
       sum(r.actual_demand)                      as demand
  from core.simulation_result r
 group by r.simulation_id, r.period;

-- ══ 6. 권한 ════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array['simulation_run','simulation_result'] loop
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

grant select on core.v_supplier_alias  to authenticated;
grant select on core.v_goods_receipt   to authenticated;
grant select on core.v_purchase_order  to authenticated;
grant select on core.v_usage_monthly   to authenticated;

grant select on analytics.v_simulation_run    to authenticated;
grant select on analytics.v_simulation_item   to authenticated;
grant select on analytics.v_simulation_series to authenticated;
grant select on analytics.v_simulation_totals to authenticated;

-- ══ 7. 확인 ════════════════════════════════════════════════════
--
-- 실행해 보려면 (관리자로 로그인한 세션에서):
--   select * from core.run_virtual_operation();

-- 정규화가 됐는지 먼저 봅니다.
-- 행이 0 이면 raw 의 한글 컬럼 이름이 다른 것이고, with_qty · first_date 가 비면
-- 수량·날짜 표기가 core.num_safe · core.date_safe 가 아는 모양이 아닙니다.
select 'goods_receipt'  as t, count(*) as rows, count(item_id) as with_item,
       count(qty) as with_qty, min(receipt_date) as first_date, max(receipt_date) as last_date
  from core.v_goods_receipt
union all
select 'purchase_order', count(*), count(item_id), count(qty),
       min(order_date), max(order_date)
  from core.v_purchase_order;

select count(*) as usage_months, min(period) as first_period, max(period) as last_period
  from core.v_usage_monthly;

-- 실행 결과
-- actual_avg_inventory · sim_avg_inventory · 회전율은 전 품목 합계 기준입니다
-- (v_simulation_totals 의 total_inventory 와 같은 단위).
select simulation_id, status, n_items, sim_start, sim_end,
       actual_stockout_months, sim_stockout_months, prevented,
       actual_avg_inventory, sim_avg_inventory, inventory_change_pct,
       actual_orders, sim_orders,
       actual_turnover, sim_turnover, skipped_items, opening_clamped_items,
       window_truncated, pipeline_seed_rows, pipeline_seed_unmatched
  from analytics.v_simulation_run
 order by started_at desc
 limit 10;

select sentence from analytics.v_simulation_run order by started_at desc limit 1;

-- 한 품목을 손으로 검산해 보세요 (기초 + 입고 − 수요 = 기말. 음수면 결품이고 기말은 0 입니다).
select item_id, period, actual_closing, sim_closing, demand, sim_order_qty, sim_safety_stock
  from analytics.v_simulation_series
 where simulation_id = (select r.simulation_id from analytics.v_simulation_run r
                         order by r.started_at desc limit 1)
 order by item_id, period
 limit 50;

select * from analytics.v_simulation_totals
 where simulation_id = (select r.simulation_id from analytics.v_simulation_run r
                         order by r.started_at desc limit 1)
 order by period;
