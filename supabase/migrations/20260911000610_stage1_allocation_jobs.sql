-- Task 6 · 자동 만료와 입고 후 후속 배정
--
-- 목적: 30일 임시배정 만료와 신규 입고 배정을 사람의 수동 실행에 의존하지 않게 한다 (stage1 §2).
-- Task 5의 20260911000600_stage1_sales_order_allocation.sql이 이미 2,393줄이라(컨트롤러 판정)
-- 이번 작업은 별도 파일로 만든다. 0600의 함수를 create or replace로 다시 정의하는 곳(§2)과
-- 새 함수만 추가하는 곳(§1)으로 나눈다. 다시 실행해도 안전하다(create or replace · add column if
-- not exists). 운영 테이블에 예시 데이터를 넣지 않는다. 실제 Supabase 적용은 사용자가 SQL Editor에서
-- 수동으로 수행한다.
--
-- ★ 컨트롤러 판정 반영
--   1) 만료 시 TEMPORARY만 해제한다. 해제 뒤 FIRM · APPROVAL_HOLD가 남아 있으면 주문은 EXPIRED가
--      되지 않고 현재 상태를 유지한다(부족수량은 다시 계산). 아무것도 남지 않으면 EXPIRED.
--      배정이 0건인 WAITING_FULL 주문도 최초 검토 요청 + 30일에 EXPIRED가 된다(대기열 이탈).
--      완료 알림("임시배정이 자동 해제되었습니다")은 이번 실행이 실제로 TEMPORARY를 해제했을
--      때만(released_qty > 0) 영업담당자 + SCM 품목담당자에게 보낸다. 배정 0건 만료는 해제한 것이
--      없으므로 알림을 보내지 않는다.
--   2) 경계: clock_timestamp() >= temporary_expires_at(Task 5 가드와 동일한 식)이고, 후보 조건은
--      "TEMPORARY가 있다" 또는 "TEMPORARY · APPROVAL_HOLD · FIRM이 전혀 없다"로 좁힌다 — 이미
--      처리를 끝낸 주문(TEMPORARY 0건, FIRM만 남음)은 재실행 때 더 이상 후보에 잡히지 않으므로
--      재실행이 이중 해제 · 이중 알림 · 이중 오류를 만들지 않는다(dedupe_key도 이중 방어).
--   3) 주문 하나는 자신의 잠금 범위(재고 행 → 주문 행 → 배정 행, core.release_order_allocations와
--      같은 순서) 안에서 처리한다. PL/pgSQL의 BEGIN…EXCEPTION 블록은 암묵적 SAVEPOINT라, 한 주문
--      처리 중 오류가 나도 그 주문의 변경만 되돌아가고 앞서 처리한 다른 주문의 변경은 트랜잭션에
--      그대로 남는다 — 오류는 삼키지 않고 결과 행(outcome='FAILED', error_message)으로 보고한다.
--   4) 신규 완료 입고만 같은 커밋 트랜잭션에서 AUTO 후속 배정을 부른다. core.stock_receipt_ledger에
--      이번에 새로 들어간 (source_record_id, item_id) 행만 대상이다 — 같은 배치를 다시 커밋해도
--      새 행이 없으면 아무 것도 다시 배정하지 않는다. 만료 · 취소로 풀린 재고는 그냥 가용재고로
--      돌아갈 뿐 자동 배정을 촉발하지 않는다(그 경로는 core.transition_stock_allocation만 부른다).
--   5) 입고 수량은 core.v_allocation_queue_line의 대기 순번(우선순위 → 최초 검토 요청 시각 →
--      생성 순서) 순으로 나눠 배정한다. 확정 전 주문이 이미 만료 시각을 지났으면(자동 만료
--      작업이 아직 돌지 않은 경우) 건너뛴다 — core.allocate_to_order_line을 부르면
--      TEMPORARY_ALLOCATION_EXPIRED로 이 함수 전체가 아니라 입고 커밋 트랜잭션 전체가
--      되돌아가므로, 사전 확인과 예외 방어를 함께 둔다. CONFIRMED 주문은 FIRM으로 배정한다.
--      WAIT_FULL 확정 전 주문은 남은 부족수량 전체를 채울 수 있을 때만 배정한다(전체 배정 대기
--      원칙을 신규 입고 배정에도 유지). PARTIAL 주문은 남은 부족수량 범위에서 채우고 대기 순번은
--      그대로 유지한다(대기열 자체가 부족수량 > 0인 줄만 순번을 매긴다).
--   6) MANUAL 품목(core.item_policy.allocation_mode = 'MANUAL', 정책이 없으면 기본값 AUTO)은
--      자동 배정을 전혀 하지 않고 SCM 품목담당자(ALLOC_MANUAL)에게 "처리 필요" 알림만 보낸다.
--      core.list_manual_allocation_candidates는 배정을 계산하거나 쓰지 않고 대기 순번만 보여준다.
--   7) 자동 배정 알림에는 주문번호 · 품목 · 배정수량 · 남은 부족수량 · 배정시각을 담는다
--      (stage1 §2 64~65행).
--   8) APPROVAL_HOLD와 FIRM은 만료 함수가 건드리지 않는다(만료 후보 조건 자체가 이 둘만 남은
--      주문을 제외한다).

-- ══ 1. 30일 임시배정 자동 만료 ═══════════════════════════════════════

create or replace function core.expire_temporary_allocations(p_now timestamptz default clock_timestamp())
returns table (
  order_id       uuid,
  order_no       text,
  outcome        text,
  released_qty   numeric,
  error_message  text
)
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_order core.sales_order%rowtype;
  v_item_ids text[];
  v_allocation record;
  v_released_qty numeric;
  v_remaining_active integer;
  v_prev_status text;
  v_next_status text;
  v_outcome text;
  v_event_type text;
  v_recipients uuid[];
  v_sqlstate text;
  v_message text;
begin
  for v_order in
    select o.*
      from core.sales_order o
     where o.status in ('REVIEW_REQUESTED', 'PARTIALLY_ALLOCATED', 'WAITING_FULL')
       and o.temporary_expires_at is not null
       and p_now >= o.temporary_expires_at
       and (
         exists (
           select 1 from core.stock_allocation a
            where a.order_id = o.order_id and a.status = 'TEMPORARY'
         )
         or not exists (
           select 1 from core.stock_allocation a
            where a.order_id = o.order_id and a.status in ('TEMPORARY', 'APPROVAL_HOLD', 'FIRM')
         )
       )
     order by o.order_seq
  loop
    begin
      v_released_qty := 0;
      v_prev_status := v_order.status;

      select array_agg(distinct l.item_id order by l.item_id) into v_item_ids
        from core.sales_order_line l where l.order_id = v_order.order_id;

      -- 잠금 순서 1) 재고 행(품목코드 순) → 2) 주문 행 → 3) 배정 행(transition_stock_allocation이 잠근다).
      perform core.lock_stock_balance_items(v_item_ids, false);

      perform 1 from core.sales_order s where s.order_id = v_order.order_id for update;

      for v_allocation in
        select a.allocation_id, a.qty
          from core.stock_allocation a
         where a.order_id = v_order.order_id and a.status = 'TEMPORARY'
         order by a.item_id, a.created_at
           for update
      loop
        perform core.transition_stock_allocation(
          v_allocation.allocation_id, 'RELEASED', null,
          '임시배정 만료(30일 경과)로 자동 해제되었습니다.', 'EXPIRED'
        );
        v_released_qty := v_released_qty + v_allocation.qty;
      end loop;

      select count(*) into v_remaining_active
        from core.stock_allocation a
       where a.order_id = v_order.order_id and a.status in ('FIRM', 'APPROVAL_HOLD');

      if v_remaining_active = 0 then
        update core.sales_order s
           set status = 'EXPIRED', expired_at = clock_timestamp()
         where s.order_id = v_order.order_id;
        v_outcome := 'EXPIRED';
        v_next_status := 'EXPIRED';
        v_event_type := 'EXPIRED';
      else
        -- FIRM · 승인대기 확보가 남아 있으면 만료로 끝내지 않는다(컨트롤러 판정 2). 부족수량만
        -- 다시 계산해 대기열 · 상태 표시를 맞춘다.
        v_next_status := core.apply_sales_order_status(v_order.order_id);
        v_outcome := 'RELEASED';
        v_event_type := 'ALLOCATION_CHANGED';
      end if;

      perform core.log_sales_order_event(
        v_order.order_id, v_event_type, v_prev_status, v_next_status, null,
        '임시배정 만료(30일 경과) 자동 처리',
        jsonb_build_object(
          'kind', 'TEMPORARY_ALLOCATION_EXPIRED', 'released_qty', v_released_qty,
          'remaining_active_count', v_remaining_active, 'outcome', v_outcome
        )
      );

      -- 완료 알림은 이번 실행이 실제로 TEMPORARY를 해제했을 때만 보낸다(컨트롤러 판정 2).
      -- enqueue_temporary_allocation_released의 dedupe_key가 주문당 한 번만 쌓이게 막아
      -- 재실행 · 동시 실행에도 중복 발송되지 않는다.
      if v_released_qty > 0 then
        v_recipients := core.sales_order_notice_recipients(v_order.order_id, true);
        if cardinality(v_recipients) > 0 then
          perform core.enqueue_temporary_allocation_released(v_order.order_id::text, v_recipients);
        end if;
      end if;

      order_id := v_order.order_id;
      order_no := v_order.order_no;
      outcome := v_outcome;
      released_qty := v_released_qty;
      error_message := null;
      return next;
    exception when others then
      -- 이 BEGIN…EXCEPTION 블록은 암묵적 SAVEPOINT다 — 이 주문의 변경만 되돌리고, 앞서 이미
      -- 처리한 다른 주문의 커밋 전 변경은 트랜잭션에 그대로 남는다(컨트롤러 판정 3).
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      order_id := v_order.order_id;
      order_no := v_order.order_no;
      outcome := 'FAILED';
      released_qty := 0;
      error_message := v_sqlstate || ': ' || v_message;
      return next;
    end;
  end loop;
  return;
end;
$$;

comment on function core.expire_temporary_allocations(timestamptz) is
  'Task 6 · 30일 경과 임시배정 자동 해제. TEMPORARY만 해제하고, FIRM · APPROVAL_HOLD가 남으면
   주문은 EXPIRED로 만들지 않는다. 배정 0건 WAITING_FULL 주문은 그대로 EXPIRED. 재실행해도
   이미 처리된 주문은 후보에서 빠져 이중 해제 · 이중 알림이 없다. 한 주문의 실패가 다른 주문
   처리를 막지 않는다(주문별 BEGIN…EXCEPTION). Cron(app/api/cron/allocations)만 호출한다';

revoke all on function core.expire_temporary_allocations(timestamptz) from public, anon, authenticated;
grant execute on function core.expire_temporary_allocations(timestamptz) to service_role;


-- ══ 2. 입고 후 후속 배정(AUTO) · 처리 필요 알림(MANUAL) ═══════════════

-- 자동 배정 알림 — 주문번호 · 품목 · 배정수량 · 남은 부족수량 · 배정시각(stage1 §2 64~65행).
create or replace function core.enqueue_auto_allocation_notice(
  p_order_id uuid,
  p_dedupe_suffix text,
  p_item_id text,
  p_allocated_qty numeric,
  p_remaining_shortage_qty numeric
)
returns integer
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_order_no text;
  v_recipients uuid[];
begin
  select o.order_no into v_order_no from core.sales_order o where o.order_id = p_order_id;
  v_recipients := core.sales_order_notice_recipients(p_order_id, true);
  if v_order_no is null or cardinality(v_recipients) = 0 then
    return 0;
  end if;

  return core.enqueue_order_notice(
    'auto_alloc:' || p_order_id::text || ':' || p_dedupe_suffix,
    'AUTO_ALLOCATION',
    v_recipients,
    jsonb_build_object(
      'order_id', p_order_id, 'order_no', v_order_no, 'item_id', p_item_id,
      'allocated_qty', p_allocated_qty, 'remaining_shortage_qty', p_remaining_shortage_qty,
      'allocated_at', clock_timestamp(),
      'title', '신규 입고로 자동 배정되었습니다',
      'message', format(
        '%s 품목 %s만큼 자동 배정되었습니다. 남은 부족수량: %s', p_item_id, p_allocated_qty, p_remaining_shortage_qty
      )
    )
  );
end;
$$;

revoke all on function core.enqueue_auto_allocation_notice(uuid, text, text, numeric, numeric) from public, anon, authenticated;

-- Task 6 계약: 입고 원장 한 건(p_receipt_id = core.stock_receipt_ledger.ledger_id)의 수량을
-- 대기 순번 순으로 나눠 배정한다. core.commit_import_batch(goods_receipt 분기)가 새로 반영된
-- 원장 행마다 이 함수를 부른다(AUTO 품목만).
create or replace function core.allocate_new_stock(p_item_id text, p_receipt_id bigint)
returns numeric
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_qty numeric;
  v_remaining numeric;
  v_line record;
  v_total numeric := 0;
  v_allocated numeric;
  v_max_qty numeric;
  v_remaining_shortage numeric;
  v_sqlstate text;
begin
  select l.qty into v_qty
    from core.stock_receipt_ledger l
   where l.ledger_id = p_receipt_id and l.item_id = p_item_id;
  if not found or v_qty is null or v_qty <= 0 then
    return 0;
  end if;

  v_remaining := v_qty;

  for v_line in
    select q.line_id, q.order_id, q.order_status, q.allocation_choice, q.temporary_expires_at, q.shortage_qty
      from core.v_allocation_queue_line q
     where q.item_id = p_item_id
       and q.queue_rank is not null
     order by q.queue_rank
  loop
    exit when v_remaining <= 0;

    -- 확정 전 주문이 이미 만료 시각을 지났으면(자동 만료 작업이 아직 돌지 않은 경우) 건너뛴다.
    -- 그대로 배정을 시도하면 TEMPORARY_ALLOCATION_EXPIRED로 이 입고 커밋 전체가 되돌아간다
    -- (컨트롤러 판정 5) — 예외 방어(아래)를 이중으로 둔다.
    if v_line.order_status <> 'CONFIRMED' and clock_timestamp() >= v_line.temporary_expires_at then
      continue;
    end if;

    v_max_qty := v_remaining;
    -- 확정 전 WAIT_FULL 주문은 남은 부족수량 전체를 채울 수 있을 때만 배정한다(전체 배정 대기
    -- 원칙 유지). 확정 주문은 선택 방식과 무관하게 가능한 만큼 채운다.
    if v_line.order_status <> 'CONFIRMED' and v_line.allocation_choice = 'WAIT_FULL'
       and v_remaining < v_line.shortage_qty then
      v_max_qty := 0;
    end if;
    if v_max_qty <= 0 then
      continue;
    end if;

    begin
      v_allocated := core.allocate_to_order_line(v_line.line_id, v_max_qty, 'RECEIPT', null);
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      if v_sqlstate = '55000' then
        -- 만료 · 재고미분류 등 55000 계열은 이 주문만 건너뛰고 나머지 대기열은 계속 처리한다.
        v_allocated := 0;
      else
        raise;
      end if;
    end;

    if v_allocated > 0 then
      v_remaining := v_remaining - v_allocated;
      v_total := v_total + v_allocated;
      select l.shortage_qty into v_remaining_shortage from core.sales_order_line l where l.line_id = v_line.line_id;
      perform core.enqueue_auto_allocation_notice(
        v_line.order_id, p_receipt_id::text || ':' || v_line.line_id, p_item_id, v_allocated, v_remaining_shortage
      );
    end if;
  end loop;

  return v_total;
end;
$$;

comment on function core.allocate_new_stock(text, bigint) is
  'Task 6 · AUTO 품목의 입고 후속 배정. core.v_allocation_queue_line 순번대로 채우고, 확정 전
   WAIT_FULL 주문은 전량 채울 수 있을 때만 배정한다. 만료된 확정 전 주문은 건너뛰어 입고
   커밋 트랜잭션이 되돌아가지 않게 한다. core.commit_import_batch만 호출하는 내부 함수다';

revoke all on function core.allocate_new_stock(text, bigint) from public, anon, authenticated;

-- MANUAL 품목 처리 필요 알림 — 계산 없이 품목 · 입고수량만 SCM 품목담당자 전원에게 전달한다.
create or replace function core.notify_manual_allocation_needed(p_item_id text, p_receipt_id bigint, p_qty numeric)
returns integer
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_recipients uuid[];
begin
  select coalesce(array_agg(distinct u.user_id), array[]::uuid[]) into v_recipients
    from core.app_user u
    join core.role_permission rp on rp.job_role = u.job_role
   where rp.permission_code = 'ALLOC_MANUAL' and u.active;

  if cardinality(v_recipients) = 0 then
    return 0;
  end if;

  return core.enqueue_order_notice(
    'manual_alloc:' || p_receipt_id::text,
    'MANUAL_ALLOCATION_NEEDED',
    v_recipients,
    jsonb_build_object(
      'item_id', p_item_id, 'received_qty', p_qty, 'receipt_id', p_receipt_id,
      'title', '수동 배정 처리가 필요합니다',
      'message', format('%s 품목이 %s만큼 입고되었습니다. 확인 후 수동으로 확정배정해 주세요.', p_item_id, p_qty)
    )
  );
end;
$$;

comment on function core.notify_manual_allocation_needed(text, bigint, numeric) is
  'Task 6 · MANUAL 품목은 자동 배정하지 않는다. core.commit_import_batch만 호출하는 내부 함수다';

revoke all on function core.notify_manual_allocation_needed(text, bigint, numeric) from public, anon, authenticated;

-- MANUAL 품목의 대기 순번만 보여준다. 배정을 계산하거나 쓰지 않는다(컨트롤러 판정 6).
create or replace function core.list_manual_allocation_candidates(p_item_id text)
returns table (
  queue_rank                 bigint,
  order_id                   uuid,
  order_no                   text,
  line_id                    bigint,
  customer_name              text,
  owner_name                 text,
  allocation_priority        integer,
  first_review_requested_at  timestamptz,
  shortage_qty               numeric
)
language plpgsql
stable
security definer
set search_path = core, public, pg_temp
as $$
begin
  if auth.uid() is null or not core.is_active_user(auth.uid()) then
    raise exception '로그인한 활성 사용자만 조회할 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('ALLOC_MANUAL') then
    raise exception '수동배정 처리 권한(ALLOC_MANUAL)이 없습니다.' using errcode = '42501';
  end if;

  return query
    select q.queue_rank, q.order_id, q.order_no, q.line_id, q.customer_name, q.owner_name,
           q.allocation_priority, q.first_review_requested_at, q.shortage_qty
      from core.v_allocation_queue_line q
     where q.item_id = p_item_id and q.queue_rank is not null
     order by q.queue_rank;
end;
$$;

comment on function core.list_manual_allocation_candidates(text) is
  'Task 6 · MANUAL 품목의 대기 순번 후보만 보여준다(계산·쓰기 없음). SCM 품목담당자(ALLOC_MANUAL)만 조회';

revoke all on function core.list_manual_allocation_candidates(text) from public, anon;
grant execute on function core.list_manual_allocation_candidates(text) to authenticated;

-- core.commit_import_batch(goods_receipt 분기)가 이 함수만 부른다(STEP4 원본 + Task4 확장,
-- 20260911000500). 새로 반영된 원장 행마다 품목의 배정 방식(core.item_policy.allocation_mode,
-- 정책이 없으면 기본값 AUTO)에 따라 AUTO 후속 배정 또는 MANUAL 처리 필요 알림을 부른다(컨트롤러
-- 판정 4). 같은 (source_record_id, item_id) 조합은 원장에 한 번만 들어가므로 재커밋해도
-- 다시 배정되지 않는다.
create or replace function core.apply_stock_receipts_from_batch(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_count integer;
  v_item_ids text[];
  v_new_receipts jsonb;
  v_receipt jsonb;
  v_ledger_id bigint;
  v_item_id text;
  v_qty numeric;
  v_mode text;
begin
  with completed as (
    select
      upper(regexp_replace(g."품목코드", '[\s\-_]', '', 'g')) as item_id,
      nullif(g."입고수량", '')::numeric as qty,
      nullif(g."입고일", '')::timestamptz as completed_at,
      g.source_record_id
    from raw.goods_receipt g
    where g.batch_id = p_batch_id
      and g.receipt_status = 'COMPLETED'
      and nullif(g."입고일", '') is not null
      and nullif(g."입고수량", '') is not null
      and nullif(g."입고수량", '')::numeric > 0
      and g.source_record_id is not null
  ),
  inserted as (
    insert into core.stock_receipt_ledger (item_id, source_record_id, qty, completed_at, source_batch_id)
    select item_id, source_record_id, qty, completed_at, p_batch_id
      from completed
    on conflict (source_record_id, item_id) do nothing
    returning ledger_id, item_id, qty
  )
  select array_agg(distinct item_id),
         coalesce(jsonb_agg(jsonb_build_object('ledger_id', ledger_id, 'item_id', item_id, 'qty', qty) order by ledger_id), '[]'::jsonb)
    into v_item_ids, v_new_receipts
    from inserted;

  v_count := jsonb_array_length(v_new_receipts);

  -- core.stock_balance에 아직 행이 없는 품목은 이 호출이 그냥 건너뛴다(update 대상 0행).
  if v_item_ids is not null then
    perform core.recompute_stock_balance_totals(v_item_ids);
  end if;

  -- Task 6: normal_qty가 새 입고를 반영한 뒤에야 후속 배정을 계산해야 한다 — 그래서 위 재계산이
  -- 끝난 다음 원장 행마다 돈다.
  for v_receipt in select * from jsonb_array_elements(v_new_receipts)
  loop
    v_ledger_id := (v_receipt ->> 'ledger_id')::bigint;
    v_item_id := v_receipt ->> 'item_id';
    v_qty := (v_receipt ->> 'qty')::numeric;

    v_mode := coalesce((select p.allocation_mode from core.item_policy p where p.item_id = v_item_id), 'AUTO');

    if v_mode = 'MANUAL' then
      perform core.notify_manual_allocation_needed(v_item_id, v_ledger_id, v_qty);
    else
      perform core.allocate_new_stock(v_item_id, v_ledger_id);
    end if;
  end loop;

  return v_count;
end;
$$;

comment on function core.apply_stock_receipts_from_batch(uuid) is
  '권한 검사가 없는 내부 계산. core.commit_import_batch(goods_receipt 분기)만 부른다. 같은
   (source_record_id, item_id) 조합은 두 번 반영되지 않는다(유니크 제약). Task 6: 새로 반영된
   원장 행마다 AUTO 품목은 core.allocate_new_stock, MANUAL 품목은 처리 필요 알림을 같은
   트랜잭션에서 실행한다';

revoke all on function core.apply_stock_receipts_from_batch(uuid) from public, anon, authenticated;


-- ══ 3. 수동 적용 후 확인 쿼리(SQL Editor 전용) ══════════════════════

-- (a) 경계 시각 재실행 안전성: 만료 시각 직전에 core.expire_temporary_allocations를 불러도
--     아무 결과가 없어야 하고(대상 없음), 경계를 지난 뒤 불러야 한 번만 EXPIRED/RELEASED로
--     보고된다. 같은 함수를 다시 불러도 같은 주문이 다시 결과에 나오지 않아야 한다.
-- select * from core.expire_temporary_allocations();

-- (b) FIRM만 남은 만료 주문은 EXPIRED가 되지 않는지 확인.
-- select status, expired_at from core.sales_order where order_id = '<검증용 주문>';
-- 기대: status <> 'EXPIRED', 후속 core.expire_temporary_allocations() 결과에 outcome='RELEASED'

-- (c) MANUAL 품목은 자동 배정 0건인지 확인.
-- select count(*) from core.stock_allocation where item_id = '<MANUAL 품목>' and source = 'RECEIPT';
-- 기대: 0

-- (d) 입고가 여러 대기 주문에 순서대로 나뉘는지 확인.
-- select order_no, temporary_allocated_qty, firm_allocated_qty, shortage_qty
--   from core.sales_order_line l join core.sales_order o using (order_id)
--  where l.item_id = '<AUTO 품목>' order by o.allocation_priority, o.first_review_requested_at;
