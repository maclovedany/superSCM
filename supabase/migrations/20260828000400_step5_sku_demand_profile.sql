-- STEP 5: SKU 수요 프로파일은 오직 core.v_train_demand를 입력으로 사용합니다.
-- 검증 Actual과 원본 사용 이력은 이 뷰에서 직접 참조하지 않습니다.
insert into core.policy_config (policy_key, policy_value, description)
values
  ('SEASONALITY_INDEX_CV_THRESHOLD', '{"value": 0.20}'::jsonb, '계절성 월별 지수 변동계수 임계값'),
  ('DEMAND_PROFILE_RECENT_PERIODS', '{"value": 3}'::jsonb, '최근 변화 비교 기간(월)')
on conflict (policy_key) do nothing;

create or replace view analytics.v_sku_demand_profile as
with active_setting as (
  select train_start, train_end
  from core.forecast_setting
  where active
    and core.is_valid_forecast_window(train_start, train_end, test_start, test_end, granularity)
  order by updated_at desc
  limit 1
),
policy as (
  select
    max((policy_value ->> 'value')::numeric) filter (where policy_key = 'SEASONALITY_INDEX_CV_THRESHOLD') as seasonality_threshold,
    max((policy_value ->> 'value')::integer) filter (where policy_key = 'DEMAND_PROFILE_RECENT_PERIODS') as recent_periods
  from core.policy_config
  where active
),
periods as (
  select generate_series(date_trunc('month', train_start), date_trunc('month', train_end), interval '1 month')::date as period
  from active_setting
),
items as (
  select item_id, item_name
  from core.v_item_master
),
monthly_demand as (
  select item_id, date_trunc('month', use_date)::date as period, sum(qty) as qty, count(qty) as n_qty
  from core.v_train_demand
  group by item_id, date_trunc('month', use_date)::date
),
grid as (
  select i.item_id, i.item_name, p.period,
    row_number() over (partition by i.item_id order by p.period) as period_number,
    case when d.item_id is null then 0::numeric when d.n_qty = 0 then null::numeric else d.qty end as qty
  from items i cross join periods p
  left join monthly_demand d on d.item_id = i.item_id and d.period = p.period
),
metrics as (
  select item_id, max(item_name) as item_name, count(*) as n_periods,
    count(*) filter (where qty > 0) as n_nonzero_periods,
    count(*) filter (where qty is null) as n_null_periods,
    avg(qty) filter (where qty > 0) as mean_nonzero,
    stddev_samp(qty) filter (where qty > 0) as sd_nonzero,
    count(*) filter (where qty = 0)::numeric / nullif(count(*), 0) as zero_demand_rate,
    regr_slope(qty, period_number) filter (where qty is not null) as trend_per_period
  from grid
  group by item_id
),
peak_period as (
  select distinct on (item_id) item_id, period as peak_period
  from grid where qty is not null
  order by item_id, qty desc, period asc
),
recent_change as (
  select g.item_id,
    avg(g.qty) filter (where g.period_number > m.n_periods - p.recent_periods) as recent_average,
    avg(g.qty) filter (where g.period_number between m.n_periods - (2 * p.recent_periods) + 1 and m.n_periods - p.recent_periods) as previous_average
  from grid g join metrics m using (item_id) cross join policy p
  group by g.item_id
),
seasonal_months as (
  select item_id, extract(month from period)::integer as month_number, avg(qty) as monthly_average
  from grid where qty is not null
  group by item_id, extract(month from period)::integer
),
seasonality_metric as (
  select item_id, stddev_samp(monthly_average) / nullif(avg(monthly_average), 0) as seasonal_index_cv
  from seasonal_months
  group by item_id
)
select
  m.item_id, m.item_name, m.n_periods, m.n_nonzero_periods,
  case when m.n_nonzero_periods = 0 then null else m.n_periods::numeric / m.n_nonzero_periods end as adi,
  case when m.n_nonzero_periods < 2 or m.mean_nonzero = 0 then null else m.sd_nonzero / m.mean_nonzero end as cv,
  case when m.n_nonzero_periods < 2 or m.mean_nonzero = 0 then null else power(m.sd_nonzero / m.mean_nonzero, 2) end as cv_squared,
  m.zero_demand_rate, m.trend_per_period,
  case
    when m.n_null_periods > 0 or p.recent_periods is null or p.recent_periods <= 0 then null
    when m.n_periods < 2 * p.recent_periods then null
    when r.previous_average is null or r.previous_average = 0 then null
    else (r.recent_average - r.previous_average) / r.previous_average
  end as recent_change_rate,
  peak.peak_period,
  case
    when m.n_null_periods > 0 or m.n_nonzero_periods < 2 then null
    when m.n_periods::numeric / m.n_nonzero_periods < 1.32 and power(m.sd_nonzero / m.mean_nonzero, 2) < 0.49 then 'SMOOTH'
    when m.n_periods::numeric / m.n_nonzero_periods >= 1.32 and power(m.sd_nonzero / m.mean_nonzero, 2) < 0.49 then 'INTERMITTENT'
    when m.n_periods::numeric / m.n_nonzero_periods < 1.32 and power(m.sd_nonzero / m.mean_nonzero, 2) >= 0.49 then 'ERRATIC'
    else 'LUMPY'
  end as demand_type,
  case
    when m.n_null_periods > 0 or m.n_periods < 24 or sm.seasonal_index_cv is null or p.seasonality_threshold is null then null
    else sm.seasonal_index_cv >= p.seasonality_threshold
  end as seasonality,
  case
    when m.n_null_periods > 0 then 'NULL_QUANTITY'
    when m.n_nonzero_periods = 0 then 'NO_DEMAND'
    when m.n_nonzero_periods < 2 then 'INSUFFICIENT_NONZERO_PERIODS'
    when m.n_periods < 24 then 'INSUFFICIENT_PERIODS'
    when p.seasonality_threshold is null or p.recent_periods is null or p.recent_periods <= 0 then 'POLICY_UNAVAILABLE'
    when sm.seasonal_index_cv is null then 'CALCULATION_UNAVAILABLE'
    when m.n_periods < 2 * p.recent_periods then 'INSUFFICIENT_RECENT_PERIODS'
    when r.previous_average is null or r.previous_average = 0 then 'ZERO_BASELINE'
    else null
  end as reason_code,
  case
    when m.n_nonzero_periods < 2 or m.mean_nonzero = 0 then null
    when power(m.sd_nonzero / m.mean_nonzero, 2) < 0.49 then 'STABLE'
    else 'VOLATILE'
  end as stability
from metrics m
cross join policy p
left join peak_period peak using (item_id)
left join recent_change r using (item_id)
left join seasonality_metric sm using (item_id);

create or replace view analytics.v_demand_profile_kpi as
select count(*) as total_items,
  count(*) filter (where demand_type = 'SMOOTH') as n_smooth,
  count(*) filter (where demand_type = 'INTERMITTENT') as n_intermittent,
  count(*) filter (where demand_type = 'ERRATIC') as n_erratic,
  count(*) filter (where demand_type = 'LUMPY') as n_lumpy,
  count(*) filter (where demand_type in ('INTERMITTENT', 'LUMPY')) as n_croston_needed,
  count(*) filter (where demand_type is null) as n_calculation_unavailable
from analytics.v_sku_demand_profile;

grant select on analytics.v_sku_demand_profile, analytics.v_demand_profile_kpi to authenticated;
