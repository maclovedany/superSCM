create extension if not exists pgcrypto;

create table if not exists public.planning_runs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_month date not null,
  target_month date not null,
  status text not null default 'draft' check (status in ('draft', 'demand_confirmed', 'supply_ready', 'calculated', 'reviewing', 'confirmed', 'reported')),
  calculation_version text not null default 'v0.1',
  currency text not null default 'KRW',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ol_demand (
  id uuid primary key default gen_random_uuid(),
  planning_run_id uuid not null references public.planning_runs(id) on delete cascade,
  need_month date not null,
  sales_department text not null,
  model_code text,
  item_code text not null,
  item_name text,
  item_type text not null check (item_type in ('device', 'option', 'part', 'consumable')),
  quantity integer not null check (quantity >= 0),
  unit text not null default 'EA',
  demand_status text not null default 'candidate' check (demand_status in ('candidate', 'conditional', 'reference', 'excluded')),
  note text,
  source_file_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sfdc_pipeline (
  id uuid primary key default gen_random_uuid(),
  planning_run_id uuid not null references public.planning_runs(id) on delete cascade,
  deal_id text not null,
  customer_name text not null,
  model_code text,
  expected_quantity integer not null check (expected_quantity >= 0),
  expected_need_month date,
  probability numeric(5,2) not null default 0 check (probability between 0 and 100),
  pipeline_status text,
  demand_status text not null default 'reference' check (demand_status in ('candidate', 'conditional', 'reference', 'excluded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bulk_deals (
  id uuid primary key default gen_random_uuid(),
  planning_run_id uuid not null references public.planning_runs(id) on delete cascade,
  deal_id text not null,
  customer_name text not null,
  model_code text,
  expected_quantity integer not null check (expected_quantity >= 0),
  need_month date,
  demand_status text not null default 'conditional' check (demand_status in ('candidate', 'conditional', 'reference', 'excluded')),
  inventory_secured boolean not null default false,
  inclusion_rate numeric(5,2) not null default 0.5 check (inclusion_rate between 0 and 1),
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.historical_actuals (
  id uuid primary key default gen_random_uuid(),
  planning_run_id uuid not null references public.planning_runs(id) on delete cascade,
  actual_month date not null,
  model_code text,
  item_code text not null,
  item_name text,
  item_type text not null check (item_type in ('device', 'option', 'part', 'consumable')),
  actual_quantity integer not null check (actual_quantity >= 0),
  unit text not null default 'EA',
  prior_year_quantity integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.demand_confirmations (
  id uuid primary key default gen_random_uuid(),
  planning_run_id uuid not null references public.planning_runs(id) on delete cascade,
  meeting_date date,
  attendees text,
  decision_note text,
  bulk_inventory_secured boolean not null default false,
  ol_total integer not null default 0 check (ol_total >= 0),
  sfdc_weighted_total numeric(12,2) not null default 0 check (sfdc_weighted_total >= 0),
  bulk_weighted_total numeric(12,2) not null default 0 check (bulk_weighted_total >= 0),
  confirmed_total integer not null default 0 check (confirmed_total >= 0),
  status text not null default 'draft' check (status in ('draft', 'confirmed')),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ol_demand_planning_run_idx on public.ol_demand(planning_run_id);
create index if not exists sfdc_pipeline_planning_run_idx on public.sfdc_pipeline(planning_run_id);
create index if not exists bulk_deals_planning_run_idx on public.bulk_deals(planning_run_id);
create index if not exists historical_actuals_planning_run_idx on public.historical_actuals(planning_run_id);
create index if not exists demand_confirmations_planning_run_idx on public.demand_confirmations(planning_run_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists planning_runs_set_updated_at on public.planning_runs;
create trigger planning_runs_set_updated_at before update on public.planning_runs for each row execute function public.set_updated_at();
drop trigger if exists ol_demand_set_updated_at on public.ol_demand;
create trigger ol_demand_set_updated_at before update on public.ol_demand for each row execute function public.set_updated_at();
drop trigger if exists sfdc_pipeline_set_updated_at on public.sfdc_pipeline;
create trigger sfdc_pipeline_set_updated_at before update on public.sfdc_pipeline for each row execute function public.set_updated_at();
drop trigger if exists bulk_deals_set_updated_at on public.bulk_deals;
create trigger bulk_deals_set_updated_at before update on public.bulk_deals for each row execute function public.set_updated_at();
drop trigger if exists historical_actuals_set_updated_at on public.historical_actuals;
create trigger historical_actuals_set_updated_at before update on public.historical_actuals for each row execute function public.set_updated_at();
drop trigger if exists demand_confirmations_set_updated_at on public.demand_confirmations;
create trigger demand_confirmations_set_updated_at before update on public.demand_confirmations for each row execute function public.set_updated_at();
