-- STEP3 데이터 모델 확장 및 학습/검증 격리입니다.
-- Supabase SQL Editor에서 사용자가 직접 실행합니다. 원격 DB에 자동 적용하지 않습니다.

create extension if not exists pgcrypto;
create schema if not exists raw;
create schema if not exists core;
create schema if not exists analytics;

-- 기존 원본 행은 그대로 유지합니다. legacy 행의 batch/source 식별자는 null로 남습니다.
alter table raw.shipment_log add column if not exists batch_id uuid;
alter table raw.shipment_log add column if not exists source_type text;
alter table raw.shipment_log add column if not exists loaded_at timestamptz default now();
alter table raw.shipment_log add column if not exists source_record_id text;

alter table raw.usage_history add column if not exists batch_id uuid;
alter table raw.usage_history add column if not exists source_type text;
alter table raw.usage_history add column if not exists loaded_at timestamptz default now();
alter table raw.usage_history add column if not exists source_record_id text;

alter table raw.inventory add column if not exists batch_id uuid;
alter table raw.inventory add column if not exists source_type text;
alter table raw.inventory add column if not exists loaded_at timestamptz default now();
alter table raw.inventory add column if not exists source_record_id text;

alter table raw.item_master add column if not exists batch_id uuid;
alter table raw.item_master add column if not exists source_type text;
alter table raw.item_master add column if not exists loaded_at timestamptz default now();
alter table raw.item_master add column if not exists source_record_id text;

alter table raw.supplier_master add column if not exists batch_id uuid;
alter table raw.supplier_master add column if not exists source_type text;
alter table raw.supplier_master add column if not exists loaded_at timestamptz default now();
alter table raw.supplier_master add column if not exists source_record_id text;

alter table raw.purchase_order add column if not exists batch_id uuid;
alter table raw.purchase_order add column if not exists source_type text;
alter table raw.purchase_order add column if not exists loaded_at timestamptz default now();
alter table raw.purchase_order add column if not exists source_record_id text;

alter table raw.goods_receipt add column if not exists batch_id uuid;
alter table raw.goods_receipt add column if not exists source_type text;
alter table raw.goods_receipt add column if not exists loaded_at timestamptz default now();
alter table raw.goods_receipt add column if not exists source_record_id text;

alter table raw.forecast add column if not exists batch_id uuid;
alter table raw.forecast add column if not exists source_type text;
alter table raw.forecast add column if not exists loaded_at timestamptz default now();
alter table raw.forecast add column if not exists source_record_id text;

create table if not exists raw.business_event (
  business_event_id uuid primary key default gen_random_uuid(),
  event_date date not null,
  event_type text not null,
  item_id text,
  supplier_id text,
  quantity numeric,
  note text,
  attributes jsonb not null default '{}'::jsonb,
  batch_id uuid,
  source_type text,
  loaded_at timestamptz default now(),
  source_record_id text
);

create table if not exists raw.sales_order (
  sales_order_id uuid primary key default gen_random_uuid(),
  order_no text,
  order_date date,
  requested_date date,
  customer_id text,
  item_id text,
  quantity numeric,
  unit text,
  order_status text,
  attributes jsonb not null default '{}'::jsonb,
  batch_id uuid,
  source_type text,
  loaded_at timestamptz default now(),
  source_record_id text
);

create table if not exists raw.item_substitute (
  item_substitute_id uuid primary key default gen_random_uuid(),
  item_id text not null,
  substitute_item_id text not null,
  priority integer,
  valid_from date,
  valid_to date,
  note text,
  batch_id uuid,
  source_type text,
  loaded_at timestamptz default now(),
  source_record_id text,
  check (item_id <> substitute_item_id),
  check (valid_to is null or valid_from is null or valid_from <= valid_to)
);

create index if not exists raw_business_event_date_idx on raw.business_event (event_date, item_id);
create index if not exists raw_sales_order_date_idx on raw.sales_order (order_date, item_id);
create index if not exists raw_item_substitute_item_idx on raw.item_substitute (item_id, substitute_item_id);
create index if not exists raw_usage_history_use_date_idx on raw.usage_history (use_date, item_id);

create table if not exists core.policy_config (
  policy_key text primary key,
  policy_value jsonb not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists core.outlier_rule (
  rule_id uuid primary key default gen_random_uuid(),
  rule_type text not null check (rule_type in ('PROJECT', 'RETURN', 'DUPLICATE', 'CUSTOM')),
  rule_name text not null,
  rule_config jsonb not null default '{}'::jsonb,
  exclude_from_training boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rule_type, rule_name)
);

create table if not exists core.item_policy (
  item_id text primary key,
  moq numeric check (moq is null or moq > 0),
  pack_size numeric check (pack_size is null or pack_size > 0),
  item_grade text,
  service_level numeric(5,4) check (service_level is null or service_level > 0 and service_level < 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists core.forecast_setting (
  setting_id uuid primary key default gen_random_uuid(),
  active boolean not null default true,
  train_start date,
  train_end date,
  test_start date,
  test_end date,
  granularity text not null default 'DAY' check (granularity in ('DAY', 'WEEK', 'MONTH')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table core.forecast_setting add column if not exists active boolean not null default true;
alter table core.forecast_setting add column if not exists train_start date;
alter table core.forecast_setting add column if not exists train_end date;
alter table core.forecast_setting add column if not exists test_start date;
alter table core.forecast_setting add column if not exists test_end date;
alter table core.forecast_setting add column if not exists granularity text not null default 'DAY';
alter table core.forecast_setting add column if not exists created_at timestamptz not null default now();
alter table core.forecast_setting add column if not exists updated_at timestamptz not null default now();

-- 기존에 활성 설정이 여러 건이면 migration을 중단하지 않습니다.
-- 이 경우 뷰는 updated_at 최신 행만 읽고, 관리자가 중복을 정리한 뒤 단일성 인덱스를 만들 수 있습니다.
do $forecast_setting_singleton$
begin
  if not exists (
    select 1
    from core.forecast_setting
    where active
    group by active
    having count(*) > 1
  ) then
    execute 'create unique index if not exists forecast_setting_one_active_idx on core.forecast_setting (active) where active';
  end if;
end;
$forecast_setting_singleton$;
create index if not exists outlier_rule_active_idx on core.outlier_rule (active, rule_type);

insert into core.policy_config (policy_key, policy_value, description)
values
  ('SERVICE_LEVEL_DEFAULT', '{"value": 0.95}'::jsonb, '기본 서비스 레벨'),
  ('REVIEW_PERIOD_DAYS', '{"value": 30}'::jsonb, '발주 검토 주기(일)'),
  ('SAFETY_BUFFER_DAYS', '{"value": 0}'::jsonb, '안전 버퍼 일수')
on conflict (policy_key) do nothing;

create or replace function core.is_valid_forecast_window(
  p_train_start date,
  p_train_end date,
  p_test_start date,
  p_test_end date,
  p_granularity text
)
returns boolean
language sql
immutable
as $$
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

create or replace view core.v_train_demand as
with active_setting as (
  select train_start, train_end
  from core.forecast_setting
  where active
    and core.is_valid_forecast_window(train_start, train_end, test_start, test_end, granularity)
  order by updated_at desc
  limit 1
)
select
  u.usage_id,
  u.item_id,
  u.use_date,
  u.qty,
  u.warehouse,
  u.note,
  u.batch_id,
  u.source_type,
  u.loaded_at,
  u.source_record_id
from raw.usage_history u
cross join active_setting s
where u.use_date >= s.train_start
  and u.use_date <= s.train_end;

create or replace view core.v_test_actual as
with active_setting as (
  select test_start, test_end
  from core.forecast_setting
  where active
    and core.is_valid_forecast_window(train_start, train_end, test_start, test_end, granularity)
  order by updated_at desc
  limit 1
)
select
  u.usage_id,
  u.item_id,
  u.use_date,
  u.qty,
  u.warehouse,
  u.note,
  u.batch_id,
  u.source_type,
  u.loaded_at,
  u.source_record_id
from raw.usage_history u
cross join active_setting s
where u.use_date >= s.test_start
  and u.use_date <= s.test_end;

create or replace view analytics.v_data_coverage as
with data_coverage as (
  select min(use_date) as data_start, max(use_date) as data_end
  from raw.usage_history
),
active_setting as (
  select train_start, train_end, test_start, test_end, granularity
  from core.forecast_setting
  where active
  order by updated_at desc
  limit 1
),
train_rows as (
  select count(*)::bigint as row_count from core.v_train_demand
),
test_rows as (
  select count(*)::bigint as row_count from core.v_test_actual
)
select
  d.data_start,
  d.data_end,
  s.train_start,
  s.train_end,
  s.test_start,
  s.test_end,
  s.granularity,
  tr.row_count as train_row_count,
  te.row_count as test_row_count,
  coalesce(core.is_valid_forecast_window(s.train_start, s.train_end, s.test_start, s.test_end, s.granularity)
    and d.data_start is not null and s.train_start >= d.data_start and s.train_end <= d.data_end, false) as train_window_ok,
  coalesce(core.is_valid_forecast_window(s.train_start, s.train_end, s.test_start, s.test_end, s.granularity)
    and d.data_start is not null and s.test_start >= d.data_start and s.test_end <= d.data_end, false) as test_window_ok,
  coalesce(core.is_valid_forecast_window(s.train_start, s.train_end, s.test_start, s.test_end, s.granularity)
    and d.data_start is not null
    and s.train_start >= d.data_start and s.train_end <= d.data_end
    and s.test_start >= d.data_start and s.test_end <= d.data_end, false) as data_isolation_ok,
  case
    when not coalesce(core.is_valid_forecast_window(s.train_start, s.train_end, s.test_start, s.test_end, s.granularity), false) then 'BLOCKED_INVALID_SETTING'
    when not coalesce(d.data_start is not null
      and s.train_start >= d.data_start and s.train_end <= d.data_end
      and s.test_start >= d.data_start and s.test_end <= d.data_end, false) then 'WINDOW_OUTSIDE_DATA'
    else 'READY'
  end as data_isolation_status
from data_coverage d
left join active_setting s on true
cross join train_rows tr
cross join test_rows te;

do $triggers$
begin
  if to_regprocedure('core.set_updated_at()') is not null then
    execute 'drop trigger if exists policy_config_set_updated_at on core.policy_config';
    execute 'create trigger policy_config_set_updated_at before update on core.policy_config for each row execute function core.set_updated_at()';
    execute 'drop trigger if exists outlier_rule_set_updated_at on core.outlier_rule';
    execute 'create trigger outlier_rule_set_updated_at before update on core.outlier_rule for each row execute function core.set_updated_at()';
    execute 'drop trigger if exists item_policy_set_updated_at on core.item_policy';
    execute 'create trigger item_policy_set_updated_at before update on core.item_policy for each row execute function core.set_updated_at()';
    execute 'drop trigger if exists forecast_setting_set_updated_at on core.forecast_setting';
    execute 'create trigger forecast_setting_set_updated_at before update on core.forecast_setting for each row execute function core.set_updated_at()';
  end if;
end;
$triggers$;

alter table raw.shipment_log enable row level security;
alter table raw.usage_history enable row level security;
alter table raw.inventory enable row level security;
alter table raw.item_master enable row level security;
alter table raw.supplier_master enable row level security;
alter table raw.purchase_order enable row level security;
alter table raw.goods_receipt enable row level security;
alter table raw.forecast enable row level security;
alter table raw.business_event enable row level security;
alter table raw.sales_order enable row level security;
alter table raw.item_substitute enable row level security;

alter table core.policy_config enable row level security;
alter table core.outlier_rule enable row level security;
alter table core.item_policy enable row level security;
alter table core.forecast_setting enable row level security;

do $policies$
declare
  table_name text;
begin
  foreach table_name in array array['policy_config', 'outlier_rule', 'item_policy', 'forecast_setting'] loop
    execute format('drop policy if exists %I on core.%I', table_name || '_active_user_select', table_name);
    execute format('drop policy if exists %I on core.%I', table_name || '_admin_mutation', table_name);
    execute format('create policy %I on core.%I for select to authenticated using (core.is_active_user())', table_name || '_active_user_select', table_name);
    execute format('create policy %I on core.%I for all to authenticated using (core.is_admin()) with check (core.is_admin())', table_name || '_admin_mutation', table_name);
  end loop;
end;
$policies$;

revoke all on schema raw from anon, authenticated;
revoke all on all tables in schema raw from anon, authenticated;
alter default privileges in schema raw revoke all on tables from anon, authenticated;

revoke all on schema core from anon;
revoke all on schema analytics from anon;
revoke all on all tables in schema core from anon;
revoke all on all tables in schema analytics from anon;

grant usage on schema core, analytics to authenticated;
grant select, insert, update, delete on core.policy_config, core.outlier_rule, core.item_policy, core.forecast_setting to authenticated;
grant select on core.v_train_demand, core.v_test_actual to authenticated;
grant select on analytics.v_data_coverage to authenticated;
grant execute on function core.is_valid_forecast_window(date, date, date, date, text) to authenticated;
revoke execute on function core.is_valid_forecast_window(date, date, date, date, text) from anon;

alter default privileges in schema analytics grant select on tables to authenticated;
