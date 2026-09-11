-- Task 8 · 확정 수요 구성과 이벤트 추가 수요 승인
--
-- 목적: 발주 계산에는 확정된 업무 근거만 들어가게 하고 영업 확률 수요를 완전히 배제한다 (stage1.md §5,
-- §2 109행). 이 마이그레이션이 만드는 analytics.v_approved_demand_monthly가 Task 9의 유일한
-- "추가 수요" 입력이며, 그 계산은 절대 영업 확률(sales_probability)이나 파트너 선주문을 참조하지 않는다.
-- 실제 Supabase 적용은 사용자가 SQL Editor에서 수동으로 수행한다. 다시 실행해도 안전하다
-- (create or replace · if not exists). 운영 테이블에 예시 데이터를 넣지 않는다.
--
-- ★ 포함 규칙(stage1.md §5, 컨트롤러 판정) — 세 원천만 발주 수요에 반영한다.
--   1) CONFIRMED_ORDER  — core.sales_order.status = 'CONFIRMED'이고 최종 승인 주문번호(confirmed_order_no)가
--      입력된 주문의 줄. 수량 = 줄의 요청수량(requested_qty). 취소된 주문은 confirmed_order_no를 그대로
--      보존하지만 status가 CONFIRMED가 아니므로 0건이다(Task 5 사업배정 유니크 인덱스 주석 참고).
--      월 = 확정 시각(confirmed_at)을 Asia/Seoul로 바꾼 달. core.sales_order_line에는 필요·납기일
--      컬럼이 없으므로(20260911000600 정의 확인) 확정 시각 기준이 유일한 선택지다(컨트롤러 판정 1).
--   2) SUPPLY_MEETING   — core.supply_meeting_result. SCM 품목담당자(SUPPLY_MEETING_INPUT)가 회의 결과를
--      대신 입력한다(계획월·품목·수량·승인여부·입력자/시각). 팀장 승인 절차가 없다(stage1.md §5 155행) —
--      approved 플래그 자체가 입력 시점의 최종 판단이다. 부서 제출 수량(core.demand_submission_line)은
--      참고 근거로만 연결하고 절대 직접 합산하지 않는다(컨트롤러 판정 2).
--   3) EVENT_DEMAND     — core.event_demand. SCM팀장(EVENT_ORDER_APPROVE) 승인이 APPROVED인 건만
--      집계한다. 승인 전 0, 승인 후 전량, 반려 후 0(컨트롤러 판정 4). 요청·승인은 Task 2의 공통 승인
--      원장(core.approval_request, approval_type = 'EVENT_ORDER')을 그대로 쓴다 — 고객·기종·수량 사유
--      검증은 core.request_approval이 이미 한다(중복 구현하지 않는다).
--
-- ★ 권한 — lib/permission.ts에 이미 등록된 코드를 그대로 쓴다(새 코드를 만들지 않는다).
--   `SUPPLY_MEETING_INPUT`('수급회의 결과 대리 입력', SCM_PLANNER 전용)이 수급회의 결과 입력 권한이다.
--   브리핑의 "SCM 담당자(PLAN_CONFIRM)"는 역할을 가리키는 표현이고, 이미 그 역할 전용으로 만들어진
--   전용 권한 코드가 있으므로(20260911000200_step19_permission.sql 50·85행) 그 코드를 쓴다 — 두 코드
--   모두 SCM_PLANNER에만 매핑되어 있어 현재 동작은 같지만, 권한 판정이 한 곳(core.has_permission)에
--   머무르게 한다. 이벤트 추가 수요 요청은 Task 2와 같은 DEMAND_CONSOLIDATE, 승인은 EVENT_ORDER_APPROVE다.
--
-- ★ sales_probability·파트너 선주문·미승인 이벤트는 참고정보로만 조회 가능하고 이 마이그레이션의
--   집계 뷰에는 조인하지 않는다. sales_probability 컬럼과 파트너 선주문 테이블은 만들지 않는다
--   (데이터 원천이 없다 — 컨트롤러 판정 3).
--
-- ★ core.v_approved_demand_source는 core.v_item_allocation_qty(Task 5, 20260911000600 988행 주석)와
--   같은 이유로 "소유자 권한 뷰"다 — security_invoker를 켜면 호출자의 core.sales_order RLS
--   (본인 주문 또는 ALLOC_* 권한 보유자만)가 그대로 적용되어, ALLOC_VIEW가 없는 SCM 품목담당자·팀장은
--   남의 확정 주문 줄이 빠진 채 합계를 보게 된다. 그래서 소유자 권한으로 전체를 모으고, 뷰 자체의
--   WHERE 절에서 DEMAND_CONSOLIDATE·PLAN_CONFIRM·PLAN_APPROVE·EVENT_ORDER_APPROVE·SUPPLY_MEETING_INPUT·
--   ADMIN만 통과시킨다. analytics 뷰는 security_invoker = true로 이 core 뷰 하나만 조회해 SCHEMA.md
--   규칙("신규 analytics 운영 뷰는 security_invoker = true")을 지키면서, 실제 행 필터는 core 뷰의
--   명시적 권한 검사로 옮긴다.


-- ══ 1. 수급회의 결과(대리 입력) ═══════════════════════════════════════

create table if not exists core.supply_meeting_result (
  result_id                 uuid primary key default gen_random_uuid(),
  plan_month                date not null check (plan_month = date_trunc('month', plan_month)::date),
  item_id                   text not null check (btrim(item_id) <> ''),
  qty                       numeric not null check (qty >= 0),
  approved                  boolean not null default false,
  basis_submission_line_id  uuid references core.demand_submission_line(line_id) on delete set null,
  entered_by                uuid not null references auth.users(id) on delete restrict,
  entered_by_name           text not null check (btrim(entered_by_name) <> ''),
  entered_at                timestamptz not null default clock_timestamp(),
  updated_by                uuid not null references auth.users(id) on delete restrict,
  updated_by_name           text not null check (btrim(updated_by_name) <> ''),
  updated_at                timestamptz not null default clock_timestamp(),
  unique (plan_month, item_id)
);

create index if not exists supply_meeting_result_item_idx
  on core.supply_meeting_result (item_id, plan_month desc);

comment on table core.supply_meeting_result is
  'Task 8 — 수급회의 결과 대리 입력(SCM 품목담당자, SUPPLY_MEETING_INPUT). 계획월·품목당 한 행만 최신값을 '
  '보관하고, 수정 이력은 core.supply_meeting_result_event에 append-only로 남긴다. 팀장 승인 절차 없음(stage1.md §5)';
comment on column core.supply_meeting_result.basis_submission_line_id is
  '선택적 참고 근거(AGREED 부서 제출 줄). 이 값이 있어도 부서 제출 수량은 집계에 직접 합산되지 않는다';

create table if not exists core.supply_meeting_result_event (
  event_id           bigint generated always as identity primary key,
  result_id          uuid not null references core.supply_meeting_result(result_id) on delete restrict,
  plan_month         date not null,
  item_id            text not null,
  previous_qty       numeric,
  qty                numeric not null,
  previous_approved  boolean,
  approved           boolean not null,
  actor              uuid not null references auth.users(id) on delete restrict,
  actor_name         text not null,
  reason             text,
  at                 timestamptz not null default clock_timestamp()
);

create index if not exists supply_meeting_result_event_result_idx
  on core.supply_meeting_result_event (result_id, at, event_id);

comment on table core.supply_meeting_result_event is
  'Task 8 — 수급회의 결과 수정 append-only 이력. previous_* 열이 수정 전 값을 보존한다';

create or replace function core.reject_supply_meeting_result_event_mutation()
returns trigger
language plpgsql
set search_path = core, pg_temp
as $$
begin
  raise exception '수급회의 결과 이력은 수정하거나 삭제할 수 없습니다.' using errcode = '42501';
end;
$$;

drop trigger if exists supply_meeting_result_event_append_only on core.supply_meeting_result_event;
create trigger supply_meeting_result_event_append_only
  before update or delete on core.supply_meeting_result_event
  for each row execute function core.reject_supply_meeting_result_event_mutation();

create or replace function core.guard_supply_meeting_result_mutation()
returns trigger
language plpgsql
set search_path = core, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '수급회의 결과는 삭제할 수 없습니다. 수량을 0으로 수정하고 이력을 남기세요.' using errcode = '42501';
  end if;
  if (new.result_id, new.plan_month, new.item_id, new.entered_by, new.entered_by_name, new.entered_at)
     is distinct from
     (old.result_id, old.plan_month, old.item_id, old.entered_by, old.entered_by_name, old.entered_at) then
    raise exception '결과의 대상(계획월·품목)과 최초 입력자·시각은 변경할 수 없습니다.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists supply_meeting_result_guard on core.supply_meeting_result;
create trigger supply_meeting_result_guard
  before update or delete on core.supply_meeting_result
  for each row execute function core.guard_supply_meeting_result_mutation();

-- 입력 또는 수정. 이미 같은 (계획월, 품목) 행이 있으면 이전 값을 이력에 남기고 갱신한다(컨트롤러 판정 2).
create or replace function core.set_supply_meeting_result(
  p_plan_month date,
  p_item_id text,
  p_qty numeric,
  p_approved boolean,
  p_basis_submission_line_id uuid default null,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_item_id text := core.normalize_item_id(p_item_id);
  v_plan_month date;
  v_item_name text;
  v_submission_status text;
  v_existing core.supply_meeting_result%rowtype;
  v_result_id uuid;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 수급회의 결과를 입력할 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('SUPPLY_MEETING_INPUT', v_actor) then
    raise exception '수급회의 결과 입력 권한(SUPPLY_MEETING_INPUT)이 없습니다.' using errcode = '42501';
  end if;
  if p_plan_month is null then
    raise exception 'PLAN_MONTH_REQUIRED: 계획월은 필수입니다.' using errcode = '22023';
  end if;
  if v_item_id = '' then
    raise exception 'ITEM_ID_REQUIRED: 품목코드는 필수입니다.' using errcode = '22023';
  end if;
  if p_qty is null or p_qty < 0 then
    raise exception 'QTY_INVALID: 수량은 0 이상이어야 합니다.' using errcode = '22023';
  end if;
  if p_approved is null then
    raise exception 'APPROVED_REQUIRED: 승인 여부는 필수입니다.' using errcode = '22023';
  end if;

  v_plan_month := date_trunc('month', p_plan_month)::date;

  select im.item_name into v_item_name from core.v_item_master im where im.item_id = v_item_id;
  if v_item_name is null then
    raise exception 'ITEM_NOT_FOUND: 품목 마스터에 없는 품목입니다 (%).', v_item_id using errcode = '22023';
  end if;

  if p_basis_submission_line_id is not null then
    select s.status into v_submission_status
      from core.demand_submission_line dl
      join core.demand_submission s on s.submission_id = dl.submission_id
     where dl.line_id = p_basis_submission_line_id;
    if v_submission_status is null then
      raise exception 'BASIS_LINE_NOT_FOUND: 근거로 지정한 제출 항목을 찾을 수 없습니다.' using errcode = 'P0002';
    end if;
    if v_submission_status <> 'AGREED' then
      raise exception 'BASIS_LINE_NOT_AGREED: 근거 제출 항목은 부서 합의(AGREED) 상태여야 합니다 (현재 %).', v_submission_status
        using errcode = '22023';
    end if;
  end if;

  select coalesce(nullif(btrim(u.name), ''), nullif(btrim(u.email), ''), u.user_id::text)
    into v_actor_name
    from core.app_user u
   where u.user_id = v_actor;

  select * into v_existing
    from core.supply_meeting_result r
   where r.plan_month = v_plan_month and r.item_id = v_item_id
     for update;

  if found then
    update core.supply_meeting_result
       set qty = p_qty,
           approved = p_approved,
           basis_submission_line_id = p_basis_submission_line_id,
           updated_by = v_actor,
           updated_by_name = v_actor_name,
           updated_at = clock_timestamp()
     where result_id = v_existing.result_id
    returning result_id into v_result_id;

    insert into core.supply_meeting_result_event (
      result_id, plan_month, item_id, previous_qty, qty, previous_approved, approved, actor, actor_name, reason
    ) values (
      v_result_id, v_plan_month, v_item_id, v_existing.qty, p_qty, v_existing.approved, p_approved,
      v_actor, v_actor_name, nullif(btrim(p_reason), '')
    );
  else
    insert into core.supply_meeting_result (
      plan_month, item_id, qty, approved, basis_submission_line_id,
      entered_by, entered_by_name, updated_by, updated_by_name
    ) values (
      v_plan_month, v_item_id, p_qty, p_approved, p_basis_submission_line_id,
      v_actor, v_actor_name, v_actor, v_actor_name
    )
    returning result_id into v_result_id;

    insert into core.supply_meeting_result_event (
      result_id, plan_month, item_id, previous_qty, qty, previous_approved, approved, actor, actor_name, reason
    ) values (
      v_result_id, v_plan_month, v_item_id, null, p_qty, null, p_approved, v_actor, v_actor_name, nullif(btrim(p_reason), '')
    );
  end if;

  return v_result_id;
end;
$$;

comment on function core.set_supply_meeting_result(date, text, numeric, boolean, uuid, text) is
  'Task 8 — 수급회의 결과 대리 입력·수정(SUPPLY_MEETING_INPUT). 팀장 승인이 없다 — approved 플래그가 '
  '최종 판단이다. 이미 있는 (계획월, 품목) 행이면 이전 값을 core.supply_meeting_result_event에 남기고 갱신한다';


-- ══ 2. 이벤트성 추가 수요(팀장 승인) ═══════════════════════════════════

create table if not exists core.event_demand (
  event_demand_id    uuid primary key default gen_random_uuid(),
  plan_month         date not null check (plan_month = date_trunc('month', plan_month)::date),
  item_id            text not null check (btrim(item_id) <> ''),
  customer_name      text not null check (btrim(customer_name) <> ''),
  qty                numeric not null check (qty > 0),
  reason             text not null check (btrim(reason) <> ''),
  status             text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  approval_id        uuid references core.approval_request(approval_id) on delete restrict,
  requested_by       uuid not null references auth.users(id) on delete restrict,
  requested_by_name  text not null check (btrim(requested_by_name) <> ''),
  requested_at       timestamptz not null default clock_timestamp(),
  decided_by         uuid references auth.users(id) on delete restrict,
  decided_by_name    text,
  decided_at         timestamptz,
  decision_comment   text,
  unique (approval_id),
  constraint event_demand_decision_check check (
    (status = 'PENDING' and decided_by is null and decided_at is null and decided_by_name is null)
    or (status in ('APPROVED', 'REJECTED') and decided_by is not null and decided_at is not null
        and nullif(btrim(decided_by_name), '') is not null)
  )
);

create index if not exists event_demand_item_idx on core.event_demand (item_id, plan_month desc);
create index if not exists event_demand_status_idx on core.event_demand (status, requested_at desc);

comment on table core.event_demand is
  'Task 8 — 이벤트성 대량 거래 추가 발주 요청(SCM팀장 승인, EVENT_ORDER_APPROVE). 승인 전 0건, 승인 후 '
  '전량, 반려 후 0건으로 집계된다(analytics.v_approved_demand_detail). 승인/반려는 core.approval_request '
  '(approval_type = EVENT_ORDER)를 그대로 쓰고 이 표는 그 결정 결과만 반영한다';

create or replace function core.guard_event_demand_mutation()
returns trigger
language plpgsql
set search_path = core, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '이벤트 추가 수요 요청은 삭제할 수 없습니다.' using errcode = '42501';
  end if;
  if (new.event_demand_id, new.plan_month, new.item_id, new.customer_name, new.qty, new.reason,
      new.requested_by, new.requested_by_name, new.requested_at)
     is distinct from
     (old.event_demand_id, old.plan_month, old.item_id, old.customer_name, old.qty, old.reason,
      old.requested_by, old.requested_by_name, old.requested_at) then
    raise exception '이벤트 추가 수요의 요청 내용은 변경할 수 없습니다.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (old.status = 'PENDING' and new.status in ('APPROVED', 'REJECTED')) then
    raise exception '허용되지 않는 이벤트 추가 수요 상태 전환입니다: % → %', old.status, new.status using errcode = '22023';
  end if;
  if new.approval_id is distinct from old.approval_id and old.approval_id is not null then
    raise exception '승인 요청 연결은 한 번만 기록할 수 있습니다.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists event_demand_guard on core.event_demand;
create trigger event_demand_guard
  before update or delete on core.event_demand
  for each row execute function core.guard_event_demand_mutation();

-- 등록 — 이벤트 추가 수요 행을 만들고(target_id로 쓸 ID 확보), Task 2 공통 승인 원장에 EVENT_ORDER
-- 승인을 요청한 뒤 그 승인ID를 되돌려 연결한다. core.request_approval이 고객·기종·수량 사유 검증을
-- 이미 하므로 여기서 다시 만들지 않는다(payload의 customer/model/quantity가 그 검증 대상이다).
create or replace function core.request_event_demand(
  p_plan_month date,
  p_item_id text,
  p_customer_name text,
  p_qty numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_item_id text := core.normalize_item_id(p_item_id);
  v_plan_month date;
  v_customer text := nullif(btrim(p_customer_name), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_item_name text;
  v_event_demand_id uuid;
  v_approval_id uuid;
  v_payload jsonb;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 이벤트 추가 수요를 등록할 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('DEMAND_CONSOLIDATE', v_actor) then
    raise exception '이벤트 추가 수요 등록 권한(DEMAND_CONSOLIDATE)이 없습니다.' using errcode = '42501';
  end if;
  if p_plan_month is null then
    raise exception 'PLAN_MONTH_REQUIRED: 대상월은 필수입니다.' using errcode = '22023';
  end if;
  if v_item_id = '' then
    raise exception 'EVENT_MODEL_REQUIRED: 이벤트 추가 수요의 기종은 필수입니다.' using errcode = '22023';
  end if;
  if v_customer is null then
    raise exception 'EVENT_CUSTOMER_REQUIRED: 이벤트 추가 수요의 고객은 필수입니다.' using errcode = '22023';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'EVENT_QUANTITY_REQUIRED: 이벤트 추가 수요의 수량은 양수여야 합니다.' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'EVENT_REASON_REQUIRED: 승인 요청 사유는 필수입니다.' using errcode = '22023';
  end if;

  v_plan_month := date_trunc('month', p_plan_month)::date;

  select im.item_name into v_item_name from core.v_item_master im where im.item_id = v_item_id;
  if v_item_name is null then
    raise exception 'ITEM_NOT_FOUND: 품목 마스터에 없는 품목입니다 (%).', v_item_id using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(u.name), ''), nullif(btrim(u.email), ''), u.user_id::text)
    into v_actor_name
    from core.app_user u
   where u.user_id = v_actor;

  insert into core.event_demand (
    plan_month, item_id, customer_name, qty, reason, requested_by, requested_by_name
  ) values (
    v_plan_month, v_item_id, v_customer, p_qty, v_reason, v_actor, v_actor_name
  )
  returning event_demand_id into v_event_demand_id;

  -- request_approval의 EVENT_ORDER 검증(고객·기종·수량)에 맞춰 payload 키를 그대로 채운다.
  v_payload := jsonb_build_object(
    'customer', v_customer, 'model', v_item_id, 'item_id', v_item_id, 'item_name', v_item_name,
    'quantity', p_qty, 'plan_month', v_plan_month, 'reason', v_reason
  );

  v_approval_id := core.request_approval(
    'EVENT_ORDER', 'EVENT_DEMAND', v_event_demand_id::text, v_payload, 'EVENT_DEMAND', v_reason
  );

  update core.event_demand set approval_id = v_approval_id where event_demand_id = v_event_demand_id;

  return v_event_demand_id;
end;
$$;

comment on function core.request_event_demand(date, text, text, numeric, text) is
  'Task 8 — 이벤트성 추가 수요 등록(DEMAND_CONSOLIDATE). 행을 먼저 만들어 target_id로 쓰고, Task 2 '
  'core.request_approval(EVENT_ORDER)로 SCM팀장 승인을 요청한 뒤 승인ID를 연결한다(Task 5 ALLOC_PRIORITY와 같은 방식)';


-- ══ 3. EVENT_ORDER 승인 후처리(Task 5 ALLOC_PRIORITY와 같은 방식) ══════════
--
-- Task 2의 core.decide_approval이 승인 상태를 바꾸는 같은 트랜잭션에서 아래 트리거가 실행된다.
-- decide_approval을 다시 정의하지 않는다.

create or replace function core.guard_event_order_approval_request()
returns trigger
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
begin
  if new.approval_type <> 'EVENT_ORDER' then
    return new;
  end if;
  if new.target_type <> 'EVENT_DEMAND'
     or not exists (
       select 1 from core.event_demand e
        where e.event_demand_id::text = new.target_id
          and e.status = 'PENDING'
          and e.approval_id is null
     ) then
    raise exception '이벤트 추가 수요 승인은 core.request_event_demand()가 만든 대기 요청에만 요청할 수 있습니다.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists event_order_request_guard on core.approval_request;
create trigger event_order_request_guard
  before insert on core.approval_request
  for each row execute function core.guard_event_order_approval_request();

create or replace function core.apply_event_demand_decision()
returns trigger
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_updated core.event_demand%rowtype;
begin
  if new.approval_type <> 'EVENT_ORDER' or old.status <> 'PENDING' or new.status not in ('APPROVED', 'REJECTED') then
    return new;
  end if;

  update core.event_demand
     set status = new.status,
         decided_by = new.decided_by,
         decided_by_name = new.decider_name,
         decided_at = new.decided_at,
         decision_comment = new.decision_comment
   where approval_id = new.approval_id
  returning * into v_updated;

  if not found then
    raise exception '이벤트 추가 수요 승인과 연결된 요청을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  -- 요청자와 승인자에게 결과를 알린다(Task 3 결과 알림과 같은 dedupe 키 규칙 — ALLOC_PRIORITY 후처리와 같다).
  perform core.enqueue_order_notice(
    'approval:' || new.approval_id || ':decision:' || new.status,
    'EVENT_DEMAND_DECIDED',
    array[new.requested_by],
    jsonb_build_object(
      'title', case new.status when 'APPROVED' then '이벤트 추가 수요 요청이 승인되었습니다'
                               else '이벤트 추가 수요 요청이 반려되었습니다' end,
      'message', format(
        '고객 %s · 품목 %s · 수량 %s · 결과 %s · 팀장 의견: %s',
        v_updated.customer_name, v_updated.item_id, v_updated.qty,
        case new.status when 'APPROVED' then '승인(발주 수요 반영)' else '반려(미반영)' end,
        coalesce(nullif(btrim(new.decision_comment), ''), '없음')
      ),
      'target_id', v_updated.event_demand_id::text,
      'event_demand_id', v_updated.event_demand_id, 'decision', new.status,
      'item_id', v_updated.item_id, 'qty', v_updated.qty, 'plan_month', v_updated.plan_month,
      'decision_comment', new.decision_comment, 'decider_name', new.decider_name, 'decided_at', new.decided_at
    )
  );

  return new;
end;
$$;

drop trigger if exists event_demand_decision_apply on core.approval_request;
create trigger event_demand_decision_apply
  after update of status on core.approval_request
  for each row
  when (new.approval_type = 'EVENT_ORDER' and old.status = 'PENDING' and new.status <> 'PENDING')
  execute function core.apply_event_demand_decision();


-- ══ 4. 확정 수요 원천(소유자 권한) ════════════════════════════════════

create or replace view core.v_approved_demand_source as
select * from (
  select
    'CONFIRMED_ORDER'::text as source_code,
    date_trunc('month', o.confirmed_at at time zone 'Asia/Seoul')::date as plan_month,
    l.item_id,
    im1.item_name,
    l.requested_qty as qty,
    true as counted,
    null::text as exclusion_reason,
    o.order_id::text as reference_id,
    o.order_no as reference_label,
    o.customer_name,
    core.order_actor_name(o.confirmed_by) as entered_by_name,
    o.confirmed_at as entered_at,
    null::text as decision_comment,
    'CONFIRMED'::text as status_label
  from core.sales_order o
  join core.sales_order_line l on l.order_id = o.order_id
  left join core.v_item_master im1 on im1.item_id = l.item_id
  where o.status = 'CONFIRMED'
    and nullif(btrim(o.confirmed_order_no), '') is not null

  union all

  select
    'SUPPLY_MEETING'::text as source_code,
    m.plan_month,
    m.item_id,
    im2.item_name,
    m.qty,
    m.approved as counted,
    case when not m.approved then 'MEETING_NOT_APPROVED' end as exclusion_reason,
    m.result_id::text as reference_id,
    null::text as reference_label,
    null::text as customer_name,
    m.updated_by_name as entered_by_name,
    m.updated_at as entered_at,
    null::text as decision_comment,
    case when m.approved then 'APPROVED' else 'NOT_APPROVED' end as status_label
  from core.supply_meeting_result m
  left join core.v_item_master im2 on im2.item_id = m.item_id

  union all

  select
    'EVENT_DEMAND'::text as source_code,
    e.plan_month,
    e.item_id,
    im3.item_name,
    e.qty,
    (e.status = 'APPROVED') as counted,
    case when e.status = 'PENDING' then 'EVENT_NOT_APPROVED'
         when e.status = 'REJECTED' then 'EVENT_REJECTED' end as exclusion_reason,
    e.event_demand_id::text as reference_id,
    e.reason as reference_label,
    e.customer_name,
    e.requested_by_name as entered_by_name,
    e.requested_at as entered_at,
    e.decision_comment,
    e.status as status_label
  from core.event_demand e
  left join core.v_item_master im3 on im3.item_id = e.item_id
) src
where core.has_permission('DEMAND_CONSOLIDATE')
   or core.has_permission('PLAN_CONFIRM')
   or core.has_permission('PLAN_APPROVE')
   or core.has_permission('EVENT_ORDER_APPROVE')
   or core.has_permission('SUPPLY_MEETING_INPUT')
   or core.is_admin();

comment on view core.v_approved_demand_source is
  'Task 8 — 소유자 권한 뷰(core.v_item_allocation_qty와 같은 이유). CONFIRMED_ORDER·SUPPLY_MEETING·'
  'EVENT_DEMAND 세 원천을 한 행씩 모으고, 뷰 자체의 WHERE 절이 조회 권한을 판정한다. sales_probability나 '
  '파트너 선주문·미승인 이벤트는 이 뷰에 애초에 없다(조인하지 않는다) — 컨트롤러 판정 3';


-- ══ 5. analytics 뷰 ═══════════════════════════════════════════════════

create or replace view analytics.v_approved_demand_detail
with (security_invoker = true)
as
select
  source_code, plan_month, item_id, item_name, qty, counted, exclusion_reason,
  reference_id, reference_label, customer_name, entered_by_name, entered_at,
  decision_comment, status_label
from core.v_approved_demand_source;

comment on view analytics.v_approved_demand_detail is
  'Task 8 — 원천별 상세. counted = false인 행은 화면에 보이되 exclusion_reason으로 제외 사유를 '
  '표시한다(MEETING_NOT_APPROVED · EVENT_NOT_APPROVED · EVENT_REJECTED). 합계는 이 표에서 TS로 다시 '
  '더하지 않고 analytics.v_approved_demand_monthly의 저장된 합계를 그대로 쓴다';

-- 월간 뷰: counted = true인 행만 합산한다. counted = false인 행의 수량·사유가 바뀌어도 합계는
-- 변하지 않는다(검증 체크리스트). 권한 필터는 v_approved_demand_detail 하나에만 두고 여기서 다시
-- 반복하지 않는다 — 권한이 없으면 위 뷰가 이미 빈 결과를 주므로 group by도 빈 결과가 된다.
create or replace view analytics.v_approved_demand_monthly
with (security_invoker = true)
as
select
  plan_month,
  item_id,
  item_name,
  coalesce(sum(qty) filter (where counted), 0) as approved_qty,
  coalesce(sum(qty) filter (where counted and source_code = 'CONFIRMED_ORDER'), 0) as confirmed_order_qty,
  coalesce(sum(qty) filter (where counted and source_code = 'SUPPLY_MEETING'), 0) as supply_meeting_qty,
  coalesce(sum(qty) filter (where counted and source_code = 'EVENT_DEMAND'), 0) as event_demand_qty
from analytics.v_approved_demand_detail
group by plan_month, item_id, item_name;

comment on view analytics.v_approved_demand_monthly is
  'Task 8 — Task 9의 유일한 추가 수요 입력. approved_qty = 확정 수주 + 승인된 수급회의 + 승인된 이벤트 '
  '추가 수요. sales_probability·파트너 선주문·미승인 이벤트는 참조하지 않는다';


-- ══ 6. RLS와 권한 ═════════════════════════════════════════════════════

alter table core.supply_meeting_result enable row level security;
alter table core.supply_meeting_result_event enable row level security;
alter table core.event_demand enable row level security;

drop policy if exists supply_meeting_result_read on core.supply_meeting_result;
create policy supply_meeting_result_read on core.supply_meeting_result
  for select to authenticated
  using (
    core.has_permission('SUPPLY_MEETING_INPUT')
    or core.has_permission('DEMAND_CONSOLIDATE')
    or core.has_permission('PLAN_CONFIRM')
    or core.has_permission('PLAN_APPROVE')
    or core.is_admin()
  );

drop policy if exists supply_meeting_result_event_read on core.supply_meeting_result_event;
create policy supply_meeting_result_event_read on core.supply_meeting_result_event
  for select to authenticated
  using (exists (
    select 1 from core.supply_meeting_result r where r.result_id = supply_meeting_result_event.result_id
  ));

-- 검증 체크리스트: 요청자 본인, 승인 권한자, 취합 담당만 조회한다. 다른 부서·일반 사용자는 보지 못한다.
drop policy if exists event_demand_read on core.event_demand;
create policy event_demand_read on core.event_demand
  for select to authenticated
  using (
    requested_by = auth.uid()
    or core.has_permission('DEMAND_CONSOLIDATE')
    or core.has_permission('EVENT_ORDER_APPROVE')
    or core.has_permission('PLAN_CONFIRM')
    or core.is_admin()
  );

revoke all on core.supply_meeting_result, core.supply_meeting_result_event, core.event_demand from anon, public;
revoke insert, update, delete on core.supply_meeting_result, core.supply_meeting_result_event, core.event_demand
  from authenticated;
grant select on core.supply_meeting_result, core.supply_meeting_result_event, core.event_demand to authenticated;

revoke all on core.v_approved_demand_source from anon, public;
grant select on core.v_approved_demand_source to authenticated;
revoke all on analytics.v_approved_demand_detail, analytics.v_approved_demand_monthly from anon, public;
grant select on analytics.v_approved_demand_detail, analytics.v_approved_demand_monthly to authenticated;

revoke all on function core.set_supply_meeting_result(date, text, numeric, boolean, uuid, text) from public, anon;
grant execute on function core.set_supply_meeting_result(date, text, numeric, boolean, uuid, text) to authenticated;

revoke all on function core.request_event_demand(date, text, text, numeric, text) from public, anon;
grant execute on function core.request_event_demand(date, text, text, numeric, text) to authenticated;

revoke all on function core.guard_supply_meeting_result_mutation() from public, anon, authenticated;
revoke all on function core.reject_supply_meeting_result_event_mutation() from public, anon, authenticated;
revoke all on function core.guard_event_demand_mutation() from public, anon, authenticated;
revoke all on function core.guard_event_order_approval_request() from public, anon, authenticated;
revoke all on function core.apply_event_demand_decision() from public, anon, authenticated;


-- ══ 7. 수동 적용 후 확인 쿼리(SQL Editor 전용) ══════════════════════════

-- (a) 확률 100%짜리 영업 건도 수주 확정 번호가 없으면 0건인지 — CONFIRMED가 아닌 모든 상태는
--     never 0건 이상 집계되지 않는다(구조적으로 원천 뷰가 status = 'CONFIRMED'만 본다).
-- select count(*) from analytics.v_approved_demand_detail
--  where source_code = 'CONFIRMED_ORDER' and item_id = '<검증용 품목>'
--    and plan_month = '<확정 전 달>';
-- 기대: 0

-- (b) 취소된 주문은 confirmed_order_no가 남아 있어도 집계되지 않는지.
-- select o.order_no, o.status, o.confirmed_order_no
--   from core.sales_order o where o.status = 'CANCELLED' and o.confirmed_order_no is not null;
-- 그 order_no가 analytics.v_approved_demand_detail의 reference_label에 없어야 한다.

-- (c) 이벤트 승인 전 0 · 승인 후 전량 · 반려 후 0.
-- select status_label, counted, qty, exclusion_reason
--   from analytics.v_approved_demand_detail
--  where source_code = 'EVENT_DEMAND' and reference_id = '<event_demand_id>';

-- (d) 수급회의 결과 수정 이력이 이전 값을 보존하는지.
-- select previous_qty, qty, previous_approved, approved, actor_name, at
--   from core.supply_meeting_result_event
--  where result_id = '<result_id>' order by at;

-- (e) 월간 합계가 analytics 저장 결과와 같은지(화면은 이 값을 그대로 쓴다. TS 재계산 금지).
-- select plan_month, item_id, approved_qty, confirmed_order_qty, supply_meeting_qty, event_demand_qty
--   from analytics.v_approved_demand_monthly order by plan_month, item_id;

-- (f) 뷰가 확률·파트너 선주문·레거시 더미 테이블을 참조하지 않는지(컨트롤러 판정 3 — SQL 계약 검사).
-- select viewname, definition from pg_views
--  where schemaname in ('core', 'analytics') and viewname in ('v_approved_demand_source', 'v_approved_demand_detail', 'v_approved_demand_monthly')
--    and definition ~* 'sales_probability|partner_pre_order|usage_history|purchase_order';
-- 기대: 0행
