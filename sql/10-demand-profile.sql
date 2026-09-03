-- ──────────────────────────────────────────────────────────────
-- STEP 5 · 수요 패턴 분석 (SKU Demand Profile)
--
-- renew.prd 10장
--   "이 분류가 모델 선택과 안전재고 정책의 입력이 된다.
--    특히 간헐수요 품목은 Croston 계열이 아니면 예측이 무의미하다."
--
-- ★ 학습 구간 데이터만 씁니다.
--   이 프로파일이 모델 선택을 좌우하므로, 검증 구간 통계를 보면
--   그것 자체가 Data Leakage 입니다 (renew.prd 7.9).
--   그래서 raw 가 아니라 core.v_train_demand 를 읽습니다.
--
-- sql/07-train-isolation.sql 을 먼저 실행하세요.
-- ──────────────────────────────────────────────────────────────

-- ══ 1. 품목 × 기간 격자 ════════════════════════════════════════
--
-- v_train_demand 에는 "수요가 있었던 기간" 만 있습니다.
-- 간헐수요를 판정하려면 수요가 0 이었던 기간도 필요하므로 격자를 만듭니다.

create or replace view core.v_demand_grid as
with s as (select * from core.forecast_setting where id = 1),
periods as (
  select generate_series(
           date_trunc('month', s.train_start),
           date_trunc('month', s.train_end),
           interval '1 month'
         )::date as period
    from s
),
items as (select distinct item_id from core.v_train_demand)
select
  i.item_id,
  p.period,
  coalesce(d.quantity, 0)          as quantity,
  (d.quantity is not null)         as has_demand,
  row_number() over (partition by i.item_id order by p.period) as period_index
from items i
cross join periods p
left join core.v_train_demand d
       on d.item_id = i.item_id and d.period = p.period;

comment on view core.v_demand_grid is
  '학습 구간의 품목 × 기간 격자. 수요가 0 인 기간을 포함합니다';

-- ══ 2. 수요 프로파일 ═══════════════════════════════════════════
--
-- 분류 기준은 Syntetos · Boylan · Croston (2005) 을 씁니다.
--
--   ADI  평균 수요 발생 간격 = 전체 기간 수 / 수요가 있었던 기간 수
--   CV²  수요가 있었던 기간 수량의 변동계수 제곱
--
--        ADI < 1.32          ADI >= 1.32
--   CV² < 0.49   평활(SMOOTH)      간헐(INTERMITTENT)
--   CV² >= 0.49  불규칙(ERRATIC)    덩어리(LUMPY)
--
-- 간헐·덩어리는 일반 시계열 모델이 무너지는 구간입니다.
-- STEP 6 에서 model_config.applicable_demand_type 이 이 값으로 모델을 거릅니다.

create or replace view analytics.v_sku_demand_profile as
with base as (
  select
    g.item_id,
    count(*)                                        as n_periods,
    count(*) filter (where g.has_demand)            as n_active_periods,
    count(*) filter (where not g.has_demand)        as n_zero_periods,
    avg(g.quantity)                                 as mean_qty,
    stddev_samp(g.quantity)                         as sd_qty,
    sum(g.quantity)                                 as total_qty,
    -- 수요가 있었던 기간만 본 변동 (SBC 의 CV²)
    avg(g.quantity) filter (where g.has_demand)     as mean_nonzero,
    stddev_samp(g.quantity) filter (where g.has_demand) as sd_nonzero,
    -- 추세 — 기간 순번에 대한 회귀 기울기 (기간당 수량 변화)
    regr_slope(g.quantity::double precision, g.period_index::double precision) as slope,
    max(g.period)                                   as last_period,
    min(g.period)                                   as first_period
  from core.v_demand_grid g
  group by g.item_id
),
recent as (
  -- 최근 3기간 대비 그 앞 3기간 증감률
  select
    item_id,
    avg(quantity) filter (where rn <= 3)             as last3,
    avg(quantity) filter (where rn between 4 and 6)  as prev3
  from (
    select item_id, quantity,
           row_number() over (partition by item_id order by period desc) as rn
      from core.v_demand_grid
  ) t
  group by item_id
),
peak as (
  -- 가장 많이 나간 달. 계절성 판정과는 별개로 참고용입니다.
  select distinct on (item_id)
         item_id,
         extract(month from period)::int as peak_month,
         quantity                        as peak_qty
    from core.v_demand_grid
   order by item_id, quantity desc, period
),
calc as (
  select
    b.*,
    r.last3, r.prev3,
    p.peak_month, p.peak_qty,
    -- ADI
    case when b.n_active_periods = 0 then null
         else b.n_periods::numeric / b.n_active_periods end as adi,
    -- CV (전체 기간 기준) 과 CV² (수요 발생 기간 기준)
    case when coalesce(b.mean_qty, 0) = 0 then null
         else b.sd_qty / b.mean_qty end                     as cv,
    case when coalesce(b.mean_nonzero, 0) = 0 or b.sd_nonzero is null then null
         else power(b.sd_nonzero / b.mean_nonzero, 2) end   as cv2
  from base b
  left join recent r using (item_id)
  left join peak   p using (item_id)
)
select
  c.item_id,
  im.item_name,
  im.supplier_id,

  -- 기간
  c.first_period,
  c.last_period,
  c.n_periods,
  c.n_active_periods,
  c.n_zero_periods,

  -- 수량
  round(c.total_qty, 0)                        as total_qty,
  round(c.mean_qty, 2)                         as mean_qty,
  round(c.sd_qty, 2)                           as sd_qty,

  -- 변동
  round(c.cv, 3)                               as cv,
  round(c.cv2, 3)                              as cv_squared,
  round(c.adi, 2)                              as adi,
  round(c.n_zero_periods::numeric / nullif(c.n_periods, 0), 3) as zero_demand_rate,

  -- 추세 — 기간당 몇 % 변하는가
  -- regr_slope 는 double precision 을 돌려줍니다.
  -- PostgreSQL 에 round(double precision, int) 은 없으므로 numeric 으로 캐스팅합니다.
  case when coalesce(c.mean_qty, 0) = 0 then null
       else round((c.slope / c.mean_qty * 100)::numeric, 2) end as trend_pct_per_period,

  -- 최근 증감률
  case when coalesce(c.prev3, 0) = 0 then null
       else round((c.last3 - c.prev3) / c.prev3 * 100, 1) end as recent_change_pct,

  c.peak_month,
  round(c.peak_qty, 0)                         as peak_qty,

  -- ★ 분류 (Syntetos · Boylan · Croston 2005)
  case
    when c.n_active_periods = 0             then 'NO_DEMAND'
    when c.n_periods < 6                    then null     -- 판정 불가
    when c.adi is null or c.cv2 is null     then null
    when c.adi <  1.32 and c.cv2 <  0.49    then 'SMOOTH'
    when c.adi >= 1.32 and c.cv2 <  0.49    then 'INTERMITTENT'
    when c.adi <  1.32 and c.cv2 >= 0.49    then 'ERRATIC'
    else                                          'LUMPY'
  end                                          as demand_type,

  -- 판정하지 못한 이유. 숫자로 채우지 않습니다 (renew.prd 20.2)
  case
    when c.n_active_periods = 0          then 'NO_USAGE_HISTORY'
    when c.n_periods < 6                 then 'INSUFFICIENT_SAMPLE'
    when c.adi is null or c.cv2 is null  then 'INSUFFICIENT_SAMPLE'
    else null
  end                                          as demand_type_reason,

  -- 계절성 — 최소 24개월이 있어야 판정할 수 있습니다.
  -- 그 전에는 null 과 사유를 돌려줍니다. 임의로 채우지 않습니다.
  null::numeric                                as seasonality_index,
  case when c.n_periods < 24 then 'INSUFFICIENT_PERIODS' else null end
                                               as seasonality_reason,

  -- 안정성 표기 (기존 v_usage_profile 과 같은 어휘)
  case
    when c.cv is null   then null
    when c.cv < 0.3     then '안정'
    when c.cv < 0.6     then '보통'
    else                     '불안정'
  end                                          as stability

from calc c
left join core.v_item_master im using (item_id);

comment on view analytics.v_sku_demand_profile is
  'renew.prd 10장 — SKU 수요 프로파일. 학습 구간만 사용합니다(Data Leakage 방지)';

-- ══ 3. 요약 ════════════════════════════════════════════════════

create or replace view analytics.v_demand_profile_kpi as
select
  count(*)                                                       as n_items,
  count(*) filter (where demand_type = 'SMOOTH')                 as n_smooth,
  count(*) filter (where demand_type = 'INTERMITTENT')           as n_intermittent,
  count(*) filter (where demand_type = 'ERRATIC')                as n_erratic,
  count(*) filter (where demand_type = 'LUMPY')                  as n_lumpy,
  count(*) filter (where demand_type = 'NO_DEMAND')              as n_no_demand,
  count(*) filter (where demand_type is null)                    as n_unclassified,
  -- 간헐 계열 = 간헐 + 덩어리. Croston 계열이 필요한 품목입니다.
  count(*) filter (where demand_type in ('INTERMITTENT', 'LUMPY')) as n_croston_needed,
  round(avg(cv), 3)                                              as avg_cv,
  round(avg(adi), 2)                                             as avg_adi,
  max(n_periods)                                                 as train_periods
from analytics.v_sku_demand_profile;

-- ══ 4. 권한 ════════════════════════════════════════════════════

grant select on analytics.v_sku_demand_profile to authenticated;
grant select on analytics.v_demand_profile_kpi to authenticated;

-- ══ 5. 확인 ════════════════════════════════════════════════════

select * from analytics.v_demand_profile_kpi;

select item_id, item_name, n_periods, n_active_periods,
       adi, cv_squared, demand_type, demand_type_reason
  from analytics.v_sku_demand_profile
 order by demand_type nulls last, adi desc nulls last;
