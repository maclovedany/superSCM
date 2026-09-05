-- ──────────────────────────────────────────────────────────────
-- ★ core.run_baseline_forecast() 의 최종 정의는 sql/27-admin-ops.sql 입니다 (실행 모드 p_mode 추가).
--   이 파일을 다시 실행했다면 sql/27 도 이어서 실행하세요. 그러지 않으면 인자 1개짜리 옛 함수가
--   되살아나 인자 하나로 부를 때 "function is not unique" 가 납니다.
--
-- ★ STEP 20 이 이 파일에 더한 것 둘 (뒤 번호 파일이 쓸 수 있도록 여기서 만듭니다)
--   · core.forecast_run.mode      검증/운영 실행 구분. sql/21 이 이 컬럼으로 실행을 고릅니다
--   · core.v_data_loaded_at       "데이터가 마지막으로 들어온 시각" 한 곳. stale 판정의 기준입니다
-- STEP 6 · Forecast Engine — Baseline (SQL)
--
-- renew.prd 11장 · 12장
--   "Baseline 을 SQL 로 먼저 완성한다. 백테스트 파이프라인이 돌아가는 상태를
--    만들어두면 Python 서비스 구축이 지연되어도 Phase 2 가 막히지 않는다."
--
-- 여기서 만드는 것
--   core  model_config      모델 레지스트리 (on/off · 파라미터 · 적용 수요유형)
--   core  model_version     실행 시점의 모델 정의 스냅샷 (재현성)
--   core  forecast_run      실행 이력
--   core  forecast_result   run_id · model_id · item_id · period 별 예측
--   core  run_baseline_forecast()  실행 함수
--   analytics  v_forecast_run · v_forecast_result · v_forecast_run_kpi · v_model_config
--
-- ★ 학습 구간만 씁니다. core.v_train_demand 외에는 읽지 않습니다.
--
-- sql/10-demand-profile.sql 까지 먼저 실행하세요.
-- ──────────────────────────────────────────────────────────────

-- ══ 1. 모델 레지스트리 ═════════════════════════════════════════
--
-- renew.prd 11.3 — 모델을 코드 수정 없이 켜고 끕니다.
-- applicable_demand_type 으로 간헐수요 전용 모델을 자동 필터링합니다.

create table if not exists core.model_config (
  model_id               text primary key,
  model_name             text not null,
  family                 text not null,   -- BASELINE · TIMESERIES · INTERMITTENT · ML
  engine                 text not null,   -- SQL · PYTHON
  version                text not null default 'v1',
  enabled                boolean not null default true,
  is_default             boolean not null default false,
  -- null 이면 모든 수요 유형에 적용합니다 (renew.prd 11.3)
  applicable_demand_type text[],
  parameters             jsonb not null default '{}'::jsonb,
  description            text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users(id) on delete set null
);

comment on table core.model_config is
  'renew.prd 11.3 — 모델 레지스트리. 새 모델은 여기 한 줄을 더하면 파이프라인에 편입됩니다';

drop trigger if exists model_config_touch on core.model_config;
create trigger model_config_touch
  before update on core.model_config
  for each row execute function core.touch_updated_at();

-- Baseline 5종 (renew.prd 11.1)
insert into core.model_config
  (model_id, model_name, family, engine, applicable_demand_type, parameters, description, is_default)
values
  ('MA_3M', '이동평균 3개월', 'BASELINE', 'SQL',
   array['SMOOTH','ERRATIC'], '{"window": 3}'::jsonb,
   '최근 3개월 평균을 그대로 미래에 적용합니다. 가장 단순한 기준선입니다', true),

  ('MA_6M', '이동평균 6개월', 'BASELINE', 'SQL',
   array['SMOOTH','ERRATIC'], '{"window": 6}'::jsonb,
   '최근 6개월 평균. 3개월보다 둔하지만 변동에 덜 흔들립니다', false),

  ('WMA_3M', '가중이동평균 3개월', 'BASELINE', 'SQL',
   array['SMOOTH','ERRATIC'], '{"weights": [3, 2, 1]}'::jsonb,
   '최근 달에 더 큰 가중치를 줍니다. 기본 가중치는 3:2:1 입니다', false),

  ('PY_SAME_MONTH', '전년 동월', 'BASELINE', 'SQL',
   array['SMOOTH'], '{"lag_months": 12}'::jsonb,
   '작년 같은 달 실적을 그대로 씁니다. 12개월 이상 학습 데이터가 있어야 합니다', false),

  ('SEASONAL_NAIVE', '계절 나이브', 'BASELINE', 'SQL',
   array['SMOOTH'], '{"season_length": 12}'::jsonb,
   '한 계절 주기 전 실적을 씁니다. 주기는 파라미터로 바꿉니다', false)
on conflict (model_id) do nothing;

-- ══ 2. 모델 버전 스냅샷 ════════════════════════════════════════
--
-- renew.prd 12.2 — "같은 스냅샷과 같은 버전으로 재실행하면 동일한 결과가 나와야 한다."
-- 실행할 때마다 그 시점의 모델 정의를 통째로 남깁니다.

create table if not exists core.model_version (
  id         bigserial primary key,
  model_id   text not null references core.model_config(model_id) on delete cascade,
  version    text not null,
  definition jsonb not null,
  created_at timestamptz not null default now(),
  unique (model_id, version, definition)
);

-- ══ 3. 실행 이력 ═══════════════════════════════════════════════

create table if not exists core.forecast_run (
  run_id           text primary key,
  status           text not null default 'RUNNING'
                     check (status in ('RUNNING', 'SUCCESS', 'FAILED')),
  granularity      text not null,
  train_start      date not null,
  train_end        date not null,
  horizon          int  not null,
  champion_metric  text,
  -- 이 시각 이후로 데이터가 바뀌면 예측이 stale 합니다 (renew.prd 8.6)
  data_snapshot_at timestamptz,
  models           jsonb,          -- 이번 실행에 쓴 모델과 버전
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

create index if not exists forecast_run_started_idx on core.forecast_run(started_at desc);

-- ── 실행 모드 (STEP 20) ────────────────────────────────────────
--
-- VALIDATION  train_end 까지 학습 → 검증 구간을 예측합니다. 백테스트가 채점합니다
-- PRODUCTION  forecast_setting.production_train_end 까지 학습 → 오늘 이후를 예측합니다.
--             재고 전개 · 발주 추천 · 대시보드가 쓰는 실행입니다
--
-- ★ 컬럼을 여기(테이블을 만드는 파일)에 두는 이유
--   sql/21-dashboard.sql 이 "화면이 쓰는 실행" 을 고를 때 이 컬럼을 봅니다. sql/21 은
--   sql/27 보다 먼저 실행되므로, 컬럼이 sql/27 에만 있으면 새로 까는 DB 가 sql/21 에서
--   막힙니다. 모드를 **쓰는** 함수(run_baseline_forecast)의 최종 정의는 그대로 sql/27 입니다.
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

-- ── 데이터가 마지막으로 들어온 시각 ★ (STEP 20) ───────────────
--
-- stale 판정의 기준을 한 곳에 둡니다. 두 곳에서 따로 세면 배너와 숫자가 어긋납니다.
--
-- ★ raw.usage_history.loaded_at 만 보면 **수요 데이터만** 감시하게 됩니다.
--   core.import_commit 은 배치가 지목한 raw 테이블 어디에나 씁니다(재고 · 발주 · 입고 ·
--   품목 · 공급처 · 이벤트 · 수주). 그래서 적재 배치의 확정 시각도 함께 봅니다 —
--   적재는 전부 core.upload_batch 를 지나가므로, 대상 테이블마다 컬럼을 확인하지 않아도
--   한 줄로 덮입니다. 대량 적재 알림(core.notify_bulk_change)도 같은 표를 보므로
--   두 신호가 어긋날 수 없습니다.
--
--   greatest() 는 null 을 무시합니다. 둘 다 비어 있으면 결과도 null 입니다.
-- ★ 실데이터 전환(sql/34) — 수요 원본의 적재 시각은 core.realdata_load 가 기록합니다.
create or replace view core.v_data_loaded_at as
select greatest(
         (select max(l.loaded_at)   from core.realdata_load l),
         (select max(b.imported_at) from core.upload_batch b where b.status = 'IMPORTED')
       ) as data_loaded_at;

comment on view core.v_data_loaded_at is
  'renew.prd 8.6 — 원본 데이터가 마지막으로 바뀐 시각. 항상 1행. stale 판정이 전부 이 값을 봅니다';

grant select on core.v_data_loaded_at to authenticated;

-- ══ 4. 예측 결과 ═══════════════════════════════════════════════
--
-- renew.prd 12.2 · 16.5 — 조건 조합마다 모델을 재실행하지 않습니다.
-- 미리 저장해 두고 화면은 조회만 합니다.

create table if not exists core.forecast_result (
  run_id        text not null references core.forecast_run(run_id) on delete cascade,
  model_id      text not null,
  model_version text not null,
  item_id       text not null,
  period        date not null,
  predicted_qty numeric,
  p50           numeric,
  p80           numeric,
  p90           numeric,
  -- 예측 오차의 표준편차. STEP 10 의 안전재고가 이 값을 씁니다 (renew.prd 21.1)
  sigma         numeric,
  -- 왜 이 값이 나왔는지 (renew.prd 15장 설명용)
  basis         jsonb,
  primary key (run_id, model_id, item_id, period)
);

create index if not exists forecast_result_lookup_idx
  on core.forecast_result(item_id, model_id, period);

-- ══ 5. In-sample 적합값 ════════════════════════════════════════
--
-- 예측 구간(P80·P90)을 만들려면 이 모델이 과거에 얼마나 빗나갔는지 알아야 합니다.
-- 학습 구간에서 각 모델의 적합값을 계산하고 잔차를 남깁니다.

create or replace view core.v_baseline_fit as
with g as (
  select item_id, period, quantity, period_index
    from core.v_demand_grid
),
lagged as (
  select
    g.*,
    lag(quantity, 1)  over w as l1,
    lag(quantity, 2)  over w as l2,
    lag(quantity, 3)  over w as l3,
    lag(quantity, 6)  over w as l6,
    lag(quantity, 12) over w as l12,
    avg(quantity) over (partition by item_id order by period
                        rows between 3 preceding and 1 preceding) as ma3,
    avg(quantity) over (partition by item_id order by period
                        rows between 6 preceding and 1 preceding) as ma6
  from g
  window w as (partition by item_id order by period)
)
select item_id, period, quantity,
       ma3                                        as fit_ma_3m,
       ma6                                        as fit_ma_6m,
       case when l1 is not null and l2 is not null and l3 is not null
            then (3 * l1 + 2 * l2 + 1 * l3) / 6.0 end as fit_wma_3m,
       l12                                        as fit_py_same_month,
       l12                                        as fit_seasonal_naive
  from lagged;

comment on view core.v_baseline_fit is
  '학습 구간에서 각 Baseline 모델의 적합값. 잔차로 예측구간을 만듭니다';

-- ══ 6. 실행 함수 ★ ═════════════════════════════════════════════
--
-- 켜져 있는 Baseline 모델을 전부 돌려 horizon 개월치를 예측합니다.
-- 예측 시작점은 train_end 다음 기간입니다. 검증 구간과 겹치므로
-- STEP 7 의 백테스트가 이 결과를 그대로 채점할 수 있습니다.

-- 주의: 반환 컬럼 이름(run_id · n_models · n_items · n_rows · message)이
--       core.forecast_run / core.forecast_result 의 컬럼 이름과 겹칩니다.
--       함수 본문에서 테이블 컬럼을 참조할 때는 반드시 별칭을 붙이세요.
create or replace function core.run_baseline_forecast(p_note text default null)
returns table (run_id text, n_models int, n_items int, n_rows int, message text)
language plpgsql
security definer
set search_path = core, public
as $$
declare
  s          core.forecast_setting%rowtype;
  v_run_id   text;
  v_started  timestamptz := clock_timestamp();
  v_snapshot timestamptz;
  v_models   jsonb;
  v_n_models int;
  v_n_items  int;
  v_n_rows   int;
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다';
  end if;

  select * into s from core.forecast_setting where id = 1;
  if not found then
    return query select null::text, 0, 0, 0, '예측 설정이 없습니다. sql/06-core-extend.sql 을 실행하세요'::text;
    return;
  end if;

  select count(*) into v_n_models
    from core.model_config where enabled and engine = 'SQL';
  if v_n_models = 0 then
    return query select null::text, 0, 0, 0, '켜져 있는 SQL 모델이 없습니다'::text;
    return;
  end if;

  -- 데이터 기준 시각. 이후 데이터가 바뀌면 이 예측은 stale 합니다.
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
    (run_id, status, granularity, train_start, train_end, horizon, champion_metric,
     data_snapshot_at, models, n_models, triggered_by, triggered_email, note)
  select v_run_id, 'RUNNING', s.granularity, s.train_start, s.train_end,
         s.forecast_horizon, s.champion_metric, v_snapshot, v_models, v_n_models,
         auth.uid(), (select email from core.app_user where user_id = auth.uid()), p_note;

  -- ── 예측 ────────────────────────────────────────────────────
  --
  -- Baseline 은 미래 전 구간에 같은 값을 냅니다(평평한 예측).
  -- 전년동월·계절나이브만 기간마다 다른 값을 씁니다.
  -- 학습 데이터가 모자라 값을 낼 수 없으면 **행을 만들지 않습니다.**
  -- 0 이나 임의 값으로 채우지 않습니다 (AGENTS.md 규칙 5).

  with horizon_periods as (
    select h,
           (date_trunc('month', s.train_end) + (h || ' month')::interval)::date as period
      from generate_series(1, s.forecast_horizon) as h
  ),
  -- 학습 구간 마지막 값들
  tail as (
    select item_id,
           avg(quantity) filter (where rn <= 3) as last3,
           avg(quantity) filter (where rn <= 6) as last6,
           max(quantity) filter (where rn = 1)  as l1,
           max(quantity) filter (where rn = 2)  as l2,
           max(quantity) filter (where rn = 3)  as l3
      from (select item_id, quantity,
                   row_number() over (partition by item_id order by period desc) as rn
              from core.v_demand_grid) t
     group by item_id
  ),
  -- 모델별 잔차 표준편차
  resid as (
    select item_id,
           stddev_samp(quantity - fit_ma_3m)          as sd_ma_3m,
           stddev_samp(quantity - fit_ma_6m)          as sd_ma_6m,
           stddev_samp(quantity - fit_wma_3m)         as sd_wma_3m,
           stddev_samp(quantity - fit_py_same_month)  as sd_py,
           stddev_samp(quantity - fit_seasonal_naive) as sd_sn
      from core.v_baseline_fit
     group by item_id
  ),
  -- 전년 동월 실적 (없으면 null → 행을 만들지 않습니다)
  py as (
    select g.item_id, hp.period,
           (select d.quantity from core.v_demand_grid d
             where d.item_id = g.item_id
               and d.period = (hp.period - interval '12 months')::date) as py_qty
      from (select distinct item_id from core.v_demand_grid) g
      cross join horizon_periods hp
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
    null::jsonb  -- basis 는 행마다 쓰지 않습니다 (error.md #35)
  from points p
  where p.qty is not null;      -- ★ 값을 못 내면 행을 만들지 않습니다

  get diagnostics v_n_rows = row_count;

  -- ★ run_id 는 이 함수의 반환 컬럼 이름이기도 합니다.
  --   한정하지 않으면 "column reference run_id is ambiguous" 가 납니다.
  --   함수 안에서 테이블 컬럼을 쓸 때는 항상 별칭을 붙입니다.
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

  return query select v_run_id, v_n_models, v_n_items, v_n_rows,
                      (v_n_rows || '행을 생성했습니다')::text;
exception
  when others then
    update core.forecast_run as r
       set status = 'FAILED', finished_at = clock_timestamp(), message = SQLERRM
     where r.run_id = v_run_id;
    return query select v_run_id, 0, 0, 0, ('실행에 실패했습니다: ' || SQLERRM)::text;
end;
$$;

revoke all on function core.run_baseline_forecast(text) from public, anon;
grant execute on function core.run_baseline_forecast(text) to authenticated;

-- ══ 7. analytics 뷰 ════════════════════════════════════════════

create or replace view analytics.v_model_config as
select m.model_id, m.model_name, m.family, m.engine, m.version, m.enabled, m.is_default,
       m.applicable_demand_type, m.parameters, m.description, m.updated_at,
       (select count(*) from core.model_version v where v.model_id = m.model_id) as version_count
  from core.model_config m;

-- ★ `create or replace view` 가 아니라 drop 후 create 입니다.
--
--   이 뷰는 `select r.*` 로 만들고, `*` 는 **뷰를 만드는 시점에** 컬럼 목록으로
--   펼쳐져 고정됩니다. 그래서 위에서 `core.forecast_run` 에 `mode` 를 add column
--   해도, 이미 존재하는 뷰에 `create or replace` 를 걸면 새 컬럼이 `result_rows`
--   **앞**에 끼어들려 하고 PostgreSQL 이 거부합니다:
--     오류: 뷰에서 "result_rows" 칼럼 이름을 "mode"(으)로 바꿀 수 없음
--   (create or replace view 는 맨 뒤에 덧붙이는 것만 허용합니다.)
--
--   그 상태로 넘어가면 뷰에 `mode` 가 없는 채로 남고, sql/21 이 `fr.mode` 를 읽을 때
--   PostgreSQL 이 이를 컬럼이 아니라 **함수 호출 `mode(fr)`** 로 해석해
--   "WITHIN GROUP is required for ordered-set aggregate mode" 로 실패합니다.
--   컬럼이 없다는 말 대신 엉뚱한 오류가 나와 원인이 가려집니다 (error.md #27).
--
--   cascade 가 뒤 파일(12 · 16 · 19 · 21 · 26 · 27)의 뷰를 함께 지웁니다.
--   sql/README.md 의 규칙 그대로 — **이 파일을 다시 실행했으면 뒤 파일을 순서대로
--   다시 실행하세요.**
drop view if exists analytics.v_forecast_run cascade;

create view analytics.v_forecast_run as
select r.*,
       (select count(*) from core.forecast_result f where f.run_id = r.run_id) as result_rows,
       -- 실행 이후 데이터가 바뀌었으면 이 예측은 stale 합니다 (renew.prd 8.6)
       (r.data_snapshot_at is not null
        and r.data_snapshot_at < (select d.data_loaded_at from core.v_data_loaded_at d)) as is_stale
  from core.forecast_run r;

create or replace view analytics.v_forecast_result as
select f.run_id, f.model_id, m.model_name, f.model_version, f.item_id,
       im.item_name, f.period, f.predicted_qty, f.p50, f.p80, f.p90, f.sigma
  from core.forecast_result f
  left join core.model_config m using (model_id)
  left join core.v_item_master im using (item_id);

create or replace view analytics.v_forecast_run_kpi as
select
  (select count(*) from core.forecast_run)                            as n_runs,
  (select count(*) from core.forecast_run where status = 'SUCCESS')   as n_success,
  (select count(*) from core.forecast_run where status = 'FAILED')    as n_failed,
  (select count(*) from core.model_config where enabled)              as n_enabled_models,
  (select count(*) from core.model_config)                            as n_models,
  (select max(started_at) from core.forecast_run)                     as last_run_at,
  (select count(*) from analytics.v_forecast_run where is_stale and status = 'SUCCESS') as n_stale;

-- ══ 8. 권한 ════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array['model_config','model_version','forecast_run','forecast_result'] loop
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

grant usage, select on sequence core.model_version_id_seq to authenticated;
grant select on analytics.v_model_config      to authenticated;
grant select on analytics.v_forecast_run      to authenticated;
grant select on analytics.v_forecast_result   to authenticated;
grant select on analytics.v_forecast_run_kpi  to authenticated;

-- ══ 9. 확인 ════════════════════════════════════════════════════

select model_id, model_name, family, enabled, applicable_demand_type, parameters
  from core.model_config order by model_id;

-- 실행해 보려면 (관리자로 로그인한 세션에서):
--   select * from core.run_baseline_forecast('첫 실행');
