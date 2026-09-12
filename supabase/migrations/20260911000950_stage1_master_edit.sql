-- Task 10a · 관리자 마스터 편집 — 해외법인 출항 준비기간 · 공급처 · 출항일 규칙 · 영업일 달력
--
-- STEP 18(20260911000100)이 만든 core.supply_entity · core.supplier · core.supplier_departure ·
-- core.business_calendar는 지금까지 읽기 전용이었다(app/(admin)/admin/master는 조회만 했다).
-- stage1 §8 "해외법인을 추가할 때 관리자가 해당 법인의 출항 준비기간을 입력하고 변경할 수 있어야
-- 한다"와 refactor.md Phase 1 완료 기준("법인 5곳과 각 출항 준비기간이 화면에서 조회·수정되는가")을
-- 구현한다.
--
-- 여기서 만드는 것
--   core.supplier_departure 확장   week_of_month(주차 규칙) · active(규칙 자체를 끈다) 열 추가
--   core.business_calendar_readiness   국가·연·월 단위 "공휴일을 다 넣었다" 선언
--   core.upsert_supply_entity(...)                 ADMIN — 법인 추가·수정(prep_days·active·기간)
--   core.upsert_supplier(...)                       ADMIN — 공급처 추가·수정(소속 법인·active·기간)
--   core.set_supplier_departure_rule(...)           ADMIN — 출항일 규칙 생성(create)/교체(replace)
--   core.deactivate_supplier_departure_rule(...)    ADMIN — 출항일 규칙 비활성화(deactivate)
--   core.add_business_holiday / core.remove_business_holiday   ADMIN — 공휴일 추가/제거
--   core.set_calendar_month_ready(...)              ADMIN — 월 단위 달력 준비 상태 선언
--   analytics.v_supplier_departure 재정의   week_of_month · active 추가(뒤에 붙인다 — error.md #16)
--   analytics.v_calendar_readiness · analytics.v_master_change_history   새 조회 뷰
--   analytics.v_master_readiness 재정의     n_calendar_months_ready 추가(뒤에 붙인다)
--
-- ★ ADMIN 전용이다. 모든 명령 함수가 core.is_admin()을 스스로 다시 확인한다(RLS는 그 다음 방어선).
-- ★ 모든 변경은 core.audit_log에 before(변경 전 스냅샷) · after(변경 후 스냅샷 + 이 마이그레이션이
--   넘겨받은 reason) · actor(auth.uid()) · at(now())를 함께 남긴다 — 기존 core.audit_log 표를
--   그대로 쓴다(step7 core.select_manual_champion과 같은 방식. reason 전용 열을 추가하지 않는다).
--   prep_days·active·적용기간처럼 사유가 특히 중요한 값만이 아니라 이 마이그레이션의 모든 명령
--   함수가 reason을 필수로 받는다 — 값을 비워도 되는 경우와 필수인 경우를 화면마다 갈라 만들면
--   실수로 사유 없이 바뀌는 값이 생긴다.
-- ★ 과거 공급처·법인은 지우지 않는다(gap 6.1). 이 마이그레이션은 core.supply_entity ·
--   core.supplier에 DELETE 함수를 두지 않는다 — 비활성화(active=false)는 반드시 종료일과 함께다.
-- ★ 출항일 규칙은 STEP 18이 "요일 또는 매월 일자" 두 가지만 표현했다(refactor.md "요일 또는 주차
--   규칙"의 "주차 규칙"은 없었다). week_of_month를 추가해 "매월 N번째 요일"(예: 매월 둘째 화요일)을
--   표현한다 — STEP 18의 원래 CHECK((weekday is null) <> (day_of_month is null))는 week_of_month를
--   모르므로 그대로 둬도 깨지지 않는다. 아래에서 "week_of_month는 weekday와 함께만" 이라는 CHECK만
--   추가로 붙인다.
--
-- 다시 실행해도 안전합니다. 실제 Supabase 적용은 사용자가 SQL Editor에서 수동으로 수행합니다.


-- ══ 1. core.supplier_departure 확장 — 주차 규칙 · 규칙 비활성화 ══

alter table core.supplier_departure add column if not exists week_of_month smallint;
alter table core.supplier_departure add column if not exists active boolean not null default true;

comment on column core.supplier_departure.week_of_month is
  'Task 10a — "매월 N번째 요일" 규칙(1~5). weekday 와 함께만 채워진다. STEP 18은 요일·매월 일자만 표현했다';
comment on column core.supplier_departure.active is
  'Task 10a — 규칙을 끈다(교체·중단). valid_from/valid_to(기간)와 별개다. 행은 지우지 않는다';

alter table core.supplier_departure drop constraint if exists supplier_departure_week_of_month_range_chk;
alter table core.supplier_departure add constraint supplier_departure_week_of_month_range_chk
  check (week_of_month is null or week_of_month between 1 and 5);

alter table core.supplier_departure drop constraint if exists supplier_departure_week_requires_weekday_chk;
alter table core.supplier_departure add constraint supplier_departure_week_requires_weekday_chk
  check (week_of_month is null or weekday is not null);

create index if not exists supplier_departure_active_idx on core.supplier_departure(supplier_id) where active;


-- ══ 2. 영업일 달력 월 준비 상태 ═══════════════════════════════

-- "공휴일 데이터가 없는 국가는 공휴일을 임의 추정하지 않고 달력 준비 상태를 표시한다"
-- (task-10-brief.md). 이 표는 그 "표시"를 관리자가 선언하는 자리다 — 공휴일을 자동 생성하지
-- 않는다. 관리자가 core.business_calendar에 그 달의 공휴일을 다 넣었다고 확인하면 ready=true로
-- 표시하고, Task 10b는 이 플래그로 "공휴일 자료가 있는 달인가"를 판정한다.
create table if not exists core.business_calendar_readiness (
  country_code text not null,
  cal_year     integer not null check (cal_year between 2000 and 2100),
  cal_month    integer not null check (cal_month between 1 and 12),
  ready        boolean not null default false,
  note         text,
  marked_by    uuid references auth.users(id) on delete set null,
  marked_at    timestamptz not null default now(),
  primary key (country_code, cal_year, cal_month)
);

comment on table core.business_calendar_readiness is
  'Task 10a — 국가·연·월 단위 "공휴일을 다 입력했다" 선언. 공휴일을 자동 생성하지 않고 관리자가 직접 표시한다';


-- ══ 3. 해외법인 편집 ═══════════════════════════════════════════

create or replace function core.upsert_supply_entity(
  p_entity_id text,
  p_entity_name text,
  p_country_code text,
  p_prep_days integer,
  p_active boolean,
  p_valid_from date,
  p_valid_to date,
  p_note text,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_action text;
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_entity_id, '')), '') is null then
    raise exception '법인 코드는 필수입니다.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_entity_name, '')), '') is null then
    raise exception '법인명은 필수입니다.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_country_code, '')), '') is null then
    raise exception '국가 코드는 필수입니다.' using errcode = '22023';
  end if;
  if p_prep_days is null or p_prep_days < 0 then
    raise exception '출항 준비기간은 0 이상이어야 합니다.' using errcode = '22023';
  end if;
  if not coalesce(p_active, true) and p_valid_to is null then
    raise exception '비활성으로 전환하려면 적용 종료일을 입력해야 합니다.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception '변경 사유는 필수입니다.' using errcode = '22023';
  end if;

  select to_jsonb(e) into v_before from core.supply_entity e where e.entity_id = p_entity_id;
  v_action := case when v_before is null then 'SUPPLY_ENTITY_CREATED' else 'SUPPLY_ENTITY_UPDATED' end;

  insert into core.supply_entity (entity_id, entity_name, country_code, prep_days, active, valid_from, valid_to, note)
  values (p_entity_id, p_entity_name, p_country_code, p_prep_days, coalesce(p_active, true), p_valid_from, p_valid_to, p_note)
  on conflict (entity_id) do update
    set entity_name = excluded.entity_name,
        country_code = excluded.country_code,
        prep_days = excluded.prep_days,
        active = excluded.active,
        valid_from = excluded.valid_from,
        valid_to = excluded.valid_to,
        note = excluded.note,
        updated_at = now();

  select to_jsonb(e) into v_after from core.supply_entity e where e.entity_id = p_entity_id;
  v_after := v_after || jsonb_build_object('reason', p_reason);

  insert into core.audit_log (actor, action, target_type, target_id, before, after)
  values (auth.uid(), v_action, 'supply_entity', p_entity_id, v_before, v_after);

  return p_entity_id;
end;
$$;

comment on function core.upsert_supply_entity(text, text, text, integer, boolean, date, date, text, text) is
  'Task 10a — ADMIN 전용. 해외법인을 추가하거나 출항 준비기간·활성 여부·적용 기간을 바꾼다. '
  '과거 법인은 active=false + 종료일로 남기고 지우지 않는다(gap 6.1)';


-- ══ 4. 공급처 편집 ═════════════════════════════════════════════

create or replace function core.upsert_supplier(
  p_supplier_id text,
  p_supplier_name text,
  p_entity_id text,
  p_lead_time_days integer,
  p_active boolean,
  p_valid_from date,
  p_valid_to date,
  p_note text,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_action text;
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_supplier_id, '')), '') is null then
    raise exception '공급처 코드는 필수입니다.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_supplier_name, '')), '') is null then
    raise exception '공급처명은 필수입니다.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_entity_id, '')), '') is null then
    raise exception '소속 법인은 필수입니다.' using errcode = '22023';
  end if;
  if not exists (select 1 from core.supply_entity e where e.entity_id = p_entity_id) then
    raise exception '해외법인을 찾을 수 없습니다: %', p_entity_id using errcode = '22023';
  end if;
  if p_lead_time_days is not null and p_lead_time_days < 0 then
    raise exception '리드타임은 0 이상이어야 합니다.' using errcode = '22023';
  end if;
  -- 과거 발주 이력이 공급처를 참조하므로(gap 6.1) 여기서 DELETE를 두지 않는다. 퇴출은
  -- active=false + 종료일로만 표현한다 — 종료일 없는 비활성화를 막아 "언제까지 유효했던
  -- 공급처인가"가 항상 남게 한다.
  if not coalesce(p_active, true) and p_valid_to is null then
    raise exception '비활성(퇴출)으로 전환하려면 적용 종료일을 입력해야 합니다.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception '변경 사유는 필수입니다.' using errcode = '22023';
  end if;

  select to_jsonb(s) into v_before from core.supplier s where s.supplier_id = p_supplier_id;
  v_action := case when v_before is null then 'SUPPLIER_CREATED' else 'SUPPLIER_UPDATED' end;

  insert into core.supplier (supplier_id, supplier_name, entity_id, lead_time_days, active, valid_from, valid_to, note)
  values (p_supplier_id, p_supplier_name, p_entity_id, p_lead_time_days, coalesce(p_active, true), p_valid_from, p_valid_to, p_note)
  on conflict (supplier_id) do update
    set supplier_name = excluded.supplier_name,
        entity_id = excluded.entity_id,
        lead_time_days = excluded.lead_time_days,
        active = excluded.active,
        valid_from = excluded.valid_from,
        valid_to = excluded.valid_to,
        note = excluded.note,
        updated_at = now();

  select to_jsonb(s) into v_after from core.supplier s where s.supplier_id = p_supplier_id;
  v_after := v_after || jsonb_build_object('reason', p_reason);

  insert into core.audit_log (actor, action, target_type, target_id, before, after)
  values (auth.uid(), v_action, 'supplier', p_supplier_id, v_before, v_after);

  return p_supplier_id;
end;
$$;

comment on function core.upsert_supplier(text, text, text, integer, boolean, date, date, text, text) is
  'Task 10a — ADMIN 전용. 공급처를 추가하거나 소속 법인·활성 여부·적용 기간을 바꾼다. '
  '과거 발주 이력이 참조하므로 삭제 함수는 두지 않는다(gap 6.1) — 퇴출은 active=false + 종료일';


-- ══ 5. 공급처 출항일 규칙 — 생성(create) / 교체(replace) / 비활성화(deactivate) ══

create or replace function core.set_supplier_departure_rule(
  p_departure_id bigint,   -- null 이면 새 규칙(create), 있으면 그 규칙을 바꾼다(replace)
  p_supplier_id text,
  p_weekday integer,
  p_week_of_month integer,
  p_day_of_month integer,
  p_valid_from date,
  p_valid_to date,
  p_note text,
  p_reason text
)
returns bigint
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_id bigint;
  v_action text;
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception '변경 사유는 필수입니다.' using errcode = '22023';
  end if;
  if not exists (select 1 from core.supplier s where s.supplier_id = p_supplier_id) then
    raise exception '공급처를 찾을 수 없습니다: %', p_supplier_id using errcode = '22023';
  end if;
  if (p_weekday is null) = (p_day_of_month is null) then
    raise exception '요일 규칙과 매월 일자 규칙 중 하나만 입력해야 합니다.' using errcode = '22023';
  end if;
  if p_week_of_month is not null and p_weekday is null then
    raise exception '주차 규칙은 요일과 함께 입력해야 합니다.' using errcode = '22023';
  end if;
  if p_week_of_month is not null and (p_week_of_month < 1 or p_week_of_month > 5) then
    raise exception '주차는 1~5 사이여야 합니다.' using errcode = '22023';
  end if;

  if p_departure_id is null then
    v_action := 'SUPPLIER_DEPARTURE_CREATED';
    v_before := null;
    insert into core.supplier_departure (supplier_id, weekday, week_of_month, day_of_month, valid_from, valid_to, note, active)
    values (p_supplier_id, p_weekday, p_week_of_month, p_day_of_month, p_valid_from, p_valid_to, p_note, true)
    returning departure_id into v_id;
  else
    select to_jsonb(d) into v_before from core.supplier_departure d where d.departure_id = p_departure_id;
    if v_before is null then
      raise exception '출항일 규칙을 찾을 수 없습니다: %', p_departure_id using errcode = '22023';
    end if;
    v_action := 'SUPPLIER_DEPARTURE_REPLACED';
    v_id := p_departure_id;
    update core.supplier_departure
       set supplier_id = p_supplier_id,
           weekday = p_weekday,
           week_of_month = p_week_of_month,
           day_of_month = p_day_of_month,
           valid_from = p_valid_from,
           valid_to = p_valid_to,
           note = p_note
     where departure_id = p_departure_id;
  end if;

  select to_jsonb(d) into v_after from core.supplier_departure d where d.departure_id = v_id;
  v_after := v_after || jsonb_build_object('reason', p_reason);

  insert into core.audit_log (actor, action, target_type, target_id, before, after)
  values (auth.uid(), v_action, 'supplier_departure', v_id::text, v_before, v_after);

  return v_id;
end;
$$;

comment on function core.set_supplier_departure_rule(bigint, text, integer, integer, integer, date, date, text, text) is
  'Task 10a — ADMIN 전용. p_departure_id가 null이면 새 규칙을 만들고(create), 있으면 그 행을 '
  '교체한다(replace). 요일·매월 일자 중 정확히 하나만, 주차(week_of_month)는 요일과 함께만 채운다';

create or replace function core.deactivate_supplier_departure_rule(p_departure_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception '변경 사유는 필수입니다.' using errcode = '22023';
  end if;

  select to_jsonb(d) into v_before from core.supplier_departure d where d.departure_id = p_departure_id;
  if v_before is null then
    raise exception '출항일 규칙을 찾을 수 없습니다: %', p_departure_id using errcode = '22023';
  end if;

  update core.supplier_departure set active = false where departure_id = p_departure_id;

  select to_jsonb(d) into v_after from core.supplier_departure d where d.departure_id = p_departure_id;
  v_after := v_after || jsonb_build_object('reason', p_reason);

  insert into core.audit_log (actor, action, target_type, target_id, before, after)
  values (auth.uid(), 'SUPPLIER_DEPARTURE_DEACTIVATED', 'supplier_departure', p_departure_id::text, v_before, v_after);
end;
$$;

comment on function core.deactivate_supplier_departure_rule(bigint, text) is
  'Task 10a — ADMIN 전용. 출항일 규칙을 끈다(active=false). 행은 지우지 않는다';


-- ══ 6. 영업일 달력 — 공휴일 추가/제거 · 월 준비 상태 ═══════════

create or replace function core.add_business_holiday(p_country_code text, p_calendar_date date, p_holiday_name text, p_reason text)
returns void
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_action text;
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_country_code, '')), '') is null then
    raise exception '국가 코드는 필수입니다.' using errcode = '22023';
  end if;
  if p_calendar_date is null then
    raise exception '날짜는 필수입니다.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_holiday_name, '')), '') is null then
    raise exception '공휴일 이름은 필수입니다.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception '변경 사유는 필수입니다.' using errcode = '22023';
  end if;

  select to_jsonb(c) into v_before from core.business_calendar c
    where c.country_code = p_country_code and c.calendar_date = p_calendar_date;
  v_action := case when v_before is null then 'BUSINESS_HOLIDAY_ADDED' else 'BUSINESS_HOLIDAY_UPDATED' end;

  insert into core.business_calendar (country_code, calendar_date, is_business_day, holiday_name)
  values (p_country_code, p_calendar_date, false, p_holiday_name)
  on conflict (country_code, calendar_date) do update
    set is_business_day = false, holiday_name = excluded.holiday_name;

  select to_jsonb(c) into v_after from core.business_calendar c
    where c.country_code = p_country_code and c.calendar_date = p_calendar_date;
  v_after := v_after || jsonb_build_object('reason', p_reason);

  insert into core.audit_log (actor, action, target_type, target_id, before, after)
  values (auth.uid(), v_action, 'business_calendar', p_country_code || ':' || p_calendar_date::text, v_before, v_after);
end;
$$;

comment on function core.add_business_holiday(text, date, text, text) is
  'Task 10a — ADMIN 전용. 공휴일을 등록한다(is_business_day=false). 공휴일을 임의로 추정해서 미리 '
  '채우지 않는다 — 관리자가 하나씩 넣는다';

create or replace function core.remove_business_holiday(p_country_code text, p_calendar_date date, p_reason text)
returns void
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_before jsonb;
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception '변경 사유는 필수입니다.' using errcode = '22023';
  end if;

  select to_jsonb(c) into v_before from core.business_calendar c
    where c.country_code = p_country_code and c.calendar_date = p_calendar_date and c.is_business_day = false;
  if v_before is null then
    raise exception '해당 날짜에 등록된 공휴일이 없습니다: % %', p_country_code, p_calendar_date using errcode = '22023';
  end if;

  delete from core.business_calendar where country_code = p_country_code and calendar_date = p_calendar_date;

  insert into core.audit_log (actor, action, target_type, target_id, before, after)
  values (
    auth.uid(), 'BUSINESS_HOLIDAY_REMOVED', 'business_calendar', p_country_code || ':' || p_calendar_date::text,
    v_before, jsonb_build_object('reason', p_reason)
  );
end;
$$;

comment on function core.remove_business_holiday(text, date, text) is
  'Task 10a — ADMIN 전용. 등록된 공휴일을 지운다(행 삭제 — 평일이면 다시 영업일로 판정된다). '
  '영업일로 강제 지정된 주말 등 공휴일이 아닌 행은 지우지 않는다';

create or replace function core.set_calendar_month_ready(p_country_code text, p_cal_year integer, p_cal_month integer, p_ready boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_country_code, '')), '') is null then
    raise exception '국가 코드는 필수입니다.' using errcode = '22023';
  end if;
  if p_cal_month is null or p_cal_month < 1 or p_cal_month > 12 then
    raise exception '월은 1~12 사이여야 합니다.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception '변경 사유는 필수입니다.' using errcode = '22023';
  end if;

  select to_jsonb(r) into v_before from core.business_calendar_readiness r
    where r.country_code = p_country_code and r.cal_year = p_cal_year and r.cal_month = p_cal_month;

  insert into core.business_calendar_readiness (country_code, cal_year, cal_month, ready, note, marked_by, marked_at)
  values (p_country_code, p_cal_year, p_cal_month, coalesce(p_ready, false), p_reason, auth.uid(), now())
  on conflict (country_code, cal_year, cal_month) do update
    set ready = excluded.ready, note = excluded.note, marked_by = excluded.marked_by, marked_at = excluded.marked_at;

  select to_jsonb(r) into v_after from core.business_calendar_readiness r
    where r.country_code = p_country_code and r.cal_year = p_cal_year and r.cal_month = p_cal_month;

  insert into core.audit_log (actor, action, target_type, target_id, before, after)
  values (
    auth.uid(), 'CALENDAR_MONTH_READY_SET', 'business_calendar_readiness',
    p_country_code || ':' || p_cal_year::text || '-' || lpad(p_cal_month::text, 2, '0'),
    v_before, v_after
  );
end;
$$;

comment on function core.set_calendar_month_ready(text, integer, integer, boolean, text) is
  'Task 10a — ADMIN 전용. "이 국가·연·월의 공휴일을 다 넣었다"를 선언한다. 공휴일 자체를 만들지 않는다';


-- ══ 7. 조회 뷰 재정의 — 기존 열 순서 유지, 새 열은 끝에(error.md #16) ══

create or replace view analytics.v_supplier_departure as
select d.departure_id, d.supplier_id, s.supplier_name, s.entity_id,
       d.weekday, d.day_of_month, d.valid_from, d.valid_to, d.note,
       d.week_of_month, d.active
  from core.supplier_departure d
  join core.supplier s on s.supplier_id = d.supplier_id;

-- ★ security_invoker를 쓰지 않고(뷰 소유자 권한) WHERE에서 core.is_admin()으로 조회 범위를
--   가른다 — analytics.v_urgent_order_history(Task 11, 20260911001100)와 같은 방식이다.
--   이 뷰는 core.app_user.name(선언한 관리자 이름)을 함께 보여 주므로 로그인한 모든 사용자에게
--   열어 두지 않는다. 화면은 관리자 전용(app/(admin)/admin/master)이라 동작은 그대로다.
--   달력 준비 상태 자체가 필요한 업무 경로(Task 10b 일정 생성)는 이 뷰가 아니라
--   core.business_calendar_readiness를 소유자 권한 함수 · 뷰 안에서 직접 읽는다.
create or replace view analytics.v_calendar_readiness as
select r.country_code, r.cal_year, r.cal_month, r.ready, r.note,
       r.marked_by, u.name as marked_by_name, r.marked_at,
       (select count(*) from core.business_calendar c
          where c.country_code = r.country_code and c.is_business_day = false
            and extract(year from c.calendar_date)::int = r.cal_year
            and extract(month from c.calendar_date)::int = r.cal_month) as n_holidays
  from core.business_calendar_readiness r
  left join core.app_user u on u.user_id = r.marked_by
 where core.is_admin();

comment on view analytics.v_calendar_readiness is
  'Task 10a — 국가·연·월별 "공휴일을 다 입력했다" 선언과 등록된 공휴일 수. 행이 없으면 아직 '
  '선언하지 않은 달이다(준비 안 됨으로 취급). 관리자(core.is_admin())만 조회한다';

-- Task 10a — 마스터(법인·공급처·출항일 규칙·달력·달력 준비 상태) 변경 이력. audit_log를
-- 대상 유형으로 좁혀서 보여 준다. before/after는 core.audit_log 그대로이며 after에는 reason이
-- 함께 들어 있다(위 4~6번 함수가 그렇게 남긴다).
-- ★ 이 뷰는 security_invoker가 아니라 뷰 소유자 권한으로 core.audit_log를 읽는다. core.audit_log의
--   RLS(audit_log_admin_select, STEP 2)는 관리자에게만 SELECT를 허용하므로, WHERE에 core.is_admin()을
--   두지 않으면 로그인한 모든 사용자가 PostgREST로 이 뷰를 읽어 RLS를 우회하게 된다(마스터 변경
--   before/after 전문과 행위자까지 노출). 조회 범위는 반드시 여기서 가른다 —
--   analytics.v_urgent_order_history(Task 11)와 같은 방식이고, 이 파일의 화면은 관리자 전용이라
--   동작은 그대로다.
create or replace view analytics.v_master_change_history as
select a.id, a.at, a.actor, u.name as actor_name, a.action, a.target_type, a.target_id, a.before, a.after
  from core.audit_log a
  left join core.app_user u on u.user_id = a.actor
 where a.target_type in ('supply_entity', 'supplier', 'supplier_departure', 'business_calendar', 'business_calendar_readiness')
   and core.is_admin()
 order by a.at desc;

comment on view analytics.v_master_change_history is
  'Task 10a — 마스터 화면이 조회하는 변경 이력. core.audit_log를 마스터 대상 유형으로만 좁힌다. '
  'core.audit_log RLS가 관리자 전용이므로 이 뷰도 core.is_admin()일 때만 행을 낸다';

-- n_calendar_months_ready를 끝에 덧붙인다 — 기존 8열의 이름·순서는 그대로다(error.md #16).
create or replace view analytics.v_master_readiness as
select (select count(*) from core.supply_entity where active)                    as n_entities,
       (select count(*) from core.supply_entity where active and prep_days = 0)  as n_prep_days_unset,
       (select count(*) from core.supplier where active)                         as n_suppliers,
       (select count(*) from core.supplier where active and lead_time_days is null) as n_leadtime_unset,
       (select count(*) from core.supplier_departure where active)               as n_departure_rules,
       (select count(*) from core.business_calendar)                             as n_calendar_days,
       (select count(*) from core.item_policy)                                   as n_item_policies,
       (select count(*) from core.item_policy where target_dos_days is null)     as n_target_dos_unset,
       (select count(*) from core.business_calendar_readiness where ready)       as n_calendar_months_ready;


-- ══ 8. 권한 ═══════════════════════════════════════════════════
--
-- fail-closed. 읽기는 로그인 사용자, 쓰기는 관리자만 — STEP 18과 같은 모양이다.
-- ★ 실제 쓰기 방어는 위 함수 본문의 core.is_admin() 확인이다. security definer 함수는 소유자
--   권한(RLS를 우회하는 슈퍼유저/테이블 소유자)으로 실행되므로, 아래 RLS는 PostgREST를 통한
--   직접 테이블 쓰기를 막는 두 번째 방어선이다(STEP 18 §7과 동일한 이유).

alter table core.business_calendar_readiness enable row level security;

drop policy if exists business_calendar_readiness_read on core.business_calendar_readiness;
create policy business_calendar_readiness_read on core.business_calendar_readiness
  for select to authenticated using (true);

do $policy$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'core' and p.proname = 'is_admin') then
    execute 'drop policy if exists business_calendar_readiness_write_admin on core.business_calendar_readiness';
    execute 'create policy business_calendar_readiness_write_admin on core.business_calendar_readiness '
         || 'for all to authenticated using (core.is_admin()) with check (core.is_admin())';
  else
    raise notice 'core.is_admin() 이 없습니다 — business_calendar_readiness 의 관리자 쓰기 정책을 건너뜁니다';
  end if;
end;
$policy$;

grant select, insert, update, delete on core.business_calendar_readiness to authenticated;
revoke all on core.business_calendar_readiness from anon, public;

grant select on analytics.v_calendar_readiness, analytics.v_master_change_history to authenticated;

grant execute on function
  core.upsert_supply_entity(text, text, text, integer, boolean, date, date, text, text),
  core.upsert_supplier(text, text, text, integer, boolean, date, date, text, text),
  core.set_supplier_departure_rule(bigint, text, integer, integer, integer, date, date, text, text),
  core.deactivate_supplier_departure_rule(bigint, text),
  core.add_business_holiday(text, date, text, text),
  core.remove_business_holiday(text, date, text),
  core.set_calendar_month_ready(text, integer, integer, boolean, text)
  to authenticated;

-- ★ 과거 법인·공급처·출항일 규칙은 지우지 않는다(gap 6.1 — 과거 발주 이력이 참조한다). STEP 18이
--   authenticated에게 준 직접 DELETE 권한을 회수해, 이 마이그레이션의 함수(모두 INSERT/UPDATE만
--   쓰고 이 세 표에서 DELETE하지 않는다)를 거치지 않는 경로(Supabase 테이블 편집기 등)로도 하드
--   삭제할 수 없게 한다. security definer 함수는 소유자 권한으로 실행되므로 이 REVOKE의 영향을
--   받지 않는다. core.business_calendar는 예외다 — core.remove_business_holiday가 착오 등록
--   정정을 위해 의도적으로 DELETE한다(§8).
revoke delete on core.supply_entity, core.supplier, core.supplier_departure from authenticated;


-- ══ 9. 확인 ═══════════════════════════════════════════════════

-- select core.upsert_supply_entity('JP','일본','JP',7,true,null,null,null,'현업 확인');
-- select * from analytics.v_supply_entity where entity_id = 'JP';
-- -- 기대: prep_days 7, reason_code null

-- select core.set_supplier_departure_rule(null,'SUP001',2,2,null,null,null,null,'매월 둘째 화요일 출항');
-- select departure_id, weekday, week_of_month, day_of_month, active from analytics.v_supplier_departure
--  where supplier_id = 'SUP001' order by departure_id desc limit 1;
-- -- 기대: weekday 2, week_of_month 2, day_of_month null, active true

-- select core.add_business_holiday('KR','2026-09-25','추석','2026년 추석 연휴');
-- select core.previous_business_day('2026-09-27'::date) as 연휴_다음_일요일이면_그_전_영업일;

-- select * from analytics.v_master_readiness;
-- -- 기대: n_calendar_months_ready 열이 끝에 추가되어 있다
