-- Task 10b · 발주일·출항일·입고 차이 — stage1 §8
--
-- Task 9b(20260911000900)가 만든 APPROVED core.procurement_plan/_line과 Task 10a
-- (20260911000950)가 만든 core.supply_entity(준비기간) · core.supplier · core.supplier_departure
-- (요일 · 요일+주차 · 매월 일자) · core.business_calendar · core.business_calendar_readiness ·
-- core.previous_business_day를 읽어 매월 발주 일정(공급처 출항일 → 기준 발주일 → 요청 발주일 →
-- 계획 입고일 → 확정 계획 입고일)을 만들고, 실제 입고일과의 차이를 법인별 · 품목별 · 월별로 집계한다.
--
-- 여기서 만드는 것
--   core.procurement_schedule            계획 라인(1개월차) × 공급처 출항일 → 발주 · 입고 일정 한 줄
--   core.receipt_schedule_result         확정 계획 입고일 · 실제 입고일 · 차이(부호 있는 일수)
--   core.build_procurement_schedule(p_plan_id)   APPROVED 계획만 허용, 재실행해도 안전 · 실제 입고일 보존
--   core.record_actual_receipt_date(...)         PLAN_CONFIRM만 — 실제 입고일 입력 · 수정(append-only 이력)
--   analytics.v_procurement_schedule             화면이 조회하는 일정 한 줄(출항일 · 발주 · 입고 · 실제 · 차이)
--   analytics.v_receipt_gap_entity / _item / _month   같은 원천 행(core.receipt_schedule_result)을 법인 ·
--                                                      품목 · 월별로 집계
--
-- ★ 컨트롤러 판정(브리프 밖에서 확정된 것)
--   1. 발주일 · 입고일 모두 KR(한국) 영업일 달력을 쓴다. 그 달이 core.business_calendar_readiness에서
--      준비됨으로 표시되지 않으면 공휴일을 임의 추정하지 않고 CALENDAR_NOT_READY + null이다(주말만으로
--      추정하는 core.is_business_day의 기본 동작을 여기서는 그대로 믿지 않는다 — 아래 §3 참고).
--   2. 대상은 그 달 최신 승인(APPROVED) 계획의 1개월차, 최종 발주량 > 0인 라인만이다. 공급처 매핑이 없는
--      품목은 SUPPLIER_UNSET으로 "제외 사유가 있는 행"으로 남긴다(조용히 빼지 않는다). 공급처가 그
--      출항일에 비활성이거나 적용 기간 밖이면 SUPPLIER_INACTIVE.
--   3. 공급처의 출항일 = 계획 월 1일 이후 첫 날짜 중, 그 날짜에 활성인 출항일 규칙이 정확히 하나 맞는 날.
--      규칙이 하나도 없으면 DEPARTURE_RULE_UNSET, 두 개 이상 겹치면 DEPARTURE_RULE_AMBIGUOUS(고르지 않는다).
--      법인 출항 준비기간이 0(미확정)이면 PREP_DAYS_UNSET — 발주일을 계산하지 않는다.
--   4. 브리프 계산식 그대로: 기준 발주일 = 출항일 − 준비기간, 요청 발주일 = 휴일이면 이전 영업일,
--      계획 입고일 = 요청 발주일 + 7일, 확정 계획 입고일 = 휴일이면 이전 영업일, 입고 차이 = 실제 − 확정
--      (부호 있는 정수, 조기/지연 상태 코드 없음). 묶음 키는 출항일의 ISO 주차다. 발주마감일 컬럼 · 상태는
--      만들지 않는다.
--   5. 실제 입고일은 SCM 품목담당자(PLAN_CONFIRM)가 DB 함수로 입력한다. 입고 실적에 자동 매칭하지 않는다.
--      actor · 시각을 core.audit_log(기존 표, append-only)에 남긴다.
--   6. core.build_procurement_schedule은 non-APPROVED 계획을 거절하고, 재실행해도 일정 행이 늘지 않으며
--      이미 입력된 실제 입고일을 보존한다. ★ fix round 1 — "그 달 최신 승인본"만 허용한다(analytics.
--      v_procurement_plan.is_latest_approved). Task 9b는 이미 APPROVED인 계획을 새 버전이 생겨도 건드리지
--      않으므로(9b 우려 5 — "작업 중 1개"만 강제) 한 달에 APPROVED 계획이 여러 개 있을 수 있다 — 옛
--      승인본으로 다시 만들면 같은 달에 독립된 일정 두 벌이 생겨 집계가 깨진다. 새 최신 승인본으로 만들면
--      그 달의 옛(아직 대체되지 않은) 일정 행을 superseded로 표시하고(지우지 않는다), 품목 · 공급처가
--      같은 옛 행에 실제 입고일이 있으면 새 행으로 옮긴다(이력은 core.audit_log에 남아 그대로 보존된다).
--   7. 세 집계 뷰는 모두 core.receipt_schedule_result에서 같은 원천 행(calculation_status='SCHEDULED')만
--      쓴다. 월별 집계는 확정 계획 입고일 기준이다. 평균 · 합계는 실제 입고일이 있는 행만 쓰고, 없는 행의
--      수는 별도로 보여준다.
--   8. 화면 · Server Action에 더미 숫자를 넣지 않는다(AGENTS.md 5번). 날짜는 모두 date 타입이고 "오늘"이
--      필요하면 (clock_timestamp() at time zone 'Asia/Seoul')::date를 쓴다(이 마이그레이션에는 그런
--      계산이 없다 — 모든 날짜가 발주계획 · 마스터 데이터에서 온다).
--
-- 다시 실행해도 안전합니다. 원격 Supabase에는 아무것도 적용하지 않았습니다 — 사용자가 SQL Editor에서
-- 수동 적용합니다(파일 끝 확인 쿼리 참고).


-- ══ 1. core.procurement_schedule ═════════════════════════════════
--
-- 계획 라인(1개월차) 하나당 한 줄. 중간에 계산이 막히면(공급처 매핑 없음 등) 그때까지 계산된 값만
-- 채우고 calculation_status='EXCLUDED' + reason_code로 남긴다 — 조용히 빼지 않는다(판정 2).

create table if not exists core.procurement_schedule (
  schedule_id             uuid primary key default gen_random_uuid(),
  plan_id                 uuid not null references core.procurement_plan(plan_id) on delete restrict,
  plan_line_id            uuid not null unique references core.procurement_plan_line(line_id) on delete restrict,
  item_id                 text not null check (btrim(item_id) <> ''),

  supplier_id             text references core.supplier(supplier_id) on delete restrict,
  entity_id               text references core.supply_entity(entity_id) on delete restrict,

  departure_date          date,
  prep_days               integer check (prep_days is null or prep_days > 0),
  base_order_date         date,
  requested_order_date    date,
  planned_receipt_date    date,
  confirmed_receipt_date  date,

  -- 출항일의 ISO 주차 — "공급처 출항일을 주차별로 묶어 발주한다"(stage1 §8)
  bundle_iso_year         integer,
  bundle_iso_week         integer check (bundle_iso_week is null or bundle_iso_week between 1 and 53),

  calculation_status      text not null check (calculation_status in ('SCHEDULED', 'EXCLUDED')),
  reason_code             text check (reason_code is null or reason_code in (
                             'SUPPLIER_UNSET', 'DEPARTURE_RULE_UNSET', 'DEPARTURE_RULE_AMBIGUOUS',
                             'SUPPLIER_INACTIVE', 'PREP_DAYS_UNSET', 'CALENDAR_NOT_READY'
                           )),
  built_at                timestamptz not null default clock_timestamp(),
  updated_at              timestamptz not null default clock_timestamp(),

  -- fix round 1 — 이 달의 더 최신 승인본으로 일정을 다시 만들면 이 행은 지우지 않고 여기 표시만 한다.
  superseded_at           timestamptz,
  superseded_by_plan_id   uuid references core.procurement_plan(plan_id) on delete restrict,

  constraint procurement_schedule_status_check check (
    (calculation_status = 'SCHEDULED' and reason_code is null and confirmed_receipt_date is not null
      and supplier_id is not null and entity_id is not null and departure_date is not null
      and prep_days is not null and base_order_date is not null and requested_order_date is not null
      and planned_receipt_date is not null)
    or (calculation_status = 'EXCLUDED' and reason_code is not null and confirmed_receipt_date is null)
  )
);

create index if not exists procurement_schedule_plan_idx on core.procurement_schedule (plan_id);
create index if not exists procurement_schedule_supplier_idx on core.procurement_schedule (supplier_id);
create index if not exists procurement_schedule_bundle_idx on core.procurement_schedule (bundle_iso_year, bundle_iso_week);
-- fix round 1 — 같은 품목 · 공급처의 "지금 대체되지 않은" 행을 빠르게 찾는다(집계 뷰 · 실제 입고일 승계).
create index if not exists procurement_schedule_active_item_idx
  on core.procurement_schedule (item_id, supplier_id) where superseded_at is null;
create index if not exists procurement_schedule_superseded_by_idx
  on core.procurement_schedule (superseded_by_plan_id) where superseded_by_plan_id is not null;

comment on table core.procurement_schedule is
  'Task 10b — 승인된 발주계획 1개월차 라인 × 공급처 출항일로 만든 발주 · 입고 일정 한 줄. '
  'core.build_procurement_schedule이 채우며 화면 · Server Action은 직접 쓰지 않는다';
comment on column core.procurement_schedule.reason_code is
  'EXCLUDED일 때만 채운다. 그때까지 계산된 값(예: departure_date)은 남기고 그 뒤 값은 비운다';
comment on column core.procurement_schedule.superseded_at is
  'fix round 1 — 이 달의 더 최신 승인본으로 일정을 다시 만들면 채워진다(행은 지우지 않는다). '
  'null이면 지금 유효한(대체되지 않은) 행이다';


-- ══ 2. core.receipt_schedule_result ═══════════════════════════════
--
-- 일정 한 줄당 정확히 하나. 실제 입고일은 append-only 이력(core.audit_log)과 함께 SCM 품목담당자가 입력한다.

create table if not exists core.receipt_schedule_result (
  result_id                uuid primary key default gen_random_uuid(),
  schedule_id               uuid not null unique references core.procurement_schedule(schedule_id) on delete restrict,
  -- core.procurement_schedule.confirmed_receipt_date의 스냅샷 — 재계산(rebuild) 때 함께 갱신된다.
  confirmed_receipt_date    date,
  actual_receipt_date       date,
  -- 부호 있는 일수. 음수면 조기 입고, 양수면 지연 입고 — 별도 상태 코드를 두지 않는다(브리프 규칙).
  gap_days                  integer generated always as (actual_receipt_date - confirmed_receipt_date) stored,
  recorded_by                uuid references auth.users(id) on delete set null,
  recorded_by_name           text,
  recorded_at                timestamptz,
  note                        text,
  created_at                  timestamptz not null default clock_timestamp()
);

create index if not exists receipt_schedule_result_actual_idx
  on core.receipt_schedule_result (confirmed_receipt_date) where actual_receipt_date is not null;

comment on table core.receipt_schedule_result is
  'Task 10b — 확정 계획 입고일 · 실제 입고일 · 차이(부호 있는 일수). 실제 입고일은 SCM 품목담당자가 '
  'core.record_actual_receipt_date로만 입력한다. 입고 실적에 자동 매칭하지 않는다(브리프 규칙)';
comment on column core.receipt_schedule_result.gap_days is
  '입고 차이 = 실제 입고일 − 확정 계획 입고일. 조기/지연 상태 코드를 별도로 두지 않는다';


-- ══ 3. 재실행 안전성 — 열이 추가될 수 있는 옛 모양 정리는 없음(신규 표이므로 §0 불필요) ══


-- ══ 4. core.build_procurement_schedule(p_plan_id) ═════════════════

create or replace function core.build_procurement_schedule(p_plan_id uuid)
returns table (schedule_id uuid, item_id text, calculation_status text, reason_code text)
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_plan core.procurement_plan%rowtype;
  v_line record;
  -- 품목 → 공급처(core.v_item_master.supplier_id로 찾은 core.supplier 행)를 스칼라로만 들고 다닌다 —
  -- 루프마다 다시 채우지 않는 rowtype 변수는 찾지 못한 회차에도 이전 값이 남을 수 있어(select into
  -- non-strict는 못 찾으면 NULL을 넣지만, 조건문으로 애초에 조회를 건너뛴 회차에는 그 규칙이 적용되지
  -- 않는다) 매 회차 명시적으로 초기화하는 스칼라가 더 안전하다.
  v_item_supplier_id text;
  v_supplier_id text;
  v_supplier_entity_id text;
  v_supplier_active boolean;
  v_supplier_valid_from date;
  v_supplier_valid_to date;
  v_supplier_exists boolean;
  v_candidate date;
  v_departure_date date;
  v_match_count integer;
  v_day integer;
  v_reason text;
  v_entity_id text;
  v_entity_prep_days integer;
  v_entity_exists boolean;
  v_prep_days integer;
  v_base_order_date date;
  v_requested_order_date date;
  v_planned_receipt_date date;
  v_confirmed_receipt_date date;
  v_bundle_iso_year integer;
  v_bundle_iso_week integer;
  v_status text;
  v_schedule_id uuid;
  -- fix round 1 — 옛 승인본의 실제 입고일을 새 행으로 승계할 때 쓴다.
  v_prev_schedule_id uuid;
  v_prev_actual_date date;
  v_prev_recorded_by uuid;
  v_prev_recorded_by_name text;
  v_prev_recorded_at timestamptz;
  v_prev_note text;
  v_existing_actual_date date;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 발주 일정을 만들 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('PLAN_CONFIRM', v_actor) then
    raise exception '발주 일정 생성 권한(PLAN_CONFIRM)이 없습니다.' using errcode = '42501';
  end if;

  select * into v_plan from core.procurement_plan where plan_id = p_plan_id;
  if not found then
    raise exception '발주계획을 찾을 수 없습니다: %', p_plan_id using errcode = 'P0002';
  end if;
  if v_plan.status <> 'APPROVED' then
    raise exception '승인된 발주계획만 발주 일정을 생성할 수 있습니다(현재 %).', v_plan.status using errcode = '42501';
  end if;
  -- fix round 1 — 승인은 됐어도 그 달의 최신 승인본이 아니면 거절한다(analytics.v_procurement_plan과
  -- 같은 판정을 한 곳에서 쓴다 — Task 9b는 새 버전이 생겨도 옛 APPROVED 계획을 SUPERSEDED로 바꾸지
  -- 않으므로 한 달에 APPROVED 계획이 여러 개 있을 수 있다).
  if not exists (
    select 1 from analytics.v_procurement_plan v where v.plan_id = p_plan_id and v.is_latest_approved
  ) then
    raise exception '이 발주계획은 승인됐지만 이 달의 최신 승인본이 아닙니다. 최신 승인본으로 발주 일정을 만드세요.'
      using errcode = '42501';
  end if;

  -- fix round 1 — 같은 달의 옛(아직 대체되지 않은) 일정을 이 계획이 대체한다고 표시한다(지우지 않는다).
  -- 같은 계획을 다시 만드는 경우(idempotent rebuild)는 plan_id <> p_plan_id 조건 때문에 영향받지 않는다 —
  -- 그 경우 이 달의 옛 행은 이미 지난 빌드에서 superseded 처리됐다.
  update core.procurement_schedule s
     set superseded_at = clock_timestamp(), superseded_by_plan_id = p_plan_id
    from core.procurement_plan p
   where p.plan_id = s.plan_id
     and p.plan_month = v_plan.plan_month
     and s.plan_id <> p_plan_id
     and s.superseded_at is null;

  for v_line in
    select l.line_id, l.item_id, l.final_order_qty
      from core.procurement_plan_line l
     where l.plan_id = p_plan_id and l.month_no = 1 and l.final_order_qty > 0
     order by l.item_id
  loop
    -- 초기화 — 매 회차 전부 새로 채운다(이전 품목의 값이 새지 않도록).
    v_item_supplier_id := null; v_supplier_id := null; v_supplier_entity_id := null; v_supplier_active := null;
    v_supplier_valid_from := null; v_supplier_valid_to := null; v_supplier_exists := false;
    v_departure_date := null; v_reason := null;
    v_entity_id := null; v_entity_prep_days := null; v_entity_exists := false; v_prep_days := null;
    v_base_order_date := null; v_requested_order_date := null;
    v_planned_receipt_date := null; v_confirmed_receipt_date := null; v_bundle_iso_year := null; v_bundle_iso_week := null;

    -- 1) 품목 → 공급처 매핑 (core.v_item_master.supplier_id) — core.supplier에 실재하는 코드여야 한다
    select im.supplier_id into v_item_supplier_id from core.v_item_master im where im.item_id = v_line.item_id;
    if v_item_supplier_id is not null then
      select s.supplier_id, s.entity_id, s.active, s.valid_from, s.valid_to
        into v_supplier_id, v_supplier_entity_id, v_supplier_active, v_supplier_valid_from, v_supplier_valid_to
        from core.supplier s where s.supplier_id = v_item_supplier_id;
      v_supplier_exists := found;
    end if;

    if v_item_supplier_id is null or not v_supplier_exists then
      v_reason := 'SUPPLIER_UNSET';
    else
      -- 2) 출항일 — 계획 월 1일 이후 첫 날짜 중 그 날짜에 활성 규칙이 정확히 하나 맞는 날(최대 400일)
      for v_day in 0..399 loop
        v_candidate := v_plan.plan_month + v_day;
        select count(*) into v_match_count
          from core.supplier_departure d
         where d.supplier_id = v_supplier_id
           and d.active
           and (d.valid_from is null or d.valid_from <= v_candidate)
           and (d.valid_to is null or d.valid_to >= v_candidate)
           and (
             (d.day_of_month is not null and extract(day from v_candidate)::int = d.day_of_month)
             or (d.weekday is not null and extract(dow from v_candidate)::int = d.weekday
                 and (d.week_of_month is null or ((extract(day from v_candidate)::int - 1) / 7 + 1) = d.week_of_month))
           );
        if v_match_count = 1 then
          v_departure_date := v_candidate;
          exit;
        elsif v_match_count > 1 then
          v_reason := 'DEPARTURE_RULE_AMBIGUOUS';
          exit;
        end if;
      end loop;

      if v_departure_date is null and v_reason is null then
        v_reason := 'DEPARTURE_RULE_UNSET';
      end if;

      if v_departure_date is not null then
        v_bundle_iso_year := extract(isoyear from v_departure_date)::int;
        v_bundle_iso_week := extract(week from v_departure_date)::int;

        -- 3) 출항일 기준 공급처 유효성
        if not (coalesce(v_supplier_active, false)
                and (v_supplier_valid_from is null or v_supplier_valid_from <= v_departure_date)
                and (v_supplier_valid_to is null or v_supplier_valid_to >= v_departure_date)) then
          v_reason := 'SUPPLIER_INACTIVE';
        else
          -- 4) 해외법인 출항 준비기간
          if v_supplier_entity_id is not null then
            select e.entity_id, e.prep_days into v_entity_id, v_entity_prep_days
              from core.supply_entity e where e.entity_id = v_supplier_entity_id;
            v_entity_exists := found;
          end if;
          if not v_entity_exists or v_entity_prep_days = 0 then
            v_reason := 'PREP_DAYS_UNSET';
          else
            v_prep_days := v_entity_prep_days;
            v_base_order_date := v_departure_date - v_prep_days;

            -- 5) 요청 발주일 — KR 영업일 확정(준비 안 된 달이면 CALENDAR_NOT_READY)
            v_requested_order_date := core.confirm_kr_business_day(v_base_order_date);
            if v_requested_order_date is null then
              v_reason := 'CALENDAR_NOT_READY';
            else
              v_planned_receipt_date := v_requested_order_date + 7;
              v_confirmed_receipt_date := core.confirm_kr_business_day(v_planned_receipt_date);
              if v_confirmed_receipt_date is null then
                v_reason := 'CALENDAR_NOT_READY';
              end if;
            end if;
          end if;
        end if;
      end if;
    end if;

    -- v_supplier_id · v_entity_id는 각 회차 맨 위에서 null로 초기화되고, 실제로 그 단계까지 도달해
    -- 조회했을 때만 채워진다(SUPPLIER_UNSET · DEPARTURE_RULE_* · SUPPLIER_INACTIVE는 entity 조회 자체에
    -- 도달하지 못하므로 자연히 null이다). PREP_DAYS_UNSET은 법인을 찾긴 했으므로(prep_days=0일 뿐)
    -- entity_id를 그대로 남긴다 — "법인은 알지만 준비기간이 없다"는 정보를 화면에서 보여줄 수 있다.
    v_status := case when v_reason is null then 'SCHEDULED' else 'EXCLUDED' end;

    insert into core.procurement_schedule (
      plan_id, plan_line_id, item_id, supplier_id, entity_id,
      departure_date, prep_days, base_order_date, requested_order_date, planned_receipt_date, confirmed_receipt_date,
      bundle_iso_year, bundle_iso_week, calculation_status, reason_code, updated_at
    )
    values (
      p_plan_id, v_line.line_id, v_line.item_id, v_supplier_id, v_entity_id,
      v_departure_date, v_prep_days, v_base_order_date, v_requested_order_date, v_planned_receipt_date, v_confirmed_receipt_date,
      v_bundle_iso_year, v_bundle_iso_week, v_status, v_reason, clock_timestamp()
    )
    on conflict (plan_line_id) do update set
      supplier_id = excluded.supplier_id, entity_id = excluded.entity_id,
      departure_date = excluded.departure_date, prep_days = excluded.prep_days,
      base_order_date = excluded.base_order_date, requested_order_date = excluded.requested_order_date,
      planned_receipt_date = excluded.planned_receipt_date, confirmed_receipt_date = excluded.confirmed_receipt_date,
      bundle_iso_year = excluded.bundle_iso_year, bundle_iso_week = excluded.bundle_iso_week,
      calculation_status = excluded.calculation_status, reason_code = excluded.reason_code,
      updated_at = clock_timestamp()
    returning core.procurement_schedule.schedule_id into v_schedule_id;

    -- fix round 1 — 방금 이 계획이 대체한(superseded_by_plan_id = p_plan_id) 옛 행 중 같은 품목 · 같은
    -- 공급처의 실제 입고일을 새 행으로 승계한다. 공급처가 바뀌었으면(예: 마스터 변경) 승계하지 않는다 —
    -- 옛 행에는 그대로 남아 있으므로 데이터를 잃지 않는다(감사 이력도 옛 schedule_id에 그대로 남는다).
    -- ★ 이 행에 이미 실제 입고일이 있으면(처음 승계된 뒤의 재실행, 또는 record_actual_receipt_date로 직접
    --   입력된 뒤의 재실행) 승계 조회 자체를 건너뛴다 — 그러지 않으면 재실행마다 같은 값을 다시 "승계"한
    --   것처럼 이력이 중복 기록된다(idempotent 요구 위반).
    v_prev_schedule_id := null; v_prev_actual_date := null; v_prev_recorded_by := null;
    v_prev_recorded_by_name := null; v_prev_recorded_at := null; v_prev_note := null;
    select rr.actual_receipt_date into v_existing_actual_date
      from core.receipt_schedule_result rr where rr.schedule_id = v_schedule_id;
    if v_existing_actual_date is null and v_supplier_id is not null then
      select ps.schedule_id, rr.actual_receipt_date, rr.recorded_by, rr.recorded_by_name, rr.recorded_at, rr.note
        into v_prev_schedule_id, v_prev_actual_date, v_prev_recorded_by, v_prev_recorded_by_name, v_prev_recorded_at, v_prev_note
        from core.procurement_schedule ps
        join core.receipt_schedule_result rr on rr.schedule_id = ps.schedule_id
       where ps.superseded_by_plan_id = p_plan_id
         and ps.item_id = v_line.item_id
         and ps.supplier_id = v_supplier_id
         and rr.actual_receipt_date is not null
       limit 1;
    end if;

    -- 재실행해도 실제 입고일은 보존한다 — confirmed_receipt_date만 최신화하고 actual_receipt_date · 이력은
    -- (이미 이 행에 있던 값이든, 방금 승계된 값이든) 건드리지 않는다. 위의 v_existing_actual_date 확인
    -- 덕분에 이미 값이 있는 행은 애초에 v_prev_schedule_id를 다시 찾지 않고, 값이 없어 다시 찾더라도
    -- ON CONFLICT가 actual_receipt_date를 갱신하지 않으므로 이중 안전장치다.
    -- ★ ON CONFLICT (schedule_id)처럼 열 이름을 그대로 쓰면 이 함수의 schedule_id 출력 열과 이름이
    --   겹쳐 "column reference is ambiguous"가 난다(error.md #20과 같은 종류) — 제약 이름으로 피한다.
    insert into core.receipt_schedule_result (
      schedule_id, confirmed_receipt_date, actual_receipt_date, recorded_by, recorded_by_name, recorded_at, note
    )
    values (
      v_schedule_id, v_confirmed_receipt_date, v_prev_actual_date, v_prev_recorded_by, v_prev_recorded_by_name,
      v_prev_recorded_at, v_prev_note
    )
    on conflict on constraint receipt_schedule_result_schedule_id_key
    do update set confirmed_receipt_date = excluded.confirmed_receipt_date;

    if v_prev_schedule_id is not null then
      -- 옛 schedule_id의 원래 입력 이력(core.record_actual_receipt_date가 남긴 RECEIPT_ACTUAL_DATE_RECORDED)은
      -- 손대지 않는다 — 그대로 append-only로 남아 "누가 언제 입력했는가"를 보존한다. 여기서는 새 행으로
      -- 옮겨졌다는 사실 자체를 새 schedule_id에 남긴다.
      insert into core.audit_log (actor, action, target_type, target_id, before, after)
      values (
        v_actor, 'RECEIPT_ACTUAL_DATE_CARRIED_OVER', 'receipt_schedule_result', v_schedule_id::text,
        jsonb_build_object('carried_from_schedule_id', v_prev_schedule_id, 'carried_from_plan_id',
          (select ps2.plan_id from core.procurement_schedule ps2 where ps2.schedule_id = v_prev_schedule_id)),
        jsonb_build_object('actual_receipt_date', v_prev_actual_date, 'recorded_by_name', v_prev_recorded_by_name,
          'recorded_at', v_prev_recorded_at)
      );
    end if;

    schedule_id := v_schedule_id; item_id := v_line.item_id; calculation_status := v_status; reason_code := v_reason;
    return next;
  end loop;

  return;
end;
$$;

comment on function core.build_procurement_schedule(uuid) is
  'Task 10b — PLAN_CONFIRM. 승인됐고(APPROVED) 그 달의 최신 승인본인 계획만 허용한다(fix round 1). '
  '1개월차 · 최종 발주량>0 라인마다 공급처 → 출항일 → 준비기간 → KR 영업일 확정 순서로 일정을 만든다. '
  '재실행해도 행이 늘지 않고 이미 입력된 실제 입고일을 보존한다(plan_line_id unique + on conflict). '
  '이 달의 옛 승인본 일정은 지우지 않고 superseded로 표시하며, 같은 품목 · 공급처의 실제 입고일은 새 '
  '행으로 옮긴다';


-- ══ 5. KR 영업일 확정 — "행 없음 = 평일" 기본 판정을 믿지 않는다 ═══
--
-- core.previous_business_day는 달력 행이 없으면 주말만으로 판정한다(STEP 18 §4, 의도된 동작 — 10a가
-- 그대로 재사용). 컨트롤러 판정 1은 Task 10b의 발주 · 입고일에는 그 기본값을 쓰지 않겠다는 뜻이다 —
-- KR 달력이 그 달(과, 뒤로 당겨져 걸치는 이전 달)에 core.business_calendar_readiness.ready=true로
-- 표시돼 있어야만 조정한다. 준비 안 됐으면 null + CALENDAR_NOT_READY.

create or replace function core.confirm_kr_business_day(p_date date)
returns date
language plpgsql
stable
set search_path = core, public, pg_temp
as $$
declare
  v_adjusted date;
  v_all_ready boolean;
begin
  if p_date is null then
    return null;
  end if;
  v_adjusted := core.previous_business_day(p_date, 'KR');
  if v_adjusted is null then
    return null;
  end if;
  select bool_and(coalesce(r.ready, false)) into v_all_ready
    from generate_series(date_trunc('month', v_adjusted), date_trunc('month', p_date), interval '1 month') as gm(month_start)
    left join core.business_calendar_readiness r
      on r.country_code = 'KR' and r.cal_year = extract(year from gm.month_start)::int and r.cal_month = extract(month from gm.month_start)::int;
  if not coalesce(v_all_ready, false) then
    return null;
  end if;
  return v_adjusted;
end;
$$;

comment on function core.confirm_kr_business_day(date) is
  'Task 10b — 이 날짜를 KR 영업일로 확정한다. previous_business_day로 당긴 뒤, 원래 날짜부터 당겨진 '
  '날짜까지 걸친 모든 달이 core.business_calendar_readiness에서 준비됨이어야 한다. 하나라도 준비 '
  '안 됐으면 null이다(공휴일 공백을 주말 판정으로 가리지 않는다)';


-- ══ 6. 실제 입고일 입력 — SCM 품목담당자(PLAN_CONFIRM) ═══════════

create or replace function core.record_actual_receipt_date(p_schedule_id uuid, p_actual_receipt_date date, p_note text default null)
returns void
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_schedule core.procurement_schedule%rowtype;
  v_before jsonb;
  v_after jsonb;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 실제 입고일을 입력할 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('PLAN_CONFIRM', v_actor) then
    raise exception '실제 입고일 입력 권한(PLAN_CONFIRM)이 없습니다.' using errcode = '42501';
  end if;

  select * into v_schedule from core.procurement_schedule where schedule_id = p_schedule_id;
  if not found then
    raise exception '발주 일정을 찾을 수 없습니다: %', p_schedule_id using errcode = 'P0002';
  end if;
  if v_schedule.calculation_status <> 'SCHEDULED' then
    raise exception '일정이 계산되지 않은 항목에는 실제 입고일을 입력할 수 없습니다(사유 %).', v_schedule.reason_code using errcode = '22023';
  end if;

  v_actor_name := core.order_actor_name(v_actor);

  select to_jsonb(r) into v_before from core.receipt_schedule_result r where r.schedule_id = p_schedule_id;

  update core.receipt_schedule_result
     set actual_receipt_date = p_actual_receipt_date,
         recorded_by = v_actor, recorded_by_name = v_actor_name, recorded_at = clock_timestamp(),
         note = p_note
   where schedule_id = p_schedule_id;

  select to_jsonb(r) into v_after from core.receipt_schedule_result r where r.schedule_id = p_schedule_id;

  -- append-only 이력 — 기존 core.audit_log를 그대로 쓴다(Task 10a와 같은 방식). before/after에 실제
  -- 입고일 변경 전후가 그대로 남는다.
  insert into core.audit_log (actor, action, target_type, target_id, before, after)
  values (v_actor, 'RECEIPT_ACTUAL_DATE_RECORDED', 'receipt_schedule_result', p_schedule_id::text, v_before, v_after);
end;
$$;

comment on function core.record_actual_receipt_date(uuid, date, text) is
  'Task 10b — PLAN_CONFIRM. 실제 입고일을 입력 · 수정한다(null이면 지운다). 계산된(SCHEDULED) 일정에만 '
  '입력할 수 있다. 입고 실적에 자동 매칭하지 않는다. actor · 시각은 core.audit_log에 append-only로 남는다';


-- ══ 7. 조회 뷰 ════════════════════════════════════════════════════

create or replace view analytics.v_procurement_schedule
with (security_invoker = true)
as
select
  s.schedule_id, s.plan_id, p.plan_month, p.status as plan_status,
  s.item_id, l.item_name, l.final_order_qty,
  s.supplier_id, sup.supplier_name, s.entity_id, ent.entity_name,
  s.departure_date, s.prep_days, s.base_order_date, s.requested_order_date,
  s.planned_receipt_date, s.confirmed_receipt_date,
  s.bundle_iso_year, s.bundle_iso_week,
  case when s.bundle_iso_year is not null and s.bundle_iso_week is not null
       then s.bundle_iso_year::text || '-W' || lpad(s.bundle_iso_week::text, 2, '0') end as bundle_key,
  s.calculation_status, s.reason_code, s.built_at,
  r.actual_receipt_date, r.gap_days, r.recorded_by_name, r.recorded_at, r.note,
  -- 행 하나의 "차이를 못 내는 이유" — EXCLUDED 행은 일정 자체가 없는 사유(reason_code)를 그대로 쓰고,
  -- SCHEDULED인데 실제 입고일이 아직 없으면 ACTUAL_RECEIPT_UNSET이다(검증 규칙 그대로).
  case when s.calculation_status <> 'SCHEDULED' then s.reason_code
       when r.actual_receipt_date is null then 'ACTUAL_RECEIPT_UNSET'
       else null end as gap_reason_code,
  -- fix round 1 — 이 달의 더 최신 승인본이 만들어지며 대체됐으면 채워진다(행은 지우지 않는다).
  s.superseded_at, s.superseded_by_plan_id
from core.procurement_schedule s
join core.procurement_plan p on p.plan_id = s.plan_id
join core.procurement_plan_line l on l.line_id = s.plan_line_id
left join core.supplier sup on sup.supplier_id = s.supplier_id
left join core.supply_entity ent on ent.entity_id = s.entity_id
left join core.receipt_schedule_result r on r.schedule_id = s.schedule_id;

comment on view analytics.v_procurement_schedule is
  'Task 10b — 발주 일정 한 줄(출항일 · 기준/요청 발주일 · 계획/확정 입고일 · 실제 입고일 · 차이). '
  'EXCLUDED 행도 그대로 보여준다(조용히 빼지 않는다). gap_reason_code는 EXCLUDED 행의 제외 사유 또는 '
  'SCHEDULED인데 실제 입고일이 아직 없을 때의 ACTUAL_RECEIPT_UNSET이다. superseded_at이 있으면 이 달의 '
  '더 최신 승인본이 대체한 옛 행이다(fix round 1)';

-- 세 집계는 모두 core.receipt_schedule_result에서 같은 원천 행(그 달 최신 승인본이 만든, 아직 대체되지
-- 않은 SCHEDULED 행)을 쓴다(판정 7 · fix round 1) — 법인 · 품목 · 월별로 나눠도 n_total의 합은 항상 같다.

create or replace view analytics.v_receipt_gap_entity
with (security_invoker = true)
as
select
  s.entity_id, ent.entity_name,
  count(*) as n_total,
  count(*) filter (where r.actual_receipt_date is not null) as n_actual_recorded,
  count(*) filter (where r.actual_receipt_date is null) as n_actual_unset,
  avg(r.gap_days) filter (where r.actual_receipt_date is not null) as avg_gap_days,
  sum(r.gap_days) filter (where r.actual_receipt_date is not null) as sum_gap_days
from core.procurement_schedule s
join core.receipt_schedule_result r on r.schedule_id = s.schedule_id
left join core.supply_entity ent on ent.entity_id = s.entity_id
where s.calculation_status = 'SCHEDULED' and s.superseded_at is null
group by s.entity_id, ent.entity_name;

comment on view analytics.v_receipt_gap_entity is
  'Task 10b — 해외법인별 계획 입고일 대비 실제 입고일 차이 집계. 실제 입고일이 있는 행만 평균 · 합계에 쓴다';

create or replace view analytics.v_receipt_gap_item
with (security_invoker = true)
as
select
  s.item_id, l.item_name,
  count(*) as n_total,
  count(*) filter (where r.actual_receipt_date is not null) as n_actual_recorded,
  count(*) filter (where r.actual_receipt_date is null) as n_actual_unset,
  avg(r.gap_days) filter (where r.actual_receipt_date is not null) as avg_gap_days,
  sum(r.gap_days) filter (where r.actual_receipt_date is not null) as sum_gap_days
from core.procurement_schedule s
join core.receipt_schedule_result r on r.schedule_id = s.schedule_id
join core.procurement_plan_line l on l.line_id = s.plan_line_id
where s.calculation_status = 'SCHEDULED' and s.superseded_at is null
group by s.item_id, l.item_name;

comment on view analytics.v_receipt_gap_item is
  'Task 10b — 품목별 계획 입고일 대비 실제 입고일 차이 집계. 실제 입고일이 있는 행만 평균 · 합계에 쓴다';

create or replace view analytics.v_receipt_gap_month
with (security_invoker = true)
as
select
  date_trunc('month', s.confirmed_receipt_date)::date as target_month,
  count(*) as n_total,
  count(*) filter (where r.actual_receipt_date is not null) as n_actual_recorded,
  count(*) filter (where r.actual_receipt_date is null) as n_actual_unset,
  avg(r.gap_days) filter (where r.actual_receipt_date is not null) as avg_gap_days,
  sum(r.gap_days) filter (where r.actual_receipt_date is not null) as sum_gap_days
from core.procurement_schedule s
join core.receipt_schedule_result r on r.schedule_id = s.schedule_id
where s.calculation_status = 'SCHEDULED' and s.superseded_at is null
group by date_trunc('month', s.confirmed_receipt_date);

comment on view analytics.v_receipt_gap_month is
  'Task 10b — 확정 계획 입고일이 속한 월별 차이 집계(브리프 규칙 — 계획 입고일 기준). 실제 입고일이 '
  '있는 행만 평균 · 합계에 쓴다';


-- ══ 8. RLS와 실행 권한 ════════════════════════════════════════════
--
-- STEP 9b(procurement_plan)와 같은 모양 — 읽기는 PLAN_CONFIRM · PLAN_APPROVE · ADMIN, 쓰기는 함수 경유만.

alter table core.procurement_schedule enable row level security;
alter table core.receipt_schedule_result enable row level security;

drop policy if exists procurement_schedule_read on core.procurement_schedule;
create policy procurement_schedule_read on core.procurement_schedule
  for select to authenticated
  using (core.has_permission('PLAN_CONFIRM') or core.has_permission('PLAN_APPROVE') or core.is_admin());

drop policy if exists receipt_schedule_result_read on core.receipt_schedule_result;
create policy receipt_schedule_result_read on core.receipt_schedule_result
  for select to authenticated
  using (exists (
    select 1 from core.procurement_schedule s where s.schedule_id = receipt_schedule_result.schedule_id
  ));

revoke all on core.procurement_schedule, core.receipt_schedule_result from anon, public;
revoke insert, update, delete on core.procurement_schedule, core.receipt_schedule_result from authenticated;
grant select on core.procurement_schedule, core.receipt_schedule_result to authenticated;

revoke all on analytics.v_procurement_schedule, analytics.v_receipt_gap_entity,
  analytics.v_receipt_gap_item, analytics.v_receipt_gap_month from anon, public;
grant select on analytics.v_procurement_schedule, analytics.v_receipt_gap_entity,
  analytics.v_receipt_gap_item, analytics.v_receipt_gap_month to authenticated;

revoke all on function core.build_procurement_schedule(uuid) from public, anon;
grant execute on function core.build_procurement_schedule(uuid) to authenticated;
revoke all on function core.record_actual_receipt_date(uuid, date, text) from public, anon;
grant execute on function core.record_actual_receipt_date(uuid, date, text) to authenticated;
revoke all on function core.confirm_kr_business_day(date) from public, anon, authenticated;


-- ══ 9. 확인 ═══════════════════════════════════════════════════════

-- 최신 승인 계획을 하나 골라 일정을 만든다(PLAN_CONFIRM 세션에서):
-- select plan_id from analytics.v_procurement_plan where is_latest_approved limit 1;
-- select * from core.build_procurement_schedule('<plan_id>');
--
-- select * from analytics.v_procurement_schedule where plan_id = '<plan_id>' order by item_id;
-- -- 기대: final_order_qty > 0인 1개월차 라인 수와 같은 행 수. 공급처 미매핑 품목은
-- --      calculation_status='EXCLUDED' · reason_code='SUPPLIER_UNSET'으로 보인다(조용히 빠지지 않는다).
--
-- select entity_id, n_total, n_actual_recorded, n_actual_unset from analytics.v_receipt_gap_entity;
-- select item_id, n_total from analytics.v_receipt_gap_item;
-- select target_month, n_total from analytics.v_receipt_gap_month;
-- -- 기대: 세 뷰의 n_total 합이 서로 같다(같은 원천 행에서 나뉘어 집계됐을 뿐이다).
