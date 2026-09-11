-- Task 5 · 영업 주문과 임시·확정 배정 트랜잭션
--
-- 목적: 여러 영업담당자가 같은 재고를 동시에 주문해도 초과 배정되지 않게 한다 (stage1 §2).
-- 실제 Supabase 적용은 사용자가 SQL Editor에서 수동으로 수행한다. 다시 실행해도 안전하다
-- (if not exists · create or replace · drop 후 재생성). 운영 테이블에 예시 데이터를 넣지 않는다.
--
-- ★ 잠금 순서 — 교착을 막기 위해 모든 경로가 같은 순서를 따른다 (Task 6도 반드시 따른다)
--     1) core.stock_balance 품목 행 — 품목코드 오름차순, core.lock_stock_balance_items()
--     2) core.sales_order 주문 행
--     3) core.stock_allocation 배정 행
--     4) core.approval_request 승인 행
--   "가용재고 = 정상 창고재고 − (TEMPORARY + APPROVAL_HOLD + FIRM)" 판정은 반드시 1)을 잡은 뒤
--   같은 트랜잭션 안에서 한다. READ COMMITTED에서는 잠금을 기다린 뒤 실행되는 다음 문장이 먼저
--   끝난 트랜잭션의 배정을 보므로, 두 요청이 같은 재고를 중복으로 가져갈 수 없다.
--   예외: core.decide_approval(Task 2)은 승인 행을 먼저 잠근다. 같은 주문의 승인과 확정배정 취소가
--   동시에 일어나는 드문 경우 PostgreSQL이 교착을 감지해 한쪽을 40P01로 되돌린다(데이터 손상 없음).
--
-- ★ 컨트롤러 판정 반영
--   - 검토 요청 시점의 임시배정은 그 순간의 가용재고에서 선착순으로만 한다. 우선순위 → 최초 검토
--     요청 시각 → 주문 생성 순서는 신규 입고 배정(Task 6)과 수동배정의 "정상 순서" 판정에만 쓴다.
--   - 임시배정 만료 = 최초 검토 요청 시각 + 30일. 주문 단위로 한 번만 기록하고 트리거로 변경을 막는다.
--     나중에 추가되는 임시배정도 같은 만료 시각을 쓴다(배정 행에 만료일을 따로 두지 않는다).
--   - 수동배정의 정상 순서 = 같은 품목에 더 앞선 순번의 부족수량 보유 주문이 없는 경우. 있으면
--     APPROVAL_HOLD + ALLOC_PRIORITY 승인 요청(사유 필수). 승인 → 즉시 FIRM, 반려 → 즉시 해제.
--   - 수주 확정은 임시배정을 FIRM으로 바꾸고, 남은 부족수량은 대기열에 남으며 이후 배정은 곧바로 FIRM.
--   - 재등록은 CANCELLED · EXPIRED 주문에서 새 주문을 만들고 replaces_order_id로 잇는다.
--   - 확정 전 주문은 등록자가 core.cancel_sales_order로 취소한다(임시 · 확보 해제, 대기 중 우선 배정 요청 취소).
--     확정배정이 있으면 거절하고 core.cancel_firm_allocation 경로로 보낸다.
--   - 고객 마스터가 없으므로 고객코드 · 고객명 텍스트를 주문에 저장한다.
--   - core.urgent_order는 테이블 · 뷰 · RLS만 만든다(등록 함수와 화면은 Task 11).
--
-- ★ Task 6이 호출할 계약 (내부 전용 — authenticated에 실행 권한이 없다)
--   core.allocate_to_order_line(p_line_id, p_max_qty, p_source, p_actor)   주문 품목 1건 후속 배정
--   core.transition_stock_allocation(p_allocation_id, p_next_status, p_actor, p_reason, p_cause, p_payload)
--   core.apply_sales_order_status(p_order_id)                               주문 상태 재계산
--   core.log_sales_order_event(p_order_id, p_event_type, ...)               주문 이력
--   core.lock_stock_balance_items(p_item_ids, p_require_all)                1) 잠금
--   core.v_allocation_queue_line                                            대기 순번의 단일 정의
--   임시배정 만료 알림 series id = 주문 ID(order_id::text) — core.enqueue_temporary_allocation_released에
--   같은 값을 넘긴다.


-- ══ 1. 주문 ═══════════════════════════════════════════════════════

create sequence if not exists core.sales_order_no_seq;

create table if not exists core.sales_order (
  order_id                  uuid primary key default gen_random_uuid(),
  order_seq                 bigint generated always as identity unique,
  order_no                  text not null unique check (btrim(order_no) <> ''),
  customer_id               text,
  customer_name             text not null check (btrim(customer_name) <> ''),
  owner_user_id             uuid not null references auth.users(id) on delete restrict,
  owner_name                text not null check (btrim(owner_name) <> ''),
  status                    text not null default 'DRAFT' check (status in (
    'DRAFT', 'REVIEW_REQUESTED', 'PARTIALLY_ALLOCATED', 'WAITING_FULL',
    'CONFIRMED', 'EXPIRED', 'CANCELLED'
  )),
  requested_at              timestamptz not null default now(),
  first_review_requested_at timestamptz,
  temporary_expires_at      timestamptz,
  allocation_choice         text check (allocation_choice is null or allocation_choice in ('PARTIAL', 'WAIT_FULL')),
  allocation_choice_by      uuid references auth.users(id) on delete restrict,
  allocation_priority       integer not null default 5 check (allocation_priority between 1 and 9),
  confirmed_order_no        text,
  confirmed_at              timestamptz,
  confirmed_by              uuid references auth.users(id) on delete restrict,
  cancelled_at              timestamptz,
  cancelled_by              uuid references auth.users(id) on delete restrict,
  cancel_reason             text,
  expired_at                timestamptz,
  replaces_order_id         uuid references core.sales_order(order_id) on delete restrict,
  note                      text,
  updated_at                timestamptz not null default now(),
  constraint sales_order_review_fields_check check (
    case
      when status = 'DRAFT' then first_review_requested_at is null
        and temporary_expires_at is null and allocation_choice is null
      when status = 'CANCELLED' then true
      else first_review_requested_at is not null
        and temporary_expires_at is not null and allocation_choice is not null
    end
  ),
  constraint sales_order_confirmed_fields_check check (
    status <> 'CONFIRMED'
    or (nullif(btrim(confirmed_order_no), '') is not null and confirmed_at is not null and confirmed_by is not null)
  ),
  constraint sales_order_cancelled_fields_check check (
    status <> 'CANCELLED' or (cancelled_at is not null and nullif(btrim(cancel_reason), '') is not null)
  ),
  constraint sales_order_expired_fields_check check (status <> 'EXPIRED' or expired_at is not null)
);

-- 최종 승인 주문번호는 확정 상태 주문 사이에서 중복될 수 없다(Task 8 확정 수요 이중 집계 방지).
-- 취소된 주문의 번호는 재등록 주문이 다시 쓸 수 있게 확정 상태만 유일하게 본다.
create unique index if not exists sales_order_confirmed_no_uq
  on core.sales_order (confirmed_order_no) where status = 'CONFIRMED';
-- 한 취소·만료 주문은 한 번만 재등록한다(중복 클릭으로 같은 주문이 두 번 복사되지 않게).
create unique index if not exists sales_order_replaces_uq
  on core.sales_order (replaces_order_id) where replaces_order_id is not null;
create index if not exists sales_order_owner_idx
  on core.sales_order (owner_user_id, requested_at desc);
create index if not exists sales_order_status_idx
  on core.sales_order (status, allocation_priority, first_review_requested_at, order_seq);

comment on table core.sales_order is
  'Task 5 영업 주문. 상태·배정 변경은 core 명령 함수로만 하며 모든 변경은 core.sales_order_event에 남는다';
comment on column core.sales_order.order_seq is
  '주문 생성 순서. 우선순위·최초 검토 요청 시각이 같을 때 먼저 만든 주문을 앞에 둔다';
comment on column core.sales_order.requested_at is '영업담당자가 주문을 등록한 시각';
comment on column core.sales_order.customer_id is
  '고객코드 텍스트. 고객 마스터가 없어 FK를 두지 않는다(컨트롤러 판정)';
comment on column core.sales_order.temporary_expires_at is
  '임시배정 만료 시각 = 최초 검토 요청 시각 + 30일. 한 번 기록하면 트리거가 변경을 막는다';
comment on column core.sales_order.allocation_priority is
  '사업강화부 우선순위(1 최우선 ~ 9 최후순, 기본 5). 변경 이력은 core.allocation_priority';


-- ══ 2. 주문 품목 ═══════════════════════════════════════════════════

create table if not exists core.sales_order_line (
  line_id                  bigint generated always as identity primary key,
  order_id                 uuid not null references core.sales_order(order_id) on delete restrict,
  line_no                  integer not null check (line_no > 0),
  item_id                  text not null check (btrim(item_id) <> ''),
  requested_qty            numeric not null check (requested_qty > 0),
  temporary_allocated_qty  numeric not null default 0 check (temporary_allocated_qty >= 0),
  firm_allocated_qty       numeric not null default 0 check (firm_allocated_qty >= 0),
  approval_hold_qty        numeric not null default 0 check (approval_hold_qty >= 0),
  shortage_qty             numeric generated always as (
    requested_qty - temporary_allocated_qty - firm_allocated_qty - approval_hold_qty
  ) stored,
  created_at               timestamptz not null default now(),
  constraint sales_order_line_no_over_allocation check (
    temporary_allocated_qty + firm_allocated_qty + approval_hold_qty <= requested_qty
  ),
  unique (order_id, line_no),
  unique (order_id, item_id)
);

create index if not exists sales_order_line_item_idx on core.sales_order_line (item_id, order_id);

comment on table core.sales_order_line is
  'Task 5 주문 품목. 임시·확정·승인대기 수량은 core.stock_allocation 합계를 같은 트랜잭션에서 옮겨 둔 값이다';
comment on column core.sales_order_line.shortage_qty is
  '부족수량 = 요청 − 임시배정 − 확정배정 − 승인대기 확보. 대기열 순번은 이 값이 0보다 큰 줄만 센다';


-- ══ 3. 재고 배정 ═══════════════════════════════════════════════════

create table if not exists core.stock_allocation (
  allocation_id    uuid primary key default gen_random_uuid(),
  order_id         uuid not null references core.sales_order(order_id) on delete restrict,
  line_id          bigint not null references core.sales_order_line(line_id) on delete restrict,
  item_id          text not null,
  status           text not null check (status in ('TEMPORARY', 'APPROVAL_HOLD', 'FIRM', 'RELEASED')),
  qty              numeric not null check (qty > 0),
  source           text not null check (source in ('REVIEW_REQUEST', 'MANUAL', 'RECEIPT')),
  approval_id      uuid references core.approval_request(approval_id) on delete restrict,
  reason           text,
  created_by       uuid references auth.users(id) on delete restrict,
  created_by_name  text not null,
  created_at       timestamptz not null default clock_timestamp(),
  firm_at          timestamptz,
  released_at      timestamptz,
  released_by      uuid references auth.users(id) on delete restrict,
  release_reason   text,
  constraint stock_allocation_hold_source_check check (status <> 'APPROVAL_HOLD' or source = 'MANUAL'),
  constraint stock_allocation_firm_fields_check check (status <> 'FIRM' or firm_at is not null),
  constraint stock_allocation_release_fields_check check (
    (status = 'RELEASED') = (released_at is not null and nullif(btrim(release_reason), '') is not null)
  )
);

create index if not exists stock_allocation_item_active_idx
  on core.stock_allocation (item_id, status) where status <> 'RELEASED';
create index if not exists stock_allocation_order_idx on core.stock_allocation (order_id, status);
create index if not exists stock_allocation_line_idx on core.stock_allocation (line_id, status);
create unique index if not exists stock_allocation_approval_uq
  on core.stock_allocation (approval_id) where approval_id is not null;

comment on table core.stock_allocation is
  'Task 5 재고 배정. TEMPORARY(만료는 주문의 temporary_expires_at) · APPROVAL_HOLD(만료 없음, 승인 대기) · '
  'FIRM(만료 없음) · RELEASED. 가용재고 차감은 RELEASED가 아닌 세 상태의 합이다. 행을 지우지 않는다';


-- ══ 4. 우선순위 · 이력 · 긴급발주 ═══════════════════════════════════

create table if not exists core.allocation_priority (
  priority_id        bigint generated always as identity primary key,
  order_id           uuid not null references core.sales_order(order_id) on delete restrict,
  previous_priority  integer not null check (previous_priority between 1 and 9),
  priority           integer not null check (priority between 1 and 9),
  reason             text not null check (btrim(reason) <> ''),
  changed_by         uuid not null references auth.users(id) on delete restrict,
  changed_by_name    text not null,
  changed_at         timestamptz not null default clock_timestamp(),
  constraint allocation_priority_changed_check check (previous_priority <> priority)
);

create index if not exists allocation_priority_order_idx on core.allocation_priority (order_id, changed_at desc);

comment on table core.allocation_priority is
  'Task 5 사업강화부 우선순위 변경 이력(변경 전후 · 변경자 · 시각 · 사유). append-only이며 '
  '현재 값은 core.sales_order.allocation_priority에 같은 트랜잭션으로 반영한다';

create table if not exists core.sales_order_event (
  event_id         bigint generated always as identity primary key,
  order_id         uuid not null references core.sales_order(order_id) on delete restrict,
  event_type       text not null check (event_type in (
    'CREATED', 'REVIEW_REQUESTED', 'ALLOCATION_CHANGED', 'PRIORITY_CHANGED',
    'CONFIRMED', 'CANCELLED', 'EXPIRED', 'COPIED'
  )),
  previous_status  text check (previous_status is null or previous_status in (
    'DRAFT', 'REVIEW_REQUESTED', 'PARTIALLY_ALLOCATED', 'WAITING_FULL', 'CONFIRMED', 'EXPIRED', 'CANCELLED'
  )),
  next_status      text not null check (next_status in (
    'DRAFT', 'REVIEW_REQUESTED', 'PARTIALLY_ALLOCATED', 'WAITING_FULL', 'CONFIRMED', 'EXPIRED', 'CANCELLED'
  )),
  actor            uuid references auth.users(id) on delete restrict,
  actor_name       text not null,
  reason           text,
  payload          jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  at               timestamptz not null default clock_timestamp()
);

create index if not exists sales_order_event_order_idx on core.sales_order_event (order_id, at, event_id);

comment on table core.sales_order_event is
  'Task 5 주문 상태 · 배정 수량 · 변경자 · 시각 · 사유 append-only 이력. actor가 null이면 시스템 처리';

create table if not exists core.stock_allocation_event (
  event_id         bigint generated always as identity primary key,
  allocation_id    uuid not null references core.stock_allocation(allocation_id) on delete restrict,
  order_id         uuid not null references core.sales_order(order_id) on delete restrict,
  line_id          bigint not null references core.sales_order_line(line_id) on delete restrict,
  item_id          text not null,
  event_type       text not null check (event_type in ('CREATED', 'CONVERTED_TO_FIRM', 'RELEASED')),
  previous_status  text,
  next_status      text not null,
  qty              numeric not null check (qty > 0),
  approval_id      uuid,
  actor            uuid references auth.users(id) on delete restrict,
  actor_name       text not null,
  reason           text,
  payload          jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  at               timestamptz not null default clock_timestamp(),
  constraint stock_allocation_event_transition_check check (
    (event_type = 'CREATED' and previous_status is null
        and next_status in ('TEMPORARY', 'APPROVAL_HOLD', 'FIRM'))
    or (event_type = 'CONVERTED_TO_FIRM' and previous_status in ('TEMPORARY', 'APPROVAL_HOLD')
        and next_status = 'FIRM')
    or (event_type = 'RELEASED' and previous_status in ('TEMPORARY', 'APPROVAL_HOLD', 'FIRM')
        and next_status = 'RELEASED')
  )
);

create index if not exists stock_allocation_event_allocation_idx
  on core.stock_allocation_event (allocation_id, at, event_id);
create index if not exists stock_allocation_event_order_idx
  on core.stock_allocation_event (order_id, at, event_id);

comment on table core.stock_allocation_event is
  'Task 5 배정 생성 · 확정 전환 · 해제 append-only 이력. 우선 배정의 대상 · 수량 · 처리자 · 시각 · 사유와 '
  '팀장 의견(승인·반려)을 변경할 수 없게 보관한다';

create table if not exists core.urgent_order (
  urgent_order_id  uuid primary key default gen_random_uuid(),
  item_id          text not null check (btrim(item_id) <> ''),
  qty              numeric not null check (qty > 0),
  needed_by        date not null,
  reason           text not null check (btrim(reason) <> ''),
  status           text not null default 'REQUESTED' check (status in ('REQUESTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  owner_user_id    uuid not null references auth.users(id) on delete restrict,
  owner_name       text not null check (btrim(owner_name) <> ''),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists urgent_order_status_idx on core.urgent_order (status, needed_by);

comment on table core.urgent_order is
  'Task 5 긴급발주 요청(품목 · 수량 · 필요일 · 사유 · 상태 · 담당자). 이번 Task는 조회 구조와 RLS만 만들고 '
  '등록 함수와 화면은 Task 11에서 연결한다';


-- ══ 5. 변경 차단 트리거 ═════════════════════════════════════════════

create or replace function core.reject_order_history_mutation()
returns trigger
language plpgsql
set search_path = core, pg_temp
as $$
begin
  raise exception '주문 · 배정 이력은 수정하거나 삭제할 수 없습니다.' using errcode = '42501';
end;
$$;

drop trigger if exists sales_order_event_append_only on core.sales_order_event;
create trigger sales_order_event_append_only
  before update or delete on core.sales_order_event
  for each row execute function core.reject_order_history_mutation();

drop trigger if exists stock_allocation_event_append_only on core.stock_allocation_event;
create trigger stock_allocation_event_append_only
  before update or delete on core.stock_allocation_event
  for each row execute function core.reject_order_history_mutation();

drop trigger if exists allocation_priority_append_only on core.allocation_priority;
create trigger allocation_priority_append_only
  before update or delete on core.allocation_priority
  for each row execute function core.reject_order_history_mutation();

-- 주문 상태 전환표. 취소 · 만료된 주문은 복구하지 않고, 수주 확정 주문은 확정배정 취소로만 끝난다.
create or replace function core.sales_order_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = core, pg_temp
as $$
  select case
    when p_from = p_to then true
    when p_from = 'DRAFT' then p_to in ('REVIEW_REQUESTED', 'CANCELLED')
    when p_from in ('REVIEW_REQUESTED', 'PARTIALLY_ALLOCATED', 'WAITING_FULL')
      then p_to in ('REVIEW_REQUESTED', 'PARTIALLY_ALLOCATED', 'WAITING_FULL', 'CONFIRMED', 'EXPIRED', 'CANCELLED')
    when p_from = 'CONFIRMED' then p_to = 'CANCELLED'
    else false
  end;
$$;

create or replace function core.guard_sales_order_mutation()
returns trigger
language plpgsql
set search_path = core, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '주문은 삭제할 수 없습니다. 취소 또는 만료 상태로만 종료합니다.' using errcode = '42501';
  end if;

  -- 임시배정 만료일은 최초 검토 요청 시각 + 30일로 한 번만 기록한다. 추가 배정 · 재요청 · 직접 수정
  -- 어느 경로로도 연장하거나 앞당길 수 없다 (stage1 §2 "임시배정 기간은 연장할 수 없다").
  if old.temporary_expires_at is not null
     and new.temporary_expires_at is distinct from old.temporary_expires_at then
    raise exception '임시배정 만료일은 최초 검토 요청 시각 + 30일로 고정되며 변경할 수 없습니다.' using errcode = '42501';
  end if;
  if old.first_review_requested_at is not null
     and new.first_review_requested_at is distinct from old.first_review_requested_at then
    raise exception '최초 검토 요청 시각은 변경할 수 없습니다.' using errcode = '42501';
  end if;
  if old.allocation_choice is not null
     and new.allocation_choice is distinct from old.allocation_choice then
    raise exception '검토 요청 때 선택한 배정 방식은 변경할 수 없습니다.' using errcode = '42501';
  end if;
  if (new.order_id, new.order_seq, new.order_no, new.owner_user_id, new.requested_at,
      new.customer_id, new.customer_name, new.replaces_order_id)
     is distinct from
     (old.order_id, old.order_seq, old.order_no, old.owner_user_id, old.requested_at,
      old.customer_id, old.customer_name, old.replaces_order_id) then
    raise exception '주문 기본 정보는 변경할 수 없습니다.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and not core.sales_order_transition_allowed(old.status, new.status) then
    raise exception '허용되지 않는 주문 상태 전환입니다: % → %', old.status, new.status using errcode = '22023';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists sales_order_guard on core.sales_order;
create trigger sales_order_guard
  before update or delete on core.sales_order
  for each row execute function core.guard_sales_order_mutation();

create or replace function core.guard_sales_order_line_mutation()
returns trigger
language plpgsql
set search_path = core, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '주문 품목은 삭제할 수 없습니다.' using errcode = '42501';
  end if;
  if (new.line_id, new.order_id, new.line_no, new.item_id, new.requested_qty, new.created_at)
     is distinct from
     (old.line_id, old.order_id, old.line_no, old.item_id, old.requested_qty, old.created_at) then
    raise exception '주문 품목과 요청수량은 변경할 수 없습니다. 필요하면 취소 후 재등록합니다.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists sales_order_line_guard on core.sales_order_line;
create trigger sales_order_line_guard
  before update or delete on core.sales_order_line
  for each row execute function core.guard_sales_order_line_mutation();

create or replace function core.guard_stock_allocation_mutation()
returns trigger
language plpgsql
set search_path = core, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '배정은 삭제할 수 없습니다. 해제(RELEASED)로만 종료합니다.' using errcode = '42501';
  end if;
  if old.status = 'RELEASED' then
    raise exception '해제된 배정은 변경할 수 없습니다.' using errcode = '42501';
  end if;
  if (new.allocation_id, new.order_id, new.line_id, new.item_id, new.qty, new.source,
      new.created_by, new.created_at)
     is distinct from
     (old.allocation_id, old.order_id, old.line_id, old.item_id, old.qty, old.source,
      old.created_by, old.created_at) then
    raise exception '배정 대상 · 수량 · 출처는 변경할 수 없습니다.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (
       (old.status in ('TEMPORARY', 'APPROVAL_HOLD') and new.status in ('FIRM', 'RELEASED'))
       or (old.status = 'FIRM' and new.status = 'RELEASED')
     ) then
    raise exception '허용되지 않는 배정 상태 전환입니다: % → %', old.status, new.status using errcode = '22023';
  end if;
  if new.approval_id is distinct from old.approval_id
     and not (old.approval_id is null and old.status = 'APPROVAL_HOLD' and new.status = 'APPROVAL_HOLD') then
    raise exception '승인 요청 연결은 승인대기 확보에 한 번만 기록할 수 있습니다.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists stock_allocation_guard on core.stock_allocation;
create trigger stock_allocation_guard
  before update or delete on core.stock_allocation
  for each row execute function core.guard_stock_allocation_mutation();


-- ══ 6. 내부 계산 · 잠금 함수 ═════════════════════════════════════════

create or replace function core.normalize_item_id(p_item_id text)
returns text
language sql
immutable
set search_path = core, pg_temp
as $$
  select upper(regexp_replace(coalesce(p_item_id, ''), '[\s\-_]', '', 'g'));
$$;

create or replace function core.order_actor_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = core, public, pg_temp
as $$
  select case
    when p_user is null then '시스템'
    else coalesce(
      (select coalesce(nullif(btrim(u.name), ''), nullif(btrim(u.email), ''), u.user_id::text)
         from core.app_user u
        where u.user_id = p_user),
      p_user::text
    )
  end;
$$;

-- 잠금 순서 1) — 품목코드 오름차순으로 core.stock_balance 행을 잠근다. 다품목 주문끼리 서로 다른
-- 순서로 잠가 교착이 생기지 않게 한다. 행이 없으면(정상 창고재고 미확정) 0으로 배정하지 않고 거절한다.
create or replace function core.lock_stock_balance_items(p_item_ids text[], p_require_all boolean default true)
returns void
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_item_id text;
  v_missing text[] := array[]::text[];
begin
  for v_item_id in
    select distinct t.item_id from unnest(p_item_ids) as t(item_id) where t.item_id is not null order by 1
  loop
    perform 1
       from core.stock_balance sb
      where sb.item_id = v_item_id
        for update;
    if not found then
      v_missing := v_missing || v_item_id;
    end if;
  end loop;

  if p_require_all and cardinality(v_missing) > 0 then
    raise exception 'INVENTORY_SCOPE_UNCLASSIFIED: 정상 창고재고가 확정되지 않은 품목은 배정할 수 없습니다 (%).',
      array_to_string(v_missing, ', ') using errcode = '55000';
  end if;
end;
$$;

-- 품목의 가용재고 차감 합계. 반드시 core.lock_stock_balance_items 뒤에 부른다(volatile — 호출
-- 문장마다 새 스냅샷이라 잠금을 기다리는 동안 끝난 배정이 보인다).
create or replace function core.item_committed_qty(p_item_id text)
returns numeric
language sql
volatile
security definer
set search_path = core, public, pg_temp
as $$
  select coalesce(sum(a.qty), 0)
    from core.stock_allocation a
   where a.item_id = p_item_id
     and a.status in ('TEMPORARY', 'APPROVAL_HOLD', 'FIRM');
$$;

create or replace function core.refresh_sales_order_line_totals(p_order_id uuid)
returns void
language sql
security definer
set search_path = core, public, pg_temp
as $$
  update core.sales_order_line l
     set temporary_allocated_qty = s.temporary_qty,
         firm_allocated_qty = s.firm_qty,
         approval_hold_qty = s.hold_qty
    from (
      select l2.line_id,
             coalesce(sum(a.qty) filter (where a.status = 'TEMPORARY'), 0) as temporary_qty,
             coalesce(sum(a.qty) filter (where a.status = 'FIRM'), 0) as firm_qty,
             coalesce(sum(a.qty) filter (where a.status = 'APPROVAL_HOLD'), 0) as hold_qty
        from core.sales_order_line l2
        left join core.stock_allocation a on a.line_id = l2.line_id
       where l2.order_id = p_order_id
       group by l2.line_id
    ) s
   where l.line_id = s.line_id
     and (l.temporary_allocated_qty, l.firm_allocated_qty, l.approval_hold_qty)
         is distinct from (s.temporary_qty, s.firm_qty, s.hold_qty);
$$;

-- 검토 단계 주문의 상태를 배정 사실로 다시 정한다. 수주 확정 · 만료 · 취소 · 작성 중은 그대로 둔다.
--   부족수량 0                       → REVIEW_REQUESTED (전량 확보, 수주 확정 대기)
--   WAIT_FULL이고 확보 수량 0         → WAITING_FULL
--   그 밖(PARTIAL, 또는 수동 확정분 있음) → PARTIALLY_ALLOCATED
create or replace function core.apply_sales_order_status(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_status text;
  v_choice text;
  v_shortage numeric;
  v_allocated numeric;
  v_next text;
begin
  perform core.refresh_sales_order_line_totals(p_order_id);

  select o.status, o.allocation_choice
    into v_status, v_choice
    from core.sales_order o
   where o.order_id = p_order_id;

  if v_status is null then
    raise exception '주문을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if v_status not in ('REVIEW_REQUESTED', 'PARTIALLY_ALLOCATED', 'WAITING_FULL') then
    return v_status;
  end if;

  select coalesce(sum(l.shortage_qty), 0),
         coalesce(sum(l.temporary_allocated_qty + l.firm_allocated_qty + l.approval_hold_qty), 0)
    into v_shortage, v_allocated
    from core.sales_order_line l
   where l.order_id = p_order_id;

  v_next := case
    when v_shortage = 0 then 'REVIEW_REQUESTED'
    when v_choice = 'WAIT_FULL' and v_allocated = 0 then 'WAITING_FULL'
    else 'PARTIALLY_ALLOCATED'
  end;

  if v_next <> v_status then
    update core.sales_order set status = v_next where order_id = p_order_id;
  end if;
  return v_next;
end;
$$;

create or replace function core.log_sales_order_event(
  p_order_id uuid,
  p_event_type text,
  p_previous_status text,
  p_next_status text,
  p_actor uuid,
  p_reason text default null,
  p_payload jsonb default '{}'::jsonb
)
returns bigint
language sql
security definer
set search_path = core, public, pg_temp
as $$
  insert into core.sales_order_event (
    order_id, event_type, previous_status, next_status, actor, actor_name, reason, payload
  ) values (
    p_order_id, p_event_type, p_previous_status, p_next_status,
    p_actor, core.order_actor_name(p_actor), nullif(btrim(p_reason), ''), coalesce(p_payload, '{}'::jsonb)
  )
  returning event_id;
$$;

-- 새 배정 1건. 호출자가 이미 잠갔더라도 재고 행을 다시 잠그고(같은 트랜잭션은 즉시 통과) 잠금 안에서
-- 초과 배정을 한 번 더 막는다 — 이 함수만 단독으로 불려도 판정이 잠금 밖에서 일어나지 않게 한다.
create or replace function core.create_stock_allocation(
  p_line_id bigint,
  p_status text,
  p_qty numeric,
  p_source text,
  p_actor uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_line core.sales_order_line%rowtype;
  v_normal numeric;
  v_committed numeric;
  v_allocation_id uuid;
begin
  if p_status is null or p_status not in ('TEMPORARY', 'APPROVAL_HOLD', 'FIRM') then
    raise exception '새 배정은 TEMPORARY · APPROVAL_HOLD · FIRM 중 하나여야 합니다.' using errcode = '22023';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception '배정 수량은 0보다 커야 합니다.' using errcode = '22023';
  end if;

  select * into v_line from core.sales_order_line l where l.line_id = p_line_id;
  if not found then
    raise exception '주문 품목을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  select sb.normal_qty into v_normal from core.stock_balance sb where sb.item_id = v_line.item_id for update;
  if not found then
    raise exception 'INVENTORY_SCOPE_UNCLASSIFIED: 정상 창고재고가 확정되지 않은 품목은 배정할 수 없습니다 (%).',
      v_line.item_id using errcode = '55000';
  end if;

  select * into v_line from core.sales_order_line l where l.line_id = p_line_id;
  if p_qty > v_line.shortage_qty then
    raise exception 'ALLOCATION_EXCEEDS_SHORTAGE: 남은 부족수량(%)보다 많이 배정할 수 없습니다.',
      v_line.shortage_qty using errcode = '22023';
  end if;

  v_committed := core.item_committed_qty(v_line.item_id);
  if v_committed + p_qty > v_normal then
    raise exception 'STOCK_INSUFFICIENT: 가용재고(%)보다 많이 배정할 수 없습니다.',
      greatest(v_normal - v_committed, 0) using errcode = '55000';
  end if;

  insert into core.stock_allocation (
    order_id, line_id, item_id, status, qty, source, reason, created_by, created_by_name, firm_at
  ) values (
    v_line.order_id, v_line.line_id, v_line.item_id, p_status, p_qty, p_source, nullif(btrim(p_reason), ''),
    p_actor, core.order_actor_name(p_actor), case when p_status = 'FIRM' then clock_timestamp() end
  )
  returning allocation_id into v_allocation_id;

  insert into core.stock_allocation_event (
    allocation_id, order_id, line_id, item_id, event_type, previous_status, next_status,
    qty, approval_id, actor, actor_name, reason, payload
  ) values (
    v_allocation_id, v_line.order_id, v_line.line_id, v_line.item_id, 'CREATED', null, p_status,
    p_qty, null, p_actor, core.order_actor_name(p_actor), nullif(btrim(p_reason), ''),
    jsonb_build_object('source', p_source, 'available_before_qty', v_normal - v_committed)
  );

  perform core.refresh_sales_order_line_totals(v_line.order_id);
  return v_allocation_id;
end;
$$;

-- TEMPORARY · APPROVAL_HOLD → FIRM, 또는 활성 배정 → RELEASED. 확정 전환은 가용재고 합계를 바꾸지
-- 않지만, 모든 배정 변경을 같은 재고 행 잠금 아래에서 하도록 여기서도 잠근다.
create or replace function core.transition_stock_allocation(
  p_allocation_id uuid,
  p_next_status text,
  p_actor uuid,
  p_reason text,
  p_cause text,
  p_payload jsonb default '{}'::jsonb
)
returns core.stock_allocation
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_before core.stock_allocation%rowtype;
  v_after core.stock_allocation%rowtype;
begin
  if p_next_status is null or p_next_status not in ('FIRM', 'RELEASED') then
    raise exception '배정은 FIRM 또는 RELEASED로만 전환할 수 있습니다.' using errcode = '22023';
  end if;

  select * into v_before from core.stock_allocation a where a.allocation_id = p_allocation_id;
  if not found then
    raise exception '배정을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  perform 1 from core.stock_balance sb where sb.item_id = v_before.item_id for update;
  select * into v_before from core.stock_allocation a where a.allocation_id = p_allocation_id for update;

  if v_before.status = 'RELEASED'
     or (p_next_status = 'FIRM' and v_before.status not in ('TEMPORARY', 'APPROVAL_HOLD')) then
    raise exception '이미 % 상태인 배정은 %로 바꿀 수 없습니다.', v_before.status, p_next_status using errcode = '22023';
  end if;
  if p_next_status = 'RELEASED' and nullif(btrim(p_reason), '') is null then
    raise exception '배정 해제에는 사유가 필요합니다.' using errcode = '22023';
  end if;

  update core.stock_allocation
     set status = p_next_status,
         firm_at = case when p_next_status = 'FIRM' then clock_timestamp() else firm_at end,
         released_at = case when p_next_status = 'RELEASED' then clock_timestamp() end,
         released_by = case when p_next_status = 'RELEASED' then p_actor end,
         release_reason = case when p_next_status = 'RELEASED' then btrim(p_reason) end
   where allocation_id = p_allocation_id
  returning * into v_after;

  insert into core.stock_allocation_event (
    allocation_id, order_id, line_id, item_id, event_type, previous_status, next_status,
    qty, approval_id, actor, actor_name, reason, payload
  ) values (
    v_after.allocation_id, v_after.order_id, v_after.line_id, v_after.item_id,
    case when p_next_status = 'FIRM' then 'CONVERTED_TO_FIRM' else 'RELEASED' end,
    v_before.status, v_after.status, v_after.qty, v_after.approval_id,
    p_actor, core.order_actor_name(p_actor), nullif(btrim(p_reason), ''),
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('cause', p_cause)
  );

  perform core.refresh_sales_order_line_totals(v_after.order_id);
  return v_after;
end;
$$;

-- 해당 영업담당자 + (선택) SCM 품목담당자. 품목별 담당자 마스터가 없으므로 ALLOC_MANUAL 권한을 가진
-- 활성 사용자 전체를 SCM 품목담당자로 본다. 비활성 계정은 빼서 알림 예약이 업무 트랜잭션을 깨지 않게 한다.
create or replace function core.sales_order_notice_recipients(p_order_id uuid, p_include_planners boolean)
returns uuid[]
language sql
stable
security definer
set search_path = core, public, pg_temp
as $$
  select coalesce(array_agg(distinct r.user_id), array[]::uuid[])
    from (
      select o.owner_user_id as user_id
        from core.sales_order o
       where o.order_id = p_order_id
      union
      select u.user_id
        from core.app_user u
        join core.role_permission rp on rp.job_role = u.job_role
       where p_include_planners
         and rp.permission_code = 'ALLOC_MANUAL'
    ) r
    join core.app_user au on au.user_id = r.user_id and au.active;
$$;

create or replace function core.enqueue_order_notice(
  p_dedupe_key text,
  p_template_code text,
  p_recipient_user_ids uuid[],
  p_payload jsonb
)
returns integer
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_user_id uuid;
  v_channel text;
  v_count integer := 0;
begin
  for v_user_id in
    select distinct u.user_id
      from unnest(coalesce(p_recipient_user_ids, array[]::uuid[])) as r(user_id)
      join core.app_user u on u.user_id = r.user_id and u.active
  loop
    foreach v_channel in array array['IN_APP', 'EMAIL'] loop
      perform core.enqueue_notification(
        p_dedupe_key, p_template_code, v_user_id, v_channel, clock_timestamp(), p_payload
      );
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;

-- 주문의 첫 임시배정이 생길 때 Task 3의 10·5·3·2·1일 전 예고를 예약한다. 같은 주문에 다시 불려도
-- dedupe 키가 같아 중복 예약되지 않는다.
create or replace function core.schedule_sales_order_expiry_notices(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_expires_at timestamptz;
  v_recipients uuid[];
  v_count integer;
begin
  select o.temporary_expires_at into v_expires_at from core.sales_order o where o.order_id = p_order_id;
  v_recipients := core.sales_order_notice_recipients(p_order_id, true);
  if v_expires_at is null or cardinality(v_recipients) = 0 then
    return 0;
  end if;

  v_count := core.schedule_temporary_allocation_expiry(p_order_id::text, v_expires_at, v_recipients);

  -- 대기하다 나중에 처음 임시배정된 주문(Task 6)은 예고 시각이 이미 지났을 수 있다. 이번 트랜잭션이
  -- 방금 만든 행(created_at = now())만 골라, 지난 예고를 뒤늦게 한꺼번에 보내지 않는다.
  update core.notification_outbox o
     set status = 'CANCELLED', finished_at = clock_timestamp()
   where o.status = 'PENDING'
     and o.template_code = 'TEMP_ALLOCATION_EXPIRY_WARNING'
     and o.payload ->> 'series_id' = p_order_id::text
     and o.scheduled_at < clock_timestamp()
     and o.created_at = now();

  return v_count;
end;
$$;

-- 주문이 취소되면 남은 우선 배정 승인 요청도 취소한다. 그대로 두면 팀장에게 10분 반복 알림이 계속
-- 가고, 승인해도 실행할 확보수량이 없어 요청이 영원히 대기로 남는다.
create or replace function core.cancel_alloc_priority_approval(p_approval_id uuid, p_actor uuid, p_comment text)
returns void
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  select to_jsonb(r) into v_before
    from core.approval_request r
   where r.approval_id = p_approval_id
     and r.status = 'PENDING'
     for update;
  if v_before is null then
    return;
  end if;

  update core.approval_request
     set status = 'CANCELLED',
         decided_by = p_actor,
         decider_name = core.order_actor_name(p_actor),
         decided_at = clock_timestamp(),
         decision_comment = p_comment
   where approval_id = p_approval_id;

  select to_jsonb(r) into v_after from core.approval_request r where r.approval_id = p_approval_id;

  insert into core.approval_event (
    approval_id, event_type, previous_status, next_status, actor, comment, payload_snapshot
  ) values (
    p_approval_id, 'CANCELLED', 'PENDING', 'CANCELLED', p_actor, p_comment, v_after
  );

  insert into core.audit_log (actor, action, target_type, target_id, before, after)
  values (p_actor, 'APPROVAL_CANCELLED', 'APPROVAL_REQUEST', p_approval_id::text, v_before, v_after);
end;
$$;

-- 주문의 활성 배정(임시 · 확정 · 승인대기 확보)을 모두 해제하고, 확보에 연결된 대기 중 우선 배정 승인 요청을
-- 취소한다. 호출자가 재고 행 → 주문 행을 이미 잠갔다는 전제다(core.cancel_firm_allocation · core.cancel_sales_order).
create or replace function core.release_order_allocations(p_order_id uuid, p_actor uuid, p_reason text, p_cause text)
returns jsonb
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_allocation record;
  v_released jsonb := '[]'::jsonb;
  v_released_qty numeric := 0;
  v_cancelled_approval_count integer := 0;
begin
  for v_allocation in
    select a.allocation_id, a.item_id, a.status, a.qty, a.approval_id
      from core.stock_allocation a
     where a.order_id = p_order_id
       and a.status in ('TEMPORARY', 'APPROVAL_HOLD', 'FIRM')
     order by a.item_id, a.created_at
       for update
  loop
    perform core.transition_stock_allocation(v_allocation.allocation_id, 'RELEASED', p_actor, p_reason, p_cause);
    v_released_qty := v_released_qty + v_allocation.qty;
    v_released := v_released || jsonb_build_array(jsonb_build_object(
      'allocation_id', v_allocation.allocation_id, 'item_id', v_allocation.item_id,
      'previous_status', v_allocation.status, 'qty', v_allocation.qty
    ));
    -- 확보를 풀면 승인할 대상이 없어진다. 요청을 취소해야 Task 3 트리거가 팀장 10분 반복 알림을 멈춘다.
    if v_allocation.status = 'APPROVAL_HOLD' and v_allocation.approval_id is not null then
      perform core.cancel_alloc_priority_approval(
        v_allocation.approval_id, p_actor, '주문이 취소되어 우선 배정 승인 요청을 취소합니다.'
      );
      v_cancelled_approval_count := v_cancelled_approval_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'released', v_released, 'released_qty', v_released_qty, 'cancelled_approval_count', v_cancelled_approval_count
  );
end;
$$;

create or replace function core.item_visibility_scope(p_item_id text)
returns text
language sql
stable
security definer
set search_path = core, public, pg_temp
as $$
  select coalesce(
    (select ivr.visibility_scope
       from core.v_item_master im
       join core.item_visibility_rule ivr on ivr.raw_item_type = im.item_type
      where im.item_id = p_item_id
      limit 1),
    'GENERAL'
  );
$$;

-- 주문 · 배정 행을 볼 수 있는 사람: 등록한 영업담당자 본인, 배정 업무 권한자.
create or replace function core.can_view_sales_order(p_owner_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = core, public, pg_temp
as $$
  select coalesce(p_owner_user_id = auth.uid(), false)
      or core.has_permission('ALLOC_VIEW')
      or core.has_permission('ALLOC_MANUAL')
      or core.has_permission('ALLOC_FIRM_CANCEL')
      or core.has_permission('ALLOC_PRIORITY_EDIT')
      or core.has_permission('ALLOC_PRIORITY_APPROVE');
$$;


-- ══ 7. 배정 집계와 대기열의 단일 정의 ═══════════════════════════════
--
-- ★ core.v_item_allocation_qty는 소유자 권한 뷰다. 영업담당자는 RLS상 남의 주문 배정을 볼 수 없으므로,
--   security_invoker 뷰가 core.stock_allocation을 직접 합하면 남의 배정이 빠져 주문 가능 수량이 부풀려진다.
--   품목별 합계만 노출하고 조회 권한은 가용재고를 읽는 모든 업무 권한으로 제한한다(core.v_open_po_qty와 같은 자리).

create or replace view core.v_item_allocation_qty as
select
  sb.item_id,
  sb.normal_qty,
  coalesce(a.temporary_allocated_qty, 0::numeric) as temporary_allocated_qty,
  coalesce(a.firm_allocated_qty, 0::numeric) as firm_allocated_qty,
  coalesce(a.approval_hold_qty, 0::numeric) as approval_hold_qty,
  coalesce(a.committed_qty, 0::numeric) as committed_qty,
  sb.normal_qty - coalesce(a.committed_qty, 0::numeric) as available_qty
from core.stock_balance sb
left join (
  select
    s.item_id,
    sum(s.qty) filter (where s.status = 'TEMPORARY') as temporary_allocated_qty,
    sum(s.qty) filter (where s.status = 'FIRM') as firm_allocated_qty,
    sum(s.qty) filter (where s.status = 'APPROVAL_HOLD') as approval_hold_qty,
    sum(s.qty) as committed_qty
  from core.stock_allocation s
  where s.status in ('TEMPORARY', 'APPROVAL_HOLD', 'FIRM')
  group by s.item_id
) a on a.item_id = sb.item_id
-- 조회 범위는 이 합계를 읽는 뷰와 같게 둔다: 마케팅은 용지·카드리더기, 서비스는 소모품만(v_available_stock),
-- 영업(ATP) · SCM · 사업강화부는 전체(v_order_available_stock · v_allocation_queue).
where core.has_permission('STOCK_VIEW_ALL')
   or (core.has_permission('STOCK_VIEW_PAPER') and core.item_visibility_scope(sb.item_id) = 'PAPER_CARD_READER')
   or (core.has_permission('STOCK_VIEW_SUPPLY') and core.item_visibility_scope(sb.item_id) = 'CONSUMABLE')
   or core.has_permission('ATP_VIEW')
   or core.has_permission('ALLOC_VIEW')
   or core.has_permission('ALLOC_MANUAL')
   or core.has_permission('ALLOC_FIRM_CANCEL')
   or core.has_permission('ALLOC_PRIORITY_EDIT')
   or core.has_permission('ALLOC_PRIORITY_APPROVE')
   or core.is_admin();

comment on view core.v_item_allocation_qty is
  'Task 5 품목별 임시·확정·승인대기 합계와 가용재고. 소유자 권한으로 전체 배정을 합산하고 품목 합계만 노출한다';

-- 대기 순번: 같은 품목에서 부족수량이 남은 줄을 우선순위 → 최초 검토 요청 시각 → 주문 생성 순서로 센다.
-- 수동배정 정상 순서 판정, 배정 화면, Task 6 신규 입고 배정이 모두 이 정의 하나를 쓴다.
create or replace view core.v_allocation_queue_line
with (security_invoker = true)
as
select
  l.item_id,
  l.line_id,
  l.line_no,
  o.order_id,
  o.order_no,
  o.order_seq,
  o.status as order_status,
  o.customer_id,
  o.customer_name,
  o.owner_user_id,
  o.owner_name,
  o.allocation_choice,
  o.allocation_priority,
  o.first_review_requested_at,
  o.temporary_expires_at,
  l.requested_qty,
  l.temporary_allocated_qty,
  l.firm_allocated_qty,
  l.approval_hold_qty,
  l.shortage_qty,
  case when l.shortage_qty > 0 then
    row_number() over (
      partition by l.item_id, (l.shortage_qty > 0)
      order by o.allocation_priority, o.first_review_requested_at, o.order_seq
    )
  end as queue_rank
from core.sales_order_line l
join core.sales_order o on o.order_id = l.order_id
where o.status in ('REVIEW_REQUESTED', 'PARTIALLY_ALLOCATED', 'WAITING_FULL', 'CONFIRMED');

comment on view core.v_allocation_queue_line is
  'Task 5 진행 중 주문 품목과 대기 순번(우선순위 → 최초 검토 요청 시각 → 주문 생성 순서). security_invoker';


-- ══ 8. 주문 생성과 후속 배정 (내부) ═════════════════════════════════

create or replace function core.insert_sales_order(
  p_actor uuid,
  p_customer_id text,
  p_customer_name text,
  p_note text,
  p_lines jsonb,
  p_replaces_order_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_order_id uuid;
  v_line jsonb;
  v_line_no integer := 0;
  v_item_id text;
  v_qty_text text;
  v_seen text[] := array[]::text[];
  v_lines jsonb := '[]'::jsonb;
begin
  if nullif(btrim(p_customer_name), '') is null then
    raise exception 'CUSTOMER_NAME_REQUIRED: 고객명은 필수입니다.' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'ORDER_LINE_REQUIRED: 주문 품목을 한 줄 이상 입력하세요.' using errcode = '22023';
  end if;

  insert into core.sales_order (
    order_no, customer_id, customer_name, owner_user_id, owner_name, note, replaces_order_id
  ) values (
    'SO-' || to_char(clock_timestamp() at time zone 'Asia/Seoul', 'YYYYMMDD') || '-'
      || lpad(nextval('core.sales_order_no_seq')::text, 6, '0'),
    nullif(btrim(p_customer_id), ''), btrim(p_customer_name), p_actor, core.order_actor_name(p_actor),
    nullif(btrim(p_note), ''), p_replaces_order_id
  )
  returning order_id into v_order_id;

  for v_line in select e.value from jsonb_array_elements(p_lines) as e(value) loop
    v_line_no := v_line_no + 1;
    v_item_id := core.normalize_item_id(v_line ->> 'item_id');
    v_qty_text := btrim(coalesce(v_line ->> 'qty', ''));

    if v_item_id = '' then
      raise exception 'ORDER_ITEM_REQUIRED: %번째 줄에 품목이 없습니다.', v_line_no using errcode = '22023';
    end if;
    if v_qty_text !~ '^[0-9]+(\.[0-9]+)?$' then
      raise exception 'ORDER_QTY_INVALID: %번째 줄 수량은 0보다 큰 숫자여야 합니다.', v_line_no using errcode = '22023';
    end if;
    if v_qty_text::numeric <= 0 then
      raise exception 'ORDER_QTY_INVALID: %번째 줄 수량은 0보다 큰 숫자여야 합니다.', v_line_no using errcode = '22023';
    end if;
    if not exists (select 1 from core.v_item_master im where im.item_id = v_item_id) then
      raise exception 'ORDER_ITEM_UNKNOWN: 품목 마스터에 없는 품목입니다 (%).', v_item_id using errcode = '22023';
    end if;
    if v_item_id = any(v_seen) then
      raise exception 'ORDER_ITEM_DUPLICATED: 같은 품목은 한 줄로 합쳐 입력하세요 (%).', v_item_id using errcode = '22023';
    end if;
    v_seen := v_seen || v_item_id;

    insert into core.sales_order_line (order_id, line_no, item_id, requested_qty)
    values (v_order_id, v_line_no, v_item_id, v_qty_text::numeric);

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'line_no', v_line_no, 'item_id', v_item_id, 'requested_qty', v_qty_text::numeric
    ));
  end loop;

  perform core.log_sales_order_event(
    v_order_id, 'CREATED', null, 'DRAFT', p_actor, null,
    jsonb_build_object(
      'customer_id', nullif(btrim(p_customer_id), ''), 'customer_name', btrim(p_customer_name),
      'replaces_order_id', p_replaces_order_id, 'lines', v_lines
    )
  );
  return v_order_id;
end;
$$;

-- Task 6 계약: 주문 품목 1건에 가능한 만큼(최대 p_max_qty) 후속 배정한다. 수주 확정 주문이면 곧바로 FIRM,
-- 그 전이면 TEMPORARY다. WAIT_FULL 주문에 전량이 아닐 때 배정하지 않는 판단은 호출자(Task 6)가
-- p_max_qty로 한다. 배정한 수량을 돌려준다(0이면 배정하지 않음).
create or replace function core.allocate_to_order_line(
  p_line_id bigint,
  p_max_qty numeric,
  p_source text,
  p_actor uuid default null
)
returns numeric
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_line core.sales_order_line%rowtype;
  v_order core.sales_order%rowtype;
  v_available numeric;
  v_qty numeric;
  v_allocation_status text;
  v_allocation_id uuid;
  v_next_status text;
begin
  if p_max_qty is null or p_max_qty <= 0 then
    return 0;
  end if;

  select * into v_line from core.sales_order_line l where l.line_id = p_line_id;
  if not found then
    raise exception '주문 품목을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  perform core.lock_stock_balance_items(array[v_line.item_id], true);

  select * into v_order
    from core.sales_order
   where order_id = v_line.order_id
     for update;

  if v_order.status not in ('REVIEW_REQUESTED', 'PARTIALLY_ALLOCATED', 'WAITING_FULL', 'CONFIRMED') then
    return 0;
  end if;

  select * into v_line from core.sales_order_line l where l.line_id = p_line_id;
  v_available := (select sb.normal_qty from core.stock_balance sb where sb.item_id = v_line.item_id)
    - core.item_committed_qty(v_line.item_id);
  v_qty := least(p_max_qty, v_line.shortage_qty, v_available);
  if v_qty <= 0 then
    return 0;
  end if;

  -- 임시배정의 만료는 주문에 이미 기록된 "최초 검토 요청 + 30일"을 그대로 쓴다. 여기서는 주문의
  -- 만료 시각 열을 다시 쓰지 않는다(쓰려고 하면 트리거가 거절한다).
  v_allocation_status := case when v_order.status = 'CONFIRMED' then 'FIRM' else 'TEMPORARY' end;
  v_allocation_id := core.create_stock_allocation(p_line_id, v_allocation_status, v_qty, p_source, p_actor, null);
  v_next_status := core.apply_sales_order_status(v_order.order_id);
  if v_allocation_status = 'TEMPORARY' then
    perform core.schedule_sales_order_expiry_notices(v_order.order_id);
  end if;

  perform core.log_sales_order_event(
    v_order.order_id, 'ALLOCATION_CHANGED', v_order.status, v_next_status, p_actor, null,
    jsonb_build_object(
      'kind', 'ADDITIONAL_ALLOCATION', 'source', p_source, 'allocation_id', v_allocation_id,
      'allocation_status', v_allocation_status, 'item_id', v_line.item_id, 'qty', v_qty,
      'remaining_shortage_qty', v_line.shortage_qty - v_qty
    )
  );
  return v_qty;
end;
$$;


-- ══ 9. 공개 명령 함수 ═══════════════════════════════════════════════

create or replace function core.create_sales_order(
  p_customer_id text,
  p_customer_name text,
  p_lines jsonb,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 주문을 등록할 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('ORDER_CREATE', v_actor) then
    raise exception '주문 등록 권한(ORDER_CREATE)이 없습니다.' using errcode = '42501';
  end if;

  return core.insert_sales_order(v_actor, p_customer_id, p_customer_name, p_note, p_lines, null);
end;
$$;

create or replace function core.request_order_review(p_order_id uuid, p_choice text)
returns jsonb
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_order core.sales_order%rowtype;
  v_line core.sales_order_line%rowtype;
  v_item_ids text[];
  v_now timestamptz;
  v_available numeric;
  v_any_shortage boolean := false;
  v_line_ids bigint[] := array[]::bigint[];
  v_plan_qtys numeric[] := array[]::numeric[];
  v_index integer;
  v_allocated_total numeric := 0;
  v_status text;
  v_summary jsonb;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 검토 요청을 등록할 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('ORDER_REVIEW_REQUEST', v_actor) then
    raise exception '검토 요청 권한(ORDER_REVIEW_REQUEST)이 없습니다.' using errcode = '42501';
  end if;
  if p_choice is null or p_choice not in ('PARTIAL', 'WAIT_FULL') then
    raise exception 'ALLOCATION_CHOICE_REQUIRED: 재고가 부족할 때의 배정 방식(PARTIAL 또는 WAIT_FULL)을 선택해야 합니다.'
      using errcode = '22023';
  end if;

  -- 잠그기 전에 먼저 확인해 권한 · 상태 오류가 재고 오류보다 먼저 보이게 한다. 잠근 뒤 다시 확인한다.
  select * into v_order from core.sales_order o where o.order_id = p_order_id;
  if not found then
    raise exception '주문을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if v_order.owner_user_id <> v_actor then
    raise exception '본인이 등록한 주문만 검토 요청할 수 있습니다.' using errcode = '42501';
  end if;
  if v_order.status <> 'DRAFT' then
    raise exception '작성 중(DRAFT) 주문만 검토 요청할 수 있습니다. 만료 · 취소 주문은 재등록한 뒤 요청합니다.'
      using errcode = '22023';
  end if;

  select array_agg(l.item_id order by l.item_id) into v_item_ids
    from core.sales_order_line l
   where l.order_id = p_order_id;
  if v_item_ids is null then
    raise exception 'ORDER_LINE_REQUIRED: 주문 품목이 없습니다.' using errcode = '22023';
  end if;

  -- 잠금 순서 1) 재고 행 → 2) 주문 행
  perform core.lock_stock_balance_items(v_item_ids, true);

  select * into v_order
    from core.sales_order
   where order_id = p_order_id
     for update;
  if v_order.status <> 'DRAFT' then
    raise exception '작성 중(DRAFT) 주문만 검토 요청할 수 있습니다. 다른 요청이 먼저 처리되었습니다.' using errcode = '22023';
  end if;

  -- 그 순간의 가용재고에서 선착순으로 판정한다(앞선 대기 주문 몫을 따로 떼어 두지 않는다).
  for v_line in
    select * from core.sales_order_line l where l.order_id = p_order_id order by l.line_no
  loop
    v_available := (select sb.normal_qty from core.stock_balance sb where sb.item_id = v_line.item_id)
      - core.item_committed_qty(v_line.item_id);
    v_line_ids := v_line_ids || v_line.line_id;
    v_plan_qtys := v_plan_qtys || least(v_line.requested_qty, greatest(v_available, 0));
    if v_available < v_line.requested_qty then
      v_any_shortage := true;
    end if;
  end loop;

  -- 전체 배정 대기: 부족한 품목이 하나라도 있으면 일부 수량도 잡지 않고 요청 전체를 대기시킨다.
  if p_choice = 'WAIT_FULL' and v_any_shortage then
    v_plan_qtys := array_fill(0::numeric, array[cardinality(v_line_ids)]);
  end if;

  v_now := clock_timestamp();
  update core.sales_order
     set status = 'REVIEW_REQUESTED',
         first_review_requested_at = v_now,
         temporary_expires_at = v_now + interval '30 days',
         allocation_choice = p_choice,
         allocation_choice_by = v_actor
   where order_id = p_order_id;

  for v_index in 1 .. cardinality(v_line_ids) loop
    if v_plan_qtys[v_index] > 0 then
      perform core.create_stock_allocation(
        v_line_ids[v_index], 'TEMPORARY', v_plan_qtys[v_index], 'REVIEW_REQUEST', v_actor, null
      );
      v_allocated_total := v_allocated_total + v_plan_qtys[v_index];
    end if;
  end loop;

  v_status := core.apply_sales_order_status(p_order_id);
  if v_allocated_total > 0 then
    perform core.schedule_sales_order_expiry_notices(p_order_id);
  end if;

  select jsonb_build_object(
           'order_id', o.order_id,
           'order_no', o.order_no,
           'status', o.status,
           'allocation_choice', o.allocation_choice,
           'temporary_expires_at', o.temporary_expires_at,
           'temporary_allocated_qty', coalesce(sum(l.temporary_allocated_qty), 0),
           'shortage_qty', coalesce(sum(l.shortage_qty), 0),
           'lines', jsonb_agg(jsonb_build_object(
             'line_id', l.line_id, 'item_id', l.item_id, 'requested_qty', l.requested_qty,
             'temporary_allocated_qty', l.temporary_allocated_qty, 'shortage_qty', l.shortage_qty
           ) order by l.line_no)
         )
    into v_summary
    from core.sales_order o
    join core.sales_order_line l on l.order_id = o.order_id
   where o.order_id = p_order_id
   group by o.order_id;

  -- 선택한 배정 방식 · 임시배정 수량 · 부족 수량 · 선택자를 주문 이력에 남긴다 (stage1 §2).
  perform core.log_sales_order_event(
    p_order_id, 'REVIEW_REQUESTED', 'DRAFT', v_status, v_actor, null,
    v_summary || jsonb_build_object('chosen_by', v_actor, 'chosen_by_name', core.order_actor_name(v_actor))
  );
  return v_summary;
end;
$$;

create or replace function core.confirm_sales_order(p_order_id uuid, p_confirmed_order_no text)
returns uuid
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_confirmed_no text := nullif(btrim(p_confirmed_order_no), '');
  v_order core.sales_order%rowtype;
  v_item_ids text[];
  v_allocation_id uuid;
  v_allocation_qty numeric;
  v_converted_qty numeric := 0;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 수주를 확정할 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('ORDER_CREATE', v_actor) then
    raise exception '수주 확정 권한(ORDER_CREATE)이 없습니다.' using errcode = '42501';
  end if;
  if v_confirmed_no is null then
    raise exception 'CONFIRMED_ORDER_NO_REQUIRED: 최종 승인된 주문번호는 필수입니다.' using errcode = '22023';
  end if;

  select * into v_order from core.sales_order o where o.order_id = p_order_id;
  if not found then
    raise exception '주문을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if v_order.owner_user_id <> v_actor then
    raise exception '본인이 등록한 주문만 수주 확정할 수 있습니다.' using errcode = '42501';
  end if;

  select array_agg(l.item_id order by l.item_id) into v_item_ids
    from core.sales_order_line l
   where l.order_id = p_order_id;

  perform core.lock_stock_balance_items(v_item_ids, false);

  select * into v_order
    from core.sales_order
   where order_id = p_order_id
     for update;
  if v_order.status not in ('REVIEW_REQUESTED', 'PARTIALLY_ALLOCATED', 'WAITING_FULL') then
    raise exception '검토 요청 이후 확정 전 주문만 수주 확정할 수 있습니다 (현재 %).', v_order.status using errcode = '22023';
  end if;
  if exists (
    select 1 from core.sales_order o
     where o.status = 'CONFIRMED' and o.confirmed_order_no = v_confirmed_no
  ) then
    raise exception 'CONFIRMED_ORDER_NO_DUPLICATED: 이미 다른 확정 주문에 쓰인 최종 승인 주문번호입니다.' using errcode = '23505';
  end if;

  -- 임시배정을 확정배정으로 전환한다(만료 없음). 승인대기 확보는 팀장 결정까지 그대로 둔다.
  for v_allocation_id, v_allocation_qty in
    select a.allocation_id, a.qty
      from core.stock_allocation a
     where a.order_id = p_order_id and a.status = 'TEMPORARY'
     order by a.item_id, a.created_at
  loop
    perform core.transition_stock_allocation(
      v_allocation_id, 'FIRM', v_actor, null, 'ORDER_CONFIRMED',
      jsonb_build_object('confirmed_order_no', v_confirmed_no)
    );
    v_converted_qty := v_converted_qty + v_allocation_qty;
  end loop;

  update core.sales_order
     set status = 'CONFIRMED',
         confirmed_order_no = v_confirmed_no,
         confirmed_at = clock_timestamp(),
         confirmed_by = v_actor
   where order_id = p_order_id;
  perform core.refresh_sales_order_line_totals(p_order_id);

  -- 확정 뒤에는 임시배정이 남지 않으므로 만료 예고를 멈춘다.
  perform core.cancel_notification_series('TEMP_ALLOCATION', p_order_id::text);

  perform core.log_sales_order_event(
    p_order_id, 'CONFIRMED', v_order.status, 'CONFIRMED', v_actor, null,
    jsonb_build_object(
      'confirmed_order_no', v_confirmed_no,
      'converted_to_firm_qty', v_converted_qty,
      'remaining_shortage_qty', (select coalesce(sum(l.shortage_qty), 0) from core.sales_order_line l where l.order_id = p_order_id),
      'approval_hold_qty', (select coalesce(sum(l.approval_hold_qty), 0) from core.sales_order_line l where l.order_id = p_order_id)
    )
  );
  return p_order_id;
end;
$$;

create or replace function core.change_allocation_priority(p_order_id uuid, p_priority integer, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := nullif(btrim(p_reason), '');
  v_order core.sales_order%rowtype;
  v_item_ids text[];
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 우선순위를 바꿀 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('ALLOC_PRIORITY_EDIT', v_actor) then
    raise exception '배정 우선순위 변경 권한(ALLOC_PRIORITY_EDIT)이 없습니다.' using errcode = '42501';
  end if;
  if p_priority is null or p_priority not between 1 and 9 then
    raise exception 'PRIORITY_INVALID: 우선순위는 1(최우선)부터 9(최후순) 사이 정수여야 합니다.' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'PRIORITY_REASON_REQUIRED: 우선순위 변경 사유는 필수입니다.' using errcode = '22023';
  end if;

  select array_agg(l.item_id order by l.item_id) into v_item_ids
    from core.sales_order_line l
   where l.order_id = p_order_id;
  if v_item_ids is null then
    raise exception '주문을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  -- 수동배정의 정상 순서 판정과 같은 재고 행 잠금으로 직렬화해, 판정 도중 순서가 바뀌지 않게 한다.
  perform core.lock_stock_balance_items(v_item_ids, false);

  select * into v_order
    from core.sales_order
   where order_id = p_order_id
     for update;
  if v_order.status not in ('REVIEW_REQUESTED', 'PARTIALLY_ALLOCATED', 'WAITING_FULL', 'CONFIRMED') then
    raise exception '검토 요청 이후 진행 중인 주문만 우선순위를 바꿀 수 있습니다 (현재 %).', v_order.status using errcode = '22023';
  end if;
  if v_order.allocation_priority = p_priority then
    raise exception 'PRIORITY_UNCHANGED: 현재 우선순위와 같습니다.' using errcode = '22023';
  end if;

  insert into core.allocation_priority (
    order_id, previous_priority, priority, reason, changed_by, changed_by_name
  ) values (
    p_order_id, v_order.allocation_priority, p_priority, v_reason, v_actor, core.order_actor_name(v_actor)
  );

  update core.sales_order set allocation_priority = p_priority where order_id = p_order_id;

  perform core.log_sales_order_event(
    p_order_id, 'PRIORITY_CHANGED', v_order.status, v_order.status, v_actor, v_reason,
    jsonb_build_object('previous_priority', v_order.allocation_priority, 'priority', p_priority)
  );
  return p_order_id;
end;
$$;

create or replace function core.request_manual_allocation(
  p_order_id uuid,
  p_item_id text,
  p_qty numeric,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_item_id text := core.normalize_item_id(p_item_id);
  v_reason text := nullif(btrim(p_reason), '');
  v_order core.sales_order%rowtype;
  v_line core.sales_order_line%rowtype;
  v_available numeric;
  v_ahead_count integer;
  v_first_ahead_order_no text;
  v_allocation_id uuid;
  v_approval_id uuid;
  v_next_status text;
  v_item_name text;
  v_payload jsonb;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 수동 배정할 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('ALLOC_MANUAL', v_actor) then
    raise exception '수동 배정 권한(ALLOC_MANUAL)이 없습니다.' using errcode = '42501';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'MANUAL_QTY_INVALID: 배정 수량은 0보다 커야 합니다.' using errcode = '22023';
  end if;

  select * into v_line from core.sales_order_line l where l.order_id = p_order_id and l.item_id = v_item_id;
  if not found then
    raise exception '주문에 해당 품목이 없습니다 (%).', v_item_id using errcode = 'P0002';
  end if;

  perform core.lock_stock_balance_items(array[v_item_id], true);

  select * into v_order
    from core.sales_order
   where order_id = p_order_id
     for update;
  if v_order.status not in ('REVIEW_REQUESTED', 'PARTIALLY_ALLOCATED', 'WAITING_FULL', 'CONFIRMED') then
    raise exception '검토 요청 이후 진행 중인 주문에만 수동 배정할 수 있습니다 (현재 %).', v_order.status using errcode = '22023';
  end if;

  select * into v_line from core.sales_order_line l where l.line_id = v_line.line_id;
  if p_qty > v_line.shortage_qty then
    raise exception 'MANUAL_QTY_EXCEEDS_SHORTAGE: 남은 부족수량(%)보다 많이 배정할 수 없습니다.', v_line.shortage_qty
      using errcode = '22023';
  end if;
  v_available := (select sb.normal_qty from core.stock_balance sb where sb.item_id = v_item_id)
    - core.item_committed_qty(v_item_id);
  if p_qty > v_available then
    raise exception 'STOCK_INSUFFICIENT: 현재 가용재고(%)보다 많이 배정할 수 없습니다.', greatest(v_available, 0)
      using errcode = '55000';
  end if;

  -- 정상 순서 판정: 같은 품목에서 이 주문보다 앞선 순번(우선순위 → 최초 검토 요청 시각 → 주문 생성
  -- 순서)의 부족수량 보유 주문이 있으면 등록 순서를 건너뛴 우선 배정이다.
  select count(*),
         (array_agg(q.order_no order by q.allocation_priority, q.first_review_requested_at, q.order_seq))[1]
    into v_ahead_count, v_first_ahead_order_no
    from core.v_allocation_queue_line q
   where q.item_id = v_item_id
     and q.order_id <> p_order_id
     and q.shortage_qty > 0
     and (q.allocation_priority, q.first_review_requested_at, q.order_seq)
         < (v_order.allocation_priority, v_order.first_review_requested_at, v_order.order_seq);

  if v_ahead_count = 0 then
    -- 정상 순서: SCM 품목담당자의 수동배정은 곧 확정배정이다(30일 만료 없음).
    v_allocation_id := core.create_stock_allocation(v_line.line_id, 'FIRM', p_qty, 'MANUAL', v_actor, v_reason);
    v_next_status := core.apply_sales_order_status(p_order_id);
    perform core.log_sales_order_event(
      p_order_id, 'ALLOCATION_CHANGED', v_order.status, v_next_status, v_actor, v_reason,
      jsonb_build_object(
        'kind', 'MANUAL_FIRM', 'allocation_id', v_allocation_id, 'item_id', v_item_id,
        'qty', p_qty, 'available_before_qty', v_available, 'queue_skipped', false
      )
    );
    return jsonb_build_object(
      'order_id', p_order_id, 'allocation_id', v_allocation_id, 'allocation_status', 'FIRM',
      'approval_id', null, 'order_status', v_next_status
    );
  end if;

  if v_reason is null then
    raise exception 'PRIORITY_REASON_REQUIRED: 대기 순서를 건너뛴 우선 배정에는 사유가 필수입니다 (앞선 대기 주문 %건).',
      v_ahead_count using errcode = '22023';
  end if;

  -- 순서를 건너뛰면 팀장 승인 전에는 확정배정을 실행하지 않는다. 승인대기 확보수량으로만 잡아
  -- 가용재고에서 차감하고(만료 없음), ALLOC_PRIORITY 승인을 요청한다.
  v_allocation_id := core.create_stock_allocation(v_line.line_id, 'APPROVAL_HOLD', p_qty, 'MANUAL', v_actor, v_reason);
  v_item_name := (select im.item_name from core.v_item_master im where im.item_id = v_item_id);

  v_payload := jsonb_build_object(
    'order_id', p_order_id, 'order_no', v_order.order_no, 'customer_name', v_order.customer_name,
    'sales_owner_name', v_order.owner_name, 'item_id', v_item_id, 'item_name', v_item_name,
    'requested_qty', p_qty, 'available_qty', v_available, 'reason', v_reason,
    'skipped_order_count', v_ahead_count, 'first_skipped_order_no', v_first_ahead_order_no,
    'allocation_id', v_allocation_id
  );
  v_approval_id := core.request_approval(
    'ALLOC_PRIORITY', 'STOCK_ALLOCATION', v_allocation_id::text, v_payload, 'QUEUE_SKIP', v_reason
  );
  update core.stock_allocation set approval_id = v_approval_id where allocation_id = v_allocation_id;

  -- Task 3 트리거가 만든 팀장 승인 대기 알림에 stage1 §2가 요구하는 내용(요청 주문 · 품목 · 요청 수량 ·
  -- 현재 가용재고 · 사유 · 요청자)을 채운다. 10분 반복 알림은 이 payload를 이어 쓰므로 반복분에도 들어간다.
  update core.notification_outbox o
     set payload = o.payload || v_payload || jsonb_build_object(
           'title', '수동 우선 배정 승인 요청',
           'message', format(
             '주문 %s · 품목 %s(%s) · 요청 수량 %s · 현재 가용재고 %s · 우선 배정 사유: %s · 요청자: %s',
             v_order.order_no, v_item_id, coalesce(v_item_name, '품목명 미상'), p_qty, v_available,
             v_reason, core.order_actor_name(v_actor)
           ),
           'target_id', v_order.order_no
         )
   where o.template_code = 'APPROVAL_PENDING'
     and o.status = 'PENDING'
     and o.payload ->> 'approval_id' = v_approval_id::text;

  v_next_status := core.apply_sales_order_status(p_order_id);
  perform core.log_sales_order_event(
    p_order_id, 'ALLOCATION_CHANGED', v_order.status, v_next_status, v_actor, v_reason,
    v_payload || jsonb_build_object('kind', 'APPROVAL_HOLD', 'approval_id', v_approval_id, 'queue_skipped', true)
  );
  return jsonb_build_object(
    'order_id', p_order_id, 'allocation_id', v_allocation_id, 'allocation_status', 'APPROVAL_HOLD',
    'approval_id', v_approval_id, 'order_status', v_next_status
  );
end;
$$;

create or replace function core.cancel_firm_allocation(p_allocation_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := nullif(btrim(p_reason), '');
  v_target core.stock_allocation%rowtype;
  v_order core.sales_order%rowtype;
  v_item_ids text[];
  v_others jsonb;
  v_released jsonb;
  v_released_total numeric;
  v_actor_name text;
  v_item_name text;
  v_now timestamptz;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 확정배정을 취소할 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('ALLOC_FIRM_CANCEL', v_actor) then
    raise exception '확정배정 취소 권한(ALLOC_FIRM_CANCEL)이 없습니다.' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'CANCEL_REASON_REQUIRED: 확정배정 취소 · 해제 사유는 필수입니다.' using errcode = '22023';
  end if;

  select * into v_target from core.stock_allocation a where a.allocation_id = p_allocation_id;
  if not found then
    raise exception '배정을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  select array_agg(l.item_id order by l.item_id) into v_item_ids
    from core.sales_order_line l
   where l.order_id = v_target.order_id;

  perform core.lock_stock_balance_items(v_item_ids, false);

  select * into v_order
    from core.sales_order
   where order_id = v_target.order_id
     for update;
  select * into v_target from core.stock_allocation a where a.allocation_id = p_allocation_id for update;

  if v_target.status <> 'FIRM' then
    raise exception 'FIRM_ALLOCATION_NOT_ACTIVE: 활성 확정배정만 취소할 수 있습니다 (현재 %).', v_target.status
      using errcode = '22023';
  end if;
  if v_order.status in ('DRAFT', 'CANCELLED', 'EXPIRED') then
    raise exception '진행 중인 주문의 확정배정만 취소할 수 있습니다 (현재 %).', v_order.status using errcode = '22023';
  end if;

  v_actor_name := core.order_actor_name(v_actor);
  perform core.transition_stock_allocation(p_allocation_id, 'RELEASED', v_actor, v_reason, 'FIRM_CANCELLED');

  -- 확정배정 취소는 주문 취소다. 같은 주문의 나머지 임시 · 확정 · 승인대기 확보도 모두 해제해 가용재고로
  -- 되돌리고, 주문을 배정 대기 상태로 되돌리지 않는다 (stage1 §2).
  v_others := core.release_order_allocations(v_order.order_id, v_actor, v_reason, 'ORDER_CANCELLED');
  v_released_total := v_target.qty + (v_others ->> 'released_qty')::numeric;
  v_released := jsonb_build_array(jsonb_build_object(
    'allocation_id', v_target.allocation_id, 'item_id', v_target.item_id, 'previous_status', 'FIRM', 'qty', v_target.qty
  )) || (v_others -> 'released');

  v_now := clock_timestamp();
  update core.sales_order
     set status = 'CANCELLED',
         cancelled_at = v_now,
         cancelled_by = v_actor,
         cancel_reason = v_reason
   where order_id = v_order.order_id;
  perform core.refresh_sales_order_line_totals(v_order.order_id);
  perform core.cancel_notification_series('TEMP_ALLOCATION', v_order.order_id::text);

  perform core.log_sales_order_event(
    v_order.order_id, 'CANCELLED', v_order.status, 'CANCELLED', v_actor, v_reason,
    jsonb_build_object(
      'kind', 'FIRM_CANCELLED', 'cancelled_allocation_id', p_allocation_id, 'item_id', v_target.item_id,
      'cancelled_firm_qty', v_target.qty, 'released_qty', v_released_total, 'released', v_released
    )
  );

  -- 취소 · 해제 알림: 주문번호 · 품목 · 해제 수량 · 처리 담당자 · 처리 시각 · 처리 사유 (stage1 §2).
  v_item_name := (select im.item_name from core.v_item_master im where im.item_id = v_target.item_id);
  perform core.enqueue_order_notice(
    'order:' || v_order.order_id || ':firm-cancelled',
    'ALLOC_FIRM_CANCELLED',
    array[v_order.owner_user_id],
    jsonb_build_object(
      'title', '확정배정이 취소되어 주문이 취소되었습니다',
      'message', format(
        '주문 %s · 품목 %s(%s) · 해제 수량 %s · 처리 담당자 %s · 처리 시각 %s · 사유: %s',
        v_order.order_no, v_target.item_id, coalesce(v_item_name, '품목명 미상'), v_target.qty,
        v_actor_name, to_char(v_now at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'), v_reason
      ),
      'target_id', v_order.order_no,
      'order_id', v_order.order_id, 'order_no', v_order.order_no, 'item_id', v_target.item_id,
      'released_qty', v_target.qty, 'order_released_qty', v_released_total,
      'handler_name', v_actor_name, 'handled_at', v_now, 'reason', v_reason
    )
  );
  return v_order.order_id;
end;
$$;

create or replace function core.copy_cancelled_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_source core.sales_order%rowtype;
  v_lines jsonb;
  v_new_order_id uuid;
  v_new_order_no text;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 주문을 재등록할 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('ORDER_CREATE', v_actor) then
    raise exception '주문 등록 권한(ORDER_CREATE)이 없습니다.' using errcode = '42501';
  end if;

  select * into v_source
    from core.sales_order
   where order_id = p_order_id
     for update;
  if not found then
    raise exception '주문을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if v_source.owner_user_id <> v_actor then
    raise exception '본인이 등록한 주문만 재등록할 수 있습니다.' using errcode = '42501';
  end if;
  if v_source.status not in ('CANCELLED', 'EXPIRED') then
    raise exception '취소 또는 만료된 주문만 재등록할 수 있습니다 (현재 %).', v_source.status using errcode = '22023';
  end if;
  if exists (select 1 from core.sales_order o where o.replaces_order_id = p_order_id) then
    raise exception 'ORDER_ALREADY_REPLACED: 이미 재등록된 주문입니다.' using errcode = '22023';
  end if;

  select jsonb_agg(jsonb_build_object('item_id', l.item_id, 'qty', l.requested_qty) order by l.line_no)
    into v_lines
    from core.sales_order_line l
   where l.order_id = p_order_id;

  -- 취소 · 만료된 주문은 복구하지 않고 새 주문(DRAFT)으로 만든다. 품목 · 수량 · 고객을 복사하고 연결한다.
  v_new_order_id := core.insert_sales_order(
    v_actor, v_source.customer_id, v_source.customer_name, v_source.note, v_lines, p_order_id
  );
  select o.order_no into v_new_order_no from core.sales_order o where o.order_id = v_new_order_id;

  perform core.log_sales_order_event(
    p_order_id, 'COPIED', v_source.status, v_source.status, v_actor, null,
    jsonb_build_object('new_order_id', v_new_order_id, 'new_order_no', v_new_order_no)
  );
  return v_new_order_id;
end;
$$;


-- 영업담당자가 수주 확정 전 주문을 취소한다 (stage1 §2 "임시배정은 주문이 반려 · 취소 또는 만료되면 해제").
-- 임시배정 · 승인대기 확보를 풀고 대기 중인 우선 배정 요청을 취소한다. 확정배정이 있으면 주문 취소가 아니라
-- SCM 품목담당자의 확정배정 취소 경로이므로 거절한다. 취소된 주문은 copy_cancelled_order로 재등록한다.
create or replace function core.cancel_sales_order(p_order_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := nullif(btrim(p_reason), '');
  v_order core.sales_order%rowtype;
  v_item_ids text[];
  v_result jsonb;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 주문을 취소할 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('ORDER_CREATE', v_actor) then
    raise exception '주문 취소 권한(ORDER_CREATE)이 없습니다.' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'CANCEL_REASON_REQUIRED: 주문 취소 사유는 필수입니다.' using errcode = '22023';
  end if;

  select * into v_order from core.sales_order o where o.order_id = p_order_id;
  if not found then
    raise exception '주문을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if v_order.owner_user_id <> v_actor then
    raise exception '본인이 등록한 주문만 취소할 수 있습니다.' using errcode = '42501';
  end if;

  select array_agg(l.item_id order by l.item_id) into v_item_ids
    from core.sales_order_line l
   where l.order_id = p_order_id;

  -- 잠금 순서 1) 재고 행(품목코드 순) → 2) 주문 행. 다품목 주문도 같은 순서라 교착이 생기지 않는다.
  perform core.lock_stock_balance_items(v_item_ids, false);

  select * into v_order
    from core.sales_order
   where order_id = p_order_id
     for update;
  if v_order.status = 'CONFIRMED' then
    raise exception 'ORDER_ALREADY_CONFIRMED: 수주 확정된 주문은 주문 취소가 아니라 확정배정 취소(SCM 품목담당자)로 처리합니다.'
      using errcode = '22023';
  end if;
  if v_order.status in ('CANCELLED', 'EXPIRED') then
    raise exception 'ORDER_ALREADY_CLOSED: 이미 취소 · 만료된 주문입니다 (현재 %).', v_order.status using errcode = '22023';
  end if;
  if exists (
    select 1 from core.stock_allocation a
     where a.order_id = p_order_id and a.status = 'FIRM'
  ) then
    raise exception 'FIRM_ALLOCATION_EXISTS: 확정배정이 있는 주문은 SCM 품목담당자의 확정배정 취소(core.cancel_firm_allocation)로만 취소합니다.'
      using errcode = '22023';
  end if;

  v_result := core.release_order_allocations(v_order.order_id, v_actor, v_reason, 'ORDER_CANCELLED');

  update core.sales_order
     set status = 'CANCELLED',
         cancelled_at = clock_timestamp(),
         cancelled_by = v_actor,
         cancel_reason = v_reason
   where order_id = v_order.order_id;
  perform core.refresh_sales_order_line_totals(v_order.order_id);
  perform core.cancel_notification_series('TEMP_ALLOCATION', v_order.order_id::text);

  perform core.log_sales_order_event(
    v_order.order_id, 'CANCELLED', v_order.status, 'CANCELLED', v_actor, v_reason,
    v_result || jsonb_build_object('kind', 'ORDER_CANCELLED')
  );
  return v_order.order_id;
end;
$$;


-- ══ 10. ALLOC_PRIORITY 승인 후처리 ═══════════════════════════════════
--
-- Task 2의 core.decide_approval이 승인 상태를 바꾸는 같은 트랜잭션에서 아래 트리거가 실행된다.
-- decide_approval을 다시 정의하지 않으므로 Task 8 · 9도 같은 방식으로 자기 유형의 후처리를 붙일 수 있다.

create or replace function core.guard_alloc_priority_approval_request()
returns trigger
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
begin
  if new.approval_type <> 'ALLOC_PRIORITY' then
    return new;
  end if;
  -- 승인대기 확보 없이 만든 우선 배정 승인은 승인해도 실행할 대상이 없어 영원히 대기로 남는다.
  if new.target_type <> 'STOCK_ALLOCATION'
     or not exists (
       select 1
         from core.stock_allocation a
        where a.allocation_id::text = new.target_id
          and a.status = 'APPROVAL_HOLD'
          and a.approval_id is null
     ) then
    raise exception '우선 배정 승인은 core.request_manual_allocation()이 만든 승인대기 확보에만 요청할 수 있습니다.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists alloc_priority_request_guard on core.approval_request;
create trigger alloc_priority_request_guard
  before insert on core.approval_request
  for each row execute function core.guard_alloc_priority_approval_request();

create or replace function core.apply_alloc_priority_decision()
returns trigger
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_allocation core.stock_allocation%rowtype;
  v_order core.sales_order%rowtype;
  v_next_status text;
  v_item_name text;
  v_cause text;
begin
  if new.approval_type <> 'ALLOC_PRIORITY' or old.status <> 'PENDING' or new.status = 'PENDING' then
    return new;
  end if;

  select * into v_allocation from core.stock_allocation a where a.approval_id = new.approval_id;
  if not found then
    raise exception '우선 배정 승인과 연결된 승인대기 확보를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  perform core.lock_stock_balance_items(array[v_allocation.item_id], false);
  select * into v_order
    from core.sales_order
   where order_id = v_allocation.order_id
     for update;
  select * into v_allocation from core.stock_allocation a where a.allocation_id = v_allocation.allocation_id for update;

  if new.status = 'APPROVED' then
    -- 승인 시점에 다시 확인한다. 확보가 이미 풀렸거나 주문이 끝났으면 우선 배정을 실행하지 않고
    -- 승인 결정 자체를 되돌린다(승인 전에는 실행하지 않는다 — stage1 §2).
    if v_allocation.status <> 'APPROVAL_HOLD'
       or v_order.status not in ('REVIEW_REQUESTED', 'PARTIALLY_ALLOCATED', 'WAITING_FULL', 'CONFIRMED') then
      raise exception '승인대기 확보가 이미 해제되었거나 주문이 종료되어 우선 배정을 실행할 수 없습니다.' using errcode = '55000';
    end if;
    -- 승인 즉시 확정배정으로 전환한다. SCM 품목담당자가 다시 수동배정하는 단계는 없다.
    v_cause := 'PRIORITY_APPROVED';
    perform core.transition_stock_allocation(
      v_allocation.allocation_id, 'FIRM', new.decided_by, new.decision_comment, v_cause,
      jsonb_build_object('priority_approval_id', new.approval_id)
    );
  elsif v_allocation.status = 'APPROVAL_HOLD' then
    -- 반려 · 취소는 확보수량을 즉시 해제해 가용재고로 되돌린다.
    v_cause := case new.status when 'REJECTED' then 'PRIORITY_REJECTED' else 'APPROVAL_CANCELLED' end;
    perform core.transition_stock_allocation(
      v_allocation.allocation_id, 'RELEASED', new.decided_by,
      coalesce(nullif(btrim(new.decision_comment), ''), '우선 배정 승인 요청이 취소되었습니다.'), v_cause,
      jsonb_build_object('priority_approval_id', new.approval_id)
    );
  else
    -- 주문 취소 경로가 먼저 확보를 해제하고 요청을 취소한 경우다.
    return new;
  end if;

  v_next_status := core.apply_sales_order_status(v_order.order_id);
  perform core.log_sales_order_event(
    v_order.order_id, 'ALLOCATION_CHANGED', v_order.status, v_next_status, new.decided_by, new.decision_comment,
    jsonb_build_object(
      'kind', v_cause, 'priority_approval_id', new.approval_id, 'allocation_id', v_allocation.allocation_id,
      'item_id', v_allocation.item_id, 'qty', v_allocation.qty
    )
  );

  if new.status in ('APPROVED', 'REJECTED') then
    v_item_name := (select im.item_name from core.v_item_master im where im.item_id = v_allocation.item_id);
    -- 요청한 SCM 품목담당자와 해당 영업담당자에게 결과를 알린다. dedupe 키를 Task 3 결과 알림
    -- (approval:<id>:decision:<status>)과 같게 둔다 — 이 트리거가 이름순으로 approval_notification_sync보다
    -- 먼저 실행되므로 요청자는 내용이 채워진 이 알림 한 건만 받는다. payload에 approval_id 키를 넣지
    -- 않는다(Task 3 트리거가 그 키로 대기 알림을 취소하므로 이 알림까지 지워진다).
    perform core.enqueue_order_notice(
      'approval:' || new.approval_id || ':decision:' || new.status,
      'ALLOC_PRIORITY_DECIDED',
      array[new.requested_by, v_order.owner_user_id],
      jsonb_build_object(
        'title', case new.status when 'APPROVED' then '우선 배정 요청이 승인되었습니다'
                                 else '우선 배정 요청이 반려되었습니다' end,
        'message', format(
          '주문 %s · 품목 %s(%s) · 요청 수량 %s · 결과 %s · 팀장 의견: %s · 처리 시각 %s',
          v_order.order_no, v_allocation.item_id, coalesce(v_item_name, '품목명 미상'), v_allocation.qty,
          case new.status when 'APPROVED' then '승인(확정배정 전환)' else '반려(확보수량 해제)' end,
          coalesce(nullif(btrim(new.decision_comment), ''), '없음'),
          to_char(new.decided_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI')
        ),
        'target_id', v_order.order_no,
        'priority_approval_id', new.approval_id, 'decision', new.status,
        'order_id', v_order.order_id, 'order_no', v_order.order_no,
        'item_id', v_allocation.item_id, 'requested_qty', v_allocation.qty,
        'decision_comment', new.decision_comment, 'decider_name', new.decider_name, 'decided_at', new.decided_at
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists alloc_priority_decision_apply on core.approval_request;
create trigger alloc_priority_decision_apply
  after update of status on core.approval_request
  for each row
  when (new.approval_type = 'ALLOC_PRIORITY' and old.status = 'PENDING' and new.status <> 'PENDING')
  execute function core.apply_alloc_priority_decision();


-- ══ 11. analytics 뷰 ═════════════════════════════════════════════════

create or replace view analytics.v_my_sales_order
with (security_invoker = true)
as
select
  o.order_id,
  o.order_no,
  o.customer_id,
  o.customer_name,
  o.owner_user_id,
  o.owner_name,
  o.status,
  o.requested_at,
  o.first_review_requested_at,
  o.temporary_expires_at,
  o.allocation_choice,
  o.allocation_priority,
  o.confirmed_order_no,
  o.confirmed_at,
  o.cancelled_at,
  o.cancel_reason,
  o.expired_at,
  o.replaces_order_id,
  src.order_no as replaces_order_no,
  rep.order_id as replaced_by_order_id,
  rep.order_no as replaced_by_order_no,
  o.note,
  t.line_count,
  t.requested_qty,
  t.temporary_allocated_qty,
  t.firm_allocated_qty,
  t.approval_hold_qty,
  t.shortage_qty,
  t.lines,
  coalesce(ev.events, '[]'::jsonb) as events
from core.sales_order o
left join core.sales_order src on src.order_id = o.replaces_order_id
left join core.sales_order rep on rep.replaces_order_id = o.order_id
left join lateral (
  select
    count(l.line_id) as line_count,
    sum(l.requested_qty) as requested_qty,
    sum(l.temporary_allocated_qty) as temporary_allocated_qty,
    sum(l.firm_allocated_qty) as firm_allocated_qty,
    sum(l.approval_hold_qty) as approval_hold_qty,
    sum(l.shortage_qty) as shortage_qty,
    coalesce(jsonb_agg(jsonb_build_object(
      'line_id', l.line_id, 'line_no', l.line_no, 'item_id', l.item_id, 'item_name', im.item_name,
      'requested_qty', l.requested_qty, 'temporary_allocated_qty', l.temporary_allocated_qty,
      'firm_allocated_qty', l.firm_allocated_qty, 'approval_hold_qty', l.approval_hold_qty,
      'shortage_qty', l.shortage_qty
    ) order by l.line_no) filter (where l.line_id is not null), '[]'::jsonb) as lines
  from core.sales_order_line l
  left join core.v_item_master im on im.item_id = l.item_id
  where l.order_id = o.order_id
) t on true
left join lateral (
  select jsonb_agg(jsonb_build_object(
    'event_id', e.event_id, 'event_type', e.event_type, 'previous_status', e.previous_status,
    'next_status', e.next_status, 'actor_name', e.actor_name, 'reason', e.reason,
    'payload', e.payload, 'at', e.at
  ) order by e.at, e.event_id) as events
  from core.sales_order_event e
  where e.order_id = o.order_id
) ev on true
where o.owner_user_id = auth.uid();

comment on view analytics.v_my_sales_order is
  'Task 5 — 로그인한 영업담당자 본인의 주문, 품목별 임시·확정·승인대기·부족수량과 주문 이력. security_invoker';

create or replace view analytics.v_allocation_queue
with (security_invoker = true)
as
select
  q.item_id,
  im.item_name,
  q.queue_rank,
  q.order_id,
  q.order_no,
  q.order_status,
  q.customer_name,
  q.owner_name,
  q.line_id,
  q.requested_qty,
  q.temporary_allocated_qty,
  q.firm_allocated_qty,
  q.approval_hold_qty,
  q.shortage_qty,
  q.allocation_choice,
  q.allocation_priority,
  q.first_review_requested_at,
  q.temporary_expires_at,
  q.order_seq,
  ip.allocation_mode,
  aq.available_qty as item_available_qty,
  case when aq.item_id is null then 'INVENTORY_SCOPE_UNCLASSIFIED' end as reason_code,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'allocation_id', a.allocation_id, 'status', a.status, 'qty', a.qty, 'source', a.source,
      'approval_id', a.approval_id, 'created_at', a.created_at, 'reason', a.reason
    ) order by a.created_at)
    from core.stock_allocation a
    where a.line_id = q.line_id and a.status <> 'RELEASED'
  ), '[]'::jsonb) as active_allocations
from core.v_allocation_queue_line q
left join core.v_item_master im on im.item_id = q.item_id
left join core.item_policy ip on ip.item_id = q.item_id
left join core.v_item_allocation_qty aq on aq.item_id = q.item_id
where core.has_permission('ALLOC_VIEW')
   or core.has_permission('ALLOC_MANUAL')
   or core.has_permission('ALLOC_FIRM_CANCEL')
   or core.has_permission('ALLOC_PRIORITY_EDIT')
   or core.has_permission('ALLOC_PRIORITY_APPROVE');

comment on view analytics.v_allocation_queue is
  'Task 5 — SCM · 사업강화부용 진행 중 주문 품목, 대기 순번, 우선순위, 활성 배정. 품목 재고가 확정되지 '
  '않았으면 item_available_qty null + INVENTORY_SCOPE_UNCLASSIFIED. security_invoker';

-- Task 4 뷰 확장: 열 이름 · 순서를 그대로 두고 0으로 고정했던 배정 세 열을 실제 합계로 바꾼다 (error.md #16).
create or replace view analytics.v_available_stock
with (security_invoker = true)
as
select
  im.item_id,
  im.item_name,
  im.item_type,
  coalesce(ivr.visibility_scope, 'GENERAL') as visibility_scope,
  sb.normal_qty as normal_warehouse_qty,
  sb.snapshot_at,
  coalesce(aq.temporary_allocated_qty, 0::numeric) as temporary_allocated_qty,
  coalesce(aq.firm_allocated_qty, 0::numeric) as firm_allocated_qty,
  coalesce(aq.approval_hold_qty, 0::numeric) as approval_hold_qty,
  case when sb.normal_qty is null then null
       else sb.normal_qty - coalesce(aq.committed_qty, 0::numeric)
  end as available_qty,
  po.open_po_qty,
  ib.inbound_qty as in_transit_qty,
  case when sb.item_id is null then 'INVENTORY_SCOPE_UNCLASSIFIED' end as reason_code
from core.v_item_master im
left join core.item_visibility_rule ivr on ivr.raw_item_type = im.item_type
left join core.stock_balance sb on sb.item_id = im.item_id
left join core.v_item_allocation_qty aq on aq.item_id = im.item_id
left join core.v_inbound_qty ib on ib.item_id = im.item_id
left join core.v_open_po_qty po on po.item_id = im.item_id
where
  core.has_permission('STOCK_VIEW_ALL')
  or (core.has_permission('STOCK_VIEW_PAPER') and coalesce(ivr.visibility_scope, 'GENERAL') = 'PAPER_CARD_READER')
  or (core.has_permission('STOCK_VIEW_SUPPLY') and coalesce(ivr.visibility_scope, 'GENERAL') = 'CONSUMABLE');

comment on view analytics.v_available_stock is
  'Task 4 · 5 — 부서 권한과 품목 범위로 제한한 정상 창고재고 · 가용재고 상세. 가용재고 = 정상 창고재고 − '
  '임시배정 − 확정배정 − 승인대기 확보(core.v_item_allocation_qty). 분류 불가 품목은 null + INVENTORY_SCOPE_UNCLASSIFIED';

create or replace view analytics.v_order_available_stock
with (security_invoker = true)
as
select
  im.item_id,
  im.item_name,
  case when sb.normal_qty is null then null
       else sb.normal_qty - coalesce(aq.committed_qty, 0::numeric)
  end as available_qty,
  case when sb.item_id is null then 'INVENTORY_SCOPE_UNCLASSIFIED' end as reason_code
from core.v_item_master im
left join core.stock_balance sb on sb.item_id = im.item_id
left join core.v_item_allocation_qty aq on aq.item_id = im.item_id
where core.has_permission('ATP_VIEW');

comment on view analytics.v_order_available_stock is
  'Task 4 · 5 — 영업(ATP_VIEW) 전용 주문 가능 수량 = 정상 창고재고 − 모든 영업담당자의 임시 · 확정 · '
  '승인대기 합계. 재고 상세는 노출하지 않는다';

create or replace view analytics.v_urgent_order
with (security_invoker = true)
as
select
  u.urgent_order_id,
  u.item_id,
  im.item_name,
  u.qty,
  u.needed_by,
  u.reason,
  u.status,
  u.owner_user_id,
  u.owner_name,
  u.created_at,
  u.updated_at
from core.urgent_order u
left join core.v_item_master im on im.item_id = u.item_id
where core.has_permission('STOCK_VIEW_ALL')
   or (core.has_permission('URGENT_ORDER_VIEW') and core.item_visibility_scope(u.item_id) = 'CONSUMABLE');

comment on view analytics.v_urgent_order is
  'Task 5 — 긴급발주 현황. SCM(STOCK_VIEW_ALL)은 전체, 서비스부(URGENT_ORDER_VIEW)는 소모품만. security_invoker';


-- ══ 12. RLS와 실행 권한 ═══════════════════════════════════════════════

alter table core.sales_order enable row level security;
alter table core.sales_order_line enable row level security;
alter table core.stock_allocation enable row level security;
alter table core.allocation_priority enable row level security;
alter table core.urgent_order enable row level security;
alter table core.sales_order_event enable row level security;
alter table core.stock_allocation_event enable row level security;

drop policy if exists sales_order_read on core.sales_order;
create policy sales_order_read on core.sales_order
  for select to authenticated
  using (core.can_view_sales_order(owner_user_id));

drop policy if exists sales_order_line_read on core.sales_order_line;
create policy sales_order_line_read on core.sales_order_line
  for select to authenticated
  using (exists (select 1 from core.sales_order o where o.order_id = sales_order_line.order_id));

drop policy if exists stock_allocation_read on core.stock_allocation;
create policy stock_allocation_read on core.stock_allocation
  for select to authenticated
  using (exists (select 1 from core.sales_order o where o.order_id = stock_allocation.order_id));

drop policy if exists allocation_priority_read on core.allocation_priority;
create policy allocation_priority_read on core.allocation_priority
  for select to authenticated
  using (exists (select 1 from core.sales_order o where o.order_id = allocation_priority.order_id));

drop policy if exists sales_order_event_read on core.sales_order_event;
create policy sales_order_event_read on core.sales_order_event
  for select to authenticated
  using (exists (select 1 from core.sales_order o where o.order_id = sales_order_event.order_id));

drop policy if exists stock_allocation_event_read on core.stock_allocation_event;
create policy stock_allocation_event_read on core.stock_allocation_event
  for select to authenticated
  using (exists (select 1 from core.sales_order o where o.order_id = stock_allocation_event.order_id));

drop policy if exists urgent_order_read on core.urgent_order;
create policy urgent_order_read on core.urgent_order
  for select to authenticated
  using (
    core.has_permission('STOCK_VIEW_ALL')
    or (core.has_permission('URGENT_ORDER_VIEW') and core.item_visibility_scope(item_id) = 'CONSUMABLE')
  );

revoke all on core.sales_order, core.sales_order_line, core.stock_allocation, core.allocation_priority,
  core.urgent_order, core.sales_order_event, core.stock_allocation_event from anon, public;
revoke insert, update, delete on core.sales_order, core.sales_order_line, core.stock_allocation,
  core.allocation_priority, core.urgent_order, core.sales_order_event, core.stock_allocation_event
  from authenticated;
grant select on core.sales_order, core.sales_order_line, core.stock_allocation, core.allocation_priority,
  core.urgent_order, core.sales_order_event, core.stock_allocation_event to authenticated;
revoke all on sequence core.sales_order_no_seq from anon, public, authenticated;

revoke all on core.v_item_allocation_qty, core.v_allocation_queue_line from anon, public;
grant select on core.v_item_allocation_qty, core.v_allocation_queue_line to authenticated;
revoke all on analytics.v_my_sales_order, analytics.v_allocation_queue, analytics.v_urgent_order,
  analytics.v_available_stock, analytics.v_order_available_stock from anon, public;
grant select on analytics.v_my_sales_order, analytics.v_allocation_queue, analytics.v_urgent_order,
  analytics.v_available_stock, analytics.v_order_available_stock to authenticated;

-- 공개 명령 — 함수가 스스로 로그인 · 업무 권한을 검사한다.
revoke all on function core.create_sales_order(text, text, jsonb, text) from public, anon;
revoke all on function core.request_order_review(uuid, text) from public, anon;
revoke all on function core.confirm_sales_order(uuid, text) from public, anon;
revoke all on function core.change_allocation_priority(uuid, integer, text) from public, anon;
revoke all on function core.request_manual_allocation(uuid, text, numeric, text) from public, anon;
revoke all on function core.cancel_firm_allocation(uuid, text) from public, anon;
revoke all on function core.copy_cancelled_order(uuid) from public, anon;
grant execute on function core.create_sales_order(text, text, jsonb, text) to authenticated;
grant execute on function core.request_order_review(uuid, text) to authenticated;
grant execute on function core.confirm_sales_order(uuid, text) to authenticated;
grant execute on function core.change_allocation_priority(uuid, integer, text) to authenticated;
grant execute on function core.request_manual_allocation(uuid, text, numeric, text) to authenticated;
grant execute on function core.cancel_firm_allocation(uuid, text) to authenticated;
grant execute on function core.copy_cancelled_order(uuid) to authenticated;
revoke all on function core.cancel_sales_order(uuid, text) from public, anon;
grant execute on function core.cancel_sales_order(uuid, text) to authenticated;

-- RLS 정책과 security_invoker 뷰가 호출자 권한으로 부르는 판정 함수.
revoke all on function core.can_view_sales_order(uuid) from public, anon;
revoke all on function core.item_visibility_scope(text) from public, anon;
grant execute on function core.can_view_sales_order(uuid) to authenticated;
grant execute on function core.item_visibility_scope(text) to authenticated;

-- 내부 전용 — authenticated도 직접 실행할 수 없다. 공개 명령과 Task 6 함수가 SECURITY DEFINER로만 부른다.
revoke all on function core.normalize_item_id(text) from public, anon, authenticated;
revoke all on function core.order_actor_name(uuid) from public, anon, authenticated;
revoke all on function core.lock_stock_balance_items(text[], boolean) from public, anon, authenticated;
revoke all on function core.item_committed_qty(text) from public, anon, authenticated;
revoke all on function core.refresh_sales_order_line_totals(uuid) from public, anon, authenticated;
revoke all on function core.apply_sales_order_status(uuid) from public, anon, authenticated;
revoke all on function core.log_sales_order_event(uuid, text, text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function core.create_stock_allocation(bigint, text, numeric, text, uuid, text) from public, anon, authenticated;
revoke all on function core.transition_stock_allocation(uuid, text, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function core.sales_order_notice_recipients(uuid, boolean) from public, anon, authenticated;
revoke all on function core.enqueue_order_notice(text, text, uuid[], jsonb) from public, anon, authenticated;
revoke all on function core.schedule_sales_order_expiry_notices(uuid) from public, anon, authenticated;
revoke all on function core.cancel_alloc_priority_approval(uuid, uuid, text) from public, anon, authenticated;
revoke all on function core.release_order_allocations(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function core.insert_sales_order(uuid, text, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function core.allocate_to_order_line(bigint, numeric, text, uuid) from public, anon, authenticated;
revoke all on function core.sales_order_transition_allowed(text, text) from public, anon, authenticated;
revoke all on function core.reject_order_history_mutation() from public, anon, authenticated;
revoke all on function core.guard_sales_order_mutation() from public, anon, authenticated;
revoke all on function core.guard_sales_order_line_mutation() from public, anon, authenticated;
revoke all on function core.guard_stock_allocation_mutation() from public, anon, authenticated;
revoke all on function core.guard_alloc_priority_approval_request() from public, anon, authenticated;
revoke all on function core.apply_alloc_priority_decision() from public, anon, authenticated;


-- ══ 13. 수동 적용 후 확인 쿼리 ═══════════════════════════════════════
--
-- (a) 뷰 보안 옵션 — analytics 네 뷰와 core.v_allocation_queue_line은 security_invoker=true,
--     core.v_item_allocation_qty는 소유자 권한(옵션 없음)이어야 한다.
-- select n.nspname, c.relname, c.reloptions
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where (n.nspname, c.relname) in (('analytics','v_my_sales_order'), ('analytics','v_allocation_queue'),
--        ('analytics','v_order_available_stock'), ('analytics','v_urgent_order'), ('analytics','v_available_stock'),
--        ('core','v_allocation_queue_line'), ('core','v_item_allocation_qty'));
--
-- (b) 초과 배정 없음 — 0행이어야 한다.
-- select a.item_id, sb.normal_qty, sum(a.qty) as committed_qty
--   from core.stock_allocation a join core.stock_balance sb using (item_id)
--  where a.status in ('TEMPORARY', 'APPROVAL_HOLD', 'FIRM')
--  group by a.item_id, sb.normal_qty
-- having sum(a.qty) > sb.normal_qty;
--
-- (c) 주문 품목 합계가 배정 원장과 같은지 — 0행이어야 한다.
-- select l.line_id
--   from core.sales_order_line l
--   left join core.stock_allocation a on a.line_id = l.line_id and a.status <> 'RELEASED'
--  group by l.line_id, l.temporary_allocated_qty, l.firm_allocated_qty, l.approval_hold_qty
-- having l.temporary_allocated_qty <> coalesce(sum(a.qty) filter (where a.status = 'TEMPORARY'), 0)
--     or l.firm_allocated_qty <> coalesce(sum(a.qty) filter (where a.status = 'FIRM'), 0)
--     or l.approval_hold_qty <> coalesce(sum(a.qty) filter (where a.status = 'APPROVAL_HOLD'), 0);
--
-- (d) 만료일 직접 변경은 트리거가 거절한다 — "임시배정 만료일은 ... 변경할 수 없습니다."
-- begin;
--   update core.sales_order set temporary_expires_at = temporary_expires_at + interval '1 day'
--    where temporary_expires_at is not null;
-- rollback;
--
-- (e) 영업담당자 계정으로 실행(SQL Editor에서 JWT 대역) — 테이블 직접 쓰기는 42501이어야 한다.
-- begin;
--   set local role authenticated;
--   select set_config('request.jwt.claim.sub', '<영업담당자 UUID>', true);
--   update core.stock_allocation set qty = 1;          -- 기대: permission denied
--   select count(*) from analytics.v_my_sales_order;   -- 기대: 본인 주문 수
-- rollback;
--
-- (f) 승인대기 확보에는 만료가 없고, 승인 후 곧바로 FIRM이 되는지 확인
-- select a.allocation_id, a.status, a.approval_id, r.status as approval_status
--   from core.stock_allocation a left join core.approval_request r using (approval_id)
--  where a.source = 'MANUAL'
--  order by a.created_at desc;
--
-- (g) 우선순위 변경 이력 — 변경 전후 · 변경자 · 시각 · 사유
-- select order_id, previous_priority, priority, changed_by_name, changed_at, reason
--   from core.allocation_priority order by changed_at desc;
