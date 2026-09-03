-- ──────────────────────────────────────────────────────────────
-- STEP 3 · 데이터 모델 확장 (2/2) — 검증 구간 격리 ★
--
-- renew.prd 7.9 · 12.1
--   "검증 구간 실적은 별도 영역에 격리한다.
--    예측 모듈이 학습 시점에 참조할 수 없어야 한다. Data Leakage 방지가 필수다."
--
-- 방법: 학습 경로가 raw.usage_history 를 직접 읽지 못하게 하고,
--       반드시 core.v_train_demand 를 거치게 합니다.
--       이 뷰는 core.forecast_setting.train_end 이후 행을 물리적으로 내보내지 않습니다.
--
-- sql/06-core-extend.sql 을 먼저 실행하세요.
-- ──────────────────────────────────────────────────────────────

-- ══ 1. 학습용 수요 ═════════════════════════════════════════════
--
-- ★ 이 뷰가 격리 지점입니다.
--   예측·백테스트 코드는 이 뷰만 조회합니다.
--   raw.usage_history 를 직접 읽는 코드는 리뷰에서 반려합니다.

create or replace view core.v_train_demand as
select
  u.item_id,
  case s.granularity
    when 'WEEK' then date_trunc('week',  u.use_date)::date
    else             date_trunc('month', u.use_date)::date
  end                as period,
  sum(u.qty)         as quantity,
  count(*)           as tx_count,
  min(u.use_date)    as first_use_date,
  max(u.use_date)    as last_use_date
from raw.usage_history u
cross join core.forecast_setting s
where s.id = 1
  and u.use_date >= s.train_start
  and u.use_date <= s.train_end          -- ★ 경계. 이 뒤 데이터는 나가지 않습니다
  and u.qty > 0                          -- 반품(음수)은 학습에서 제외 (core.outlier_rule RETURN)
  and not exists (
        select 1 from core.outlier_exclusion e
         where e.item_id = u.item_id and e.use_date = u.use_date
      )
group by 1, 2;

comment on view core.v_train_demand is
  '★ 학습 전용. forecast_setting.train_end 이후 행을 내보내지 않습니다 (renew.prd 7.9)';

-- ══ 2. 검증용 실적 ═════════════════════════════════════════════
--
-- 백테스트가 "정답"과 맞춰볼 때만 씁니다.
-- 이름을 다르게 둔 이유는, 학습 코드가 실수로 이 뷰를 부르면
-- 코드 리뷰에서 바로 눈에 띄게 하기 위해서입니다.

create or replace view core.v_test_actual as
select
  u.item_id,
  case s.granularity
    when 'WEEK' then date_trunc('week',  u.use_date)::date
    else             date_trunc('month', u.use_date)::date
  end        as period,
  sum(u.qty) as quantity,
  count(*)   as tx_count
from raw.usage_history u
cross join core.forecast_setting s
where s.id = 1
  and u.use_date >= s.test_start
  and u.use_date <= s.test_end
  and u.qty > 0
group by 1, 2;

comment on view core.v_test_actual is
  '백테스트 정답지. 학습 경로에서 부르면 Data Leakage 입니다 (renew.prd 12.1)';

-- ══ 3. 데이터 커버리지 ═════════════════════════════════════════
--
-- renew.prd 8.6 · 31.5 — 데이터가 언제까지 있는지 화면에서 보여야 합니다.
-- 설정한 경계가 실제 데이터와 어긋나면 여기서 드러납니다.

-- 개월 수 헬퍼. 뷰보다 먼저 만들어야 합니다.
create or replace function core.months_between_safe(a date, b date)
returns numeric language sql immutable as $$
  select (extract(year from age(b, a)) * 12 + extract(month from age(b, a)))::numeric
       + extract(day from age(b, a)) / 30.0;
$$;

create or replace view analytics.v_data_coverage as
with s as (select * from core.forecast_setting where id = 1),
     u as (
       select min(use_date) as min_date, max(use_date) as max_date, count(*) as row_count
         from raw.usage_history
     ),
     tr as (select count(*) as periods, sum(quantity) as qty from core.v_train_demand),
     te as (select count(*) as periods, sum(quantity) as qty from core.v_test_actual)
select
  u.min_date    as data_start,
  u.max_date    as data_end,
  u.row_count   as usage_rows,
  s.granularity,
  s.train_start, s.train_end,
  s.test_start,  s.test_end,
  tr.periods    as train_periods,
  tr.qty        as train_qty,
  te.periods    as test_periods,
  te.qty        as test_qty,
  -- 경계가 실제 데이터 안에 들어와 있는가. false 면 설정이 데이터와 어긋난 것입니다.
  (s.train_end >= u.min_date and s.train_start <= u.max_date) as train_window_ok,
  (s.test_start <= u.max_date and s.test_end >= u.min_date)   as test_window_ok,
  round(core.months_between_safe(u.min_date, u.max_date), 1)  as data_months
from s, u, tr, te;

comment on view analytics.v_data_coverage is
  'renew.prd 8.6 — 데이터 범위와 학습/검증 경계. 경계가 어긋나면 *_window_ok 가 false 입니다';

-- ══ 4. 권한 ════════════════════════════════════════════════════
--
-- 학습 뷰는 로그인한 사용자만 봅니다. anon 에는 열지 않습니다.

grant select on core.v_train_demand to authenticated;
grant select on core.v_test_actual  to authenticated;
grant select on analytics.v_data_coverage to anon, authenticated;

-- ══ 5. 격리 검증 ★ ═════════════════════════════════════════════
--
-- 아래 세 줄이 모두 통과해야 STEP 3 이 끝납니다.

-- (1) 학습 뷰에 검증 구간 행이 한 건이라도 있으면 실패
select case
         when count(*) = 0 then '통과 — 학습 뷰에 검증 구간 데이터가 없습니다'
         else '실패 — 검증 구간 데이터 ' || count(*) || '건이 학습 뷰에 들어 있습니다'
       end as 격리_검증
  from core.v_train_demand t, core.forecast_setting s
 where s.id = 1 and t.period > s.train_end;

-- (2) 학습 구간과 검증 구간이 겹치지 않아야 합니다
select case
         when count(*) = 0 then '통과 — 학습/검증 구간이 겹치지 않습니다'
         else '실패 — ' || count(*) || '개 기간이 양쪽에 있습니다'
       end as 구간_중복
  from core.v_train_demand t
  join core.v_test_actual  v using (item_id, period);

-- (3) 데이터 커버리지
select * from analytics.v_data_coverage;
