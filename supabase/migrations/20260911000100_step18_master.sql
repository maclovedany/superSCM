-- STEP 18 · Phase 1 — 마스터와 달력
--
-- refactor.md Phase 1. 이후 모든 계산이 참조할 기준 정보를 먼저 세웁니다.
--
-- 여기서 만드는 것
--   core.supply_entity        해외법인 5곳 · 출항 준비기간
--   core.supplier             공급처 · 소속 법인 · 리드타임
--   core.supplier_departure   공급처별 출항일 규칙
--   core.business_calendar    영업일 · 공휴일
--   core.item_policy 확장     목표 DoS · 배정방식 · 목표재고 · 단가
--   core.previous_business_day()  주말·공휴일이면 이전 영업일로 당기는 계산
--
-- ★ 과거 공급처는 지우지 않습니다. active 와 적용 기간으로 관리합니다.
--   지난 발주 이력이 그 공급처를 참조하기 때문입니다 (stage1 §8 · gap 6.1).
--
-- ★ MOQ 와 목표 DoS 의 기본값 처리가 다릅니다. 헷갈리면 stage1 §6 의 마지막 규칙이 무너집니다.
--     MOQ 미설정      → 1 로 본다        (계산을 계속한다)
--     목표 DoS 미설정 → 발주 확정 차단    (계산을 멈춘다)
--
-- 다시 실행해도 안전합니다.


-- ══ 0. 옛 모양이 남아 있으면 옆으로 밀어 둡니다 ═══════════════
-- error.md #12 — 이름이 같고 컬럼이 다른 표가 있으면 create table if not exists 가
-- 조용히 건너뛰고, 그다음 인덱스나 제약이 엉뚱한 곳에서 죽습니다.

do $legacy$
declare
  v_stamp text := to_char(now(), 'YYYYMMDDHH24MI');
  v_row   record;
  v_kind  "char";
begin
  for v_row in
    select * from (values
      ('supply_entity',      'prep_days'),
      ('supplier',           'entity_id'),
      ('supplier_departure', 'supplier_id'),
      ('business_calendar',  'is_business_day')
    ) as t(table_name, must_have)
  loop
    select c.relkind into v_kind
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'core' and c.relname = v_row.table_name;

    if v_kind is null then
      continue;
    end if;

    if exists (
      select 1 from information_schema.columns
       where table_schema = 'core' and table_name = v_row.table_name
         and column_name = v_row.must_have
    ) then
      continue;  -- 이미 새 모양입니다
    end if;

    execute format('alter table core.%I rename to %I',
                   v_row.table_name, v_row.table_name || '_legacy_' || v_stamp);
    raise notice '옛 core.% 를 %_legacy_% 로 옮겼습니다', v_row.table_name, v_row.table_name, v_stamp;
  end loop;
end;
$legacy$;


-- ══ 1. 해외법인 ═══════════════════════════════════════════════
--
-- prep_days — 출항 준비기간. 발주일 = 출항일 − prep_days (stage1 §8).
-- 법인을 추가할 때 관리자가 이 값을 입력하고 변경할 수 있어야 합니다.

create table if not exists core.supply_entity (
  entity_id    text primary key,
  entity_name  text not null,
  country_code text not null,
  prep_days    integer not null default 0 check (prep_days >= 0),
  active       boolean not null default true,
  valid_from   date,
  valid_to     date,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_from <= valid_to)
);

comment on table core.supply_entity is
  'stage1 §8 — 조달 대상 해외법인. 운영 대상은 5곳이며 과거 법인은 지우지 않고 active 로 관리합니다';
comment on column core.supply_entity.prep_days is
  '출항 준비기간(일). 발주일 = 공급처 출항일 − 이 값';

-- 확정된 5곳 (stage1 §1 · gap 2). prep_days 는 현업 확인 전이라 0 입니다.
-- ★ 0 은 "아직 못 받은 값" 입니다. 임의 추정치를 넣지 않습니다.
insert into core.supply_entity (entity_id, entity_name, country_code, prep_days, note)
values
  ('JP', '일본',       'JP', 0, '출항 준비기간 현업 확인 필요'),
  ('CN', '중국',       'CN', 0, '출항 준비기간 현업 확인 필요'),
  ('VN', '베트남',     'VN', 0, '출항 준비기간 현업 확인 필요'),
  ('SG', '싱가포르',   'SG', 0, '출항 준비기간 현업 확인 필요'),
  ('NL', '네덜란드',   'NL', 0, '출항 준비기간 현업 확인 필요')
on conflict (entity_id) do nothing;


-- ══ 2. 공급처 ═════════════════════════════════════════════════

create table if not exists core.supplier (
  supplier_id     text primary key,
  supplier_name   text not null,
  entity_id       text references core.supply_entity(entity_id),
  -- 예측 조정 범위의 시작 월을 정합니다 (stage1 §4). 없으면 null 이고 계산이 멈춥니다.
  lead_time_days  integer check (lead_time_days is null or lead_time_days >= 0),
  active          boolean not null default true,
  valid_from      date,
  valid_to        date,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_from <= valid_to)
);

create index if not exists supplier_entity_idx on core.supplier(entity_id) where active;

comment on column core.supplier.lead_time_days is
  'stage1 §4 — 이 값이 없으면 조정 범위의 시작 월을 정할 수 없어 발주량 계산이 멈춥니다';


-- ══ 3. 공급처별 출항일 ════════════════════════════════════════
--
-- "공급처마다 출항일이 다르다. 공급처 출항일을 주차별로 묶어 발주한다" (stage1 §8)
--
-- 두 가지 표현을 모두 받습니다. 원 자료가 어느 쪽인지 아직 모르기 때문입니다.
--   weekday       매주 같은 요일에 출항 (0=일 ~ 6=토)
--   day_of_month  매월 특정 일자에 출항

create table if not exists core.supplier_departure (
  departure_id  bigserial primary key,
  supplier_id   text not null references core.supplier(supplier_id) on delete cascade,
  weekday       smallint check (weekday is null or weekday between 0 and 6),
  day_of_month  smallint check (day_of_month is null or day_of_month between 1 and 31),
  valid_from    date,
  valid_to      date,
  note          text,
  created_at    timestamptz not null default now(),
  -- 둘 중 정확히 하나만 채웁니다. 둘 다 비면 규칙이 아니고, 둘 다 차면 어느 쪽인지 모릅니다.
  check ((weekday is null) <> (day_of_month is null)),
  check (valid_to is null or valid_from is null or valid_from <= valid_to)
);

create index if not exists supplier_departure_supplier_idx on core.supplier_departure(supplier_id);


-- ══ 4. 영업일 달력 ════════════════════════════════════════════
--
-- "정해진 발주일이나 입고예정일이 주말 또는 공휴일이면 이전 영업일로 당긴다" (stage1 §8)
--
-- ★ 나라별로 둡니다. 해외법인 5곳의 공휴일이 서로 다릅니다.
--   행이 없는 날은 주말만 판정합니다 — 공휴일 자료가 없다는 사실을 숨기지 않기 위해서입니다.

create table if not exists core.business_calendar (
  country_code    text not null,
  calendar_date   date not null,
  is_business_day boolean not null,
  holiday_name    text,
  created_at      timestamptz not null default now(),
  primary key (country_code, calendar_date)
);

comment on table core.business_calendar is
  'stage1 §8 — 영업일 판정. 행이 없는 날짜는 주말 여부로만 판정합니다';

/**
 * 이 날짜가 영업일인가.
 *
 * 달력에 행이 있으면 그 값을 따르고, 없으면 주말이 아닌지로 판정합니다.
 * ★ 공휴일 자료가 아직 없어 "행 없음 = 평일" 로 봅니다. 자료가 들어오면 이 함수를
 *   고치지 않고 달력에 행을 넣기만 하면 됩니다.
 */
create or replace function core.is_business_day(p_date date, p_country text default 'KR')
returns boolean
language sql
stable
as $$
  select coalesce(
    (select c.is_business_day
       from core.business_calendar c
      where c.country_code = p_country and c.calendar_date = p_date),
    extract(isodow from p_date) between 1 and 5
  );
$$;

/**
 * 주말·공휴일이면 이전 영업일로 당깁니다 (stage1 §8).
 *
 * 이미 영업일이면 그 날짜를 그대로 돌려줍니다. 최대 30일까지만 거슬러 올라가고,
 * 그 안에 영업일이 없으면 null 입니다 — 무한 반복 대신 "모른다" 를 돌려줍니다.
 */
create or replace function core.previous_business_day(p_date date, p_country text default 'KR')
returns date
language plpgsql
stable
as $$
declare
  v_date date := p_date;
  v_tries int := 0;
begin
  if p_date is null then
    return null;
  end if;
  while not core.is_business_day(v_date, p_country) loop
    v_date := v_date - 1;
    v_tries := v_tries + 1;
    if v_tries > 30 then
      return null;
    end if;
  end loop;
  return v_date;
end;
$$;


-- ══ 5. 품목 정책 확장 ═════════════════════════════════════════
--
-- 기존 core.item_policy 에 컬럼을 더합니다 (stage1 §6 · §7 · gap 6.5).
-- 기존 컬럼(moq · pack_size · item_grade · service_level)은 그대로 둡니다.

alter table core.item_policy add column if not exists target_dos_days   numeric
  check (target_dos_days is null or target_dos_days > 0);
alter table core.item_policy add column if not exists allocation_mode   text
  not null default 'AUTO' check (allocation_mode in ('AUTO', 'MANUAL'));
alter table core.item_policy add column if not exists target_stock_qty  numeric
  check (target_stock_qty is null or target_stock_qty >= 0);
alter table core.item_policy add column if not exists unit_price        numeric
  check (unit_price is null or unit_price >= 0);
alter table core.item_policy add column if not exists unit_price_basis  text;
alter table core.item_policy add column if not exists min_order_amount  numeric
  check (min_order_amount is null or min_order_amount >= 0);

comment on column core.item_policy.target_dos_days is
  'stage1 §6 — 목표 DoS 일수. ★ 미설정이면 발주 확정을 차단합니다. 임의값을 넣지 않습니다';
comment on column core.item_policy.moq is
  'stage1 §7 — 최소주문수량. 미설정이면 1 로 봅니다 (목표 DoS 와 달리 계산을 멈추지 않습니다)';
comment on column core.item_policy.pack_size is
  'stage1 §7 — 포장단위. ★ 현재 발주 계산에 적용하지 않습니다. 향후 확장을 위한 자리입니다';
comment on column core.item_policy.min_order_amount is
  'stage1 §7 — 최소주문금액. ★ 현재 발주 계산에 적용하지 않습니다. 향후 확장을 위한 자리입니다';
comment on column core.item_policy.unit_price_basis is
  '표준원가 · 최근매입가 중 무엇인지. 현업 확인 전까지 null';

-- 정책 기본값 — 월평균사용량 기준 기간 (stage1 §6: 모든 품목 동일하게 최근 6개월)
insert into core.policy_config (policy_key, policy_value, description)
values ('AVG_USAGE_MONTHS', '{"value": 6}'::jsonb, 'DoS 계산의 월평균사용량 기준 개월 수')
on conflict (policy_key) do nothing;


-- ══ 6. 조회 뷰 ════════════════════════════════════════════════
--
-- ★ 화면은 core 를 직접 읽지 않습니다. 여기서만 읽습니다.

create or replace view analytics.v_supply_entity as
select e.entity_id, e.entity_name, e.country_code, e.prep_days,
       e.active, e.valid_from, e.valid_to, e.note,
       (select count(*) from core.supplier s where s.entity_id = e.entity_id and s.active) as n_active_suppliers,
       -- 아직 못 받은 값을 화면이 구분할 수 있게 합니다
       case when e.prep_days = 0 then 'PREP_DAYS_UNSET' end as reason_code
  from core.supply_entity e;

create or replace view analytics.v_supplier as
select s.supplier_id, s.supplier_name, s.entity_id, e.entity_name, e.country_code,
       s.lead_time_days, s.active, s.valid_from, s.valid_to, s.note,
       (select count(*) from core.supplier_departure d where d.supplier_id = s.supplier_id) as n_departure_rules,
       case when s.lead_time_days is null then 'LEADTIME_UNSET' end as reason_code
  from core.supplier s
  left join core.supply_entity e on e.entity_id = s.entity_id;

create or replace view analytics.v_supplier_departure as
select d.departure_id, d.supplier_id, s.supplier_name, s.entity_id,
       d.weekday, d.day_of_month, d.valid_from, d.valid_to, d.note
  from core.supplier_departure d
  join core.supplier s on s.supplier_id = d.supplier_id;

create or replace view analytics.v_item_policy as
select p.item_id,
       p.target_dos_days, p.allocation_mode, p.target_stock_qty,
       p.unit_price, p.unit_price_basis,
       p.moq, p.pack_size, p.min_order_amount, p.item_grade, p.service_level,
       p.updated_at,
       -- ★ 이 두 줄이 stage1 §6·§7 의 서로 다른 기본값 규칙입니다
       coalesce(p.moq, 1)                                    as effective_moq,
       (p.target_dos_days is null)                           as order_blocked,
       case when p.target_dos_days is null then 'TARGET_DOS_UNSET' end as reason_code
  from core.item_policy p;

create or replace view analytics.v_master_readiness as
select (select count(*) from core.supply_entity where active)                    as n_entities,
       (select count(*) from core.supply_entity where active and prep_days = 0)  as n_prep_days_unset,
       (select count(*) from core.supplier where active)                         as n_suppliers,
       (select count(*) from core.supplier where active and lead_time_days is null) as n_leadtime_unset,
       (select count(*) from core.supplier_departure)                            as n_departure_rules,
       (select count(*) from core.business_calendar)                             as n_calendar_days,
       (select count(*) from core.item_policy)                                   as n_item_policies,
       (select count(*) from core.item_policy where target_dos_days is null)     as n_target_dos_unset;

comment on view analytics.v_master_readiness is
  'Phase 1 준비 상태. 아직 못 받은 값이 몇 건인지 한 줄로 보여 줍니다';


-- ══ 7. 권한 ═══════════════════════════════════════════════════
--
-- fail-closed. 읽기는 로그인 사용자, 쓰기는 관리자만.
-- ★ Phase 2 에서 부서·직책 권한이 들어오면 이 정책을 그것으로 교체합니다.

alter table core.supply_entity      enable row level security;
alter table core.supplier           enable row level security;
alter table core.supplier_departure enable row level security;
alter table core.business_calendar  enable row level security;

do $policies$
declare
  v_table text;
begin
  foreach v_table in array array['supply_entity', 'supplier', 'supplier_departure', 'business_calendar']
  loop
    execute format('drop policy if exists %I on core.%I', v_table || '_read', v_table);
    execute format('create policy %I on core.%I for select to authenticated using (true)',
                   v_table || '_read', v_table);

    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'core' and p.proname = 'is_admin') then
      execute format('drop policy if exists %I on core.%I', v_table || '_write_admin', v_table);
      execute format('create policy %I on core.%I for all to authenticated using (core.is_admin()) with check (core.is_admin())',
                     v_table || '_write_admin', v_table);
    else
      raise notice 'core.is_admin() 이 없습니다 — % 의 관리자 쓰기 정책을 건너뜁니다', v_table;
    end if;
  end loop;
end;
$policies$;

grant select, insert, update, delete
  on core.supply_entity, core.supplier, core.supplier_departure, core.business_calendar
  to authenticated;
grant usage, select on sequence core.supplier_departure_departure_id_seq to authenticated;

grant select on analytics.v_supply_entity, analytics.v_supplier, analytics.v_supplier_departure,
                analytics.v_item_policy, analytics.v_master_readiness to authenticated;

grant execute on function core.is_business_day(date, text) to authenticated;
grant execute on function core.previous_business_day(date, text) to authenticated;

revoke all on core.supply_entity, core.supplier, core.supplier_departure, core.business_calendar
  from anon, public;


-- ══ 8. 확인 ═══════════════════════════════════════════════════

select * from analytics.v_master_readiness;
-- 기대: n_entities 5 · n_prep_days_unset 5 (아직 못 받은 값) · 나머지 0

select core.previous_business_day('2026-09-13'::date) as 일요일이면_금요일;
-- 기대: 2026-09-11
