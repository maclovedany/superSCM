--
-- PostgreSQL database dump
--

\restrict 5RwlkNBhW08dAR34JWwSPDF81f2hcV1mBCWWLvPjWJRZ8oFTvRdWLvvc4MGpEUa

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: analytics; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA analytics;


--
-- Name: core; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA core;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: raw; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA raw;


--
-- Name: add_business_holiday(text, date, text, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.add_business_holiday(p_country_code text, p_calendar_date date, p_holiday_name text, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: FUNCTION add_business_holiday(p_country_code text, p_calendar_date date, p_holiday_name text, p_reason text); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.add_business_holiday(p_country_code text, p_calendar_date date, p_holiday_name text, p_reason text) IS 'Task 10a — ADMIN 전용. 공휴일을 등록한다(is_business_day=false). 공휴일을 임의로 추정해서 미리 채우지 않는다 — 관리자가 하나씩 넣는다';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: demand_submission; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.demand_submission (
    submission_id uuid DEFAULT gen_random_uuid() NOT NULL,
    cycle_id uuid NOT NULL,
    plan_month date NOT NULL,
    department text NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    created_by uuid NOT NULL,
    submitted_by uuid,
    submitted_at timestamp with time zone,
    withdrawn_by uuid,
    withdrawn_at timestamp with time zone,
    withdraw_reason text,
    agreed_by uuid,
    agreed_at timestamp with time zone,
    last_modified_by uuid NOT NULL,
    last_modified_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT demand_submission_department_check CHECK ((department = ANY (ARRAY['SCM'::text, 'SALES'::text, 'MARKETING'::text, 'SERVICE'::text, 'BIZ_DEV'::text]))),
    CONSTRAINT demand_submission_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'SUBMITTED'::text, 'WITHDRAWN'::text, 'AGREED'::text]))),
    CONSTRAINT demand_submission_version_check CHECK ((version > 0))
);


--
-- Name: agree_demand_submission(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.agree_demand_submission(p_submission_id uuid) RETURNS core.demand_submission
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_submission core.demand_submission%rowtype;
  v_cycle_id uuid;
  v_cycle_is_active boolean;
  v_previous_status text;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 합의를 확정할 수 있습니다.' using errcode = '42501';
  end if;
  if not (core.has_permission('PLAN_CONFIRM', v_actor) or core.is_admin(v_actor)) then
    raise exception 'SCM 품목담당자 또는 관리자만 합의를 확정할 수 있습니다.' using errcode = '42501';
  end if;

  -- fix round 3 — 잠금 순서: 취합 주기 행을 먼저(FOR SHARE) 잠그고 그다음 제출본 행을 잠근다
  -- (FOR UPDATE). 파일 머리말의 "잠금 순서" 참고.
  select cycle_id into v_cycle_id from core.demand_submission where submission_id = p_submission_id;
  if v_cycle_id is null then
    raise exception '제출본을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  select is_active into v_cycle_is_active from core.planning_cycle where cycle_id = v_cycle_id for share;
  -- fix round 2 — 닫힌 취합 주기(재개로 이미 새 cycle_id가 열렸을 수도 있는, 옛 cycle_id에 묶인
  -- 행)에서는 합의도 막는다. save/submit/withdraw와 같은 규칙이다.
  if v_cycle_is_active is distinct from true then
    raise exception '취합 주기가 닫혀 더 이상 합의를 확정할 수 없습니다.' using errcode = '22023';
  end if;

  select * into v_submission from core.demand_submission where submission_id = p_submission_id for update;
  if not found then
    raise exception '제출본을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if v_submission.status <> 'SUBMITTED' then
    raise exception '제출완료 상태만 합의를 확정할 수 있습니다.' using errcode = '22023';
  end if;
  v_previous_status := v_submission.status;

  update core.demand_submission
     set status = 'AGREED', agreed_by = v_actor, agreed_at = clock_timestamp(),
         last_modified_by = v_actor, last_modified_at = clock_timestamp(), version = version + 1
   where submission_id = p_submission_id
   returning * into v_submission;

  insert into core.demand_submission_event (
    submission_id, event_type, previous_status, next_status, version, actor, actor_name, payload_snapshot
  ) values (
    p_submission_id, 'AGREED', v_previous_status, v_submission.status, v_submission.version,
    v_actor, core.order_actor_name(v_actor), to_jsonb(v_submission)
  );

  return v_submission;
end;
$$;


--
-- Name: allocate_new_stock(text, bigint); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.allocate_new_stock(p_item_id text, p_receipt_id bigint) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: FUNCTION allocate_new_stock(p_item_id text, p_receipt_id bigint); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.allocate_new_stock(p_item_id text, p_receipt_id bigint) IS 'Task 6 · AUTO 품목의 입고 후속 배정. core.v_allocation_queue_line 순번대로 채우고, 확정 전
   WAIT_FULL 주문은 전량 채울 수 있을 때만 배정한다. 만료된 확정 전 주문은 건너뛰어 입고
   커밋 트랜잭션이 되돌아가지 않게 한다. core.commit_import_batch만 호출하는 내부 함수다';


--
-- Name: allocate_to_order_line(bigint, numeric, text, uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.allocate_to_order_line(p_line_id bigint, p_max_qty numeric, p_source text, p_actor uuid DEFAULT NULL::uuid) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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
  -- 확정 전 주문의 후속 배정은 임시배정이다. 만료 시각이 지났으면 만들지 않는다 — 만료 예고가 모두 과거라
  -- 아무에게도 알리지 못한 채 이미 끝난 주문에 재고가 묶인다. 호출자(Task 6)는 만료 주문을 먼저 해제하거나 건너뛴다.
  if v_order.status <> 'CONFIRMED' and clock_timestamp() >= v_order.temporary_expires_at then
    raise exception 'TEMPORARY_ALLOCATION_EXPIRED: 임시배정 만료 시각(%)이 지난 주문에는 후속 임시배정을 만들 수 없습니다.',
      v_order.temporary_expires_at using errcode = '55000';
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


--
-- Name: apply_alloc_priority_decision(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.apply_alloc_priority_decision() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: apply_event_demand_decision(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.apply_event_demand_decision() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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

  -- 요청자에게 결과를 알린다.
  -- ★ dedupe_key는 Task 3 공통 결과 알림(approval:<id>:decision:<status>)과 반드시 달라야 한다
  --   (error.md #23). 같은 키를 쓰면 같은 수신자 · 같은 채널에서 먼저 들어간 쪽이 이기고 나중 쪽은
  --   on conflict do nothing으로 조용히 버려진다. AFTER UPDATE 트리거는 이름 알파벳 순서로 실행되는데
  --   approval_notification_sync가 event_demand_decision_apply보다 앞서므로, 같은 키를 쓰면 품목 · 수량 ·
  --   반영 여부가 담긴 이 알림이 항상 사라졌다. Task 9a(item_policy_revision:) · 9b(procurement_plan:)와
  --   같은 방식으로 도메인 접두어를 붙인다.
  perform core.enqueue_order_notice(
    'event_demand:' || new.approval_id || ':decision:' || new.status,
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


--
-- Name: apply_item_policy_decision(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.apply_item_policy_decision() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_revision core.item_policy_revision%rowtype;
  v_policy_before core.item_policy%rowtype;
  v_before jsonb;
  v_after jsonb;
begin
  -- fix round 1 — CANCELLED도 여기서 처리한다(core.cancel_item_policy_change가 approval_request를
  -- CANCELLED로 바꾸면 이 트리거가 걸린다). 그전에는 이 WHEN에서 걸러지지 않아 item_policy_revision이
  -- 영원히 PENDING으로 남았다(요청자가 새로 요청할 수 없었다).
  if new.approval_type <> 'ITEM_POLICY' or old.status <> 'PENDING' or new.status not in ('APPROVED', 'REJECTED', 'CANCELLED') then
    return new;
  end if;

  select * into v_revision from core.item_policy_revision where approval_id = new.approval_id for update;
  if not found then
    raise exception '품목 정책 변경 승인과 연결된 변경안을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  update core.item_policy_revision
     set status = new.status,
         decided_by = new.decided_by,
         decider_name = new.decider_name,
         decided_at = new.decided_at,
         decision_comment = new.decision_comment
   where revision_id = v_revision.revision_id;

  if new.status = 'APPROVED' then
    -- ★ 운영값은 여기서만 바뀐다. 반려·취소 경로는 이 블록을 타지 않으므로 기존 운영값이
    --   그대로 남는다(컨트롤러 판정 3 · stage1 §9 "설정, 변경, 확정 및 승인 내역은... 이력으로 관리").
    -- ★ proposed_* 중 null인 항목은 "이 변경안이 그 항목을 건드리지 않는다"는 뜻이다(모델 계층의
    --   validateRequestItemPolicyChange와 같은 규칙) — coalesce로 현재값을 유지하고, null로
    --   덮어써 지우지 않는다. allocation_mode만 not null 컬럼이라 항상 제안값을 그대로 쓴다.
    select * into v_policy_before from core.item_policy p where p.item_id = v_revision.item_id for update;
    v_before := to_jsonb(v_policy_before);

    update core.item_policy
       set target_dos_days = coalesce(v_revision.proposed_target_dos_days, v_policy_before.target_dos_days),
           allocation_mode = v_revision.proposed_allocation_mode,
           target_stock_qty = coalesce(v_revision.proposed_target_stock_qty, v_policy_before.target_stock_qty),
           unit_price = coalesce(v_revision.proposed_unit_price, v_policy_before.unit_price),
           moq = coalesce(v_revision.proposed_moq, v_policy_before.moq),
           pack_size = coalesce(v_revision.proposed_pack_size, v_policy_before.pack_size),
           min_order_amount = coalesce(v_revision.proposed_min_order_amount, v_policy_before.min_order_amount),
           updated_at = clock_timestamp()
     where item_id = v_revision.item_id;

    select to_jsonb(p) into v_after from core.item_policy p where p.item_id = v_revision.item_id;

    insert into core.audit_log (actor, action, target_type, target_id, before, after)
    values (new.decided_by, 'ITEM_POLICY_APPROVED', 'item_policy', v_revision.item_id, v_before, v_after);
  end if;

  -- 요청자에게 결과를 알린다. Task 3의 공통 결과 알림(approval:<id>:decision:<status>, APPROVAL_DECIDED)과
  -- 일부러 다른 dedupe 키를 쓴다 — 같은 키를 쓰면 트리거 실행 순서(트리거 이름 알파벳 순서: 'a'pproval_
  -- notification_sync가 'i'tem_policy_decision_apply보다 먼저 실행된다)에 따라 이 알림이 조용히
  -- 덮어써지지 않고 함께 남기 때문이다(요청자는 일반 알림과 품목 상세 알림 두 건을 받는다).
  perform core.enqueue_order_notice(
    'item_policy_revision:' || v_revision.revision_id || ':decision:' || new.status,
    'ITEM_POLICY_DECIDED',
    array[new.requested_by],
    jsonb_build_object(
      'title', case new.status
                 when 'APPROVED' then '품목 정책 변경이 승인되었습니다'
                 when 'REJECTED' then '품목 정책 변경이 반려되었습니다'
                 else '품목 정책 변경 요청이 취소되었습니다'
               end,
      -- fix round 1 — CANCELLED는 요청자 본인이 취소한 것이라 "팀장 의견"이 아니라 "처리 의견"으로 둔다.
      'message', format(
        '품목 %s · 결과 %s · 처리 의견: %s',
        v_revision.item_id,
        case new.status
          when 'APPROVED' then '승인(운영값 반영)'
          when 'REJECTED' then '반려(운영값 유지)'
          else '취소(운영값 유지)'
        end,
        coalesce(nullif(btrim(new.decision_comment), ''), '없음')
      ),
      'target_id', v_revision.item_id,
      'revision_id', v_revision.revision_id, 'decision', new.status,
      'item_id', v_revision.item_id,
      'decision_comment', new.decision_comment, 'decider_name', new.decider_name, 'decided_at', new.decided_at
    )
  );

  return new;
end;
$$;


--
-- Name: apply_month_end_inventory_snapshot_from_batch(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.apply_month_end_inventory_snapshot_from_batch(p_batch_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_count integer;
begin
  with classified as (
    -- Task 4 core.apply_stock_balance_from_batch와 같은 필터 · 같은 분류 함수.
    select
      upper(regexp_replace(i."품목코드", '[\s\-_]', '', 'g')) as item_id,
      nullif(i."현재고", '')::numeric as qty,
      i.snapshot_at,
      core.classify_inventory_scope(i.warehouse_code, i.inventory_status) as scope_code
    from raw.inventory i
    where i.batch_id = p_batch_id
      and i.warehouse_code is not null
      and nullif(i."현재고", '') is not null
      and i.snapshot_at is not null
  ),
  normal_only as (
    select item_id, qty, snapshot_at from classified where scope_code = 'NORMAL'
  ),
  aggregated as (
    -- 같은 배치·같은 품목 안에서도 스냅샷 시각이 다른 여러 달에 걸칠 수 있으므로 달별로 묶는다.
    -- ★ Task 7 core.raise_demand_submission_reminders·submission_deadline과 같은 이유로 세션
    --   timezone에 좌우되지 않도록 명시적으로 'Asia/Seoul' 벽시계 기준으로 달을 정한다 — 그냥
    --   date_trunc('month', snapshot_at)를 쓰면 세션 timezone에 따라 월 경계 근처 스냅샷(예:
    --   2026-09-01T03:00:00Z)이 UTC-8 세션에서는 8월로 잘못 묶일 수 있다(error.md 타임존 계열
    --   이슈와 같은 클래스). timestamptz를 timestamp로 바꾼 뒤 truncate하면 이후 truncate·cast는
    --   세션 timezone의 영향을 받지 않는다.
    select
      item_id,
      date_trunc('month', snapshot_at at time zone 'Asia/Seoul')::date as plan_month,
      sum(qty) as normal_qty,
      max(snapshot_at) as snapshot_at
    from normal_only
    group by item_id, date_trunc('month', snapshot_at at time zone 'Asia/Seoul')::date
  ),
  upserted as (
    insert into core.month_end_inventory_snapshot (plan_month, item_id, normal_qty, snapshot_at, source_batch_id, updated_at)
    select plan_month, item_id, normal_qty, snapshot_at, p_batch_id, now()
      from aggregated
    on conflict (plan_month, item_id) do update
       set normal_qty      = excluded.normal_qty,
           snapshot_at     = excluded.snapshot_at,
           source_batch_id = excluded.source_batch_id,
           updated_at      = now()
     -- 컨트롤러 판정 1 — 그 달 안에서 가장 최근 스냅샷만 남긴다. 옛 배치를 나중에(재검증 등으로)
     -- 다시 반영해도 이미 있는 더 최근 값을 덮어쓰지 않는다.
     where excluded.snapshot_at >= core.month_end_inventory_snapshot.snapshot_at
    returning item_id
  )
  select count(*) into v_count from upserted;
  return coalesce(v_count, 0);
end;
$$;


--
-- Name: FUNCTION apply_month_end_inventory_snapshot_from_batch(p_batch_id uuid); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.apply_month_end_inventory_snapshot_from_batch(p_batch_id uuid) IS 'Task 12 — inventory 배치의 NORMAL 분류 행을 (item_id, 스냅샷 달)별로 묶어 core.month_end_inventory_snapshot에 append-upsert한다. 그 달의 기존 값보다 이르면 덮어쓰지 않는다.
   권한 검사 없음 — commit_import_batch · refresh_stock_balance만 부른다';


--
-- Name: apply_procurement_plan_decision(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.apply_procurement_plan_decision() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_plan core.procurement_plan%rowtype;
begin
  if new.approval_type <> 'PURCHASE_PLAN' or old.status <> 'PENDING' or new.status not in ('APPROVED', 'REJECTED', 'CANCELLED') then
    return new;
  end if;

  select * into v_plan from core.procurement_plan where approval_id = new.approval_id for update;
  if not found then
    raise exception '최종 발주계획 승인과 연결된 계획을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if v_plan.status <> 'PENDING_APPROVAL' then
    raise exception '승인 대기 상태가 아닌 발주계획입니다(현재 %).', v_plan.status using errcode = '22023';
  end if;

  if new.status = 'CANCELLED' then
    -- 새 버전 계산이 승인 요청을 취소했다 — 계획은 미확정으로 돌아가고, 호출한 생성 함수가 곧바로 SUPERSEDED로 바꾼다
    update core.procurement_plan set status = 'DRAFT' where plan_id = v_plan.plan_id;
    insert into core.procurement_plan_event (plan_id, event_type, previous_status, next_status, actor, actor_name, approval_id, comment)
    values (v_plan.plan_id, 'APPROVAL_CANCELLED', 'PENDING_APPROVAL', 'DRAFT', new.decided_by, new.decider_name,
            new.approval_id, new.decision_comment);
    return new;
  end if;

  -- ★ 최종본은 여기서만 만들어진다(승인 결정과 같은 트랜잭션)
  update core.procurement_plan
     set status = new.status, decided_by = new.decided_by, decider_name = new.decider_name,
         decided_at = new.decided_at, decision_comment = new.decision_comment
   where plan_id = v_plan.plan_id;

  insert into core.procurement_plan_event (plan_id, event_type, previous_status, next_status, actor, actor_name, approval_id, comment)
  values (v_plan.plan_id, new.status, 'PENDING_APPROVAL', new.status, new.decided_by, new.decider_name,
          new.approval_id, new.decision_comment);

  if new.status = 'APPROVED' then
    insert into core.audit_log (actor, action, target_type, target_id, before, after)
    values (new.decided_by, 'PROCUREMENT_PLAN_APPROVED', 'procurement_plan', v_plan.plan_id::text, to_jsonb(v_plan),
            (select to_jsonb(p) from core.procurement_plan p where p.plan_id = v_plan.plan_id));
  end if;

  -- Task 3 공통 결과 알림과 다른 dedupe_key(error.md #23) — 확정자는 두 알림을 모두 받는다
  perform core.enqueue_order_notice(
    'procurement_plan:' || v_plan.plan_id || ':approval:' || new.approval_id || ':decision:' || new.status,
    'PROCUREMENT_PLAN_DECIDED',
    array[new.requested_by],
    jsonb_build_object(
      'title', case new.status when 'APPROVED' then '발주계획이 승인되었습니다(최종본)'
                               else '발주계획이 반려되었습니다' end,
      'message', format('%s 발주계획 v%s · 결과 %s · 팀장 의견: %s',
                        to_char(v_plan.plan_month, 'YYYY-MM'), v_plan.version,
                        case new.status when 'APPROVED' then '승인' else '반려(미확정으로 복귀)' end,
                        coalesce(nullif(btrim(new.decision_comment), ''), '없음')),
      'target_id', v_plan.plan_id::text, 'plan_id', v_plan.plan_id, 'plan_month', v_plan.plan_month,
      'version', v_plan.version, 'decision', new.status, 'decision_comment', new.decision_comment,
      'decider_name', new.decider_name, 'decided_at', new.decided_at
    )
  );

  return new;
end;
$$;


--
-- Name: apply_sales_order_status(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.apply_sales_order_status(p_order_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: apply_stock_balance_from_batch(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.apply_stock_balance_from_batch(p_batch_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_count integer;
  v_item_ids text[];
begin
  with classified as (
    -- 상태나 창고 범위를 분류할 수 없는 행은 여기서 완전히 제외한다 — 0으로도, NORMAL로도
    -- 세지 않는다. warehouse_code가 없으면(창고 범위 미상) 분류 함수를 부르지 않고 바로
    -- 제외한다. inventory_status가 매핑되지 않아도(core.classify_inventory_scope가 null을
    -- 돌려주면) 다음 CTE에서 제외된다.
    select
      upper(regexp_replace(i."품목코드", '[\s\-_]', '', 'g')) as item_id,
      nullif(i."현재고", '')::numeric as qty,
      i.snapshot_at,
      core.classify_inventory_scope(i.warehouse_code, i.inventory_status) as scope_code
    from raw.inventory i
    where i.batch_id = p_batch_id
      and i.warehouse_code is not null
      and nullif(i."현재고", '') is not null
      and i.snapshot_at is not null
  ),
  classified_only as (
    select * from classified where scope_code is not null
  ),
  aggregated as (
    select
      item_id,
      coalesce(sum(qty) filter (where scope_code = 'NORMAL'), 0) as snapshot_qty,
      max(snapshot_at) filter (where scope_code = 'NORMAL') as snapshot_at
    from classified_only
    group by item_id
  ),
  upserted as (
    insert into core.stock_balance (item_id, snapshot_qty, normal_qty, snapshot_at, source_batch_id, updated_at)
    select item_id, snapshot_qty, snapshot_qty, snapshot_at, p_batch_id, now()
      from aggregated
    on conflict (item_id) do update
      set snapshot_qty    = excluded.snapshot_qty,
          snapshot_at     = excluded.snapshot_at,
          source_batch_id = excluded.source_batch_id,
          updated_at      = now()
    returning item_id
  )
  select array_agg(item_id) into v_item_ids from upserted;

  v_count := coalesce(array_length(v_item_ids, 1), 0);

  -- 새 스냅샷이 실린 품목은 그 스냅샷 시각을 기준으로 완료 입고 합을 다시 계산한다. 이전에
  -- 반영됐던 입고 중 새 스냅샷 시각보다 이르면 이번 실사에 이미 잡혔다고 보고 제외된다.
  if v_item_ids is not null then
    perform core.recompute_stock_balance_totals(v_item_ids);
  end if;

  return v_count;
end;
$$;


--
-- Name: FUNCTION apply_stock_balance_from_batch(p_batch_id uuid); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.apply_stock_balance_from_batch(p_batch_id uuid) IS '권한 검사가 없는 내부 계산. 배치 상태·타입 확인은 호출자의 책임이다. authenticated에
   직접 노출하지 않는다 — core.refresh_stock_balance와 core.commit_import_batch를 거친다';


--
-- Name: apply_stock_receipts_from_batch(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.apply_stock_receipts_from_batch(p_batch_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: FUNCTION apply_stock_receipts_from_batch(p_batch_id uuid); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.apply_stock_receipts_from_batch(p_batch_id uuid) IS '권한 검사가 없는 내부 계산. core.commit_import_batch(goods_receipt 분기)만 부른다. 같은
   (source_record_id, item_id) 조합은 두 번 반영되지 않는다(유니크 제약). Task 6: 새로 반영된
   원장 행마다 AUTO 품목은 core.allocate_new_stock, MANUAL 품목은 처리 필요 알림을 같은
   트랜잭션에서 실행한다';


--
-- Name: approve_procurement_plan(uuid, uuid, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.approve_procurement_plan(p_plan_id uuid, p_approval_id uuid, p_comment text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_plan core.procurement_plan%rowtype;
begin
  if auth.uid() is null or not core.is_active_user(auth.uid()) then
    raise exception '로그인한 활성 사용자만 발주계획을 승인할 수 있습니다.' using errcode = '42501';
  end if;
  select * into v_plan from core.procurement_plan where plan_id = p_plan_id;
  if not found then
    raise exception '발주계획을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if v_plan.approval_id is distinct from p_approval_id then
    raise exception '이 계획의 승인 요청이 아닙니다.' using errcode = '22023';
  end if;
  if v_plan.status <> 'PENDING_APPROVAL' then
    raise exception '승인 대기 상태가 아닙니다(현재 %).', v_plan.status using errcode = '22023';
  end if;
  return core.decide_approval(p_approval_id, 'APPROVED', p_comment);
end;
$$;


--
-- Name: audit_app_user_change(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.audit_app_user_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'pg_temp'
    AS $$
begin
  if old.role is distinct from new.role then
    insert into core.audit_log (actor, action, target_type, target_id, before, after)
    values (
      auth.uid(), 'USER_ROLE_CHANGED', 'app_user', new.user_id::text,
      jsonb_build_object('role', old.role, 'active', old.active),
      jsonb_build_object('role', new.role, 'active', new.active)
    );
  end if;

  if old.active is distinct from new.active then
    insert into core.audit_log (actor, action, target_type, target_id, before, after)
    values (
      auth.uid(), 'USER_ACTIVE_CHANGED', 'app_user', new.user_id::text,
      jsonb_build_object('role', old.role, 'active', old.active),
      jsonb_build_object('role', new.role, 'active', new.active)
    );
  end if;
  return new;
end;
$$;


--
-- Name: build_procurement_plan(date, uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.build_procurement_plan(p_plan_month date, p_forecast_run_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'analytics', 'public', 'pg_temp'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_month date;
  v_run core.forecast_run%rowtype;
  v_source_status text;
  v_verified boolean;
  v_open core.procurement_plan%rowtype;
  v_locked_approval_id uuid;
  v_plan_id uuid := gen_random_uuid();
  v_version integer;
  v_cycle_id uuid;
  v_item record;
  v_calc record;
  v_month_no integer;
  v_target date;
  v_total numeric;
  v_base numeric;
  v_dept numeric;
  v_confirmed numeric;
  v_meeting numeric;
  v_event numeric;
  v_added numeric;
  v_start numeric;
  v_reasons text[];
  v_unavailable boolean;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 발주계획을 만들 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('PLAN_CONFIRM', v_actor) then
    raise exception '발주계획 생성 권한(PLAN_CONFIRM)이 없습니다.' using errcode = '42501';
  end if;
  if p_plan_month is null then
    raise exception 'PLAN_MONTH_REQUIRED: 기준월은 필수입니다.' using errcode = '22023';
  end if;
  v_month := make_date(extract(year from p_plan_month)::integer, extract(month from p_plan_month)::integer, 1);
  v_actor_name := core.order_actor_name(v_actor);

  if p_forecast_run_id is not null then
    select * into v_run from core.forecast_run where run_id = p_forecast_run_id;
    if not found then
      raise exception 'FORECAST_RUN_NOT_FOUND: Forecast Run을 찾을 수 없습니다.' using errcode = 'P0002';
    end if;
    if v_run.status <> 'SUCCESS' then
      raise exception 'FORECAST_RUN_NOT_SUCCESS: 성공한 Forecast Run만 발주계획에 쓸 수 있습니다(현재 %).', v_run.status
        using errcode = '22023';
    end if;
  else
    -- 비워 두면 최신 성공 실행. 없으면 v_run이 비어 원천 판정이 FORECAST_SOURCE_UNVERIFIED가 된다(컨트롤러 판정 1)
    select * into v_run from core.forecast_run where status = 'SUCCESS' order by finished_at desc nulls last, started_at desc limit 1;
  end if;

  v_source_status := core.procurement_forecast_source_status(v_run.run_id);
  v_verified := v_source_status = 'VERIFIED';

  -- 같은 기준월 생성을 직렬화한다(버전 번호 · 작업본 대체)
  perform pg_advisory_xact_lock(hashtextextended('core.procurement_plan:' || to_char(v_month, 'YYYY-MM-DD'), 0));

  select * into v_open
    from core.procurement_plan
   where plan_month = v_month and status in ('DRAFT', 'PENDING_APPROVAL', 'REJECTED');
  if found then
    if v_open.status = 'PENDING_APPROVAL' then
      -- 잠금 순서: 승인 요청 → 계획(core.decide_approval과 같다)
      perform 1 from core.approval_request where approval_id = v_open.approval_id for update;
      v_locked_approval_id := v_open.approval_id;
    end if;
    select * into v_open from core.procurement_plan where plan_id = v_open.plan_id for update;

    if v_open.status = 'PENDING_APPROVAL' then
      if v_locked_approval_id is distinct from v_open.approval_id then
        raise exception '같은 기준월 계획이 방금 확정되었습니다. 다시 계산해 주세요.' using errcode = '40001';
      end if;
      -- 승인 대기 중인 이전 버전은 승인 요청을 취소한다. Task 5의 범용 취소 헬퍼를 그대로 쓴다(Task 9a와 같다) —
      -- 그 UPDATE가 Task 3 반복 알림 취소와 아래 훅(계획 → DRAFT, APPROVAL_CANCELLED 이력)을 같은 트랜잭션에서 연쇄시킨다.
      perform core.cancel_alloc_priority_approval(v_open.approval_id, v_actor, '새 버전 계산으로 승인 요청을 취소합니다.');
      select * into v_open from core.procurement_plan where plan_id = v_open.plan_id;
    end if;

    if v_open.status in ('DRAFT', 'REJECTED') then
      update core.procurement_plan
         set status = 'SUPERSEDED', superseded_by_plan_id = v_plan_id, superseded_at = clock_timestamp()
       where plan_id = v_open.plan_id;
      insert into core.procurement_plan_event (plan_id, event_type, previous_status, next_status, actor, actor_name, payload)
      values (v_open.plan_id, 'SUPERSEDED', v_open.status, 'SUPERSEDED', v_actor, v_actor_name,
              jsonb_build_object('superseded_by_plan_id', v_plan_id));
    end if;
  end if;

  select coalesce(max(version), 0) + 1 into v_version from core.procurement_plan where plan_month = v_month;

  insert into core.procurement_plan (
    plan_id, plan_month, version, status, forecast_run_id, forecast_train_start, forecast_train_end,
    forecast_data_snapshot_at, source_status, built_by, built_by_name
  ) values (
    v_plan_id, v_month, v_version, 'DRAFT', v_run.run_id, v_run.train_start, v_run.train_end,
    v_run.data_snapshot_at, v_source_status, v_actor, v_actor_name
  );

  -- 조정 후보는 이 기준월 취합 주기(가장 최근에 연 주기)의 합의본에서만 읽는다
  select c.cycle_id into v_cycle_id
    from core.planning_cycle c
   where c.plan_month = v_month
   order by c.is_active desc, c.opened_at desc
   limit 1;

  for v_item in
    with champion as (
      -- 품목별 최신 Champion이 이 Forecast Run의 Backtest에서 나온 경우만 쓴다
      select c.item_id, c.champion_model_id, c.model_version
        from analytics.v_champion_model c
        join core.backtest_run br on br.backtest_run_id = c.backtest_run_id
       where br.forecast_run_id = v_run.run_id
         and c.champion_model_id is not null
    ), items as (
      select p.item_id from core.item_policy p
      union
      select ch.item_id from champion ch
    )
    select i.item_id,
           im.item_name,
           ip.item_id is not null as has_policy,
           -- ★ 승인값만 쓴다(pre-review fix) — core.item_policy에 직접 들어간 운영값은 승인이 아니다
           ip.approved_target_dos_days as target_dos_days,
           coalesce(ip.target_dos_approved, false) as target_dos_approved,
           ip.approved_unit_price as unit_price,
           ip.approved_moq as moq,
           ip.pack_size, ip.min_order_amount,
           ch.champion_model_id, ch.model_version,
           st.item_id is not null as has_stock_row,
           st.normal_warehouse_qty,
           st.temporary_allocated_qty + st.firm_allocated_qty + st.approval_hold_qty as allocated_qty,
           st.available_qty,
           st.snapshot_at as stock_snapshot_at,
           st.reason_code as stock_reason_code
      from items i
      left join core.v_item_master im on im.item_id = i.item_id
      left join analytics.v_item_policy ip on ip.item_id = i.item_id
      left join champion ch on ch.item_id = i.item_id
      left join analytics.v_available_stock st on st.item_id = i.item_id
     order by i.item_id
  loop
    -- 최근 6개월 사용량 합 — 그 실행의 학습 시계열만(원천 게이트가 기간 · 지문 일치를 이미 확인했다).
    -- 평균(합 ÷ 6)은 스냅샷 · 표시용으로만 저장하고, 계산은 합을 그대로 넘긴다(정밀도, fix round 1)
    v_total := null;
    if v_verified then
      select case
               when date_trunc('month', v_run.train_start::timestamp) > date_trunc('month', v_run.train_end::timestamp) - interval '5 months'
                 then null
               when count(*) filter (where t.qty is null) > 0 then null
               else coalesce(sum(t.qty), 0)
             end
        into v_total
        from core.v_train_demand t
       where t.item_id = v_item.item_id
         and t.use_date >= (date_trunc('month', v_run.train_end::timestamp) - interval '5 months')::date;
    end if;

    v_start := v_item.available_qty;

    for v_month_no in 1..6 loop
      v_target := (v_month + make_interval(months => v_month_no - 1))::date;
      v_reasons := array[]::text[];
      v_unavailable := false;

      v_base := null;
      if v_verified and v_item.champion_model_id is not null then
        select f.predicted_qty into v_base
          from core.forecast_result f
         where f.run_id = v_run.run_id and f.model_id = v_item.champion_model_id
           and f.item_id = v_item.item_id and f.period = v_target;
      end if;

      select sum(l.qty) into v_dept
        from core.demand_submission s
        join core.demand_submission_line l on l.submission_id = s.submission_id
       where s.cycle_id = v_cycle_id and s.status = 'AGREED'
         and l.item_id = v_item.item_id and l.need_month = v_target
         and l.qty is not null and jsonb_array_length(l.issues) = 0;

      select coalesce(sum(m.confirmed_order_qty), 0), coalesce(sum(m.supply_meeting_qty), 0),
             coalesce(sum(m.event_demand_qty), 0), coalesce(sum(m.approved_qty), 0)
        into v_confirmed, v_meeting, v_event, v_added
        from analytics.v_approved_demand_monthly m
       where m.plan_month = v_target and m.item_id = v_item.item_id;

      -- 사유 확인 순서 = lib/procurement/model.ts buildPlanItemLines · PLAN_REASON_PRIORITY
      if not v_verified then
        v_reasons := array_append(v_reasons, v_source_status);
        v_unavailable := true;
      else
        if v_item.champion_model_id is null then
          v_reasons := array_append(v_reasons, 'CHAMPION_UNAVAILABLE');
          v_unavailable := true;
        elsif v_base is null then
          v_reasons := array_append(v_reasons, 'BASE_FORECAST_UNAVAILABLE');
          v_unavailable := true;
        end if;
        if v_total is null or v_total < 0 then
          v_reasons := array_append(v_reasons, 'AVG_USAGE_UNAVAILABLE');
          v_unavailable := true;
        end if;
      end if;

      if v_month_no = 1 then
        if not v_item.has_stock_row then
          v_reasons := array_append(v_reasons, 'AVAILABLE_STOCK_UNAVAILABLE');
          v_unavailable := true;
        elsif v_item.available_qty is null then
          v_reasons := array_append(v_reasons, coalesce(v_item.stock_reason_code, 'AVAILABLE_STOCK_UNAVAILABLE'));
          v_unavailable := true;
        end if;
      elsif v_start is null then
        v_reasons := array_append(v_reasons, 'PRIOR_MONTH_UNAVAILABLE');
        v_unavailable := true;
      end if;

      if not v_item.has_policy then
        v_reasons := array_append(v_reasons, 'ITEM_POLICY_MISSING');
        v_unavailable := true;
      else
        if v_item.unit_price is null then
          v_reasons := array_append(v_reasons, 'UNIT_PRICE_UNSET');
          v_unavailable := true;
        end if;
        if v_item.target_dos_days is null then
          -- 승인된 목표 DoS가 없다(직접 넣은 운영값만 있어도 마찬가지)
          v_reasons := array_append(v_reasons, 'TARGET_DOS_UNSET');
          v_unavailable := true;
        end if;
      end if;

      select * into v_calc
        from core.calculate_procurement_plan_month(
          v_month_no, v_base, v_dept, v_added,
          case when v_unavailable then null else v_start end,
          v_item.target_dos_days, v_total, v_item.moq, v_item.unit_price
        );
      if not v_unavailable and v_calc.dos_reason_code is not null then
        v_reasons := array_append(v_reasons, v_calc.dos_reason_code);
      end if;

      insert into core.procurement_plan_line (
        plan_id, item_id, item_name, month_no, target_month,
        champion_model_id, model_version, base_forecast_qty, department_agreed_qty, candidate_source, candidate_qty,
        flex_min_qty, flex_max_qty, flex_applied, adjusted_demand_qty,
        confirmed_order_qty, meeting_qty, event_qty, approved_added_qty, demand_qty,
        normal_stock_qty, allocated_qty, available_qty, stock_snapshot_at, start_stock_qty,
        target_dos_days, target_dos_approved, unit_price, moq, pack_size, min_order_amount, avg_usage_6m,
        stockout_prevention_qty, dos_required_qty, selected_qty, selection_reason, effective_moq, final_order_qty,
        projected_month_end_qty, projected_dos_days, projected_inventory_value,
        calculation_status, reason_code, reason_codes
      ) values (
        v_plan_id, v_item.item_id, v_item.item_name, v_month_no, v_target,
        case when v_verified then v_item.champion_model_id end, case when v_verified then v_item.model_version end,
        v_base, v_dept, v_calc.candidate_source, v_calc.candidate_qty,
        v_calc.flex_min_qty, v_calc.flex_max_qty, v_calc.flex_applied, v_calc.adjusted_demand_qty,
        v_confirmed, v_meeting, v_event, v_added, v_calc.demand_qty,
        v_item.normal_warehouse_qty, v_item.allocated_qty, v_item.available_qty, v_item.stock_snapshot_at, v_start,
        v_item.target_dos_days, v_item.target_dos_approved, v_item.unit_price, v_item.moq, v_item.pack_size,
        v_item.min_order_amount, v_total / 6,
        v_calc.stockout_prevention_qty, v_calc.dos_required_qty, v_calc.selected_qty, v_calc.selection_reason,
        v_calc.effective_moq, v_calc.final_order_qty,
        v_calc.projected_month_end_qty, v_calc.projected_dos_days, v_calc.projected_inventory_value,
        case when v_unavailable then 'CALCULATION_UNAVAILABLE' else 'CALCULATED' end, v_reasons[1], v_reasons
      );

      v_start := case when v_unavailable then null else v_calc.projected_month_end_qty end;
    end loop;
  end loop;

  insert into core.procurement_plan_event (plan_id, event_type, previous_status, next_status, actor, actor_name, payload)
  select v_plan_id, 'BUILT', null, 'DRAFT', v_actor, v_actor_name,
         jsonb_build_object(
           'version', v_version, 'forecast_run_id', v_run.run_id, 'source_status', v_source_status,
           'planning_cycle_id', v_cycle_id, 'n_items', count(distinct l.item_id), 'n_lines', count(l.line_id),
           'n_unavailable_lines', count(l.line_id) filter (where l.calculation_status = 'CALCULATION_UNAVAILABLE')
         )
    from core.procurement_plan_line l
   where l.plan_id = v_plan_id;

  return v_plan_id;
end;
$$;


--
-- Name: FUNCTION build_procurement_plan(p_plan_month date, p_forecast_run_id uuid); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.build_procurement_plan(p_plan_month date, p_forecast_run_id uuid) IS 'Task 9b — 기준월 발주계획 새 버전 계산(PLAN_CONFIRM). 입력값을 라인에 스냅샷하고, 같은 달 작업본은 SUPERSEDED로 대체한다. p_forecast_run_id가 null이면 최신 SUCCESS 실행을 쓴다';


--
-- Name: build_procurement_schedule(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.build_procurement_schedule(p_plan_id uuid) RETURNS TABLE(schedule_id uuid, item_id text, calculation_status text, reason_code text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: FUNCTION build_procurement_schedule(p_plan_id uuid); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.build_procurement_schedule(p_plan_id uuid) IS 'Task 10b — PLAN_CONFIRM. 승인됐고(APPROVED) 그 달의 최신 승인본인 계획만 허용한다(fix round 1). 1개월차 · 최종 발주량>0 라인마다 공급처 → 출항일 → 준비기간 → KR 영업일 확정 순서로 일정을 만든다. 재실행해도 행이 늘지 않고 이미 입력된 실제 입고일을 보존한다(plan_line_id unique + on conflict). 이 달의 옛 승인본 일정은 지우지 않고 superseded로 표시하며, 같은 품목 · 공급처의 실제 입고일은 새 행으로 옮긴다';


--
-- Name: calculate_procurement_plan_month(integer, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.calculate_procurement_plan_month(p_month_no integer, p_base_forecast_qty numeric, p_department_agreed_qty numeric, p_approved_added_qty numeric, p_start_stock_qty numeric, p_target_dos_days numeric, p_usage_6m_total numeric, p_moq numeric, p_unit_price numeric) RETURNS TABLE(candidate_source text, candidate_qty numeric, flex_min_qty numeric, flex_max_qty numeric, flex_applied boolean, adjusted_demand_qty numeric, demand_qty numeric, stockout_prevention_qty numeric, dos_required_qty numeric, selected_qty numeric, selection_reason text, effective_moq numeric, final_order_qty numeric, projected_month_end_qty numeric, projected_dos_days numeric, projected_inventory_value numeric, dos_reason_code text)
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'core', 'pg_temp'
    AS $$
declare
  -- stage1 §4 — 1개월차 ±20%, 2~3개월차 ±30%, 4~6개월차 미적용
  v_band numeric := case when p_month_no = 1 then 0.2 when p_month_no in (2, 3) then 0.3 end;
begin
  flex_applied := false;
  effective_moq := coalesce(p_moq, 1);
  if p_base_forecast_qty is null then
    return next;
    return;
  end if;

  candidate_source := case when p_department_agreed_qty is null then 'BASE_FORECAST' else 'DEPARTMENT_AGREED' end;
  candidate_qty := coalesce(p_department_agreed_qty, p_base_forecast_qty);
  if v_band is null then
    adjusted_demand_qty := candidate_qty;
  else
    flex_min_qty := least(p_base_forecast_qty * (1 - v_band), p_base_forecast_qty * (1 + v_band));
    flex_max_qty := greatest(p_base_forecast_qty * (1 - v_band), p_base_forecast_qty * (1 + v_band));
    flex_applied := candidate_qty < flex_min_qty or candidate_qty > flex_max_qty;
    adjusted_demand_qty := least(greatest(candidate_qty, flex_min_qty), flex_max_qty);
  end if;
  -- ★ 승인된 추가 수요는 클램프 뒤에 더한다(stage1 §5 — 이벤트성 대량 거래는 조정 범위를 벗어날 수 있다)
  demand_qty := adjusted_demand_qty + coalesce(p_approved_added_qty, 0);

  if p_start_stock_qty is null or p_target_dos_days is null or p_usage_6m_total is null or p_unit_price is null then
    return next;
    return;
  end if;

  -- ★ 정밀도 — 목표DoS ÷ 30 × (합 ÷ 6) = 목표DoS × 합 ÷ 180. 나눗셈은 한 번만 하고, 올림 직전에 소수 6자리로
  --   반올림해 numeric 반올림 꼬리(…0000000001)가 MOQ 올림을 한 단위 넘기지 않게 한다.
  stockout_prevention_qty := greatest(0, round(demand_qty - p_start_stock_qty, 6));
  dos_required_qty := greatest(0, round(demand_qty + p_target_dos_days * p_usage_6m_total / 180 - p_start_stock_qty, 6));
  selected_qty := greatest(stockout_prevention_qty, dos_required_qty);
  -- 1순위 품절 방지 · 2순위 목표 DoS 충족 최소수량 · 두 기준이 같으면 그 최소수량이 곧 월말 재고금액 최소(3순위)
  selection_reason := case
    when stockout_prevention_qty > dos_required_qty then 'STOCKOUT_PREVENTION'
    when dos_required_qty > stockout_prevention_qty then 'DOS_TARGET'
    else 'INVENTORY_VALUE_MIN'
  end;
  -- stage1 §7 — MOQ 단위 올림(120, MOQ 50 → 150), 미설정이면 1
  final_order_qty := ceil(selected_qty / effective_moq) * effective_moq;
  projected_month_end_qty := p_start_stock_qty + final_order_qty - demand_qty;
  -- stage1 §6 — DoS = 월말 재고 ÷ 월평균사용량 × 30 = 월말 재고 × 180 ÷ 6개월 합.
  -- 반올림하지 않고 저장한다(fix round 1 — 표시할 때만 반올림, Task 12가 원값으로 비교한다)
  projected_dos_days := case when p_usage_6m_total > 0 then projected_month_end_qty * 180 / p_usage_6m_total end;
  dos_reason_code := case when p_usage_6m_total = 0 then 'AVG_USAGE_ZERO' end;
  projected_inventory_value := projected_month_end_qty * p_unit_price;
  return next;
end;
$$;


--
-- Name: FUNCTION calculate_procurement_plan_month(p_month_no integer, p_base_forecast_qty numeric, p_department_agreed_qty numeric, p_approved_added_qty numeric, p_start_stock_qty numeric, p_target_dos_days numeric, p_usage_6m_total numeric, p_moq numeric, p_unit_price numeric); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.calculate_procurement_plan_month(p_month_no integer, p_base_forecast_qty numeric, p_department_agreed_qty numeric, p_approved_added_qty numeric, p_start_stock_qty numeric, p_target_dos_days numeric, p_usage_6m_total numeric, p_moq numeric, p_unit_price numeric) IS 'Task 9b — 한 품목 한 달의 Flex · 수요 · 선택 수량 · MOQ 올림 · 예상 월말재고 · DoS · 재고금액. 입력만 보는 순수 함수. 7번째 인자는 학습 기간 최근 6개월 사용량 합이다(평균이 아니다)';


--
-- Name: can_view_sales_order(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.can_view_sales_order(p_owner_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
  select coalesce(p_owner_user_id = auth.uid(), false)
      or core.has_permission('ALLOC_VIEW')
      or core.has_permission('ALLOC_MANUAL')
      or core.has_permission('ALLOC_FIRM_CANCEL')
      or core.has_permission('ALLOC_PRIORITY_EDIT')
      or core.has_permission('ALLOC_PRIORITY_APPROVE');
$$;


--
-- Name: cancel_alloc_priority_approval(uuid, uuid, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.cancel_alloc_priority_approval(p_approval_id uuid, p_actor uuid, p_comment text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: cancel_firm_allocation(uuid, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.cancel_firm_allocation(p_allocation_id uuid, p_reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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

  -- 잠금 순서 0) 승인 행 → 1) 재고 행 → 2) 주문 행 → 3) 배정 행 (파일 머리말). 승인 행을 먼저 잠가야
  -- core.decide_approval과 순서가 같아져 동시 승인 · 취소가 교착(40P01)되지 않는다.
  perform core.lock_order_pending_approvals(v_target.order_id);
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


--
-- Name: cancel_item_policy_change(uuid, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.cancel_item_policy_change(p_revision_id uuid, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_revision core.item_policy_revision%rowtype;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 품목 정책 변경안을 취소할 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('ITEM_POLICY_EDIT', v_actor) then
    raise exception '품목 정책 변경 요청 권한이 없습니다.' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception '취소 사유는 필수입니다.' using errcode = '22023';
  end if;

  -- ★ 잠금 순서(2026-09-12 최종 리뷰 Important 4) — core.decide_approval(Task 2)은 반드시
  --   core.approval_request를 먼저 잠근 뒤 후처리 훅에서 도메인 행(core.item_policy_revision)을 잠근다.
  --   이 취소 경로가 변경안 행을 먼저 잠그면 순서가 뒤집혀, 같은 요청을 팀장이 승인하는 동시에
  --   요청자가 취소하면 40P01(deadlock detected) 영문 오류가 화면에 그대로 노출됐다.
  --   그래서 1) 잠그지 않고 읽어 승인 id만 얻고 → 2) core.approval_request를 먼저 잠근 뒤 →
  --   3) 변경안 행을 잠그고 상태를 다시 확인한다. 잠금 전 스냅샷으로 한 검사는 잠근 뒤 그대로 반복한다.
  select * into v_revision from core.item_policy_revision where revision_id = p_revision_id;
  if not found then
    raise exception '품목 정책 변경안을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if v_revision.requested_by <> v_actor then
    raise exception '요청자 본인만 자신의 품목 정책 변경안을 취소할 수 있습니다.' using errcode = '42501';
  end if;
  if v_revision.status <> 'PENDING' then
    raise exception '대기 중인 변경안만 취소할 수 있습니다.' using errcode = '22023';
  end if;
  if v_revision.approval_id is null then
    -- request_item_policy_change가 같은 트랜잭션에서 항상 채우므로 정상 흐름에서는 발생하지 않는다.
    raise exception '이 변경안에는 연결된 승인 요청이 없습니다.' using errcode = 'P0002';
  end if;

  -- 1) 승인 행을 먼저 잠근다. 팀장의 결정이 진행 중이면 여기서 기다렸다가, 그 결정이 끝난 뒤
  --    아래 재확인에서 "대기 중인 변경안만 취소할 수 있습니다"로 정상 거절된다(교착 없음).
  perform 1 from core.approval_request where approval_id = v_revision.approval_id for update;

  -- 2) 그 다음에 변경안 행을 잠그고 상태를 다시 확인한다(잠금을 기다리는 동안 결정이 끝났을 수 있다).
  select * into v_revision from core.item_policy_revision where revision_id = p_revision_id for update;
  if not found then
    raise exception '품목 정책 변경안을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if v_revision.requested_by <> v_actor then
    raise exception '요청자 본인만 자신의 품목 정책 변경안을 취소할 수 있습니다.' using errcode = '42501';
  end if;
  if v_revision.status <> 'PENDING' then
    raise exception '대기 중인 변경안만 취소할 수 있습니다.' using errcode = '22023';
  end if;

  -- approval_request.status를 CANCELLED로 바꾼다. 그 UPDATE가 다음을 같은 트랜잭션에서 연쇄시킨다:
  --   Task 3 approval_notification_sync   → 대기 중인 10분 반복 알림(APPROVAL_PENDING) 취소
  --   core.apply_item_policy_decision()   → item_policy_revision을 CANCELLED로, 운영값은 그대로 둠
  perform core.cancel_alloc_priority_approval(v_revision.approval_id, v_actor, btrim(p_reason));
end;
$$;


--
-- Name: FUNCTION cancel_item_policy_change(p_revision_id uuid, p_reason text); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.cancel_item_policy_change(p_revision_id uuid, p_reason text) IS 'Task 9a fix round 1 — 요청자 본인이 대기 중(PENDING) 품목 정책 변경안을 취소한다. 운영값 반영 경로가 아니므로 core.item_policy는 건드리지 않는다';


--
-- Name: cancel_notification_series(text, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.cancel_notification_series(p_series_type text, p_series_id text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_count integer;
begin
  update core.notification_outbox
     set status = 'CANCELLED', finished_at = clock_timestamp(),
         claimed_by = null, claim_token = null, claim_expires_at = null
   where status in ('PENDING', 'PROCESSING')
     and payload ->> 'series_type' = p_series_type
     and payload ->> 'series_id' = p_series_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


--
-- Name: cancel_sales_order(uuid, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.cancel_sales_order(p_order_id uuid, p_reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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

  -- 잠금 순서 0) 승인 행(승인 id 순) → 1) 재고 행(품목코드 순) → 2) 주문 행. 다품목 주문도 같은 순서라
  -- 교착이 생기지 않는다. 승인 행이 맨 앞인 이유는 파일 머리말 참고(동시 승인 · 취소 40P01 방지).
  perform core.lock_order_pending_approvals(p_order_id);
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


--
-- Name: change_allocation_priority(uuid, integer, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.change_allocation_priority(p_order_id uuid, p_priority integer, p_reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: change_urgent_order_status(uuid, text, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.change_urgent_order_status(p_urgent_order_id uuid, p_status text, p_reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_row core.urgent_order%rowtype;
  v_actor_name text;
begin
  if auth.uid() is null or not core.is_active_user(auth.uid()) then
    raise exception '로그인한 활성 사용자만 상태를 변경할 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('ALLOC_MANUAL') then
    raise exception '긴급발주 상태 변경 권한(ALLOC_MANUAL)이 없습니다.' using errcode = '42501';
  end if;
  if p_status not in ('REQUESTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') then
    raise exception '알 수 없는 상태입니다: %', p_status;
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception '사유는 필수입니다.';
  end if;

  select * into v_row from core.urgent_order where urgent_order_id = p_urgent_order_id for update;
  if not found then
    raise exception '긴급발주를 찾을 수 없습니다: %', p_urgent_order_id;
  end if;
  if v_row.status in ('COMPLETED', 'CANCELLED') then
    raise exception '이미 종료된 긴급발주입니다(상태: %).', v_row.status;
  end if;
  if v_row.status = p_status then
    raise exception '이미 % 상태입니다.', p_status;
  end if;

  v_actor_name := core.order_actor_name(auth.uid());

  update core.urgent_order o
     set status = p_status, updated_at = now()
   where o.urgent_order_id = p_urgent_order_id;

  insert into core.audit_log (actor, action, target_type, target_id, before, after)
  values (
    auth.uid(), 'URGENT_ORDER_STATUS_CHANGED', 'urgent_order', p_urgent_order_id::text,
    jsonb_build_object('status', v_row.status),
    jsonb_build_object('status', p_status, 'reason', btrim(p_reason), 'actor_name', v_actor_name)
  );

  return p_urgent_order_id;
end;
$$;


--
-- Name: FUNCTION change_urgent_order_status(p_urgent_order_id uuid, p_status text, p_reason text); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.change_urgent_order_status(p_urgent_order_id uuid, p_status text, p_reason text) IS 'Task 11 — 긴급발주 상태 변경(REQUESTED → IN_PROGRESS → COMPLETED, 또는 CANCELLED). 종료 상태에서는 더 바꿀 수 없다. 사유는 필수이며 core.audit_log에 append-only로 남는다';


--
-- Name: claim_due_notifications(integer, uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.claim_due_notifications(p_limit integer DEFAULT 50, p_worker_id uuid DEFAULT gen_random_uuid()) RETURNS TABLE(notification_id uuid, claim_token uuid, template_code text, recipient_user_id uuid, recipient_email text, channel text, payload jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_exhausted core.notification_outbox%rowtype;
  v_exhausted_next_at timestamptz;
begin
  if p_limit < 1 or p_limit > 50 then
    raise exception '한 번에 처리할 알림 수는 1~50건이어야 합니다.' using errcode = '22023';
  end if;
  if p_worker_id is null then
    raise exception '알림 작업자 식별자는 필수입니다.' using errcode = '22023';
  end if;

  -- 임대시간이 끝났고 최대 시도 횟수에 도달한 작업은 최종 실패 이력을 남깁니다.
  for v_exhausted in
    update core.notification_outbox as o
       set status = 'FAILED',
           finished_at = clock_timestamp(),
           last_error = '처리 임대 만료 후 최대 재시도 횟수를 초과했습니다.',
           claimed_by = null,
           claim_token = null,
           claim_expires_at = null
     where o.status = 'PROCESSING'
       and o.claim_expires_at <= clock_timestamp()
       and o.attempt_count >= o.max_attempts
    returning o.*
  loop
    insert into core.notification_delivery (
      notification_id, recipient_user_id, recipient_email, channel,
      status, attempt_number, retryable, error_message
    )
    select v_exhausted.notification_id, v_exhausted.recipient_user_id,
           nullif(btrim(u.email), ''), v_exhausted.channel,
           'FAILED', v_exhausted.attempt_count, false, v_exhausted.last_error
      from core.app_user u
     where u.user_id = v_exhausted.recipient_user_id;

    -- 작업자 중단이 최대 횟수에 도달해도 반복 series 자체는 끊지 않습니다.
    v_exhausted_next_at := date_bin(
      interval '10 minutes', clock_timestamp(), timestamptz '2000-01-01 00:00:00+00'
    ) + interval '10 minutes';
    if v_exhausted.template_code = 'APPROVAL_PENDING'
       and exists (
         select 1 from core.approval_request r
          where r.approval_id::text = v_exhausted.payload ->> 'approval_id'
            and r.status = 'PENDING'
       ) then
      perform core.enqueue_notification(
        'approval:' || (v_exhausted.payload ->> 'approval_id') || ':pending:'
          || extract(epoch from v_exhausted_next_at)::bigint,
        'APPROVAL_PENDING', v_exhausted.recipient_user_id, v_exhausted.channel,
        v_exhausted_next_at, v_exhausted.payload
      );
    elsif v_exhausted.template_code = 'DEMAND_SUBMISSION_OVERDUE' then
      perform core.enqueue_notification(
        'demand:' || (v_exhausted.payload ->> 'series_id') || ':overdue:'
          || extract(epoch from v_exhausted_next_at)::bigint,
        'DEMAND_SUBMISSION_OVERDUE', v_exhausted.recipient_user_id, v_exhausted.channel,
        v_exhausted_next_at, v_exhausted.payload
      );
    end if;
  end loop;

  -- 작업자가 중단한 PROCESSING 행은 임대 만료 뒤 같은 알림 ID로 다시 처리합니다.
  update core.notification_outbox as o
     set status = 'PENDING',
         claimed_at = null,
         claimed_by = null,
         claim_token = null,
         claim_expires_at = null,
         scheduled_at = clock_timestamp()
   where o.status = 'PROCESSING'
     and o.claim_expires_at <= clock_timestamp()
     and o.attempt_count < o.max_attempts;

  -- 예약 후 계정이 비활성화되면 발송하지 않고 취소합니다. claim 후 반환되지 않아
  -- PROCESSING 상태에 고립되는 행이 생기지 않게 같은 함수 안에서 정리합니다.
  update core.notification_outbox o
     set status = 'CANCELLED', finished_at = clock_timestamp()
   where o.status = 'PENDING'
     and o.scheduled_at <= clock_timestamp()
     and not exists (
       select 1 from core.app_user u
        where u.user_id = o.recipient_user_id and u.active
     );

  return query
  with due as (
    select o.notification_id
      from core.notification_outbox o
     where o.status = 'PENDING'
       and o.scheduled_at <= clock_timestamp()
     order by o.scheduled_at, o.created_at
     for update skip locked
     limit p_limit
  ), claimed as (
    update core.notification_outbox o
       set status = 'PROCESSING',
           attempt_count = o.attempt_count + 1,
           claimed_at = clock_timestamp(),
           claimed_by = p_worker_id,
           claim_token = gen_random_uuid(),
           claim_expires_at = clock_timestamp() + interval '2 minutes',
           finished_at = null
      from due
     where o.notification_id = due.notification_id
    returning o.notification_id, o.claim_token, o.template_code, o.recipient_user_id, o.channel, o.payload
  )
  select c.notification_id, c.claim_token, c.template_code, c.recipient_user_id, u.email,
         c.channel, c.payload
    from claimed c
    join core.app_user u on u.user_id = c.recipient_user_id;
end;
$$;


--
-- Name: classify_inventory_scope(text, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.classify_inventory_scope(p_warehouse_code text, p_raw_status text) RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO 'core', 'pg_temp'
    AS $$
  select r.scope_code
    from core.inventory_scope_rule r
   where (r.warehouse_code = p_warehouse_code or r.warehouse_code is null)
     and (r.raw_status = p_raw_status or r.raw_status is null)
   order by
     (case when r.warehouse_code is not null and r.raw_status is not null then 3
           when r.warehouse_code is not null then 2
           when r.raw_status is not null then 1
           else 0 end) desc,
     r.rule_id
   limit 1;
$$;


--
-- Name: FUNCTION classify_inventory_scope(p_warehouse_code text, p_raw_status text); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.classify_inventory_scope(p_warehouse_code text, p_raw_status text) IS '창고+상태 조합에서 가장 구체적인 core.inventory_scope_rule 행 하나를 고른다. 매칭이
   없으면 null(분류 불가)';


--
-- Name: close_planning_cycle(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.close_planning_cycle(p_cycle_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_department text;
  v_cycle core.planning_cycle%rowtype;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 취합 주기를 닫을 수 있습니다.' using errcode = '42501';
  end if;
  if not (core.has_permission('PLAN_CONFIRM', v_actor) or core.is_admin(v_actor)) then
    raise exception 'SCM 품목담당자 또는 관리자만 취합 주기를 닫을 수 있습니다.' using errcode = '42501';
  end if;

  -- fix round 3 — 잠금 순서: 이 마이그레이션은 어디서나 취합 주기 행을 먼저 잠근다(파일 머리말
  -- "잠금 순서" 참고). 여기서 FOR UPDATE로 명시적으로 먼저 잠가, 이 시점부터 동시에 진행 중인
  -- save/submit/withdraw/agree(취합 주기 행을 FOR SHARE로 먼저 잠근다)와 순서가 확정된다 —
  -- 어느 쪽이 먼저 이 행을 잠갔는지에 따라 나머지가 기다렸다가 최신 상태를 본다.
  select * into v_cycle from core.planning_cycle where cycle_id = p_cycle_id for update;
  if not found or not v_cycle.is_active then
    raise exception '열려 있는 취합 주기를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  update core.planning_cycle
     set status = 'CLOSED', is_active = false, closed_by = v_actor, closed_at = clock_timestamp()
   where cycle_id = p_cycle_id;

  -- fix round 1 — 닫힌 주기에 남아 있던 반복 미제출 알림을 전부 중단한다. 재개(reopen)는
  -- 같은 달에 새 cycle_id로 새 취합 주기를 여는 것이라, 이 닫힌 주기에 묶인 제출본(DRAFT ·
  -- WITHDRAWN · SUBMITTED 무엇이든)은 다시 살아나지 않고 읽기 전용 이력으로만 남는다
  -- (core.save_demand_submission_lines · submit_demand_submission ·
  -- withdraw_demand_submission이 is_active=false인 주기의 쓰기를 거절한다).
  for v_department in
    select distinct u.department
      from core.app_user u
      join core.role_permission rp on rp.job_role = u.job_role
     where u.active and rp.permission_code = 'DEMAND_SUBMIT' and u.department is not null
  loop
    perform core.cancel_notification_series('DEMAND_SUBMISSION', p_cycle_id::text || ':' || v_department);
  end loop;
end;
$$;


--
-- Name: commit_import_batch(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.commit_import_batch(p_batch_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'raw', 'pg_temp'
    AS $_$
declare b core.upload_batch%rowtype; table_name text; r record; payload jsonb;
begin
  if not core.is_admin() then raise exception '관리자 권한이 필요합니다.' using errcode='42501'; end if;
  select * into b from core.upload_batch where batch_id=p_batch_id for update;
  if not found or b.status <> 'VALIDATED' or b.error_rows > 0 then raise exception '검증 완료 및 오류 0건인 batch만 적재할 수 있습니다.' using errcode='22023'; end if;
  table_name := core.import_target_table(b.import_type); if table_name is null then raise exception '지원하지 않는 Import Type입니다.'; end if;
  if b.import_mode='replace' then execute format('insert into core.import_row_backup(batch_id,target_table,row_data,backup_reason) select $1,$2,to_jsonb(t),''REPLACE'' from raw.%I t',table_name) using p_batch_id,table_name; execute format('delete from raw.%I',table_name); end if;
  for r in select row_number,mapped_data from core.import_staging where batch_id=p_batch_id and validation_status in ('SUCCESS','WARNING') order by row_number loop
    payload := r.mapped_data || jsonb_build_object('batch_id',p_batch_id,'source_type','FILE_UPLOAD','loaded_at',now(),'source_record_id',coalesce(r.mapped_data->>'source_record_id',r.row_number::text));
    if b.import_type='inventory' then payload := jsonb_build_object('품목코드',payload->>'item_id','창고',payload->>'warehouse','현재고',payload->>'current_stock','기준일자',payload->>'reference_date','안전재고',payload->>'safety_stock','inventory_status',payload->>'inventory_status','warehouse_code',payload->>'warehouse_code','snapshot_at',payload->>'snapshot_at','batch_id',p_batch_id,'source_type','FILE_UPLOAD','loaded_at',now(),'source_record_id',payload->>'source_record_id');
    elsif b.import_type='item_master' then payload := jsonb_build_object('품목코드',payload->>'item_id','품목명',payload->>'item_name','품목구분',payload->>'item_type','단위',payload->>'unit','supplier_id',payload->>'supplier_id','batch_id',p_batch_id,'source_type','FILE_UPLOAD','loaded_at',now(),'source_record_id',payload->>'source_record_id');
    elsif b.import_type='supplier_master' then payload := jsonb_build_object('공급업체코드',payload->>'supplier_id','공급업체명',payload->>'supplier_name','국가',payload->>'country','batch_id',p_batch_id,'source_type','FILE_UPLOAD','loaded_at',now(),'source_record_id',payload->>'source_record_id');
    elsif b.import_type='purchase_order' then payload := jsonb_build_object('발주번호',payload->>'source_record_id','발주일',payload->>'order_date','공급업체',payload->>'supplier_id','품목코드',payload->>'item_id','발주수량',payload->>'qty','batch_id',p_batch_id,'source_type','FILE_UPLOAD','loaded_at',now(),'source_record_id',payload->>'source_record_id');
    elsif b.import_type='goods_receipt' then payload := jsonb_build_object('입고번호',payload->>'source_record_id','품목코드',payload->>'item_id','입고수량',payload->>'qty','입고일',payload->>'receipt_date','receipt_status',payload->>'receipt_status','batch_id',p_batch_id,'source_type','FILE_UPLOAD','loaded_at',now(),'source_record_id',payload->>'source_record_id'); end if;
    if b.import_mode='upsert' then
      -- ★ (Task 4 후속 수정, 0500과 같은 내용) 입고 · 발주는 한 문서번호에 품목이 여러 줄이다.
      --   source_record_id 하나만 키로 삭제하면 앞 줄이 뒤 줄을 적재할 때마다 지워져 마지막 품목만
      --   raw에 남는다(core.v_open_po_qty의 발주 · 입고 수량이 함께 과소 계상됐다). 이 두 유형은
      --   (source_record_id, 품목코드)가 행의 실제 식별자다 — core.stock_receipt_ledger 유니크 키와 같다.
      if b.import_type in ('goods_receipt','purchase_order') then
        execute format('insert into core.import_row_backup(batch_id,target_table,row_data,backup_reason) select $1,$2,to_jsonb(t),''UPSERT'' from raw.%I t where t.source_type=''FILE_UPLOAD'' and t.source_record_id=$3 and t."품목코드" is not distinct from $4',table_name) using p_batch_id,table_name,payload->>'source_record_id',payload->>'품목코드';
        execute format('delete from raw.%I where source_type=''FILE_UPLOAD'' and source_record_id=$1 and "품목코드" is not distinct from $2',table_name) using payload->>'source_record_id',payload->>'품목코드';
      else
        execute format('insert into core.import_row_backup(batch_id,target_table,row_data,backup_reason) select $1,$2,to_jsonb(t),''UPSERT'' from raw.%I t where t.source_type=''FILE_UPLOAD'' and t.source_record_id=$3',table_name) using p_batch_id,table_name,payload->>'source_record_id';
        execute format('delete from raw.%I where source_type=''FILE_UPLOAD'' and source_record_id=$1',table_name) using payload->>'source_record_id';
      end if;
    end if;
    execute format('insert into raw.%I select * from jsonb_populate_record(null::raw.%I,$1)',table_name,table_name) using payload;
  end loop;
  update core.upload_batch set status='IMPORTED', imported_at=now(), forecast_stale_marked=b.import_type in ('usage_history','sales_order','business_event') where batch_id=p_batch_id;
  if b.import_type in ('usage_history','sales_order','business_event') and to_regclass('core.forecast_run') is not null then execute 'update core.forecast_run set stale_at=now() where data_snapshot_at < now() and stale_at is null'; end if;
  if b.import_type = 'inventory' then perform core.apply_stock_balance_from_batch(p_batch_id); perform core.apply_month_end_inventory_snapshot_from_batch(p_batch_id);
  elsif b.import_type = 'goods_receipt' then perform core.apply_stock_receipts_from_batch(p_batch_id); end if;
end; $_$;


--
-- Name: FUNCTION commit_import_batch(p_batch_id uuid); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.commit_import_batch(p_batch_id uuid) IS 'STEP 4 원본 + Task 4 확장 + Task 12 확장: inventory 배치 적재 직후 같은 트랜잭션에서 core.apply_stock_balance_from_batch(현재값)와 core.apply_month_end_inventory_snapshot_from_batch (그 달 스냅샷 append)를 함께 호출한다. goods_receipt는 이전과 동일(월말 스냅샷에 영향 없음 — 입고는 실사 스냅샷이 아니다)';


--
-- Name: confirm_kr_business_day(date); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.confirm_kr_business_day(p_date date) RETURNS date
    LANGUAGE plpgsql STABLE
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: FUNCTION confirm_kr_business_day(p_date date); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.confirm_kr_business_day(p_date date) IS 'Task 10b — 이 날짜를 KR 영업일로 확정한다. previous_business_day로 당긴 뒤, 원래 날짜부터 당겨진 날짜까지 걸친 모든 달이 core.business_calendar_readiness에서 준비됨이어야 한다. 하나라도 준비 안 됐으면 null이다(공휴일 공백을 주말 판정으로 가리지 않는다)';


--
-- Name: confirm_procurement_plan(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.confirm_procurement_plan(p_plan_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_plan core.procurement_plan%rowtype;
  v_n_lines integer;
  v_blockers jsonb;
  v_approval_id uuid;
  v_payload jsonb;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 발주계획을 확정할 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('PLAN_CONFIRM', v_actor) then
    raise exception '발주계획 확정 권한(PLAN_CONFIRM)이 없습니다.' using errcode = '42501';
  end if;

  select * into v_plan from core.procurement_plan where plan_id = p_plan_id for update;
  if not found then
    raise exception '발주계획을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if v_plan.status not in ('DRAFT', 'REJECTED') then
    raise exception '확정할 수 있는 상태가 아닙니다(현재 %).', v_plan.status using errcode = '22023';
  end if;
  v_actor_name := core.order_actor_name(v_actor);

  select count(*) into v_n_lines from core.procurement_plan_line where plan_id = p_plan_id;

  -- 화면이 보여주는 차단 사유(analytics.v_procurement_plan_blocker)와 같은 판정을 쓴다
  select coalesce(
           jsonb_agg(jsonb_build_object('reason_code', b.reason_code, 'line_count', b.line_count, 'item_count', b.item_count)
                     order by b.reason_rank, b.reason_code),
           '[]'::jsonb)
    into v_blockers
    from analytics.v_procurement_plan_blocker b
   where b.plan_id = p_plan_id;

  if v_n_lines = 0 then
    v_blockers := jsonb_build_array(jsonb_build_object('reason_code', 'PLAN_HAS_NO_LINES', 'line_count', 0, 'item_count', 0));
  end if;

  if jsonb_array_length(v_blockers) > 0 then
    insert into core.procurement_plan_event (plan_id, event_type, previous_status, next_status, actor, actor_name, payload)
    values (p_plan_id, 'CONFIRM_BLOCKED', v_plan.status, v_plan.status, v_actor, v_actor_name,
            jsonb_build_object('blocking_reasons', v_blockers));
    return jsonb_build_object('status', 'BLOCKED', 'plan_id', p_plan_id, 'blocking_reasons', v_blockers);
  end if;

  update core.procurement_plan
     set status = 'PENDING_APPROVAL', confirmed_by = v_actor, confirmed_by_name = v_actor_name, confirmed_at = clock_timestamp(),
         approval_id = null, decided_by = null, decider_name = null, decided_at = null, decision_comment = null
   where plan_id = p_plan_id;

  select jsonb_build_object(
           'plan_id', p_plan_id, 'plan_month', v_plan.plan_month, 'version', v_plan.version,
           'forecast_run_id', v_plan.forecast_run_id, 'n_items', count(distinct l.item_id),
           'month1_final_order_qty', sum(l.final_order_qty) filter (where l.month_no = 1),
           'month1_projected_inventory_value', sum(l.projected_inventory_value) filter (where l.month_no = 1)
         )
    into v_payload
    from core.procurement_plan_line l
   where l.plan_id = p_plan_id;

  -- Task 2 공통 승인 엔진 — PLAN_CONFIRM으로 요청, PLAN_APPROVE · 요청자 ≠ 승인자는 core.decide_approval이 판정한다
  v_approval_id := core.request_approval(
    'PURCHASE_PLAN', 'PROCUREMENT_PLAN', p_plan_id::text, v_payload, 'PURCHASE_PLAN_CONFIRM',
    format('%s 발주계획 v%s 확정', to_char(v_plan.plan_month, 'YYYY-MM'), v_plan.version)
  );

  update core.procurement_plan set approval_id = v_approval_id where plan_id = p_plan_id;

  insert into core.procurement_plan_event (plan_id, event_type, previous_status, next_status, actor, actor_name, approval_id, payload)
  values (p_plan_id, 'CONFIRMED', v_plan.status, 'PENDING_APPROVAL', v_actor, v_actor_name, v_approval_id, v_payload);

  return jsonb_build_object('status', 'PENDING_APPROVAL', 'plan_id', p_plan_id, 'approval_id', v_approval_id);
end;
$$;


--
-- Name: FUNCTION confirm_procurement_plan(p_plan_id uuid); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.confirm_procurement_plan(p_plan_id uuid) IS 'Task 9b — 발주계획 확정(PLAN_CONFIRM). 계산 불가 · 목표 DoS 미승인 라인이 있으면 {status: BLOCKED, blocking_reasons}를 돌려주고 이력만 남긴다. 통과하면 PURCHASE_PLAN 승인 요청을 만들고 {status: PENDING_APPROVAL, approval_id}를 돌려준다';


--
-- Name: confirm_sales_order(uuid, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.confirm_sales_order(p_order_id uuid, p_confirmed_order_no text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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
  -- 만료 시각이 지나면 임시배정은 이미 효력이 없다. 해제되지 않은 임시배정이 남은 채 확정해 FIRM(만료 없음)으로
  -- 바꾸면 30일 규칙을 우회하므로, 자동 해제 작업(Task 6)이 늦게 돌더라도 여기서 막는다 (stage1 §2 44 · 46행).
  -- 30일 규칙은 임시배정에만 적용된다(68 · 97행). 남은 배정이 FIRM · 승인대기 확보뿐이면 만료 뒤에도 확정할 수 있다.
  if clock_timestamp() >= v_order.temporary_expires_at
     and exists (
       select 1
         from core.stock_allocation a
        where a.order_id = p_order_id
          and a.status = 'TEMPORARY'
     ) then
    raise exception 'TEMPORARY_ALLOCATION_EXPIRED: 임시배정 만료 시각(%)이 지나 해제되지 않은 임시배정이 남은 주문은 수주 확정할 수 없습니다. 만료 임시배정이 해제된 뒤 FIRM · 확보만 남으면 확정할 수 있습니다.',
      v_order.temporary_expires_at using errcode = '55000';
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


--
-- Name: copy_cancelled_order(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.copy_cancelled_order(p_order_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: create_sales_order(text, text, jsonb, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.create_sales_order(p_customer_id text, p_customer_name text, p_lines jsonb, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: create_stock_allocation(bigint, text, numeric, text, uuid, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.create_stock_allocation(p_line_id bigint, p_status text, p_qty numeric, p_source text, p_actor uuid, p_reason text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_line core.sales_order_line%rowtype;
  v_normal numeric;
  v_committed numeric;
  v_allocation_id uuid;
  v_order_status text;
  v_temporary_expires_at timestamptz;
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
  -- 임시배정 생성은 주문의 만료 시각 전에만 한다. 수동 FIRM · 승인대기 확보는 시간 제한이 없다(stage1 §2 68 · 83행).
  select o.status, o.temporary_expires_at
    into v_order_status, v_temporary_expires_at
    from core.sales_order o
   where o.order_id = v_line.order_id;
  if p_status = 'TEMPORARY' and v_order_status <> 'CONFIRMED'
     and clock_timestamp() >= v_temporary_expires_at then
    raise exception 'TEMPORARY_ALLOCATION_EXPIRED: 임시배정 만료 시각(%)이 지난 주문에는 임시배정을 만들 수 없습니다.',
      v_temporary_expires_at using errcode = '55000';
  end if;

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


--
-- Name: create_urgent_order(text, numeric, date, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.create_urgent_order(p_item_id text, p_qty numeric, p_needed_by date, p_reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_item_id text;
  v_actor_name text;
  v_urgent_order_id uuid;
begin
  if auth.uid() is null or not core.is_active_user(auth.uid()) then
    raise exception '로그인한 활성 사용자만 등록할 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('ALLOC_MANUAL') then
    raise exception '긴급발주 등록 권한(ALLOC_MANUAL)이 없습니다.' using errcode = '42501';
  end if;

  v_item_id := core.normalize_item_id(p_item_id);
  if v_item_id = '' then
    raise exception '품목코드는 필수입니다.';
  end if;
  if not exists (select 1 from core.v_item_master m where m.item_id = v_item_id) then
    raise exception '등록되지 않은 품목입니다: %', v_item_id;
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception '수량은 0보다 커야 합니다.';
  end if;
  if p_needed_by is null then
    raise exception '필요일은 필수입니다.';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception '사유는 필수입니다.';
  end if;

  v_actor_name := core.order_actor_name(auth.uid());

  insert into core.urgent_order (item_id, qty, needed_by, reason, status, owner_user_id, owner_name)
  values (v_item_id, p_qty, p_needed_by, btrim(p_reason), 'REQUESTED', auth.uid(), v_actor_name)
  returning urgent_order_id into v_urgent_order_id;

  insert into core.audit_log (actor, action, target_type, target_id, before, after)
  values (
    auth.uid(), 'URGENT_ORDER_CREATED', 'urgent_order', v_urgent_order_id::text,
    null,
    jsonb_build_object(
      'item_id', v_item_id, 'qty', p_qty, 'needed_by', p_needed_by, 'reason', btrim(p_reason),
      'status', 'REQUESTED', 'actor_name', v_actor_name
    )
  );

  return v_urgent_order_id;
end;
$$;


--
-- Name: FUNCTION create_urgent_order(p_item_id text, p_qty numeric, p_needed_by date, p_reason text); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.create_urgent_order(p_item_id text, p_qty numeric, p_needed_by date, p_reason text) IS 'Task 11 — 긴급발주 등록. SCM 품목담당자(ALLOC_MANUAL)만 등록한다(컨트롤러 판정 1). 등록 사실이 core.audit_log(target_type=urgent_order)에 남는다';


--
-- Name: deactivate_supplier_departure_rule(bigint, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.deactivate_supplier_departure_rule(p_departure_id bigint, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: FUNCTION deactivate_supplier_departure_rule(p_departure_id bigint, p_reason text); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.deactivate_supplier_departure_rule(p_departure_id bigint, p_reason text) IS 'Task 10a — ADMIN 전용. 출항일 규칙을 끈다(active=false). 행은 지우지 않는다';


--
-- Name: decide_approval(uuid, text, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.decide_approval(p_approval_id uuid, p_decision text, p_decision_comment text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_required_permission text;
  v_request core.approval_request%rowtype;
  v_before jsonb;
  v_after jsonb;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 승인 요청을 처리할 수 있습니다.' using errcode = '42501';
  end if;

  if p_decision is null or p_decision not in ('APPROVED', 'REJECTED') then
    raise exception '승인 결과는 APPROVED 또는 REJECTED여야 합니다.' using errcode = '22023';
  end if;

  select * into v_request
    from core.approval_request
   where approval_id = p_approval_id
   for update;

  if not found then
    raise exception '승인 요청을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  v_required_permission := case v_request.approval_type
    when 'ITEM_POLICY' then 'ITEM_POLICY_APPROVE'
    when 'ALLOC_PRIORITY' then 'ALLOC_PRIORITY_APPROVE'
    when 'EVENT_ORDER' then 'EVENT_ORDER_APPROVE'
    when 'PURCHASE_PLAN' then 'PLAN_APPROVE'
  end;

  if v_required_permission is null or not core.has_permission(v_required_permission, v_actor) then
    raise exception '이 승인 유형을 결정할 업무 권한이 없습니다.' using errcode = '42501';
  end if;

  select coalesce(nullif(btrim(u.name), ''), nullif(btrim(u.email), ''), u.user_id::text)
    into v_actor_name
    from core.app_user u
   where u.user_id = v_actor;

  if v_request.requested_by = v_actor then
    raise exception '자신이 요청한 승인은 직접 결정할 수 없습니다.' using errcode = '42501';
  end if;

  if v_request.status <> 'PENDING' then
    raise exception '이미 처리되었거나 취소된 승인 요청입니다.' using errcode = '22023';
  end if;

  if p_decision = 'REJECTED' and nullif(btrim(p_decision_comment), '') is null then
    raise exception '반려 의견은 필수입니다.' using errcode = '22023';
  end if;

  v_before := to_jsonb(v_request);

  update core.approval_request
     set status = p_decision,
         decided_by = v_actor,
         decider_name = v_actor_name,
         decided_at = clock_timestamp(),
         decision_comment = nullif(btrim(p_decision_comment), '')
   where approval_id = p_approval_id;

  select to_jsonb(r) into v_after
    from core.approval_request r
   where r.approval_id = p_approval_id;

  insert into core.approval_event (
    approval_id, event_type, previous_status, next_status,
    actor, comment, payload_snapshot
  ) values (
    p_approval_id, p_decision, 'PENDING', p_decision,
    v_actor, nullif(btrim(p_decision_comment), ''), v_after
  );

  insert into core.audit_log (actor, action, target_type, target_id, before, after)
  values (
    v_actor,
    case p_decision when 'APPROVED' then 'APPROVAL_APPROVED' else 'APPROVAL_REJECTED' end,
    'APPROVAL_REQUEST', p_approval_id::text, v_before, v_after
  );

  return p_approval_id;
end;
$$;


--
-- Name: enqueue_auto_allocation_notice(uuid, text, text, numeric, numeric); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.enqueue_auto_allocation_notice(p_order_id uuid, p_dedupe_suffix text, p_item_id text, p_allocated_qty numeric, p_remaining_shortage_qty numeric) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: enqueue_notification(text, text, uuid, text, timestamp with time zone, jsonb); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.enqueue_notification(p_dedupe_key text, p_template_code text, p_recipient_user_id uuid, p_channel text, p_scheduled_at timestamp with time zone, p_payload jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_notification_id uuid;
begin
  if nullif(btrim(p_dedupe_key), '') is null
     or nullif(btrim(p_template_code), '') is null
     or p_recipient_user_id is null
     or p_scheduled_at is null
     or p_channel not in ('IN_APP', 'EMAIL')
     or p_payload is null
     or jsonb_typeof(p_payload) <> 'object' then
    raise exception '알림 예약 입력값이 올바르지 않습니다.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from core.app_user u
     where u.user_id = p_recipient_user_id and u.active
  ) then
    raise exception '활성 수신자를 찾을 수 없습니다.' using errcode = '22023';
  end if;

  insert into core.notification_outbox (
    dedupe_key, template_code, recipient_user_id, channel, scheduled_at, payload
  ) values (
    btrim(p_dedupe_key), btrim(p_template_code), p_recipient_user_id,
    p_channel, p_scheduled_at, p_payload
  )
  on conflict (dedupe_key, recipient_user_id, channel) do nothing
  returning notification_id into v_notification_id;

  if v_notification_id is null then
    select o.notification_id into v_notification_id
      from core.notification_outbox o
     where o.dedupe_key = btrim(p_dedupe_key)
       and o.recipient_user_id = p_recipient_user_id
       and o.channel = p_channel;
  end if;

  return v_notification_id;
end;
$$;


--
-- Name: enqueue_order_notice(text, text, uuid[], jsonb); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.enqueue_order_notice(p_dedupe_key text, p_template_code text, p_recipient_user_ids uuid[], p_payload jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: enqueue_temporary_allocation_released(text, uuid[]); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.enqueue_temporary_allocation_released(p_allocation_id text, p_recipient_user_ids uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_user_id uuid;
  v_channel text;
  v_count integer := 0;
begin
  perform core.cancel_notification_series('TEMP_ALLOCATION', p_allocation_id);
  foreach v_user_id in array p_recipient_user_ids loop
    foreach v_channel in array array['IN_APP', 'EMAIL'] loop
      perform core.enqueue_notification(
        'allocation:' || p_allocation_id || ':released',
        'TEMP_ALLOCATION_RELEASED', v_user_id, v_channel, clock_timestamp(),
        jsonb_build_object(
          'series_type', 'TEMP_ALLOCATION', 'series_id', p_allocation_id,
          'allocation_id', p_allocation_id, 'title', '임시배정이 자동 해제되었습니다',
          'message', '만료된 임시배정과 연결된 주문 상태를 확인해 주세요.'
        )
      );
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;


--
-- Name: expire_temporary_allocations(timestamp with time zone); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.expire_temporary_allocations(p_now timestamp with time zone DEFAULT clock_timestamp()) RETURNS TABLE(order_id uuid, order_no text, outcome text, released_qty numeric, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: FUNCTION expire_temporary_allocations(p_now timestamp with time zone); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.expire_temporary_allocations(p_now timestamp with time zone) IS 'Task 6 · 30일 경과 임시배정 자동 해제. TEMPORARY만 해제하고, FIRM · APPROVAL_HOLD가 남으면
   주문은 EXPIRED로 만들지 않는다. 배정 0건 WAITING_FULL 주문은 그대로 EXPIRED. 재실행해도
   이미 처리된 주문은 후보에서 빠져 이중 해제 · 이중 알림이 없다. 한 주문의 실패가 다른 주문
   처리를 막지 않는다(주문별 BEGIN…EXCEPTION). Cron(app/api/cron/allocations)만 호출한다';


--
-- Name: finish_notification(uuid, uuid, uuid, boolean, boolean, text, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.finish_notification(p_notification_id uuid, p_worker_id uuid, p_claim_token uuid, p_success boolean, p_retryable boolean DEFAULT false, p_error_message text DEFAULT NULL::text, p_external_message_id text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_notice core.notification_outbox%rowtype;
  v_recipient_email text;
  v_next_at timestamptz;
  v_is_recurring boolean;
  v_retry_scheduled boolean;
begin
  select * into v_notice
    from core.notification_outbox
   where notification_id = p_notification_id
   for update;

  if not found then
    raise exception '처리할 알림을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if v_notice.status <> 'PROCESSING' then
    raise exception 'claim되지 않은 알림은 완료할 수 없습니다.' using errcode = '22023';
  end if;
  if p_worker_id is null
     or p_claim_token is null
     or v_notice.claimed_by is distinct from p_worker_id
     or v_notice.claim_token is distinct from p_claim_token then
    raise exception '알림 claim 소유권이 일치하지 않습니다.' using errcode = '42501';
  end if;
  if v_notice.claim_expires_at <= clock_timestamp() then
    raise exception '알림 처리 임대시간이 만료되었습니다.' using errcode = '55000';
  end if;
  if not p_success and nullif(btrim(p_error_message), '') is null then
    raise exception '실패 알림에는 오류 내용이 필요합니다.' using errcode = '22023';
  end if;

  select nullif(btrim(u.email), '') into v_recipient_email
    from core.app_user u
   where u.user_id = v_notice.recipient_user_id;

  -- 반복 알림은 현재 발송 성공 여부와 무관하게 다음 10분 회차가 이어져야 합니다.
  -- 같은 알림 자체를 재시도하면 다음 회차와 겹칠 수 있으므로, 단발 알림만 동일 ID로 재시도합니다.
  v_is_recurring := v_notice.template_code in ('APPROVAL_PENDING', 'DEMAND_SUBMISSION_OVERDUE');
  v_retry_scheduled := not p_success
    and p_retryable
    and not v_is_recurring
    and v_notice.attempt_count < v_notice.max_attempts;

  insert into core.notification_delivery (
    notification_id, recipient_user_id, recipient_email, channel,
    status, attempt_number, retryable, error_message, external_message_id
  ) values (
    v_notice.notification_id, v_notice.recipient_user_id, v_recipient_email,
    v_notice.channel, case when p_success then 'SUCCESS' else 'FAILED' end,
    v_notice.attempt_count, v_retry_scheduled,
    case when p_success then null else btrim(p_error_message) end,
    nullif(btrim(p_external_message_id), '')
  );

  if v_retry_scheduled then
    update core.notification_outbox
       set status = 'PENDING',
           scheduled_at = clock_timestamp() + make_interval(
             secs => least(21600, 600 * power(2, greatest(v_notice.attempt_count - 1, 0)))::integer
           ),
           claimed_at = null,
           claimed_by = null,
           claim_token = null,
           claim_expires_at = null,
           last_error = btrim(p_error_message),
           finished_at = null
     where notification_id = p_notification_id;
    return;
  end if;

  update core.notification_outbox
     set status = case when p_success then 'SENT' else 'FAILED' end,
         claimed_by = null,
         claim_token = null,
         claim_expires_at = null,
         last_error = case when p_success then null else btrim(p_error_message) end,
         finished_at = clock_timestamp()
   where notification_id = p_notification_id;

  if p_success and v_notice.channel = 'IN_APP' then
    insert into core.user_notification (notification_id, recipient_user_id)
    values (v_notice.notification_id, v_notice.recipient_user_id)
    on conflict (notification_id) do nothing;
  end if;

  -- 승인 대기는 24시간 운영하며, 처리되지 않은 동안에만 정확히 10분 뒤 다음 건을 예약합니다.
  if v_notice.template_code = 'APPROVAL_PENDING'
     and exists (
       select 1 from core.approval_request r
        where r.approval_id::text = v_notice.payload ->> 'approval_id'
          and r.status = 'PENDING'
     ) then
    v_next_at := date_bin(
      interval '10 minutes', clock_timestamp(), timestamptz '2000-01-01 00:00:00+00'
    ) + interval '10 minutes';
    perform core.enqueue_notification(
      'approval:' || (v_notice.payload ->> 'approval_id') || ':pending:' || extract(epoch from v_next_at)::bigint,
      'APPROVAL_PENDING', v_notice.recipient_user_id, v_notice.channel, v_next_at, v_notice.payload
    );
  elsif v_notice.template_code = 'DEMAND_SUBMISSION_OVERDUE' then
    v_next_at := date_bin(
      interval '10 minutes', clock_timestamp(), timestamptz '2000-01-01 00:00:00+00'
    ) + interval '10 minutes';
    perform core.enqueue_notification(
      'demand:' || (v_notice.payload ->> 'series_id') || ':overdue:' || extract(epoch from v_next_at)::bigint,
      'DEMAND_SUBMISSION_OVERDUE', v_notice.recipient_user_id, v_notice.channel, v_next_at, v_notice.payload
    );
  end if;
end;
$$;


--
-- Name: guard_alloc_priority_approval_request(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.guard_alloc_priority_approval_request() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: guard_demand_submission_cycle_active(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.guard_demand_submission_cycle_active() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'pg_temp'
    AS $$
declare
  v_is_active boolean;
begin
  -- fix round 3 — 잠그지 않은 SELECT는 READ COMMITTED에서 동시 진행 중인
  -- core.close_planning_cycle의 커밋을 기다리지 않고 옛(잠기기 전) 값을 그대로 읽을 수 있다.
  -- FOR SHARE로 읽어야 close_planning_cycle(FOR UPDATE로 잠근다)과 실제로 순서가 맞춰진다.
  -- FOR KEY SHARE는 부족하다 — 일반 UPDATE(키가 아닌 열만 바꾸는 FOR NO KEY UPDATE)와 충돌하지
  -- 않기 때문이다. 이 트리거가 최종 방어선이라 애플리케이션 함수의 확인 여부와 무관하게 스스로
  -- 정확해야 한다.
  select c.is_active into v_is_active from core.planning_cycle c where c.cycle_id = new.cycle_id for share;
  if v_is_active is distinct from true then
    raise exception '취합 주기가 닫힌 제출본은 더 이상 바꿀 수 없습니다.' using errcode = '22023';
  end if;
  return new;
end;
$$;


--
-- Name: guard_demand_submission_line_cycle_active(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.guard_demand_submission_line_cycle_active() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'pg_temp'
    AS $$
declare
  v_submission_id uuid := coalesce(new.submission_id, old.submission_id);
  v_is_active boolean;
begin
  -- fix round 3 — 위 core.guard_demand_submission_cycle_active와 같은 이유로 취합 주기 행만
  -- FOR SHARE로 잠근다("for share of c" — 제출본 행은 호출한 함수가 이미 따로 잠그고 있으므로
  -- 여기서 다시 잠글 필요가 없다).
  select c.is_active into v_is_active
    from core.demand_submission s
    join core.planning_cycle c on c.cycle_id = s.cycle_id
   where s.submission_id = v_submission_id
   for share of c;
  if v_is_active is distinct from true then
    raise exception '취합 주기가 닫힌 제출본의 항목은 더 이상 바꿀 수 없습니다.' using errcode = '22023';
  end if;
  return coalesce(new, old);
end;
$$;


--
-- Name: guard_event_demand_mutation(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.guard_event_demand_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'core', 'pg_temp'
    AS $$
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


--
-- Name: guard_event_order_approval_request(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.guard_event_order_approval_request() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: guard_item_policy_approval_request(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.guard_item_policy_approval_request() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
begin
  if new.approval_type <> 'ITEM_POLICY' then
    return new;
  end if;
  if new.target_type <> 'ITEM_POLICY_REVISION'
     or not exists (
       select 1 from core.item_policy_revision r
        where r.revision_id::text = new.target_id
          and r.status = 'PENDING'
          and r.approval_id is null
     ) then
    raise exception '품목 정책 변경 승인은 core.request_item_policy_change()가 만든 대기 변경안에만 요청할 수 있습니다.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;


--
-- Name: guard_procurement_plan_line_mutation(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.guard_procurement_plan_line_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'core', 'pg_temp'
    AS $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception '발주계획 라인은 생성 후 수정하거나 삭제할 수 없습니다. 새 버전을 계산하세요.' using errcode = '42501';
  end if;
  -- 라인은 방금 만든(아직 한 번도 확정되지 않은) 작성 계획에만 붙는다 — 승인본 · 대체본에 끼워 넣을 수 없다
  if not exists (
    select 1 from core.procurement_plan p
     where p.plan_id = new.plan_id and p.status = 'DRAFT' and p.confirmed_at is null
  ) then
    raise exception '발주계획 라인은 방금 계산한 작성(DRAFT) 계획에만 추가할 수 있습니다.' using errcode = '42501';
  end if;
  return new;
end;
$$;


--
-- Name: guard_procurement_plan_mutation(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.guard_procurement_plan_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'core', 'pg_temp'
    AS $$
begin
  if tg_op = 'DELETE' then
    raise exception '발주계획은 삭제할 수 없습니다. 새 버전을 계산하세요.' using errcode = '42501';
  end if;
  if old.status = 'APPROVED' then
    raise exception '승인된 발주계획은 변경할 수 없습니다. 새 버전을 계산하세요.' using errcode = '42501';
  end if;
  if old.status = 'SUPERSEDED' then
    raise exception '새 버전으로 대체된 발주계획은 변경할 수 없습니다.' using errcode = '42501';
  end if;
  if (new.plan_id, new.plan_month, new.version, new.horizon_months, new.forecast_run_id, new.forecast_train_start,
      new.forecast_train_end, new.forecast_data_snapshot_at, new.source_status, new.built_by, new.built_by_name, new.built_at)
     is distinct from
     (old.plan_id, old.plan_month, old.version, old.horizon_months, old.forecast_run_id, old.forecast_train_start,
      old.forecast_train_end, old.forecast_data_snapshot_at, old.source_status, old.built_by, old.built_by_name, old.built_at) then
    raise exception '발주계획의 계산 근거(기준월 · 버전 · Forecast · 생성자)는 변경할 수 없습니다.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'DRAFT' and new.status in ('PENDING_APPROVAL', 'SUPERSEDED'))
    or (old.status = 'PENDING_APPROVAL' and new.status in ('APPROVED', 'REJECTED', 'DRAFT'))
    or (old.status = 'REJECTED' and new.status in ('PENDING_APPROVAL', 'SUPERSEDED'))
  ) then
    raise exception '허용되지 않는 발주계획 상태 전환입니다: % → %', old.status, new.status using errcode = '22023';
  end if;
  return new;
end;
$$;


--
-- Name: guard_purchase_plan_approval_request(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.guard_purchase_plan_approval_request() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
begin
  if new.approval_type <> 'PURCHASE_PLAN' then
    return new;
  end if;
  if new.target_type <> 'PROCUREMENT_PLAN'
     or not exists (
       select 1 from core.procurement_plan p
        where p.plan_id::text = new.target_id and p.status = 'PENDING_APPROVAL' and p.approval_id is null
     ) then
    raise exception '최종 발주계획 승인은 core.confirm_procurement_plan()이 확정한 계획에만 요청할 수 있습니다.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;


--
-- Name: guard_sales_order_line_mutation(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.guard_sales_order_line_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'core', 'pg_temp'
    AS $$
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


--
-- Name: guard_sales_order_mutation(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.guard_sales_order_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'core', 'pg_temp'
    AS $$
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


--
-- Name: guard_stock_allocation_mutation(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.guard_stock_allocation_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'core', 'pg_temp'
    AS $$
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


--
-- Name: guard_supply_meeting_result_mutation(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.guard_supply_meeting_result_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'core', 'pg_temp'
    AS $$
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


--
-- Name: handle_new_auth_user(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.handle_new_auth_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'auth', 'pg_temp'
    AS $$
begin
  insert into core.app_user (user_id, email, name, department, role, active)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    nullif(new.raw_user_meta_data ->> 'department', ''),
    'USER',
    true
  )
  on conflict (user_id) do update
    set email = excluded.email,
        name = case when core.app_user.name = '' then excluded.name else core.app_user.name end,
        updated_at = now();
  return new;
end;
$$;


--
-- Name: has_permission(text, uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.has_permission(p_code text, p_user uuid DEFAULT auth.uid()) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
  select exists (
    select 1
      from core.app_user u
      join core.role_permission rp on rp.job_role = u.job_role
     where u.user_id = p_user
       and u.active
       and rp.permission_code = p_code
  );
$$;


--
-- Name: FUNCTION has_permission(p_code text, p_user uuid); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.has_permission(p_code text, p_user uuid) IS '업무 권한 판정. ★ 비활성 계정은 직책이 있어도 false 입니다 — 퇴사자의 승인 권한이 남으면 안 됩니다';


--
-- Name: import_target_table(text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.import_target_table(p_type text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case p_type when 'usage_history' then 'usage_history' when 'inventory' then 'inventory' when 'item_master' then 'item_master' when 'supplier_master' then 'supplier_master' when 'purchase_order' then 'purchase_order' when 'goods_receipt' then 'goods_receipt' when 'sales_order' then 'sales_order' when 'business_event' then 'business_event' end;
$$;


--
-- Name: insert_sales_order(uuid, text, text, text, jsonb, uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.insert_sales_order(p_actor uuid, p_customer_id text, p_customer_name text, p_note text, p_lines jsonb, p_replaces_order_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $_$
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
$_$;


--
-- Name: is_active_user(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.is_active_user(check_user_id uuid DEFAULT auth.uid()) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'core', 'pg_temp'
    AS $$
  select exists (
    select 1
      from core.app_user
     where user_id = check_user_id
       and active = true
  );
$$;


--
-- Name: is_admin(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.is_admin(check_user_id uuid DEFAULT auth.uid()) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'core', 'pg_temp'
    AS $$
  select exists (
    select 1
      from core.app_user
     where user_id = check_user_id
       and role = 'ADMIN'
       and active = true
  );
$$;


--
-- Name: is_business_day(date, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.is_business_day(p_date date, p_country text DEFAULT 'KR'::text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select coalesce(
    (select c.is_business_day
       from core.business_calendar c
      where c.country_code = p_country and c.calendar_date = p_date),
    extract(isodow from p_date) between 1 and 5
  );
$$;


--
-- Name: is_valid_forecast_window(date, date, date, date, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.is_valid_forecast_window(p_train_start date, p_train_end date, p_test_start date, p_test_end date, p_granularity text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
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


--
-- Name: item_committed_qty(text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.item_committed_qty(p_item_id text) RETURNS numeric
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
  select coalesce(sum(a.qty), 0)
    from core.stock_allocation a
   where a.item_id = p_item_id
     and a.status in ('TEMPORARY', 'APPROVAL_HOLD', 'FIRM');
$$;


--
-- Name: item_visibility_scope(text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.item_visibility_scope(p_item_id text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
  select coalesce(
    (select ivr.visibility_scope
       from core.v_item_master im
       join core.item_visibility_rule ivr on ivr.raw_item_type = im.item_type
      where im.item_id = p_item_id
      limit 1),
    'GENERAL'
  );
$$;


--
-- Name: list_manual_allocation_candidates(text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.list_manual_allocation_candidates(p_item_id text) RETURNS TABLE(queue_rank bigint, order_id uuid, order_no text, line_id bigint, customer_name text, owner_name text, allocation_priority integer, first_review_requested_at timestamp with time zone, shortage_qty numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: FUNCTION list_manual_allocation_candidates(p_item_id text); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.list_manual_allocation_candidates(p_item_id text) IS 'Task 6 · MANUAL 품목의 대기 순번 후보만 보여준다(계산·쓰기 없음). SCM 품목담당자(ALLOC_MANUAL)만 조회';


--
-- Name: lock_order_pending_approvals(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.lock_order_pending_approvals(p_order_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_approval_id uuid;
  v_count integer := 0;
begin
  for v_approval_id in
    select r.approval_id
      from core.approval_request r
     where r.status = 'PENDING'
       and r.approval_id in (
         select a.approval_id
           from core.stock_allocation a
          where a.order_id = p_order_id
            and a.approval_id is not null
            and a.status in ('TEMPORARY', 'APPROVAL_HOLD', 'FIRM')
       )
     order by r.approval_id
       for update
  loop
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;


--
-- Name: FUNCTION lock_order_pending_approvals(p_order_id uuid); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.lock_order_pending_approvals(p_order_id uuid) IS 'Task 5(2026-09-12 최종 fix) — 취소 경로가 재고 · 주문 행을 잡기 전에 그 주문의 대기 중 승인 요청을 먼저 잠근다. core.decide_approval과 같은 잠금 순서를 만들어 동시 승인 · 취소 교착(40P01)을 없앤다';


--
-- Name: lock_stock_balance_items(text[], boolean); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.lock_stock_balance_items(p_item_ids text[], p_require_all boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: log_sales_order_event(uuid, text, text, text, uuid, text, jsonb); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.log_sales_order_event(p_order_id uuid, p_event_type text, p_previous_status text, p_next_status text, p_actor uuid, p_reason text DEFAULT NULL::text, p_payload jsonb DEFAULT '{}'::jsonb) RETURNS bigint
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
  insert into core.sales_order_event (
    order_id, event_type, previous_status, next_status, actor, actor_name, reason, payload
  ) values (
    p_order_id, p_event_type, p_previous_status, p_next_status,
    p_actor, core.order_actor_name(p_actor), nullif(btrim(p_reason), ''), coalesce(p_payload, '{}'::jsonb)
  )
  returning event_id;
$$;


--
-- Name: mark_login(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.mark_login() RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'core', 'pg_temp'
    AS $$
  update core.app_user
     set last_login_at = now(), updated_at = now()
   where user_id = auth.uid()
     and active = true;
$$;


--
-- Name: mark_notification_read(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.mark_notification_read(p_notification_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  update core.user_notification
     set read_at = coalesce(read_at, clock_timestamp())
   where notification_id = p_notification_id
     and recipient_user_id = auth.uid();
  if not found then
    raise exception '읽을 알림을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
end;
$$;


--
-- Name: my_permissions(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.my_permissions(p_user uuid DEFAULT auth.uid()) RETURNS TABLE(permission_code text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
  select rp.permission_code
    from core.app_user u
    join core.role_permission rp on rp.job_role = u.job_role
   where u.user_id = p_user and u.active
   order by rp.permission_code;
$$;


--
-- Name: normalize_item_id(text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.normalize_item_id(p_item_id text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'core', 'pg_temp'
    AS $$
  select upper(regexp_replace(coalesce(p_item_id, ''), '[\s\-_]', '', 'g'));
$$;


--
-- Name: notify_manual_allocation_needed(text, bigint, numeric); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.notify_manual_allocation_needed(p_item_id text, p_receipt_id bigint, p_qty numeric) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: FUNCTION notify_manual_allocation_needed(p_item_id text, p_receipt_id bigint, p_qty numeric); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.notify_manual_allocation_needed(p_item_id text, p_receipt_id bigint, p_qty numeric) IS 'Task 6 · MANUAL 품목은 자동 배정하지 않는다. core.commit_import_batch만 호출하는 내부 함수다';


--
-- Name: open_planning_cycle(date); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.open_planning_cycle(p_plan_month date) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_month date;
  v_cycle_id uuid;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 취합 주기를 열 수 있습니다.' using errcode = '42501';
  end if;
  if not (core.has_permission('PLAN_CONFIRM', v_actor) or core.is_admin(v_actor)) then
    raise exception 'SCM 품목담당자 또는 관리자만 취합 주기를 열 수 있습니다.' using errcode = '42501';
  end if;
  if p_plan_month is null then
    raise exception '기준월은 필수입니다.' using errcode = '22023';
  end if;

  v_month := date_trunc('month', p_plan_month)::date;

  if exists (select 1 from core.planning_cycle where plan_month = v_month and is_active) then
    raise exception '이미 해당 월의 취합 주기가 열려 있습니다.' using errcode = '22023';
  end if;

  insert into core.planning_cycle (plan_month, submission_deadline, opened_by)
  values (v_month, core.submission_deadline(v_month), v_actor)
  returning cycle_id into v_cycle_id;

  return v_cycle_id;
end;
$$;


--
-- Name: order_actor_name(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.order_actor_name(p_user uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: previous_business_day(date, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.previous_business_day(p_date date, p_country text DEFAULT 'KR'::text) RETURNS date
    LANGUAGE plpgsql STABLE
    AS $$
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


--
-- Name: procurement_forecast_source_status(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.procurement_forecast_source_status(p_run_id uuid) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'core', 'analytics', 'public', 'pg_temp'
    AS $$
declare
  -- analytics.v_forecast_run은 select r.*로 만들어져 3b에서 덧붙인 지문 열이 없다 — 원본 표를 읽는다
  v_run core.forecast_run%rowtype;
  v_train_start date;
  v_train_end date;
  v_test_start date;
  v_test_end date;
  v_train_print record;
  v_test_print record;
begin
  if p_run_id is null then
    return 'FORECAST_SOURCE_UNVERIFIED';
  end if;

  select * into v_run from core.forecast_run where run_id = p_run_id;
  if not found or v_run.status <> 'SUCCESS' or v_run.granularity is distinct from 'MONTH' then
    return 'FORECAST_SOURCE_UNVERIFIED';
  end if;

  select s.train_start, s.train_end, s.test_start, s.test_end into v_train_start, v_train_end, v_test_start, v_test_end
    from core.forecast_setting s
   where s.active and core.is_valid_forecast_window(s.train_start, s.train_end, s.test_start, s.test_end, s.granularity)
   order by s.updated_at desc
   limit 1;
  if v_train_start is distinct from v_run.train_start or v_train_end is distinct from v_run.train_end then
    return 'FORECAST_WINDOW_CHANGED';
  end if;

  -- 이 실행의 Champion(품목별 최신 선정)을 채점한 Backtest의 검증 기간이 지금 core.v_test_actual의 기간과 같아야
  -- 아래 출처 확인이 "채점에 쓴 Actual"을 본다
  if exists (
    select 1
      from analytics.v_champion_model c
      join core.backtest_run br on br.backtest_run_id = c.backtest_run_id
     where br.forecast_run_id = p_run_id
       and (br.test_start is distinct from v_test_start or br.test_end is distinct from v_test_end)
  ) then
    return 'FORECAST_WINDOW_CHANGED';
  end if;

  -- 학습 행과 Champion 채점에 쓴 test 기간 행 모두 검증된 적재 배치 출처여야 한다(pre-review fix)
  if not exists (select 1 from core.v_train_demand)
     or exists (
       select 1
         from (
           select tr.batch_id, tr.source_type from core.v_train_demand tr
           union all
           select te.batch_id, te.source_type from core.v_test_actual te
         ) t
         left join core.upload_batch b on b.batch_id = t.batch_id
        where b.batch_id is null
           or b.status <> 'IMPORTED'
           or b.import_type <> 'usage_history'
           or t.source_type is distinct from 'FILE_UPLOAD'
     ) then
    return 'FORECAST_SOURCE_UNVERIFIED';
  end if;

  -- ④ 입력 지문(fix round 1) — 지금 남은 행이 아니라 실행 · 채점이 실제로 쓴 행과 같은지 확인한다.
  --   STEP 6 is_stale은 보지 않는다(무관한 수주 · 이벤트 적재로도 켜진다) — 사용 이력 변경은 지문이 잡는다.
  if v_run.train_input_md5 is null
     or exists (
       select 1
         from analytics.v_champion_model c
         join core.backtest_run br on br.backtest_run_id = c.backtest_run_id
        where br.forecast_run_id = p_run_id and br.test_input_md5 is null
     ) then
    return 'FORECAST_INPUT_UNTRACED';
  end if;

  select * into v_train_print from core.usage_input_fingerprint('TRAIN');
  if (v_train_print.row_count, v_train_print.qty_sum, v_train_print.max_loaded_at, v_train_print.input_md5)
     is distinct from
     (v_run.train_input_row_count, v_run.train_input_qty_sum, v_run.train_input_max_loaded_at, v_run.train_input_md5) then
    return 'FORECAST_INPUT_CHANGED';
  end if;

  select * into v_test_print from core.usage_input_fingerprint('TEST');
  if exists (
    select 1
      from analytics.v_champion_model c
      join core.backtest_run br on br.backtest_run_id = c.backtest_run_id
     where br.forecast_run_id = p_run_id
       and (br.test_input_row_count, br.test_input_qty_sum, br.test_input_max_loaded_at, br.test_input_md5)
           is distinct from
           (v_test_print.row_count, v_test_print.qty_sum, v_test_print.max_loaded_at, v_test_print.input_md5)
  ) then
    return 'FORECAST_INPUT_CHANGED';
  end if;

  return 'VERIFIED';
end;
$$;


--
-- Name: FUNCTION procurement_forecast_source_status(p_run_id uuid); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.procurement_forecast_source_status(p_run_id uuid) IS 'Task 9b 원천 게이트 — VERIFIED · FORECAST_SOURCE_UNVERIFIED · FORECAST_WINDOW_CHANGED · FORECAST_INPUT_UNTRACED · FORECAST_INPUT_CHANGED';


--
-- Name: protect_self_admin_change(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.protect_self_admin_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'core', 'pg_temp'
    AS $$
begin
  if auth.uid() = old.user_id and old.role = 'ADMIN' and new.role <> 'ADMIN' then
    raise exception '자신의 관리자 권한은 제거할 수 없습니다.' using errcode = '42501';
  end if;
  if auth.uid() = old.user_id and old.active = true and new.active = false then
    raise exception '자신의 계정은 비활성화할 수 없습니다.' using errcode = '42501';
  end if;
  return new;
end;
$$;


--
-- Name: raise_demand_submission_reminders(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.raise_demand_submission_reminders() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_cycle record;
  v_department text;
  v_first_at timestamptz;
  v_series_id text;
  v_recipients uuid[];
  v_count integer := 0;
begin
  for v_cycle in
    select cycle_id, plan_month, submission_deadline
      from core.planning_cycle
     where is_active
       and (clock_timestamp() at time zone 'Asia/Seoul')::date > submission_deadline
  loop
    -- date를 timestamptz로 바로 "at time zone"하면 세션 timezone GUC를 거쳐 먼저
    -- timestamptz로 캐스팅된 뒤 다시 변환되어, 세션 timezone에 따라 결과가 달라지는 버그가
    -- 난다(Supabase 기본 UTC 세션에서 18시간까지 밀림). date를 먼저 명시적으로 timestamp로
    -- 캐스팅해 "Asia/Seoul 벽시계 자정"으로 한 번만 해석해야 세션 timezone과 무관하다.
    v_first_at := (v_cycle.submission_deadline + 1)::timestamp at time zone 'Asia/Seoul';

    -- 필수 제출 부서 = DEMAND_SUBMIT 권한을 가진 활성 사용자가 있는 부서(컨트롤러 판정 2).
    for v_department in
      select distinct u.department
        from core.app_user u
        join core.role_permission rp on rp.job_role = u.job_role
       where u.active and rp.permission_code = 'DEMAND_SUBMIT' and u.department is not null
    loop
      if not exists (
        select 1 from core.demand_submission s
         where s.cycle_id = v_cycle.cycle_id
           and s.department = v_department
           and s.status in ('SUBMITTED', 'AGREED')
      ) then
        v_series_id := v_cycle.cycle_id::text || ':' || v_department;
        select array_agg(u.user_id) into v_recipients
          from core.app_user u
          join core.role_permission rp on rp.job_role = u.job_role
         where u.active and u.department = v_department and rp.permission_code = 'DEMAND_SUBMIT';
        if coalesce(array_length(v_recipients, 1), 0) > 0 then
          v_count := v_count + core.schedule_demand_submission_reminder(v_series_id, v_first_at, v_recipients);
        end if;
      end if;
    end loop;
  end loop;
  return v_count;
end;
$$;


--
-- Name: recompute_stock_balance_totals(text[]); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.recompute_stock_balance_totals(p_item_ids text[]) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
  update core.stock_balance sb
     set normal_qty = sb.snapshot_qty + coalesce((
           select sum(l.qty)
             from core.stock_receipt_ledger l
            where l.item_id = sb.item_id
              and l.completed_at > coalesce(sb.snapshot_at, '-infinity'::timestamptz)
         ), 0),
         updated_at = now()
   where sb.item_id = any(p_item_ids);
$$;


--
-- Name: FUNCTION recompute_stock_balance_totals(p_item_ids text[]); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.recompute_stock_balance_totals(p_item_ids text[]) IS '내부 전용. snapshot_qty + 완료 입고 합으로 normal_qty를 다시 계산한다. 새 스냅샷이나
   새 완료 입고가 반영된 직후 영향받은 item_id 목록으로 호출한다';


--
-- Name: record_actual_receipt_date(uuid, date, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.record_actual_receipt_date(p_schedule_id uuid, p_actual_receipt_date date, p_note text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: FUNCTION record_actual_receipt_date(p_schedule_id uuid, p_actual_receipt_date date, p_note text); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.record_actual_receipt_date(p_schedule_id uuid, p_actual_receipt_date date, p_note text) IS 'Task 10b — PLAN_CONFIRM. 실제 입고일을 입력 · 수정한다(null이면 지운다). 계산된(SCHEDULED) 일정에만 입력할 수 있다. 입고 실적에 자동 매칭하지 않는다. actor · 시각은 core.audit_log에 append-only로 남는다';


--
-- Name: record_backtest_run_input_fingerprint(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.record_backtest_run_input_fingerprint() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'pg_temp'
    AS $$
begin
  if new.status = 'SUCCESS' and new.test_input_md5 is null and (tg_op = 'INSERT' or old.status is distinct from 'SUCCESS') then
    select f.row_count, f.qty_sum, f.max_loaded_at, f.input_md5
      into new.test_input_row_count, new.test_input_qty_sum, new.test_input_max_loaded_at, new.test_input_md5
      from core.usage_input_fingerprint('TEST') f;
    new.test_input_fingerprinted_at := clock_timestamp();
  end if;
  return new;
end;
$$;


--
-- Name: record_forecast_run_input_fingerprint(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.record_forecast_run_input_fingerprint() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'pg_temp'
    AS $$
begin
  if new.status = 'SUCCESS' and new.train_input_md5 is null and (tg_op = 'INSERT' or old.status is distinct from 'SUCCESS') then
    select f.row_count, f.qty_sum, f.max_loaded_at, f.input_md5
      into new.train_input_row_count, new.train_input_qty_sum, new.train_input_max_loaded_at, new.train_input_md5
      from core.usage_input_fingerprint('TRAIN') f;
    new.train_input_fingerprinted_at := clock_timestamp();
  end if;
  return new;
end;
$$;


--
-- Name: refresh_sales_order_line_totals(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.refresh_sales_order_line_totals(p_order_id uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: refresh_stock_balance(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.refresh_stock_balance(p_batch_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_batch core.upload_batch%rowtype;
  v_stock_count integer;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 재고 배치를 반영할 수 있습니다.' using errcode = '42501';
  end if;

  if not (core.has_permission('STOCK_VIEW_ALL', v_actor) or core.is_admin(v_actor)) then
    raise exception '정상 창고재고 반영 권한이 없습니다.' using errcode = '42501';
  end if;

  select * into v_batch from core.upload_batch where batch_id = p_batch_id;
  if not found then
    raise exception '재고 배치를 찾을 수 없습니다: %', p_batch_id using errcode = 'P0002';
  end if;
  if v_batch.import_type <> 'inventory' then
    raise exception 'inventory 배치만 정상 창고재고에 반영할 수 있습니다.' using errcode = '22023';
  end if;
  if v_batch.status not in ('VALIDATED', 'IMPORTED') then
    raise exception '검증 완료된 배치만 반영할 수 있습니다. 현재 상태: %', v_batch.status using errcode = '22023';
  end if;

  v_stock_count := core.apply_stock_balance_from_batch(p_batch_id);
  -- Task 12 — 같은 배치를 수동으로 다시 반영할 때도 월말 스냅샷을 함께 갱신한다(분류 규칙을
  -- 나중에 고친 뒤 재반영하는 경우 등). 반환값은 이전과 같은 계약(정상 창고재고 갱신 건수)을
  -- 유지한다 — 이 값을 읽는 화면이 아직 없지만 계약을 바꾸지 않는다.
  perform core.apply_month_end_inventory_snapshot_from_batch(p_batch_id);
  return v_stock_count;
end;
$$;


--
-- Name: FUNCTION refresh_stock_balance(p_batch_id uuid); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.refresh_stock_balance(p_batch_id uuid) IS 'SCM 담당자가 수동으로 다시 반영할 때 쓴다. 정상 경로는 core.commit_import_batch가 커밋 직후 자동으로 반영을 호출하므로 보통 다시 호출할 필요가 없다(분류 규칙을 나중에 고쳤을 때 재반영하는 용도). Task 12 — 정상 창고재고(core.stock_balance)와 월말 스냅샷(core.month_end_inventory_snapshot)을 함께 다시 계산한다';


--
-- Name: reject_approval_event_mutation(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.reject_approval_event_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'core', 'pg_temp'
    AS $$
begin
  raise exception '승인 이벤트 이력은 수정하거나 삭제할 수 없습니다.' using errcode = '42501';
end;
$$;


--
-- Name: reject_demand_submission_event_mutation(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.reject_demand_submission_event_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'core', 'pg_temp'
    AS $$
begin
  raise exception '수요 제출 이력은 수정하거나 삭제할 수 없습니다.' using errcode = '42501';
end;
$$;


--
-- Name: reject_order_history_mutation(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.reject_order_history_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'core', 'pg_temp'
    AS $$
begin
  raise exception '주문 · 배정 이력은 수정하거나 삭제할 수 없습니다.' using errcode = '42501';
end;
$$;


--
-- Name: reject_procurement_plan_event_mutation(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.reject_procurement_plan_event_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'core', 'pg_temp'
    AS $$
begin
  raise exception '발주계획 이력은 수정하거나 삭제할 수 없습니다.' using errcode = '42501';
end;
$$;


--
-- Name: reject_supply_meeting_result_event_mutation(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.reject_supply_meeting_result_event_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'core', 'pg_temp'
    AS $$
begin
  raise exception '수급회의 결과 이력은 수정하거나 삭제할 수 없습니다.' using errcode = '42501';
end;
$$;


--
-- Name: release_order_allocations(uuid, uuid, text, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.release_order_allocations(p_order_id uuid, p_actor uuid, p_reason text, p_cause text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: remove_business_holiday(text, date, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.remove_business_holiday(p_country_code text, p_calendar_date date, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: FUNCTION remove_business_holiday(p_country_code text, p_calendar_date date, p_reason text); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.remove_business_holiday(p_country_code text, p_calendar_date date, p_reason text) IS 'Task 10a — ADMIN 전용. 등록된 공휴일을 지운다(행 삭제 — 평일이면 다시 영업일로 판정된다). 영업일로 강제 지정된 주말 등 공휴일이 아닌 행은 지우지 않는다';


--
-- Name: request_approval(text, text, text, jsonb, text, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.request_approval(p_approval_type text, p_target_type text, p_target_id text, p_payload jsonb DEFAULT '{}'::jsonb, p_reason_code text DEFAULT NULL::text, p_reason_text text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_required_permission text;
  v_approval_id uuid;
  v_after jsonb;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 승인 요청을 만들 수 있습니다.' using errcode = '42501';
  end if;

  if p_approval_type is null or p_approval_type not in (
    'ITEM_POLICY', 'ALLOC_PRIORITY', 'EVENT_ORDER', 'PURCHASE_PLAN'
  ) then
    raise exception '지원하지 않는 승인 유형입니다.' using errcode = '22023';
  end if;

  v_required_permission := case p_approval_type
    when 'ITEM_POLICY' then 'ITEM_POLICY_EDIT'
    when 'ALLOC_PRIORITY' then 'ALLOC_MANUAL'
    when 'EVENT_ORDER' then 'DEMAND_CONSOLIDATE'
    when 'PURCHASE_PLAN' then 'PLAN_CONFIRM'
  end;

  if v_required_permission is null or not core.has_permission(v_required_permission, v_actor) then
    raise exception '이 승인 유형을 요청할 업무 권한이 없습니다.' using errcode = '42501';
  end if;

  select coalesce(nullif(btrim(u.name), ''), nullif(btrim(u.email), ''), u.user_id::text)
    into v_actor_name
    from core.app_user u
   where u.user_id = v_actor;

  if nullif(btrim(p_target_type), '') is null or nullif(btrim(p_target_id), '') is null then
    raise exception '승인 대상 유형과 대상 ID는 필수입니다.' using errcode = '22023';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception '승인 요청 payload는 JSON 객체여야 합니다.' using errcode = '22023';
  end if;

  if p_approval_type = 'EVENT_ORDER' then
    if nullif(btrim(p_payload ->> 'customer'), '') is null then
      raise exception '이벤트 추가 수요의 고객은 필수입니다.' using errcode = '22023';
    end if;
    if nullif(btrim(p_payload ->> 'model'), '') is null then
      raise exception '이벤트 추가 수요의 기종은 필수입니다.' using errcode = '22023';
    end if;
    if jsonb_typeof(p_payload -> 'quantity') is distinct from 'number' then
      raise exception '이벤트 추가 수요의 수량은 양수여야 합니다.' using errcode = '22023';
    end if;
    if (p_payload ->> 'quantity')::numeric <= 0 then
      raise exception '이벤트 추가 수요의 수량은 양수여야 합니다.' using errcode = '22023';
    end if;
  end if;

  insert into core.approval_request (
    approval_type, target_type, target_id, payload,
    reason_code, reason_text, requested_by, requester_name
  ) values (
    p_approval_type, btrim(p_target_type), btrim(p_target_id), p_payload,
    nullif(btrim(p_reason_code), ''), nullif(btrim(p_reason_text), ''), v_actor, v_actor_name
  )
  returning approval_id into v_approval_id;

  select to_jsonb(r) into v_after
    from core.approval_request r
   where r.approval_id = v_approval_id;

  insert into core.approval_event (
    approval_id, event_type, previous_status, next_status,
    actor, comment, payload_snapshot
  ) values (
    v_approval_id, 'REQUESTED', null, 'PENDING',
    v_actor, nullif(btrim(p_reason_text), ''), v_after
  );

  insert into core.audit_log (actor, action, target_type, target_id, before, after)
  values (v_actor, 'APPROVAL_REQUESTED', 'APPROVAL_REQUEST', v_approval_id::text, null, v_after);

  return v_approval_id;
end;
$$;


--
-- Name: request_event_demand(date, text, text, numeric, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.request_event_demand(p_plan_month date, p_item_id text, p_customer_name text, p_qty numeric, p_reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: FUNCTION request_event_demand(p_plan_month date, p_item_id text, p_customer_name text, p_qty numeric, p_reason text); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.request_event_demand(p_plan_month date, p_item_id text, p_customer_name text, p_qty numeric, p_reason text) IS 'Task 8 — 이벤트성 추가 수요 등록(DEMAND_CONSOLIDATE). 행을 먼저 만들어 target_id로 쓰고, Task 2 core.request_approval(EVENT_ORDER)로 SCM팀장 승인을 요청한 뒤 승인ID를 연결한다(Task 5 ALLOC_PRIORITY와 같은 방식)';


--
-- Name: request_item_policy_change(text, numeric, text, numeric, numeric, numeric, numeric, numeric, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.request_item_policy_change(p_item_id text, p_target_dos_days numeric, p_allocation_mode text, p_target_stock_qty numeric, p_unit_price numeric, p_moq numeric, p_pack_size numeric, p_min_order_amount numeric, p_reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_policy core.item_policy%rowtype;
  v_revision_id uuid;
  v_approval_id uuid;
  v_payload jsonb;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 품목 정책 변경을 요청할 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('ITEM_POLICY_EDIT', v_actor) then
    raise exception '품목 정책 변경 요청 권한이 없습니다.' using errcode = '42501';
  end if;

  if nullif(btrim(p_item_id), '') is null then
    raise exception '품목코드는 필수입니다.' using errcode = '22023';
  end if;
  if p_allocation_mode is null or p_allocation_mode not in ('AUTO', 'MANUAL') then
    raise exception '배정 방식은 AUTO 또는 MANUAL이어야 합니다.' using errcode = '22023';
  end if;
  if p_target_dos_days is not null and p_target_dos_days <= 0 then
    raise exception '목표 DoS 일수는 0보다 커야 합니다.' using errcode = '22023';
  end if;
  if p_target_stock_qty is not null and p_target_stock_qty < 0 then
    raise exception '목표 재고는 0 이상이어야 합니다.' using errcode = '22023';
  end if;
  if p_unit_price is not null and p_unit_price < 0 then
    raise exception '단가는 0 이상이어야 합니다.' using errcode = '22023';
  end if;
  if p_moq is not null and p_moq <= 0 then
    raise exception '최소주문수량은 0보다 커야 합니다.' using errcode = '22023';
  end if;
  if p_pack_size is not null and p_pack_size <= 0 then
    raise exception '포장단위는 0보다 커야 합니다.' using errcode = '22023';
  end if;
  if p_min_order_amount is not null and p_min_order_amount < 0 then
    raise exception '최소주문금액은 0 이상이어야 합니다.' using errcode = '22023';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception '변경 사유는 필수입니다.' using errcode = '22023';
  end if;

  -- 같은 품목의 동시 요청을 직렬화한다 — 아래 "대기 중 변경안 존재" 확인이 경쟁 상태 없이 유효하다.
  select * into v_policy from core.item_policy where item_id = btrim(p_item_id) for update;
  if not found then
    raise exception '품목 정책을 찾을 수 없습니다: %', p_item_id using errcode = 'P0002';
  end if;

  if exists (
    select 1 from core.item_policy_revision r
     where r.item_id = v_policy.item_id and r.status = 'PENDING'
  ) then
    raise exception '이미 처리 대기 중인 품목 정책 변경안이 있습니다.' using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(u.name), ''), nullif(btrim(u.email), ''), u.user_id::text)
    into v_actor_name
    from core.app_user u where u.user_id = v_actor;

  insert into core.item_policy_revision (
    item_id,
    proposed_target_dos_days, proposed_allocation_mode, proposed_target_stock_qty,
    proposed_unit_price, proposed_moq, proposed_pack_size, proposed_min_order_amount,
    previous_target_dos_days, previous_allocation_mode, previous_target_stock_qty,
    previous_unit_price, previous_moq, previous_pack_size, previous_min_order_amount,
    reason, requested_by, requester_name
  ) values (
    v_policy.item_id,
    p_target_dos_days, p_allocation_mode, p_target_stock_qty,
    p_unit_price, p_moq, p_pack_size, p_min_order_amount,
    v_policy.target_dos_days, v_policy.allocation_mode, v_policy.target_stock_qty,
    v_policy.unit_price, v_policy.moq, v_policy.pack_size, v_policy.min_order_amount,
    btrim(p_reason), v_actor, v_actor_name
  )
  returning revision_id into v_revision_id;

  v_payload := jsonb_build_object(
    'revision_id', v_revision_id, 'item_id', v_policy.item_id,
    'proposed_target_dos_days', p_target_dos_days, 'proposed_allocation_mode', p_allocation_mode,
    'proposed_target_stock_qty', p_target_stock_qty, 'proposed_unit_price', p_unit_price,
    'proposed_moq', p_moq, 'proposed_pack_size', p_pack_size, 'proposed_min_order_amount', p_min_order_amount,
    'previous_target_dos_days', v_policy.target_dos_days, 'previous_allocation_mode', v_policy.allocation_mode
  );

  -- Task 2 공통 승인 엔진(요청자 ≠ 승인자, ITEM_POLICY_APPROVE 권한을 core.decide_approval이 다시 확인한다)
  v_approval_id := core.request_approval(
    'ITEM_POLICY', 'ITEM_POLICY_REVISION', v_revision_id::text, v_payload, 'ITEM_POLICY_CHANGE', btrim(p_reason)
  );

  update core.item_policy_revision set approval_id = v_approval_id where revision_id = v_revision_id;

  return v_revision_id;
end;
$$;


--
-- Name: FUNCTION request_item_policy_change(p_item_id text, p_target_dos_days numeric, p_allocation_mode text, p_target_stock_qty numeric, p_unit_price numeric, p_moq numeric, p_pack_size numeric, p_min_order_amount numeric, p_reason text); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.request_item_policy_change(p_item_id text, p_target_dos_days numeric, p_allocation_mode text, p_target_stock_qty numeric, p_unit_price numeric, p_moq numeric, p_pack_size numeric, p_min_order_amount numeric, p_reason text) IS 'Task 9a — 품목 정책 변경안 제출(ITEM_POLICY_EDIT). 행을 먼저 만들어 target_id로 쓰고, Task 2 core.request_approval(ITEM_POLICY)로 SCM팀장 승인을 요청한 뒤 승인ID를 연결한다(Task 5 ALLOC_PRIORITY · Task 8 EVENT_ORDER와 같은 방식)';


--
-- Name: request_manual_allocation(uuid, text, numeric, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.request_manual_allocation(p_order_id uuid, p_item_id text, p_qty numeric, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: request_order_review(uuid, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.request_order_review(p_order_id uuid, p_choice text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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
  -- 만료 시각이 이미 기록된 주문에는 새 임시배정을 만들지 않는다(DRAFT는 check 제약상 만료가 비어 있지만 방어한다).
  if v_order.temporary_expires_at is not null and clock_timestamp() >= v_order.temporary_expires_at then
    raise exception 'TEMPORARY_ALLOCATION_EXPIRED: 임시배정 만료 시각(%)이 지난 주문입니다. 새 주문으로 재등록합니다.',
      v_order.temporary_expires_at using errcode = '55000';
  end if;
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


--
-- Name: rollback_import_batch(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.rollback_import_batch(p_batch_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'raw', 'pg_temp'
    AS $_$
declare b core.upload_batch%rowtype; table_name text; r record;
begin
  if not core.is_admin() then raise exception '관리자 권한이 필요합니다.' using errcode='42501'; end if;
  select * into b from core.upload_batch where batch_id=p_batch_id for update; if not found or b.status <> 'IMPORTED' then raise exception '적재 완료 batch만 rollback할 수 있습니다.'; end if;
  table_name:=core.import_target_table(b.import_type); execute format('delete from raw.%I where batch_id=$1',table_name) using p_batch_id;
  for r in select row_data from core.import_row_backup where batch_id=p_batch_id order by backup_id loop execute format('insert into raw.%I select * from jsonb_populate_record(null::raw.%I,$1)',table_name,table_name) using r.row_data; end loop;
  update core.upload_batch set status='ROLLED_BACK',rolled_back_at=now() where batch_id=p_batch_id;
end; $_$;


--
-- Name: run_backtest(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.run_backtest(p_forecast_run_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'analytics', 'pg_temp'
    AS $$
declare v_backtest_id uuid := gen_random_uuid(); v_started timestamptz := clock_timestamp();
  v_test_start date; v_test_end date; v_metric text; v_reference text; v_actor uuid := auth.uid();
begin
  if not core.is_admin() then raise exception '관리자 권한이 필요합니다.' using errcode = '42501'; end if;
  insert into core.backtest_run(backtest_run_id, forecast_run_id, metric, status, started_at, triggered_by)
  values(v_backtest_id, p_forecast_run_id, 'WAPE', 'RUNNING', v_started, v_actor);
  begin
    if not exists(select 1 from core.forecast_run where run_id=p_forecast_run_id and status='SUCCESS') then raise exception 'SUCCESS Forecast Run만 Backtest할 수 있습니다.'; end if;
    select test_start,test_end,champion_metric,reference_model_id into v_test_start,v_test_end,v_metric,v_reference
    from core.forecast_setting where active and core.is_valid_forecast_window(train_start,train_end,test_start,test_end,granularity) order by updated_at desc limit 1;
    if v_test_start is null then raise exception '유효한 검증 기간 설정이 필요합니다.'; end if;
    update core.backtest_run set test_start=v_test_start,test_end=v_test_end,metric=v_metric,reference_model_id=v_reference where backtest_run_id=v_backtest_id;

    insert into core.model_performance(backtest_run_id,forecast_run_id,model_id,model_version,item_id,n_periods,wape,mape,bias,rmse,mae,calculation_status,reason_code)
    with actual as (
      select item_id,date_trunc('month',use_date)::date as period,sum(qty) as actual_qty,count(qty) as n_qty
      from core.v_test_actual group by item_id,date_trunc('month',use_date)::date
    ), candidates as (
      select distinct f.model_id,f.model_version,f.item_id from core.forecast_result f where f.run_id=p_forecast_run_id
    ), paired as (
      select f.model_id,f.model_version,f.item_id,f.period,f.predicted_qty,
        case when a.item_id is null then null when a.n_qty=0 then null else a.actual_qty end as actual_qty
      from core.forecast_result f left join actual a on a.item_id=f.item_id and a.period=f.period
      where f.run_id=p_forecast_run_id and f.period between v_test_start and v_test_end
    ), grouped as (
      select c.model_id,c.model_version,c.item_id,count(*) filter(where p.predicted_qty is not null and p.actual_qty is not null)::integer as n_periods,
        sum(abs(p.predicted_qty-p.actual_qty)) filter(where p.predicted_qty is not null and p.actual_qty is not null) as abs_error_sum,
        sum(abs(p.actual_qty)) filter(where p.predicted_qty is not null and p.actual_qty is not null) as abs_actual_sum,
        count(*) filter(where p.predicted_qty is not null and p.actual_qty is not null and p.actual_qty<>0) as mape_periods,
        avg(abs((p.predicted_qty-p.actual_qty)/nullif(p.actual_qty,0))) filter(where p.predicted_qty is not null and p.actual_qty<>0) as mape,
        avg(p.predicted_qty-p.actual_qty) filter(where p.predicted_qty is not null and p.actual_qty is not null) as bias,
        sqrt(avg(power(p.predicted_qty-p.actual_qty,2))) filter(where p.predicted_qty is not null and p.actual_qty is not null) as rmse,
        avg(abs(p.predicted_qty-p.actual_qty)) filter(where p.predicted_qty is not null and p.actual_qty is not null) as mae
      from candidates c left join paired p on p.model_id=c.model_id and p.model_version=c.model_version and p.item_id=c.item_id
      group by c.model_id,c.model_version,c.item_id
    )
    select v_backtest_id,p_forecast_run_id,model_id,model_version,item_id,n_periods,
      case when abs_actual_sum=0 then null else abs_error_sum/abs_actual_sum end,mape,bias,rmse,mae,
      case when n_periods=0 then 'UNAVAILABLE' when abs_actual_sum=0 then 'UNAVAILABLE' else 'SUCCESS' end,
      case when n_periods=0 then 'FORECAST_OR_ACTUAL_MISSING' when abs_actual_sum=0 then 'WAPE_ZERO_DENOMINATOR' when mape_periods=0 then 'MAPE_ZERO_DENOMINATOR' else null end
    from grouped;

    update core.model_performance p set baseline_improvement=(ref.wape-p.wape)/nullif(ref.wape,0)
    from core.model_performance ref where p.backtest_run_id=v_backtest_id and ref.backtest_run_id=p.backtest_run_id and ref.item_id=p.item_id and ref.model_id=v_reference and p.wape is not null and ref.wape is not null;
    with ranked as (
      select backtest_run_id,model_id,item_id,row_number() over(partition by item_id order by
        case v_metric when 'WAPE' then wape when 'MAPE' then mape when 'RMSE' then rmse when 'MAE' then mae end asc,
        abs(bias) asc nulls last,rmse asc nulls last,model_id asc) as position
      from core.model_performance where backtest_run_id=v_backtest_id and calculation_status='SUCCESS'
        and (case v_metric when 'WAPE' then wape when 'MAPE' then mape when 'RMSE' then rmse when 'MAE' then mae end) is not null
    ) update core.model_performance p set rank=r.position from ranked r where p.backtest_run_id=r.backtest_run_id and p.model_id=r.model_id and p.item_id=r.item_id;

    insert into core.champion_model_selection(backtest_run_id,item_id,champion_model_id,model_version,champion_metric,champion_metric_value,wape,mape,bias,rmse,mae,candidate_performance,selection_reason,selection_method,selected_by)
    select v_backtest_id,all_items.item_id,winner.model_id,winner.model_version,v_metric,
      case v_metric when 'WAPE' then winner.wape when 'MAPE' then winner.mape when 'RMSE' then winner.rmse when 'MAE' then winner.mae end,
      winner.wape,winner.mape,winner.bias,winner.rmse,winner.mae,
      (select jsonb_agg(jsonb_build_object('model_id',p.model_id,'model_version',p.model_version,'wape',p.wape,'mape',p.mape,'bias',p.bias,'rmse',p.rmse,'mae',p.mae,'rank',p.rank,'reason_code',p.reason_code) order by p.rank nulls last,p.model_id) from core.model_performance p where p.backtest_run_id=v_backtest_id and p.item_id=all_items.item_id),
      case when winner.model_id is null then 'NO_VALID_CANDIDATE' else 'LOWEST_'||v_metric||'_THEN_ABS_BIAS_RMSE_MODEL_ID' end,'AUTO',v_actor
    from (select distinct item_id from core.model_performance where backtest_run_id=v_backtest_id) all_items
    left join core.model_performance winner on winner.backtest_run_id=v_backtest_id and winner.item_id=all_items.item_id and winner.rank=1;
    update core.backtest_run set status='SUCCESS',finished_at=clock_timestamp(),message='Backtest scoring 완료' where backtest_run_id=v_backtest_id;
    return v_backtest_id;
  exception when others then
    update core.backtest_run set status='FAILED',finished_at=clock_timestamp(),message=sqlerrm where backtest_run_id=v_backtest_id;
    return v_backtest_id;
  end;
end; $$;


--
-- Name: run_baseline_forecast(text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.run_baseline_forecast(p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'analytics', 'pg_temp'
    AS $$
declare
  v_run_id uuid := gen_random_uuid();
  v_started_at timestamptz := clock_timestamp();
  v_train_start date;
  v_train_end date;
  v_granularity text;
  v_horizon integer;
  v_snapshot_at timestamptz;
  v_actor uuid := auth.uid();
  v_email text;
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;

  insert into core.forecast_run (run_id, status, triggered_by, note, started_at)
  values (v_run_id, 'RUNNING', v_actor, p_note, v_started_at);

  begin
  select train_start, train_end, granularity, forecast_horizon
    into v_train_start, v_train_end, v_granularity, v_horizon
  from core.forecast_setting
  where active
    and core.is_valid_forecast_window(train_start, train_end, test_start, test_end, granularity)
  order by updated_at desc
  limit 1;

  if v_train_start is null or v_granularity <> 'MONTH' then
    update core.forecast_run
    set status = 'FAILED', finished_at = clock_timestamp(),
      duration_ms = floor(extract(epoch from clock_timestamp() - v_started_at) * 1000),
      message = '유효한 MONTH granularity 학습 설정이 필요합니다.'
    where run_id = v_run_id;
    return v_run_id;
  end if;

  select email into v_email from core.app_user where user_id = v_actor;
  select max(loaded_at) into v_snapshot_at from core.v_train_demand;

  update core.forecast_run
  set granularity = v_granularity, train_start = v_train_start, train_end = v_train_end,
    horizon = v_horizon, data_snapshot_at = v_snapshot_at, triggered_email = v_email
  where run_id = v_run_id;

  insert into core.model_version (run_id, model_id, version, definition, parameters, created_by)
  select v_run_id, c.model_id, c.version,
    jsonb_build_object('model_name', c.model_name, 'family', c.family, 'engine', c.engine,
      'applicable_demand_type', c.applicable_demand_type, 'parameters', c.parameters, 'description', c.description),
    c.parameters, v_actor
  from core.model_config c
  where c.enabled and c.engine = 'SQL';

  if not exists (select 1 from core.model_version where run_id = v_run_id) then
    update core.forecast_run
    set status = 'FAILED', finished_at = clock_timestamp(),
      duration_ms = floor(extract(epoch from clock_timestamp() - v_started_at) * 1000),
      message = '실행 가능한 SQL 모델이 없습니다.'
    where run_id = v_run_id;
    return v_run_id;
  end if;

  create temp table baseline_models on commit drop as
  select mv.model_version, mv.model_id, mv.parameters,
    array(select jsonb_array_elements_text(mv.definition -> 'applicable_demand_type')) as applicable_demand_type
  from core.model_version mv
  where mv.run_id = v_run_id;

  create temp table baseline_grid on commit drop as
  with periods as (
    select generate_series(date_trunc('month', v_train_start), date_trunc('month', v_train_end), interval '1 month')::date as period
  ), demand as (
    select item_id, date_trunc('month', use_date)::date as period, sum(qty) as qty, count(qty) as n_qty
    from core.v_train_demand
    group by item_id, date_trunc('month', use_date)::date
  )
  select i.item_id, p.period,
    case when d.item_id is null then 0::numeric when d.n_qty = 0 then null::numeric else d.qty end as qty,
    profile.demand_type
  from core.v_item_master i
  cross join periods p
  left join demand d on d.item_id = i.item_id and d.period = p.period
  left join analytics.v_sku_demand_profile profile on profile.item_id = i.item_id;

  create temp table baseline_fitted on commit drop as
  select m.model_version, m.model_id, g.item_id, g.period, g.qty as actual_qty,
    case
      when m.model_id in ('MA_3M', 'MA_6M') then (
        select case when count(*) = (m.parameters ->> 'window')::integer and count(qty) = (m.parameters ->> 'window')::integer then avg(qty) end
        from (select qty from baseline_grid h where h.item_id = g.item_id and h.period < g.period order by h.period desc limit (m.parameters ->> 'window')::integer) history
      )
      when m.model_id = 'WMA_3M' then (
        select case when count(*) = jsonb_array_length(m.parameters -> 'weights') and count(qty) = jsonb_array_length(m.parameters -> 'weights') then
          sum(qty * (m.parameters -> 'weights' ->> ((rn - 1)::integer))::numeric)
          / nullif(sum((m.parameters -> 'weights' ->> ((rn - 1)::integer))::numeric), 0) end
        from (select qty, row_number() over (order by period desc) as rn from baseline_grid h where h.item_id = g.item_id and h.period < g.period order by h.period desc limit jsonb_array_length(m.parameters -> 'weights')) history
      )
      when m.model_id = 'PY_SAME_MONTH' then (select qty from baseline_grid h where h.item_id = g.item_id and h.period = (g.period - make_interval(months => (m.parameters ->> 'lag_months')::integer))::date)
      when m.model_id = 'SEASONAL_NAIVE' then (select qty from baseline_grid h where h.item_id = g.item_id and h.period = (g.period - make_interval(months => (m.parameters ->> 'seasonal_lag_months')::integer))::date)
      else null
    end as fitted_qty
  from baseline_grid g
  join baseline_models m on g.demand_type = any(m.applicable_demand_type);

  create temp table baseline_sigma on commit drop as
  select model_version, model_id, item_id, stddev_samp(actual_qty - fitted_qty) as sigma
  from baseline_fitted
  where actual_qty is not null and fitted_qty is not null
  group by model_version, model_id, item_id;

  create temp table baseline_candidates on commit drop as
  select m.model_version, m.model_id, m.parameters, m.applicable_demand_type,
    i.item_id, i.demand_type, target.period
  from baseline_models m
  join (select distinct item_id, demand_type from baseline_grid) i on i.demand_type = any(m.applicable_demand_type)
  cross join lateral (
    select generate_series(
      date_trunc('month', v_train_end) + interval '1 month',
      date_trunc('month', v_train_end) + make_interval(months => v_horizon),
      interval '1 month'
    )::date as period
  ) target;

  insert into core.forecast_result (run_id, model_id, item_id, period, model_version, predicted_qty, p50, p80, p90, sigma, basis)
  select v_run_id, c.model_id, c.item_id, c.period, c.model_version,
    forecast.predicted_qty, forecast.predicted_qty,
    case when forecast.predicted_qty is null or s.sigma is null then null else forecast.predicted_qty + 0.841621234 * s.sigma end,
    case when forecast.predicted_qty is null or s.sigma is null then null else forecast.predicted_qty + 1.281551566 * s.sigma end,
    s.sigma,
    jsonb_build_object('source', 'TRAIN_ONLY', 'parameters', c.parameters,
      'reason_code', case when forecast.predicted_qty is null then 'INSUFFICIENT_HISTORY' when s.sigma is null then 'SIGMA_UNAVAILABLE' else null end)
  from baseline_candidates c
  left join baseline_sigma s on s.model_version = c.model_version and s.item_id = c.item_id
  cross join lateral (
    select case
      when c.model_id in ('MA_3M', 'MA_6M') then (
        select case when count(*) = (c.parameters ->> 'window')::integer and count(qty) = (c.parameters ->> 'window')::integer then avg(qty) end
        from (select qty from baseline_grid h where h.item_id = c.item_id and h.period <= v_train_end order by h.period desc limit (c.parameters ->> 'window')::integer) history
      )
      when c.model_id = 'WMA_3M' then (
        select case when count(*) = jsonb_array_length(c.parameters -> 'weights') and count(qty) = jsonb_array_length(c.parameters -> 'weights') then
          sum(qty * (c.parameters -> 'weights' ->> ((rn - 1)::integer))::numeric)
          / nullif(sum((c.parameters -> 'weights' ->> ((rn - 1)::integer))::numeric), 0) end
        from (select qty, row_number() over (order by period desc) as rn from baseline_grid h where h.item_id = c.item_id and h.period <= v_train_end order by h.period desc limit jsonb_array_length(c.parameters -> 'weights')) history
      )
      when c.model_id in ('PY_SAME_MONTH', 'SEASONAL_NAIVE') then (
        select qty from baseline_grid h where h.item_id = c.item_id and h.period = (c.period - make_interval(months => (c.parameters ->> (case when c.model_id = 'PY_SAME_MONTH' then 'lag_months' else 'seasonal_lag_months' end))::integer))::date
      )
      else null
    end as predicted_qty
  ) forecast;

  update core.forecast_run r
  set status = 'SUCCESS',
    models = coalesce((select jsonb_agg(jsonb_build_object('model_id', model_id, 'model_version', model_version, 'parameters', parameters) order by model_id) from baseline_models), '[]'::jsonb),
    n_models = (select count(*) from baseline_models),
    n_items = (select count(distinct item_id) from core.forecast_result where run_id = v_run_id and predicted_qty is not null),
    n_rows = (select count(*) from core.forecast_result where run_id = v_run_id),
    finished_at = clock_timestamp(),
    duration_ms = floor(extract(epoch from clock_timestamp() - v_started_at) * 1000),
    message = 'SQL Baseline Forecast 실행 완료'
  where r.run_id = v_run_id;
  return v_run_id;
  exception when others then
    update core.forecast_run
    set status = 'FAILED', finished_at = clock_timestamp(),
      duration_ms = floor(extract(epoch from clock_timestamp() - v_started_at) * 1000),
      message = sqlerrm
    where run_id = v_run_id;
    return v_run_id;
  end;
end;
$$;


--
-- Name: sales_order_notice_recipients(uuid, boolean); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.sales_order_notice_recipients(p_order_id uuid, p_include_planners boolean) RETURNS uuid[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: sales_order_transition_allowed(text, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.sales_order_transition_allowed(p_from text, p_to text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'core', 'pg_temp'
    AS $$
  select case
    when p_from = p_to then true
    when p_from = 'DRAFT' then p_to in ('REVIEW_REQUESTED', 'CANCELLED')
    when p_from in ('REVIEW_REQUESTED', 'PARTIALLY_ALLOCATED', 'WAITING_FULL')
      then p_to in ('REVIEW_REQUESTED', 'PARTIALLY_ALLOCATED', 'WAITING_FULL', 'CONFIRMED', 'EXPIRED', 'CANCELLED')
    when p_from = 'CONFIRMED' then p_to = 'CANCELLED'
    else false
  end;
$$;


--
-- Name: save_demand_submission_lines(uuid, jsonb); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.save_demand_submission_lines(p_submission_id uuid, p_lines jsonb) RETURNS core.demand_submission
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $_$
declare
  v_actor uuid := auth.uid();
  v_department text;
  v_submission core.demand_submission%rowtype;
  v_cycle_id uuid;
  v_cycle_is_active boolean;
  v_line jsonb;
  v_line_no integer := 0;
  v_raw_item text;
  v_raw_qty text;
  v_raw_month text;
  v_item_id text;
  v_qty numeric;
  v_need_month date;
  v_issues jsonb;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 저장할 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('DEMAND_SUBMIT', v_actor) then
    raise exception '부서 수요 제출 권한이 없습니다.' using errcode = '42501';
  end if;

  select department into v_department from core.app_user where user_id = v_actor;

  -- fix round 3 — 잠금 순서: 취합 주기 행을 먼저 잠그고(FOR SHARE) 그다음 제출본 행을 잠근다
  -- (FOR UPDATE). close_planning_cycle도 취합 주기 행을 먼저(FOR UPDATE) 잠그므로, 이 마이그리이션
  -- 전체가 "취합 주기 → 제출본" 한 방향으로만 잠가 교착 상태가 나지 않는다(파일 머리말 참고).
  -- cycle_id는 제출본 생성 뒤 바뀌지 않으므로 이 첫 조회는 잠글 필요가 없다.
  select cycle_id into v_cycle_id from core.demand_submission where submission_id = p_submission_id;
  if v_cycle_id is null then
    raise exception '제출본을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  -- 잠그지 않은 SELECT는 동시 진행 중인 close_planning_cycle의 커밋을 기다리지 않는다 — FOR
  -- SHARE로 읽어야 실제로 순서가 맞춰진다(core.guard_demand_submission_cycle_active와 같은 이유).
  select is_active into v_cycle_is_active from core.planning_cycle where cycle_id = v_cycle_id for share;
  -- fix round 1 — 닫힌 취합 주기에 묶인 제출본은 얼려 둔다. 재개(open_planning_cycle)는
  -- 같은 달에 새 cycle_id를 만들 뿐 이 행을 되살리지 않는다(아래 §4 재개 정책 참고).
  if v_cycle_is_active is distinct from true then
    raise exception '취합 주기가 닫혀 더 이상 수정할 수 없습니다.' using errcode = '22023';
  end if;

  select * into v_submission from core.demand_submission where submission_id = p_submission_id for update;
  if not found then
    raise exception '제출본을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if v_submission.department is distinct from v_department then
    raise exception '다른 부서의 제출본은 수정할 수 없습니다.' using errcode = '42501';
  end if;
  if v_submission.status not in ('DRAFT', 'WITHDRAWN') then
    raise exception '제출되었거나 합의된 자료는 회수한 뒤에만 수정할 수 있습니다.' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception '저장할 항목이 올바르지 않습니다.' using errcode = '22023';
  end if;

  delete from core.demand_submission_line where submission_id = p_submission_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_line_no := v_line_no + 1;
    v_raw_item := nullif(btrim(v_line ->> 'item_id'), '');
    v_raw_qty := nullif(btrim(v_line ->> 'qty'), '');
    v_raw_month := nullif(btrim(v_line ->> 'need_month'), '');
    v_issues := '[]'::jsonb;

    -- 품목코드
    if v_raw_item is null then
      v_issues := v_issues || jsonb_build_array(
        jsonb_build_object('field_name', 'item_id', 'code', 'REQUIRED_VALUE', 'message', '품목코드가 없습니다.'));
      v_item_id := null;
    else
      v_item_id := core.normalize_item_id(v_raw_item);
      if not exists (select 1 from core.v_item_master im where im.item_id = v_item_id) then
        v_issues := v_issues || jsonb_build_array(
          jsonb_build_object('field_name', 'item_id', 'code', 'UNKNOWN_ITEM', 'message', '품목 마스터에 없습니다.'));
        v_item_id := null;
      end if;
    end if;

    -- 수량 — 없거나 숫자가 아니거나 음수면 null로 남기고 오류를 붙인다(0으로 채우지 않는다)
    v_qty := null;
    if v_raw_qty is null then
      v_issues := v_issues || jsonb_build_array(
        jsonb_build_object('field_name', 'qty', 'code', 'REQUIRED_VALUE', 'message', '수량이 없습니다.'));
    elsif v_raw_qty !~ '^-?[0-9]+(\.[0-9]+)?$' then
      v_issues := v_issues || jsonb_build_array(
        jsonb_build_object('field_name', 'qty', 'code', 'INVALID_NUMBER', 'message', '숫자 형식이 올바르지 않습니다.'));
    elsif v_raw_qty::numeric < 0 then
      v_issues := v_issues || jsonb_build_array(
        jsonb_build_object('field_name', 'qty', 'code', 'NEGATIVE_QUANTITY', 'message', '수량은 음수일 수 없습니다.'));
    else
      v_qty := v_raw_qty::numeric;
    end if;

    -- 필요월 — YYYY-MM만 받는다
    v_need_month := null;
    if v_raw_month is null then
      v_issues := v_issues || jsonb_build_array(
        jsonb_build_object('field_name', 'need_month', 'code', 'REQUIRED_VALUE', 'message', '필요월이 없습니다.'));
    elsif v_raw_month !~ '^\d{4}-\d{2}$' then
      v_issues := v_issues || jsonb_build_array(
        jsonb_build_object('field_name', 'need_month', 'code', 'INVALID_DATE', 'message', '연월 형식(YYYY-MM)이 올바르지 않습니다.'));
    elsif substring(v_raw_month from 6 for 2)::int not between 1 and 12 then
      v_issues := v_issues || jsonb_build_array(
        jsonb_build_object('field_name', 'need_month', 'code', 'INVALID_DATE', 'message', '연월 형식(YYYY-MM)이 올바르지 않습니다.'));
    else
      v_need_month := (v_raw_month || '-01')::date;
    end if;

    insert into core.demand_submission_line (submission_id, line_no, raw_item_code, item_id, qty, need_month, issues)
    values (p_submission_id, v_line_no, v_raw_item, v_item_id, v_qty, v_need_month, v_issues);
  end loop;

  update core.demand_submission
     set last_modified_by = v_actor, last_modified_at = clock_timestamp(), version = version + 1
   where submission_id = p_submission_id
   returning * into v_submission;

  insert into core.demand_submission_event (
    submission_id, event_type, previous_status, next_status, version, actor, actor_name, payload_snapshot
  ) values (
    p_submission_id, 'EDITED', v_submission.status, v_submission.status, v_submission.version,
    v_actor, core.order_actor_name(v_actor), jsonb_build_object('line_count', v_line_no)
  );

  return v_submission;
end;
$_$;


--
-- Name: schedule_demand_submission_reminder(text, timestamp with time zone, uuid[]); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.schedule_demand_submission_reminder(p_submission_cycle_id text, p_first_at timestamp with time zone, p_recipient_user_ids uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_user_id uuid;
  v_channel text;
  v_count integer := 0;
begin
  if nullif(btrim(p_submission_cycle_id), '') is null or p_first_at is null
     or coalesce(cardinality(p_recipient_user_ids), 0) = 0 then
    raise exception '수요 미제출 알림 입력값이 올바르지 않습니다.' using errcode = '22023';
  end if;
  foreach v_user_id in array p_recipient_user_ids loop
    foreach v_channel in array array['IN_APP', 'EMAIL'] loop
      perform core.enqueue_notification(
        'demand:' || p_submission_cycle_id || ':overdue:' || extract(epoch from p_first_at)::bigint,
        'DEMAND_SUBMISSION_OVERDUE', v_user_id, v_channel, p_first_at,
        jsonb_build_object(
          'series_type', 'DEMAND_SUBMISSION', 'series_id', p_submission_cycle_id,
          'submission_cycle_id', p_submission_cycle_id,
          'title', '수요자료 제출이 지연되고 있습니다',
          'message', '제출 마감일이 지났습니다. 수요자료를 제출해 주세요.'
        )
      );
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;


--
-- Name: schedule_sales_order_expiry_notices(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.schedule_sales_order_expiry_notices(p_order_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: schedule_temporary_allocation_expiry(text, timestamp with time zone, uuid[]); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.schedule_temporary_allocation_expiry(p_allocation_id text, p_expires_at timestamp with time zone, p_recipient_user_ids uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_days integer;
  v_user_id uuid;
  v_channel text;
  v_count integer := 0;
  v_when timestamptz;
begin
  if nullif(btrim(p_allocation_id), '') is null or p_expires_at is null
     or coalesce(cardinality(p_recipient_user_ids), 0) = 0 then
    raise exception '임시배정 만료 알림 입력값이 올바르지 않습니다.' using errcode = '22023';
  end if;

  foreach v_days in array array[10, 5, 3, 2, 1] loop
    v_when := p_expires_at - make_interval(days => v_days);
    foreach v_user_id in array p_recipient_user_ids loop
      foreach v_channel in array array['IN_APP', 'EMAIL'] loop
        perform core.enqueue_notification(
          'allocation:' || p_allocation_id || ':expires:' || v_days,
          'TEMP_ALLOCATION_EXPIRY_WARNING', v_user_id, v_channel, v_when,
          jsonb_build_object(
            'series_type', 'TEMP_ALLOCATION', 'series_id', p_allocation_id,
            'allocation_id', p_allocation_id, 'expires_at', p_expires_at,
            'days_before', v_days, 'title', '임시배정 만료 알림',
            'message', '임시배정이 ' || v_days || '일 후 만료됩니다.'
          )
        );
        v_count := v_count + 1;
      end loop;
    end loop;
  end loop;
  return v_count;
end;
$$;


--
-- Name: select_manual_champion(uuid, text, text, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.select_manual_champion(p_backtest_run_id uuid, p_item_id text, p_model_id text, p_reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'pg_temp'
    AS $$
declare v_perf core.model_performance%rowtype; v_id uuid := gen_random_uuid();
begin
  if not core.is_admin() then raise exception '관리자 권한이 필요합니다.' using errcode='42501'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception '수동 Champion 변경 사유는 필수입니다.' using errcode='22023'; end if;
  select * into v_perf from core.model_performance where backtest_run_id=p_backtest_run_id and item_id=p_item_id and model_id=p_model_id;
  if not found then raise exception '해당 Backtest 후보 성능을 찾을 수 없습니다.' using errcode='22023'; end if;
  insert into core.champion_model_selection(selection_id,backtest_run_id,item_id,champion_model_id,model_version,champion_metric,champion_metric_value,wape,mape,bias,rmse,mae,candidate_performance,selection_reason,selection_method,selected_by)
  values(v_id,p_backtest_run_id,p_item_id,p_model_id,v_perf.model_version,'MANUAL',v_perf.wape,v_perf.wape,v_perf.mape,v_perf.bias,v_perf.rmse,v_perf.mae,
    (select jsonb_agg(jsonb_build_object('model_id',model_id,'wape',wape,'mape',mape,'bias',bias,'rmse',rmse,'mae',mae,'rank',rank)) from core.model_performance where backtest_run_id=p_backtest_run_id and item_id=p_item_id),p_reason,'MANUAL',auth.uid());
  insert into core.audit_log(actor,action,target_type,target_id,before,after)
  values(auth.uid(),'CHAMPION_MANUALLY_CHANGED','champion_model',p_item_id,
    (select to_jsonb(c) from core.champion_model_selection c where c.item_id=p_item_id order by selected_at desc offset 1 limit 1),
    jsonb_build_object('selection_id',v_id,'backtest_run_id',p_backtest_run_id,'model_id',p_model_id,'reason',p_reason));
  return v_id;
end; $$;


--
-- Name: set_calendar_month_ready(text, integer, integer, boolean, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.set_calendar_month_ready(p_country_code text, p_cal_year integer, p_cal_month integer, p_ready boolean, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: FUNCTION set_calendar_month_ready(p_country_code text, p_cal_year integer, p_cal_month integer, p_ready boolean, p_reason text); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.set_calendar_month_ready(p_country_code text, p_cal_year integer, p_cal_month integer, p_ready boolean, p_reason text) IS 'Task 10a — ADMIN 전용. "이 국가·연·월의 공휴일을 다 넣었다"를 선언한다. 공휴일 자체를 만들지 않는다';


--
-- Name: set_supplier_departure_rule(bigint, text, integer, integer, integer, date, date, text, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.set_supplier_departure_rule(p_departure_id bigint, p_supplier_id text, p_weekday integer, p_week_of_month integer, p_day_of_month integer, p_valid_from date, p_valid_to date, p_note text, p_reason text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: FUNCTION set_supplier_departure_rule(p_departure_id bigint, p_supplier_id text, p_weekday integer, p_week_of_month integer, p_day_of_month integer, p_valid_from date, p_valid_to date, p_note text, p_reason text); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.set_supplier_departure_rule(p_departure_id bigint, p_supplier_id text, p_weekday integer, p_week_of_month integer, p_day_of_month integer, p_valid_from date, p_valid_to date, p_note text, p_reason text) IS 'Task 10a — ADMIN 전용. p_departure_id가 null이면 새 규칙을 만들고(create), 있으면 그 행을 교체한다(replace). 요일·매월 일자 중 정확히 하나만, 주차(week_of_month)는 요일과 함께만 채운다';


--
-- Name: set_supply_meeting_result(date, text, numeric, boolean, uuid, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.set_supply_meeting_result(p_plan_month date, p_item_id text, p_qty numeric, p_approved boolean, p_basis_submission_line_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: FUNCTION set_supply_meeting_result(p_plan_month date, p_item_id text, p_qty numeric, p_approved boolean, p_basis_submission_line_id uuid, p_reason text); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.set_supply_meeting_result(p_plan_month date, p_item_id text, p_qty numeric, p_approved boolean, p_basis_submission_line_id uuid, p_reason text) IS 'Task 8 — 수급회의 결과 대리 입력·수정(SUPPLY_MEETING_INPUT). 팀장 승인이 없다 — approved 플래그가 최종 판단이다. 이미 있는 (계획월, 품목) 행이면 이전 값을 core.supply_meeting_result_event에 남기고 갱신한다';


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'core', 'pg_temp'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: start_demand_submission(date); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.start_demand_submission(p_plan_month date) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_department text;
  v_month date;
  v_cycle core.planning_cycle%rowtype;
  v_submission_id uuid;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 수요를 작성할 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('DEMAND_SUBMIT', v_actor) then
    raise exception '부서 수요 제출 권한이 없습니다.' using errcode = '42501';
  end if;

  select department into v_department from core.app_user where user_id = v_actor;
  if nullif(btrim(v_department), '') is null then
    raise exception '소속 부서가 설정되지 않았습니다. 관리자에게 문의하세요.' using errcode = '22023';
  end if;

  v_month := date_trunc('month', p_plan_month)::date;

  -- fix round 3 — 잠금 순서: 취합 주기 행을 먼저 잠근다(파일 머리말의 "잠금 순서" 참고). WHERE에
  -- is_active를 넣은 채로 FOR UPDATE를 걸면, 동시에 진행 중인 close_planning_cycle이 커밋될 때까지
  -- 기다렸다가 그 결과(닫혔으면 조건에 더 이상 맞지 않음)를 다시 확인한다 — PostgreSQL의 표준
  -- FOR UPDATE 재확인 동작이다.
  select * into v_cycle from core.planning_cycle where plan_month = v_month and is_active for update;
  if not found then
    raise exception '해당 월의 수요 취합 주기가 열려 있지 않습니다.' using errcode = '22023';
  end if;

  select submission_id into v_submission_id
    from core.demand_submission
   where cycle_id = v_cycle.cycle_id and department = v_department;

  if v_submission_id is not null then
    return v_submission_id;
  end if;

  insert into core.demand_submission (
    cycle_id, plan_month, department, status, created_by, last_modified_by, last_modified_at
  ) values (
    v_cycle.cycle_id, v_cycle.plan_month, v_department, 'DRAFT', v_actor, v_actor, clock_timestamp()
  )
  returning submission_id into v_submission_id;

  insert into core.demand_submission_event (
    submission_id, event_type, previous_status, next_status, version, actor, actor_name, payload_snapshot
  )
  select v_submission_id, 'CREATED', null, 'DRAFT', 1, v_actor, core.order_actor_name(v_actor), to_jsonb(s)
    from core.demand_submission s
   where s.submission_id = v_submission_id;

  return v_submission_id;
end;
$$;


--
-- Name: submission_deadline(date); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.submission_deadline(p_plan_month date) RETURNS date
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'core', 'pg_temp'
    AS $$
  select (date_trunc('month', p_plan_month)::date - 2);
$$;


--
-- Name: FUNCTION submission_deadline(p_plan_month date); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.submission_deadline(p_plan_month date) IS 'Task 7 — 대상월 1일 - 2일 = 전월 말일 - 1일. lib/demand/model.ts의 submissionDeadline과 값이 같아야 한다';


--
-- Name: submit_demand_submission(uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.submit_demand_submission(p_submission_id uuid) RETURNS core.demand_submission
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_department text;
  v_submission core.demand_submission%rowtype;
  v_cycle_id uuid;
  v_cycle_is_active boolean;
  v_previous_status text;
  v_line_count integer;
  v_error_count integer;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 제출할 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('DEMAND_SUBMIT', v_actor) then
    raise exception '부서 수요 제출 권한이 없습니다.' using errcode = '42501';
  end if;

  select department into v_department from core.app_user where user_id = v_actor;

  -- fix round 3 — 잠금 순서: 취합 주기 행을 먼저(FOR SHARE) 잠그고 그다음 제출본 행을 잠근다
  -- (FOR UPDATE). 파일 머리말의 "잠금 순서" 참고.
  select cycle_id into v_cycle_id from core.demand_submission where submission_id = p_submission_id;
  if v_cycle_id is null then
    raise exception '제출본을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  select is_active into v_cycle_is_active from core.planning_cycle where cycle_id = v_cycle_id for share;
  -- fix round 1 — 닫힌 취합 주기에서는 제출도 막는다.
  if v_cycle_is_active is distinct from true then
    raise exception '취합 주기가 닫혀 더 이상 제출할 수 없습니다.' using errcode = '22023';
  end if;

  select * into v_submission from core.demand_submission where submission_id = p_submission_id for update;
  if not found then
    raise exception '제출본을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if v_submission.department is distinct from v_department then
    raise exception '다른 부서의 제출본은 제출할 수 없습니다.' using errcode = '42501';
  end if;
  if v_submission.status not in ('DRAFT', 'WITHDRAWN') then
    raise exception '이미 제출되었거나 합의된 자료입니다.' using errcode = '22023';
  end if;

  select count(*), count(*) filter (where jsonb_array_length(issues) > 0)
    into v_line_count, v_error_count
    from core.demand_submission_line
   where submission_id = p_submission_id;

  if v_line_count = 0 then
    raise exception '제출할 항목이 없습니다.' using errcode = '22023';
  end if;
  -- 검증 체크리스트: ERROR 행이 있으면 제출 완료로 바뀌지 않는다.
  if v_error_count > 0 then
    raise exception '오류가 있는 항목(%건)을 수정한 뒤 제출하세요.', v_error_count using errcode = '22023';
  end if;

  v_previous_status := v_submission.status;

  update core.demand_submission
     set status = 'SUBMITTED', submitted_by = v_actor, submitted_at = clock_timestamp(),
         last_modified_by = v_actor, last_modified_at = clock_timestamp(), version = version + 1
   where submission_id = p_submission_id
   returning * into v_submission;

  insert into core.demand_submission_event (
    submission_id, event_type, previous_status, next_status, version, actor, actor_name, payload_snapshot
  ) values (
    p_submission_id, 'SUBMITTED', v_previous_status, v_submission.status, v_submission.version,
    v_actor, core.order_actor_name(v_actor), to_jsonb(v_submission)
  );

  -- 제출 완료 시 해당 부서의 반복 미제출 알림을 즉시 중단한다(구현 체크리스트).
  perform core.cancel_notification_series(
    'DEMAND_SUBMISSION', v_submission.cycle_id::text || ':' || v_submission.department
  );

  return v_submission;
end;
$$;


--
-- Name: sync_approval_notifications(); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.sync_approval_notifications() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_permission text;
  v_recipient record;
  v_channel text;
  v_payload jsonb;
begin
  if tg_op = 'INSERT' then
    v_permission := case new.approval_type
      when 'ITEM_POLICY' then 'ITEM_POLICY_APPROVE'
      when 'ALLOC_PRIORITY' then 'ALLOC_PRIORITY_APPROVE'
      when 'EVENT_ORDER' then 'EVENT_ORDER_APPROVE'
      when 'PURCHASE_PLAN' then 'PLAN_APPROVE'
    end;
    v_payload := jsonb_build_object(
      'approval_id', new.approval_id,
      'target_id', new.target_id,
      'approval_type', new.approval_type,
      'title', '승인 요청이 대기 중입니다',
      'message', new.requester_name || ' 님이 등록한 요청을 확인해 주세요.'
    );

    for v_recipient in
      select distinct u.user_id
        from core.app_user u
        join core.role_permission rp on rp.job_role = u.job_role
       where u.active
         and u.user_id <> new.requested_by
         and rp.permission_code = v_permission
    loop
      foreach v_channel in array array['IN_APP', 'EMAIL'] loop
        perform core.enqueue_notification(
          'approval:' || new.approval_id || ':pending:' || extract(epoch from new.requested_at)::bigint,
          'APPROVAL_PENDING', v_recipient.user_id, v_channel, new.requested_at, v_payload
        );
      end loop;
    end loop;
    return new;
  end if;

  if old.status = 'PENDING' and new.status in ('APPROVED', 'REJECTED', 'CANCELLED') then
    update core.notification_outbox
       set status = 'CANCELLED', finished_at = clock_timestamp(),
           claimed_by = null, claim_token = null, claim_expires_at = null
     where status in ('PENDING', 'PROCESSING')
       and payload ->> 'approval_id' = new.approval_id::text;

    v_payload := jsonb_build_object(
      'approval_id', new.approval_id,
      'target_id', new.target_id,
      'approval_type', new.approval_type,
      'decision', new.status,
      'title', case new.status when 'APPROVED' then '승인 요청이 승인되었습니다'
                               when 'REJECTED' then '승인 요청이 반려되었습니다'
                               else '승인 요청이 취소되었습니다' end,
      'message', coalesce(new.decision_comment, '승인함에서 처리 결과를 확인해 주세요.')
    );
    foreach v_channel in array array['IN_APP', 'EMAIL'] loop
      perform core.enqueue_notification(
        'approval:' || new.approval_id || ':decision:' || new.status,
        'APPROVAL_DECIDED', new.requested_by, v_channel, clock_timestamp(), v_payload
      );
    end loop;
  end if;
  return new;
end;
$$;


--
-- Name: stock_allocation; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.stock_allocation (
    allocation_id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    line_id bigint NOT NULL,
    item_id text NOT NULL,
    status text NOT NULL,
    qty numeric NOT NULL,
    source text NOT NULL,
    approval_id uuid,
    reason text,
    created_by uuid,
    created_by_name text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    firm_at timestamp with time zone,
    released_at timestamp with time zone,
    released_by uuid,
    release_reason text,
    CONSTRAINT stock_allocation_firm_fields_check CHECK (((status <> 'FIRM'::text) OR (firm_at IS NOT NULL))),
    CONSTRAINT stock_allocation_hold_source_check CHECK (((status <> 'APPROVAL_HOLD'::text) OR (source = 'MANUAL'::text))),
    CONSTRAINT stock_allocation_qty_check CHECK ((qty > (0)::numeric)),
    CONSTRAINT stock_allocation_release_fields_check CHECK (((status = 'RELEASED'::text) = ((released_at IS NOT NULL) AND (NULLIF(btrim(release_reason), ''::text) IS NOT NULL)))),
    CONSTRAINT stock_allocation_source_check CHECK ((source = ANY (ARRAY['REVIEW_REQUEST'::text, 'MANUAL'::text, 'RECEIPT'::text]))),
    CONSTRAINT stock_allocation_status_check CHECK ((status = ANY (ARRAY['TEMPORARY'::text, 'APPROVAL_HOLD'::text, 'FIRM'::text, 'RELEASED'::text])))
);


--
-- Name: TABLE stock_allocation; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.stock_allocation IS 'Task 5 재고 배정. TEMPORARY(만료는 주문의 temporary_expires_at) · APPROVAL_HOLD(만료 없음, 승인 대기) · FIRM(만료 없음) · RELEASED. 가용재고 차감은 RELEASED가 아닌 세 상태의 합이다. 행을 지우지 않는다';


--
-- Name: transition_stock_allocation(uuid, text, uuid, text, text, jsonb); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.transition_stock_allocation(p_allocation_id uuid, p_next_status text, p_actor uuid, p_reason text, p_cause text, p_payload jsonb DEFAULT '{}'::jsonb) RETURNS core.stock_allocation
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_before core.stock_allocation%rowtype;
  v_after core.stock_allocation%rowtype;
  v_temporary_expires_at timestamptz;
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
  -- 임시배정을 확정배정으로 바꾸는 것은 만료 시각 전에만 한다. 해제는 언제든 허용한다(Task 6 자동 해제도 이 함수를 쓴다).
  if v_before.status = 'TEMPORARY' and p_next_status = 'FIRM' then
    select o.temporary_expires_at into v_temporary_expires_at
      from core.sales_order o
     where o.order_id = v_before.order_id;
    if clock_timestamp() >= v_temporary_expires_at then
      raise exception 'TEMPORARY_ALLOCATION_EXPIRED: 만료 시각(%)이 지난 임시배정은 확정배정으로 바꿀 수 없습니다.',
        v_temporary_expires_at using errcode = '55000';
    end if;
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


--
-- Name: update_urgent_order(uuid, numeric, date, text, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.update_urgent_order(p_urgent_order_id uuid, p_qty numeric, p_needed_by date, p_reason text, p_change_reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_row core.urgent_order%rowtype;
  v_actor_name text;
begin
  if auth.uid() is null or not core.is_active_user(auth.uid()) then
    raise exception '로그인한 활성 사용자만 수정할 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('ALLOC_MANUAL') then
    raise exception '긴급발주 수정 권한(ALLOC_MANUAL)이 없습니다.' using errcode = '42501';
  end if;

  select * into v_row from core.urgent_order where urgent_order_id = p_urgent_order_id for update;
  if not found then
    raise exception '긴급발주를 찾을 수 없습니다: %', p_urgent_order_id;
  end if;
  if v_row.status in ('COMPLETED', 'CANCELLED') then
    raise exception '이미 종료된 긴급발주는 수정할 수 없습니다(상태: %).', v_row.status;
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception '수량은 0보다 커야 합니다.';
  end if;
  if p_needed_by is null then
    raise exception '필요일은 필수입니다.';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception '사유는 필수입니다.';
  end if;
  if p_change_reason is null or btrim(p_change_reason) = '' then
    raise exception '변경 사유는 필수입니다.';
  end if;

  v_actor_name := core.order_actor_name(auth.uid());

  update core.urgent_order o
     set qty = p_qty, needed_by = p_needed_by, reason = btrim(p_reason), updated_at = now()
   where o.urgent_order_id = p_urgent_order_id;

  insert into core.audit_log (actor, action, target_type, target_id, before, after)
  values (
    auth.uid(), 'URGENT_ORDER_UPDATED', 'urgent_order', p_urgent_order_id::text,
    jsonb_build_object('qty', v_row.qty, 'needed_by', v_row.needed_by, 'reason', v_row.reason),
    jsonb_build_object('qty', p_qty, 'needed_by', p_needed_by, 'reason', btrim(p_reason),
                        'change_reason', btrim(p_change_reason), 'actor_name', v_actor_name)
  );

  return p_urgent_order_id;
end;
$$;


--
-- Name: FUNCTION update_urgent_order(p_urgent_order_id uuid, p_qty numeric, p_needed_by date, p_reason text, p_change_reason text); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.update_urgent_order(p_urgent_order_id uuid, p_qty numeric, p_needed_by date, p_reason text, p_change_reason text) IS 'Task 11 — 긴급발주 수량 · 필요일 · 사유 수정. 종료(COMPLETED · CANCELLED) 건은 수정할 수 없다. 변경 전후 값과 변경 사유가 core.audit_log에 남는다(append-only)';


--
-- Name: upsert_supplier(text, text, text, integer, boolean, date, date, text, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.upsert_supplier(p_supplier_id text, p_supplier_name text, p_entity_id text, p_lead_time_days integer, p_active boolean, p_valid_from date, p_valid_to date, p_note text, p_reason text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: FUNCTION upsert_supplier(p_supplier_id text, p_supplier_name text, p_entity_id text, p_lead_time_days integer, p_active boolean, p_valid_from date, p_valid_to date, p_note text, p_reason text); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.upsert_supplier(p_supplier_id text, p_supplier_name text, p_entity_id text, p_lead_time_days integer, p_active boolean, p_valid_from date, p_valid_to date, p_note text, p_reason text) IS 'Task 10a — ADMIN 전용. 공급처를 추가하거나 소속 법인·활성 여부·적용 기간을 바꾼다. 과거 발주 이력이 참조하므로 삭제 함수는 두지 않는다(gap 6.1) — 퇴출은 active=false + 종료일';


--
-- Name: upsert_supply_entity(text, text, text, integer, boolean, date, date, text, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.upsert_supply_entity(p_entity_id text, p_entity_name text, p_country_code text, p_prep_days integer, p_active boolean, p_valid_from date, p_valid_to date, p_note text, p_reason text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
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


--
-- Name: FUNCTION upsert_supply_entity(p_entity_id text, p_entity_name text, p_country_code text, p_prep_days integer, p_active boolean, p_valid_from date, p_valid_to date, p_note text, p_reason text); Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON FUNCTION core.upsert_supply_entity(p_entity_id text, p_entity_name text, p_country_code text, p_prep_days integer, p_active boolean, p_valid_from date, p_valid_to date, p_note text, p_reason text) IS 'Task 10a — ADMIN 전용. 해외법인을 추가하거나 출항 준비기간·활성 여부·적용 기간을 바꾼다. 과거 법인은 active=false + 종료일로 남기고 지우지 않는다(gap 6.1)';


--
-- Name: usage_input_fingerprint(text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.usage_input_fingerprint(p_split text) RETURNS TABLE(row_count bigint, qty_sum numeric, max_loaded_at timestamp with time zone, input_md5 text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'core', 'pg_temp'
    AS $$
  with input_rows as (
    select t.item_id, t.use_date, t.qty, t.batch_id, t.loaded_at from core.v_train_demand t where p_split = 'TRAIN'
    union all
    select t.item_id, t.use_date, t.qty, t.batch_id, t.loaded_at from core.v_test_actual t where p_split = 'TEST'
  )
  select count(*),
         sum(r.qty),
         max(r.loaded_at),
         md5(coalesce(string_agg(
           concat_ws('|', coalesce(r.item_id, '-'), coalesce(to_char(r.use_date::timestamp, 'YYYY-MM-DD'), '-'),
                     coalesce(r.qty::text, '-'), coalesce(r.batch_id::text, '-')),
           E'\n' order by r.item_id, r.use_date, r.qty, r.batch_id::text), ''))
    from input_rows r;
$$;


--
-- Name: validate_claimed_notification(uuid, uuid, uuid); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.validate_claimed_notification(p_notification_id uuid, p_worker_id uuid, p_claim_token uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_notice core.notification_outbox%rowtype;
begin
  select * into v_notice
    from core.notification_outbox
   where notification_id = p_notification_id
   for update;

  if p_worker_id is null
     or p_claim_token is null
     or not found
     or v_notice.status <> 'PROCESSING'
     or v_notice.claimed_by is distinct from p_worker_id
     or v_notice.claim_token is distinct from p_claim_token
     or v_notice.claim_expires_at <= clock_timestamp() then
    return false;
  end if;

  if not exists (
    select 1 from core.app_user u
     where u.user_id = v_notice.recipient_user_id and u.active
  ) then
    update core.notification_outbox
       set status = 'CANCELLED', finished_at = clock_timestamp(),
           claimed_by = null, claim_token = null, claim_expires_at = null
     where notification_id = p_notification_id;
    return false;
  end if;

  if v_notice.template_code = 'APPROVAL_PENDING'
     and not exists (
       select 1 from core.approval_request r
        where r.approval_id::text = v_notice.payload ->> 'approval_id'
          and r.status = 'PENDING'
     ) then
    update core.notification_outbox
       set status = 'CANCELLED', finished_at = clock_timestamp(),
           claimed_by = null, claim_token = null, claim_expires_at = null
     where notification_id = p_notification_id;
    return false;
  end if;

  return true;
end;
$$;


--
-- Name: withdraw_demand_submission(uuid, text); Type: FUNCTION; Schema: core; Owner: -
--

CREATE FUNCTION core.withdraw_demand_submission(p_submission_id uuid, p_reason text) RETURNS core.demand_submission
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'public', 'pg_temp'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_department text;
  v_submission core.demand_submission%rowtype;
  v_previous_status text;
  v_cycle_id uuid;
  v_cycle core.planning_cycle%rowtype;
  v_series_id text;
  v_recipients uuid[];
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 회수할 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('DEMAND_SUBMIT', v_actor) then
    raise exception '부서 수요 제출 권한이 없습니다.' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception '회수 사유는 필수입니다.' using errcode = '22023';
  end if;

  select department into v_department from core.app_user where user_id = v_actor;

  -- fix round 3 — 잠금 순서: 취합 주기 행을 먼저(FOR SHARE) 잠그고 그다음 제출본 행을 잠근다
  -- (FOR UPDATE). 파일 머리말의 "잠금 순서" 참고. cycle_id는 제출본 생성 뒤 바뀌지 않으므로
  -- 이 첫 조회는 잠글 필요가 없다.
  select cycle_id into v_cycle_id from core.demand_submission where submission_id = p_submission_id;
  if v_cycle_id is null then
    raise exception '제출본을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  select * into v_cycle from core.planning_cycle where cycle_id = v_cycle_id for share;
  -- fix round 1 — 닫힌 취합 주기에서는 회수도 막는다(이미 확정된 이력을 건드리지 않는다).
  if not v_cycle.is_active then
    raise exception '취합 주기가 닫혀 더 이상 회수할 수 없습니다.' using errcode = '22023';
  end if;

  select * into v_submission from core.demand_submission where submission_id = p_submission_id for update;
  if not found then
    raise exception '제출본을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if v_submission.department is distinct from v_department then
    raise exception '다른 부서의 제출본은 회수할 수 없습니다.' using errcode = '42501';
  end if;
  if v_submission.status <> 'SUBMITTED' then
    raise exception '제출된 자료만 회수할 수 있습니다.' using errcode = '22023';
  end if;
  v_previous_status := v_submission.status;

  update core.demand_submission
     set status = 'WITHDRAWN', withdrawn_by = v_actor, withdrawn_at = clock_timestamp(),
         withdraw_reason = btrim(p_reason),
         last_modified_by = v_actor, last_modified_at = clock_timestamp(), version = version + 1
   where submission_id = p_submission_id
   returning * into v_submission;

  insert into core.demand_submission_event (
    submission_id, event_type, previous_status, next_status, version, actor, actor_name, reason, payload_snapshot
  ) values (
    p_submission_id, 'WITHDRAWN', v_previous_status, v_submission.status, v_submission.version,
    v_actor, core.order_actor_name(v_actor), btrim(p_reason), to_jsonb(v_submission)
  );

  -- 마감일이 지난 뒤 회수하면 반복 미제출 알림을 즉시 재개한다(컨트롤러 판정 5).
  -- v_cycle은 위에서 이미 조회했다(닫힌 주기 여부 확인 때).
  if v_cycle.submission_deadline is not null
     and (clock_timestamp() at time zone 'Asia/Seoul')::date > v_cycle.submission_deadline then
    v_series_id := v_submission.cycle_id::text || ':' || v_submission.department;
    select array_agg(u.user_id) into v_recipients
      from core.app_user u
      join core.role_permission rp on rp.job_role = u.job_role
     where u.active and u.department = v_submission.department and rp.permission_code = 'DEMAND_SUBMIT';
    if coalesce(array_length(v_recipients, 1), 0) > 0 then
      perform core.schedule_demand_submission_reminder(v_series_id, clock_timestamp(), v_recipients);
    end if;
  end if;

  return v_submission;
end;
$$;


--
-- Name: item_policy; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.item_policy (
    item_id text NOT NULL,
    moq numeric,
    pack_size numeric,
    item_grade text,
    service_level numeric(5,4),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    target_dos_days numeric,
    allocation_mode text DEFAULT 'AUTO'::text NOT NULL,
    target_stock_qty numeric,
    unit_price numeric,
    unit_price_basis text,
    min_order_amount numeric,
    CONSTRAINT item_policy_allocation_mode_check CHECK ((allocation_mode = ANY (ARRAY['AUTO'::text, 'MANUAL'::text]))),
    CONSTRAINT item_policy_min_order_amount_check CHECK (((min_order_amount IS NULL) OR (min_order_amount >= (0)::numeric))),
    CONSTRAINT item_policy_moq_check CHECK (((moq IS NULL) OR (moq > (0)::numeric))),
    CONSTRAINT item_policy_pack_size_check CHECK (((pack_size IS NULL) OR (pack_size > (0)::numeric))),
    CONSTRAINT item_policy_service_level_check CHECK (((service_level IS NULL) OR ((service_level > (0)::numeric) AND (service_level < (1)::numeric)))),
    CONSTRAINT item_policy_target_dos_days_check CHECK (((target_dos_days IS NULL) OR (target_dos_days > (0)::numeric))),
    CONSTRAINT item_policy_target_stock_qty_check CHECK (((target_stock_qty IS NULL) OR (target_stock_qty >= (0)::numeric))),
    CONSTRAINT item_policy_unit_price_check CHECK (((unit_price IS NULL) OR (unit_price >= (0)::numeric)))
);


--
-- Name: COLUMN item_policy.moq; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.item_policy.moq IS '승인된 최소주문수량 운영값. 미설정이면 계산에서 1로 봅니다(stage1 §7). authenticated 직접 쓰기 금지(Task 9a)';


--
-- Name: COLUMN item_policy.pack_size; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.item_policy.pack_size IS '승인된 포장단위. ★ 현재 발주 계산에 적용하지 않습니다(저장 · 표시만). authenticated 직접 쓰기 금지(Task 9a)';


--
-- Name: COLUMN item_policy.target_dos_days; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.item_policy.target_dos_days IS '승인된 목표 DoS 운영값. authenticated 직접 쓰기 금지, 승인 함수로만 변경합니다';


--
-- Name: COLUMN item_policy.allocation_mode; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.item_policy.allocation_mode IS '승인된 배정 방식 운영값. authenticated 직접 쓰기 금지, 승인 함수로만 변경합니다';


--
-- Name: COLUMN item_policy.target_stock_qty; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.item_policy.target_stock_qty IS '승인된 목표재고 운영값. authenticated 직접 쓰기 금지, core.request_item_policy_change + 승인 함수로만 변경합니다(Task 9a)';


--
-- Name: COLUMN item_policy.unit_price; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.item_policy.unit_price IS '승인된 단가 운영값. authenticated 직접 쓰기 금지, core.request_item_policy_change + 승인 함수로만 변경합니다(Task 9a)';


--
-- Name: COLUMN item_policy.unit_price_basis; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.item_policy.unit_price_basis IS '표준원가 · 최근매입가 중 무엇인지. 현업 확인 전까지 null';


--
-- Name: COLUMN item_policy.min_order_amount; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.item_policy.min_order_amount IS '승인된 최소주문금액. ★ 현재 발주 계산에 적용하지 않습니다(저장 · 표시만). authenticated 직접 쓰기 금지(Task 9a)';


--
-- Name: sales_order; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.sales_order (
    order_id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_seq bigint NOT NULL,
    order_no text NOT NULL,
    customer_id text,
    customer_name text NOT NULL,
    owner_user_id uuid NOT NULL,
    owner_name text NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    first_review_requested_at timestamp with time zone,
    temporary_expires_at timestamp with time zone,
    allocation_choice text,
    allocation_choice_by uuid,
    allocation_priority integer DEFAULT 5 NOT NULL,
    confirmed_order_no text,
    confirmed_at timestamp with time zone,
    confirmed_by uuid,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    cancel_reason text,
    expired_at timestamp with time zone,
    replaces_order_id uuid,
    note text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sales_order_allocation_choice_check CHECK (((allocation_choice IS NULL) OR (allocation_choice = ANY (ARRAY['PARTIAL'::text, 'WAIT_FULL'::text])))),
    CONSTRAINT sales_order_allocation_priority_check CHECK (((allocation_priority >= 1) AND (allocation_priority <= 9))),
    CONSTRAINT sales_order_cancelled_fields_check CHECK (((status <> 'CANCELLED'::text) OR ((cancelled_at IS NOT NULL) AND (NULLIF(btrim(cancel_reason), ''::text) IS NOT NULL)))),
    CONSTRAINT sales_order_confirmed_fields_check CHECK (((status <> 'CONFIRMED'::text) OR ((NULLIF(btrim(confirmed_order_no), ''::text) IS NOT NULL) AND (confirmed_at IS NOT NULL) AND (confirmed_by IS NOT NULL)))),
    CONSTRAINT sales_order_customer_name_check CHECK ((btrim(customer_name) <> ''::text)),
    CONSTRAINT sales_order_expired_fields_check CHECK (((status <> 'EXPIRED'::text) OR (expired_at IS NOT NULL))),
    CONSTRAINT sales_order_order_no_check CHECK ((btrim(order_no) <> ''::text)),
    CONSTRAINT sales_order_owner_name_check CHECK ((btrim(owner_name) <> ''::text)),
    CONSTRAINT sales_order_review_fields_check CHECK (
CASE
    WHEN (status = 'DRAFT'::text) THEN ((first_review_requested_at IS NULL) AND (temporary_expires_at IS NULL) AND (allocation_choice IS NULL))
    WHEN (status = 'CANCELLED'::text) THEN true
    ELSE ((first_review_requested_at IS NOT NULL) AND (temporary_expires_at IS NOT NULL) AND (allocation_choice IS NOT NULL))
END),
    CONSTRAINT sales_order_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'REVIEW_REQUESTED'::text, 'PARTIALLY_ALLOCATED'::text, 'WAITING_FULL'::text, 'CONFIRMED'::text, 'EXPIRED'::text, 'CANCELLED'::text])))
);


--
-- Name: TABLE sales_order; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.sales_order IS 'Task 5 영업 주문. 상태·배정 변경은 core 명령 함수로만 하며 모든 변경은 core.sales_order_event에 남는다';


--
-- Name: COLUMN sales_order.order_seq; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.sales_order.order_seq IS '주문 생성 순서. 우선순위·최초 검토 요청 시각이 같을 때 먼저 만든 주문을 앞에 둔다';


--
-- Name: COLUMN sales_order.customer_id; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.sales_order.customer_id IS '고객코드 텍스트. 고객 마스터가 없어 FK를 두지 않는다(컨트롤러 판정)';


--
-- Name: COLUMN sales_order.requested_at; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.sales_order.requested_at IS '영업담당자가 주문을 등록한 시각';


--
-- Name: COLUMN sales_order.temporary_expires_at; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.sales_order.temporary_expires_at IS '임시배정 만료 시각 = 최초 검토 요청 시각 + 30일. 한 번 기록하면 트리거가 변경을 막는다';


--
-- Name: COLUMN sales_order.allocation_priority; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.sales_order.allocation_priority IS '사업강화부 우선순위(1 최우선 ~ 9 최후순, 기본 5). 변경 이력은 core.allocation_priority';


--
-- Name: sales_order_line; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.sales_order_line (
    line_id bigint NOT NULL,
    order_id uuid NOT NULL,
    line_no integer NOT NULL,
    item_id text NOT NULL,
    requested_qty numeric NOT NULL,
    temporary_allocated_qty numeric DEFAULT 0 NOT NULL,
    firm_allocated_qty numeric DEFAULT 0 NOT NULL,
    approval_hold_qty numeric DEFAULT 0 NOT NULL,
    shortage_qty numeric GENERATED ALWAYS AS ((((requested_qty - temporary_allocated_qty) - firm_allocated_qty) - approval_hold_qty)) STORED,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sales_order_line_approval_hold_qty_check CHECK ((approval_hold_qty >= (0)::numeric)),
    CONSTRAINT sales_order_line_firm_allocated_qty_check CHECK ((firm_allocated_qty >= (0)::numeric)),
    CONSTRAINT sales_order_line_item_id_check CHECK ((btrim(item_id) <> ''::text)),
    CONSTRAINT sales_order_line_line_no_check CHECK ((line_no > 0)),
    CONSTRAINT sales_order_line_no_over_allocation CHECK ((((temporary_allocated_qty + firm_allocated_qty) + approval_hold_qty) <= requested_qty)),
    CONSTRAINT sales_order_line_requested_qty_check CHECK ((requested_qty > (0)::numeric)),
    CONSTRAINT sales_order_line_temporary_allocated_qty_check CHECK ((temporary_allocated_qty >= (0)::numeric))
);


--
-- Name: TABLE sales_order_line; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.sales_order_line IS 'Task 5 주문 품목. 임시·확정·승인대기 수량은 core.stock_allocation 합계를 같은 트랜잭션에서 옮겨 둔 값이다';


--
-- Name: COLUMN sales_order_line.shortage_qty; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.sales_order_line.shortage_qty IS '부족수량 = 요청 − 임시배정 − 확정배정 − 승인대기 확보. 대기열 순번은 이 값이 0보다 큰 줄만 센다';


--
-- Name: stock_balance; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.stock_balance (
    item_id text NOT NULL,
    snapshot_qty numeric DEFAULT 0 NOT NULL,
    normal_qty numeric DEFAULT 0 NOT NULL,
    snapshot_at timestamp with time zone,
    source_batch_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_balance_normal_qty_check CHECK ((normal_qty >= (0)::numeric)),
    CONSTRAINT stock_balance_snapshot_qty_check CHECK ((snapshot_qty >= (0)::numeric))
);


--
-- Name: TABLE stock_balance; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.stock_balance IS '품목별 확정 정상 창고재고. Task 5의 배정 함수가 FOR UPDATE로 잠그는 행이다. 분류 가능한 raw.inventory 행이 하나도 없는 품목은 이 표에 올리지 않는다 (0이 아니라 "아직 모른다"를 뜻하기 때문이다). 이 배치에 없는 품목은 갱신하지 않는다 — 품목별 최신값 누적이며 전체 재계산이 아니다';


--
-- Name: COLUMN stock_balance.snapshot_qty; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.stock_balance.snapshot_qty IS '최근 반영된 inventory 배치에서 NORMAL로 분류된 실사 수량. 입고 반영 전 기준값이다';


--
-- Name: COLUMN stock_balance.normal_qty; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.stock_balance.normal_qty IS '화면·뷰가 읽는 정상 창고재고. snapshot_qty + snapshot_at 이후 완료된
   core.stock_receipt_ledger 합. core.recompute_stock_balance_totals가 계산한다';


--
-- Name: COLUMN stock_balance.snapshot_at; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.stock_balance.snapshot_at IS 'NORMAL로 분류된 행만의 최신 확인 시각. 그 배치에 NORMAL 행이 하나도 없으면(정상재고
   0건이 확인됨) null일 수 있다 — normal_qty=0이어도 "언제 확인했는지"는 모를 수 있다';


--
-- Name: v_allocation_queue_line; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_allocation_queue_line WITH (security_invoker='true') AS
 SELECT l.item_id,
    l.line_id,
    l.line_no,
    o.order_id,
    o.order_no,
    o.order_seq,
    o.status AS order_status,
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
        CASE
            WHEN (l.shortage_qty > (0)::numeric) THEN row_number() OVER (PARTITION BY l.item_id, (l.shortage_qty > (0)::numeric) ORDER BY o.allocation_priority, o.first_review_requested_at, o.order_seq)
            ELSE NULL::bigint
        END AS queue_rank
   FROM (core.sales_order_line l
     JOIN core.sales_order o ON ((o.order_id = l.order_id)))
  WHERE (o.status = ANY (ARRAY['REVIEW_REQUESTED'::text, 'PARTIALLY_ALLOCATED'::text, 'WAITING_FULL'::text, 'CONFIRMED'::text]));


--
-- Name: VIEW v_allocation_queue_line; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON VIEW core.v_allocation_queue_line IS 'Task 5 진행 중 주문 품목과 대기 순번(우선순위 → 최초 검토 요청 시각 → 주문 생성 순서). security_invoker';


--
-- Name: v_item_allocation_qty; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_item_allocation_qty AS
 SELECT sb.item_id,
    sb.normal_qty,
    COALESCE(a.temporary_allocated_qty, (0)::numeric) AS temporary_allocated_qty,
    COALESCE(a.firm_allocated_qty, (0)::numeric) AS firm_allocated_qty,
    COALESCE(a.approval_hold_qty, (0)::numeric) AS approval_hold_qty,
    COALESCE(a.committed_qty, (0)::numeric) AS committed_qty,
    (sb.normal_qty - COALESCE(a.committed_qty, (0)::numeric)) AS available_qty
   FROM (core.stock_balance sb
     LEFT JOIN ( SELECT s.item_id,
            sum(s.qty) FILTER (WHERE (s.status = 'TEMPORARY'::text)) AS temporary_allocated_qty,
            sum(s.qty) FILTER (WHERE (s.status = 'FIRM'::text)) AS firm_allocated_qty,
            sum(s.qty) FILTER (WHERE (s.status = 'APPROVAL_HOLD'::text)) AS approval_hold_qty,
            sum(s.qty) AS committed_qty
           FROM core.stock_allocation s
          WHERE (s.status = ANY (ARRAY['TEMPORARY'::text, 'APPROVAL_HOLD'::text, 'FIRM'::text]))
          GROUP BY s.item_id) a ON ((a.item_id = sb.item_id)))
  WHERE (core.has_permission('STOCK_VIEW_ALL'::text) OR (core.has_permission('STOCK_VIEW_PAPER'::text) AND (core.item_visibility_scope(sb.item_id) = 'PAPER_CARD_READER'::text)) OR (core.has_permission('STOCK_VIEW_SUPPLY'::text) AND (core.item_visibility_scope(sb.item_id) = 'CONSUMABLE'::text)) OR core.has_permission('ATP_VIEW'::text) OR core.has_permission('ALLOC_VIEW'::text) OR core.has_permission('ALLOC_MANUAL'::text) OR core.has_permission('ALLOC_FIRM_CANCEL'::text) OR core.has_permission('ALLOC_PRIORITY_EDIT'::text) OR core.has_permission('ALLOC_PRIORITY_APPROVE'::text) OR core.is_admin());


--
-- Name: VIEW v_item_allocation_qty; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON VIEW core.v_item_allocation_qty IS 'Task 5 품목별 임시·확정·승인대기 합계와 가용재고. 소유자 권한으로 전체 배정을 합산하고 품목 합계만 노출한다';


--
-- Name: item_master; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.item_master (
    "품목코드" text,
    "품목명" text,
    "품목구분" text,
    "단위" text,
    "표준단가" text,
    "사용여부" text,
    supplier_id text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);


--
-- Name: v_item_master; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_item_master AS
 SELECT DISTINCT ON (item_id) item_id,
    item_name,
    item_type,
    supplier_id,
    unit,
    is_active
   FROM ( SELECT upper(regexp_replace(item_master."품목코드", '[\s\-_]'::text, ''::text, 'g'::text)) AS item_id,
            item_master."품목명" AS item_name,
            item_master."품목구분" AS item_type,
            item_master.supplier_id,
            item_master."단위" AS unit,
            item_master."사용여부" AS is_active,
                CASE
                    WHEN (item_master."품목코드" = upper(regexp_replace(item_master."품목코드", '[\s\-_]'::text, ''::text, 'g'::text))) THEN 0
                    ELSE 1
                END AS pref
           FROM raw.item_master) t
  ORDER BY item_id, pref;


--
-- Name: v_allocation_queue; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_allocation_queue WITH (security_invoker='true') AS
 SELECT q.item_id,
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
    aq.available_qty AS item_available_qty,
        CASE
            WHEN (aq.item_id IS NULL) THEN 'INVENTORY_SCOPE_UNCLASSIFIED'::text
            ELSE NULL::text
        END AS reason_code,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('allocation_id', a.allocation_id, 'status', a.status, 'qty', a.qty, 'source', a.source, 'approval_id', a.approval_id, 'created_at', a.created_at, 'reason', a.reason) ORDER BY a.created_at) AS jsonb_agg
           FROM core.stock_allocation a
          WHERE ((a.line_id = q.line_id) AND (a.status <> 'RELEASED'::text))), '[]'::jsonb) AS active_allocations
   FROM (((core.v_allocation_queue_line q
     LEFT JOIN core.v_item_master im ON ((im.item_id = q.item_id)))
     LEFT JOIN core.item_policy ip ON ((ip.item_id = q.item_id)))
     LEFT JOIN core.v_item_allocation_qty aq ON ((aq.item_id = q.item_id)))
  WHERE (core.has_permission('ALLOC_VIEW'::text) OR core.has_permission('ALLOC_MANUAL'::text) OR core.has_permission('ALLOC_FIRM_CANCEL'::text) OR core.has_permission('ALLOC_PRIORITY_EDIT'::text) OR core.has_permission('ALLOC_PRIORITY_APPROVE'::text));


--
-- Name: VIEW v_allocation_queue; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_allocation_queue IS 'Task 5 — SCM · 사업강화부용 진행 중 주문 품목, 대기 순번, 우선순위, 활성 배정. 품목 재고가 확정되지 않았으면 item_available_qty null + INVENTORY_SCOPE_UNCLASSIFIED. security_invoker';


--
-- Name: approval_request; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.approval_request (
    approval_id uuid DEFAULT gen_random_uuid() NOT NULL,
    approval_type text NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    reason_code text,
    reason_text text,
    requested_by uuid NOT NULL,
    requester_name text NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_by uuid,
    decider_name text,
    decided_at timestamp with time zone,
    decision_comment text,
    CONSTRAINT approval_request_approval_type_check CHECK ((approval_type = ANY (ARRAY['ITEM_POLICY'::text, 'ALLOC_PRIORITY'::text, 'EVENT_ORDER'::text, 'PURCHASE_PLAN'::text]))),
    CONSTRAINT approval_request_decision_check CHECK ((((status = 'PENDING'::text) AND (decided_by IS NULL) AND (decider_name IS NULL) AND (decided_at IS NULL) AND (decision_comment IS NULL)) OR ((status = 'APPROVED'::text) AND (decided_by IS NOT NULL) AND (NULLIF(btrim(decider_name), ''::text) IS NOT NULL) AND (decided_at IS NOT NULL)) OR ((status = 'REJECTED'::text) AND (decided_by IS NOT NULL) AND (decided_at IS NOT NULL) AND (NULLIF(btrim(decider_name), ''::text) IS NOT NULL) AND (NULLIF(btrim(decision_comment), ''::text) IS NOT NULL)) OR ((status = 'CANCELLED'::text) AND (decided_by IS NOT NULL) AND (NULLIF(btrim(decider_name), ''::text) IS NOT NULL) AND (decided_at IS NOT NULL)))),
    CONSTRAINT approval_request_payload_check CHECK ((jsonb_typeof(payload) = 'object'::text)),
    CONSTRAINT approval_request_requester_name_check CHECK ((btrim(requester_name) <> ''::text)),
    CONSTRAINT approval_request_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELLED'::text]))),
    CONSTRAINT approval_request_target_id_check CHECK ((btrim(target_id) <> ''::text)),
    CONSTRAINT approval_request_target_type_check CHECK ((btrim(target_type) <> ''::text))
);


--
-- Name: TABLE approval_request; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.approval_request IS 'Task 2 공통 승인 원장. 승인 후 도메인 반영은 후속 Task에서 연결합니다';


--
-- Name: v_approval_history; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_approval_history WITH (security_invoker='true') AS
 SELECT approval_id,
    approval_type,
    target_type,
    target_id,
    payload,
    status,
    reason_code,
    reason_text,
    requested_by,
    requested_at,
    decided_by,
    decided_at,
    decision_comment,
    requester_name,
    decider_name
   FROM core.approval_request r
  WHERE ((requested_by = auth.uid()) OR (decided_by = auth.uid()) OR core.has_permission(
        CASE approval_type
            WHEN 'ITEM_POLICY'::text THEN 'ITEM_POLICY_APPROVE'::text
            WHEN 'ALLOC_PRIORITY'::text THEN 'ALLOC_PRIORITY_APPROVE'::text
            WHEN 'EVENT_ORDER'::text THEN 'EVENT_ORDER_APPROVE'::text
            WHEN 'PURCHASE_PLAN'::text THEN 'PLAN_APPROVE'::text
            ELSE NULL::text
        END));


--
-- Name: VIEW v_approval_history; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_approval_history IS '현재 사용자의 요청·처리 이력과 승인 권한 범위 이력';


--
-- Name: event_demand; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.event_demand (
    event_demand_id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_month date NOT NULL,
    item_id text NOT NULL,
    customer_name text NOT NULL,
    qty numeric NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    approval_id uuid,
    requested_by uuid NOT NULL,
    requested_by_name text NOT NULL,
    requested_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    decided_by uuid,
    decided_by_name text,
    decided_at timestamp with time zone,
    decision_comment text,
    CONSTRAINT event_demand_customer_name_check CHECK ((btrim(customer_name) <> ''::text)),
    CONSTRAINT event_demand_decision_check CHECK ((((status = 'PENDING'::text) AND (decided_by IS NULL) AND (decided_at IS NULL) AND (decided_by_name IS NULL)) OR ((status = ANY (ARRAY['APPROVED'::text, 'REJECTED'::text])) AND (decided_by IS NOT NULL) AND (decided_at IS NOT NULL) AND (NULLIF(btrim(decided_by_name), ''::text) IS NOT NULL)))),
    CONSTRAINT event_demand_item_id_check CHECK ((btrim(item_id) <> ''::text)),
    CONSTRAINT event_demand_plan_month_check CHECK ((plan_month = (date_trunc('month'::text, (plan_month)::timestamp with time zone))::date)),
    CONSTRAINT event_demand_qty_check CHECK ((qty > (0)::numeric)),
    CONSTRAINT event_demand_reason_check CHECK ((btrim(reason) <> ''::text)),
    CONSTRAINT event_demand_requested_by_name_check CHECK ((btrim(requested_by_name) <> ''::text)),
    CONSTRAINT event_demand_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text])))
);


--
-- Name: TABLE event_demand; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.event_demand IS 'Task 8 — 이벤트성 대량 거래 추가 발주 요청(SCM팀장 승인, EVENT_ORDER_APPROVE). 승인 전 0건, 승인 후 전량, 반려 후 0건으로 집계된다(analytics.v_approved_demand_detail). 승인/반려는 core.approval_request (approval_type = EVENT_ORDER)를 그대로 쓰고 이 표는 그 결정 결과만 반영한다';


--
-- Name: supply_meeting_result; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.supply_meeting_result (
    result_id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_month date NOT NULL,
    item_id text NOT NULL,
    qty numeric NOT NULL,
    approved boolean DEFAULT false NOT NULL,
    basis_submission_line_id uuid,
    entered_by uuid NOT NULL,
    entered_by_name text NOT NULL,
    entered_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_by uuid NOT NULL,
    updated_by_name text NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT supply_meeting_result_entered_by_name_check CHECK ((btrim(entered_by_name) <> ''::text)),
    CONSTRAINT supply_meeting_result_item_id_check CHECK ((btrim(item_id) <> ''::text)),
    CONSTRAINT supply_meeting_result_plan_month_check CHECK ((plan_month = (date_trunc('month'::text, (plan_month)::timestamp with time zone))::date)),
    CONSTRAINT supply_meeting_result_qty_check CHECK ((qty >= (0)::numeric)),
    CONSTRAINT supply_meeting_result_updated_by_name_check CHECK ((btrim(updated_by_name) <> ''::text))
);


--
-- Name: TABLE supply_meeting_result; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.supply_meeting_result IS 'Task 8 — 수급회의 결과 대리 입력(SCM 품목담당자, SUPPLY_MEETING_INPUT). 계획월·품목당 한 행만 최신값을 보관하고, 수정 이력은 core.supply_meeting_result_event에 append-only로 남긴다. 팀장 승인 절차 없음(stage1.md §5)';


--
-- Name: COLUMN supply_meeting_result.basis_submission_line_id; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.supply_meeting_result.basis_submission_line_id IS '선택적 참고 근거(AGREED 부서 제출 줄). 이 값이 있어도 부서 제출 수량은 집계에 직접 합산되지 않는다';


--
-- Name: v_approved_demand_source; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_approved_demand_source AS
 SELECT source_code,
    plan_month,
    item_id,
    item_name,
    qty,
    counted,
    exclusion_reason,
    reference_id,
    reference_label,
    customer_name,
    entered_by_name,
    entered_at,
    decision_comment,
    status_label
   FROM ( SELECT 'CONFIRMED_ORDER'::text AS source_code,
            (date_trunc('month'::text, (o.confirmed_at AT TIME ZONE 'Asia/Seoul'::text)))::date AS plan_month,
            l.item_id,
            im1.item_name,
            l.requested_qty AS qty,
            true AS counted,
            NULL::text AS exclusion_reason,
            (o.order_id)::text AS reference_id,
            o.order_no AS reference_label,
            o.customer_name,
            core.order_actor_name(o.confirmed_by) AS entered_by_name,
            o.confirmed_at AS entered_at,
            NULL::text AS decision_comment,
            'CONFIRMED'::text AS status_label
           FROM ((core.sales_order o
             JOIN core.sales_order_line l ON ((l.order_id = o.order_id)))
             LEFT JOIN core.v_item_master im1 ON ((im1.item_id = l.item_id)))
          WHERE ((o.status = 'CONFIRMED'::text) AND (NULLIF(btrim(o.confirmed_order_no), ''::text) IS NOT NULL))
        UNION ALL
         SELECT 'SUPPLY_MEETING'::text AS source_code,
            m.plan_month,
            m.item_id,
            im2.item_name,
            m.qty,
            m.approved AS counted,
                CASE
                    WHEN (NOT m.approved) THEN 'MEETING_NOT_APPROVED'::text
                    ELSE NULL::text
                END AS exclusion_reason,
            (m.result_id)::text AS reference_id,
            NULL::text AS reference_label,
            NULL::text AS customer_name,
            m.updated_by_name AS entered_by_name,
            m.updated_at AS entered_at,
            NULL::text AS decision_comment,
                CASE
                    WHEN m.approved THEN 'APPROVED'::text
                    ELSE 'NOT_APPROVED'::text
                END AS status_label
           FROM (core.supply_meeting_result m
             LEFT JOIN core.v_item_master im2 ON ((im2.item_id = m.item_id)))
        UNION ALL
         SELECT 'EVENT_DEMAND'::text AS source_code,
            e.plan_month,
            e.item_id,
            im3.item_name,
            e.qty,
            (e.status = 'APPROVED'::text) AS counted,
                CASE
                    WHEN (e.status = 'PENDING'::text) THEN 'EVENT_NOT_APPROVED'::text
                    WHEN (e.status = 'REJECTED'::text) THEN 'EVENT_REJECTED'::text
                    ELSE NULL::text
                END AS exclusion_reason,
            (e.event_demand_id)::text AS reference_id,
            e.reason AS reference_label,
            e.customer_name,
            e.requested_by_name AS entered_by_name,
            e.requested_at AS entered_at,
            e.decision_comment,
            e.status AS status_label
           FROM (core.event_demand e
             LEFT JOIN core.v_item_master im3 ON ((im3.item_id = e.item_id)))) src
  WHERE (core.has_permission('DEMAND_CONSOLIDATE'::text) OR core.has_permission('PLAN_CONFIRM'::text) OR core.has_permission('PLAN_APPROVE'::text) OR core.has_permission('EVENT_ORDER_APPROVE'::text) OR core.has_permission('SUPPLY_MEETING_INPUT'::text) OR core.is_admin());


--
-- Name: VIEW v_approved_demand_source; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON VIEW core.v_approved_demand_source IS 'Task 8 — 소유자 권한 뷰(core.v_item_allocation_qty와 같은 이유). CONFIRMED_ORDER·SUPPLY_MEETING·EVENT_DEMAND 세 원천을 한 행씩 모으고, 뷰 자체의 WHERE 절이 조회 권한을 판정한다. sales_probability나 파트너 선주문·미승인 이벤트는 이 뷰에 애초에 없다(조인하지 않는다) — 컨트롤러 판정 3';


--
-- Name: v_approved_demand_detail; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_approved_demand_detail WITH (security_invoker='true') AS
 SELECT source_code,
    plan_month,
    item_id,
    item_name,
    qty,
    counted,
    exclusion_reason,
    reference_id,
    reference_label,
    customer_name,
    entered_by_name,
    entered_at,
    decision_comment,
    status_label
   FROM core.v_approved_demand_source;


--
-- Name: VIEW v_approved_demand_detail; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_approved_demand_detail IS 'Task 8 — 원천별 상세. counted = false인 행은 화면에 보이되 exclusion_reason으로 제외 사유를 표시한다(MEETING_NOT_APPROVED · EVENT_NOT_APPROVED · EVENT_REJECTED). 합계는 이 표에서 TS로 다시 더하지 않고 analytics.v_approved_demand_monthly의 저장된 합계를 그대로 쓴다';


--
-- Name: v_approved_demand_monthly; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_approved_demand_monthly WITH (security_invoker='true') AS
 SELECT plan_month,
    item_id,
    item_name,
    COALESCE(sum(qty) FILTER (WHERE counted), (0)::numeric) AS approved_qty,
    COALESCE(sum(qty) FILTER (WHERE (counted AND (source_code = 'CONFIRMED_ORDER'::text))), (0)::numeric) AS confirmed_order_qty,
    COALESCE(sum(qty) FILTER (WHERE (counted AND (source_code = 'SUPPLY_MEETING'::text))), (0)::numeric) AS supply_meeting_qty,
    COALESCE(sum(qty) FILTER (WHERE (counted AND (source_code = 'EVENT_DEMAND'::text))), (0)::numeric) AS event_demand_qty
   FROM analytics.v_approved_demand_detail
  GROUP BY plan_month, item_id, item_name;


--
-- Name: VIEW v_approved_demand_monthly; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_approved_demand_monthly IS 'Task 8 — Task 9의 유일한 추가 수요 입력. approved_qty = 확정 수주 + 승인된 수급회의 + 승인된 이벤트 추가 수요. sales_probability·파트너 선주문·미승인 이벤트는 참조하지 않는다';


--
-- Name: item_visibility_rule; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.item_visibility_rule (
    raw_item_type text NOT NULL,
    visibility_scope text NOT NULL,
    description text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT item_visibility_rule_visibility_scope_check CHECK ((visibility_scope = ANY (ARRAY['PAPER_CARD_READER'::text, 'CONSUMABLE'::text, 'GENERAL'::text])))
);


--
-- Name: TABLE item_visibility_rule; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.item_visibility_rule IS 'stage1 §2 — 품목구분을 조회 범위로 매핑. 매핑에 없는 품목구분은 GENERAL로 취급한다(제외하지 않는다)';


--
-- Name: leadtime_plan; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.leadtime_plan (
    supplier_id text NOT NULL,
    planned_lead_time integer,
    basis text,
    service_level numeric,
    confirmed_reason text,
    confirmed_at timestamp with time zone DEFAULT now()
);


--
-- Name: shipment_log; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.shipment_log (
    shipment_id text,
    po_no text,
    item_id text,
    supplier_id text,
    country text,
    transport_mode text,
    order_date date,
    due_date date,
    supplier_ship_date date,
    port_departure_date date,
    port_arrival_date date,
    customs_clear_date date,
    warehouse_receipt_date date,
    qc_release_date date,
    qty numeric,
    warehouse text,
    status text,
    incident_note text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);


--
-- Name: v_fact_shipment; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_fact_shipment AS
 SELECT shipment_id,
    upper(regexp_replace(COALESCE(po_no, ''::text), '[\s\-_]'::text, ''::text, 'g'::text)) AS po_no,
    upper(regexp_replace(COALESCE(item_id, ''::text), '[\s\-_]'::text, ''::text, 'g'::text)) AS item_id,
    supplier_id,
    country,
        CASE upper(TRIM(BOTH FROM transport_mode))
            WHEN '해상'::text THEN 'SEA'::text
            WHEN '항공'::text THEN 'AIR'::text
            ELSE upper(TRIM(BOTH FROM transport_mode))
        END AS transport_mode,
    order_date,
    due_date,
    supplier_ship_date,
    port_departure_date,
    port_arrival_date,
    customs_clear_date,
    warehouse_receipt_date,
    qc_release_date,
    qty,
    status,
    NULLIF(TRIM(BOTH FROM COALESCE(incident_note, ''::text)), ''::text) AS incident_note,
    (supplier_ship_date - order_date) AS seg_order_to_ship,
    (qc_release_date - supplier_ship_date) AS seg_ship_to_receive,
    (qc_release_date - order_date) AS lt_total,
        CASE
            WHEN (status = 'IN_TRANSIT'::text) THEN 'IN_TRANSIT'::text
            WHEN ((order_date IS NULL) OR (qc_release_date IS NULL)) THEN 'MISSING_DATE'::text
            WHEN (qc_release_date < warehouse_receipt_date) THEN 'IMPOSSIBLE_ORDER'::text
            WHEN (warehouse_receipt_date < order_date) THEN 'IMPOSSIBLE_ORDER'::text
            ELSE 'OK'::text
        END AS quality_flag
   FROM raw.shipment_log s;


--
-- Name: v_shipment_valid; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_shipment_valid AS
 SELECT shipment_id,
    po_no,
    item_id,
    supplier_id,
    country,
    transport_mode,
    order_date,
    due_date,
    supplier_ship_date,
    port_departure_date,
    port_arrival_date,
    customs_clear_date,
    warehouse_receipt_date,
    qc_release_date,
    qty,
    status,
    incident_note,
    seg_order_to_ship,
    seg_ship_to_receive,
    lt_total,
    quality_flag
   FROM core.v_fact_shipment
  WHERE ((status = 'COMPLETED'::text) AND (quality_flag = 'OK'::text) AND (lt_total > 0));


--
-- Name: supplier_master; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.supplier_master (
    "공급업체코드" text,
    "공급업체명" text,
    "국가" text,
    "표준리드타임(일)" text,
    "담당자" text,
    "사용여부" text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);


--
-- Name: v_leadtime_stat; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_leadtime_stat AS
 SELECT v.supplier_id,
    s."공급업체명" AS supplier_name,
    v.country,
    count(*) AS n_samples,
    round(avg(v.seg_order_to_ship), 1) AS avg_order_to_ship,
    round(avg(v.seg_ship_to_receive), 1) AS avg_ship_to_receive,
    round(avg(v.lt_total), 1) AS mean_days,
    (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((v.lt_total)::double precision)))::integer AS p50_days,
    (percentile_cont((0.8)::double precision) WITHIN GROUP (ORDER BY ((v.lt_total)::double precision)))::integer AS p80_days,
    (percentile_cont((0.9)::double precision) WITHIN GROUP (ORDER BY ((v.lt_total)::double precision)))::integer AS p90_days,
    round(stddev_samp(v.lt_total), 1) AS std_days,
    max(v.lt_total) AS max_days,
        CASE
            WHEN (count(*) >= 30) THEN 'HIGH'::text
            WHEN (count(*) >= 10) THEN 'MEDIUM'::text
            ELSE 'LOW'::text
        END AS confidence
   FROM (core.v_shipment_valid v
     JOIN raw.supplier_master s ON ((s."공급업체코드" = v.supplier_id)))
  GROUP BY v.supplier_id, s."공급업체명", v.country;


--
-- Name: v_leadtime_effective; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_leadtime_effective AS
 SELECT st.supplier_id,
    st.supplier_name,
    st.country,
    st.n_samples,
    st.p80_days,
    p.planned_lead_time,
    COALESCE(p.planned_lead_time, st.p80_days) AS effective_lead_time,
        CASE
            WHEN (p.planned_lead_time IS NOT NULL) THEN '확정값'::text
            ELSE '실적 P80'::text
        END AS source
   FROM (core.v_leadtime_stat st
     LEFT JOIN core.leadtime_plan p ON ((p.supplier_id = st.supplier_id)));


--
-- Name: v_inbound_qty; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_inbound_qty AS
 SELECT item_id,
    sum(qty) AS inbound_qty,
    count(*) AS inbound_shipments,
    min((order_date + COALESCE(( SELECT e.effective_lead_time
           FROM core.v_leadtime_effective e
          WHERE (e.supplier_id = f.supplier_id)), 30))) AS earliest_eta
   FROM core.v_fact_shipment f
  WHERE (status = 'IN_TRANSIT'::text)
  GROUP BY item_id;


--
-- Name: goods_receipt; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.goods_receipt (
    "입고번호" text,
    "발주번호" text,
    "품목코드" text,
    "입고수량" text,
    "입고일" text,
    "입고창고" text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text,
    receipt_status text
);


--
-- Name: COLUMN goods_receipt.receipt_status; Type: COMMENT; Schema: raw; Owner: -
--

COMMENT ON COLUMN raw.goods_receipt.receipt_status IS '입고 완료 상태. "입고일" + receipt_status=COMPLETED 두 조건을 모두 만족해야 참고 열에 반영한다';


--
-- Name: purchase_order; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.purchase_order (
    "발주번호" text,
    "발주일" text,
    "공급업체" text,
    "품목코드" text,
    "발주수량" text,
    "단가" text,
    "납기예정일" text,
    "발주담당" text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);


--
-- Name: v_open_po_qty; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_open_po_qty AS
 WITH ordered AS (
         SELECT upper(regexp_replace(p."품목코드", '[\s\-_]'::text, ''::text, 'g'::text)) AS item_id,
            sum((NULLIF(p."발주수량", ''::text))::numeric) AS ordered_qty
           FROM raw.purchase_order p
          GROUP BY (upper(regexp_replace(p."품목코드", '[\s\-_]'::text, ''::text, 'g'::text)))
        ), received AS (
         SELECT upper(regexp_replace(g."품목코드", '[\s\-_]'::text, ''::text, 'g'::text)) AS item_id,
            sum((NULLIF(g."입고수량", ''::text))::numeric) AS received_qty
           FROM raw.goods_receipt g
          WHERE ((NULLIF(g."입고일", ''::text) IS NOT NULL) AND (g.receipt_status = 'COMPLETED'::text))
          GROUP BY (upper(regexp_replace(g."품목코드", '[\s\-_]'::text, ''::text, 'g'::text)))
        )
 SELECT o.item_id,
    GREATEST((0)::numeric, (o.ordered_qty - COALESCE(r.received_qty, (0)::numeric))) AS open_po_qty
   FROM (ordered o
     LEFT JOIN received r ON ((r.item_id = o.item_id)));


--
-- Name: VIEW v_open_po_qty; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON VIEW core.v_open_po_qty IS '품목별 Open PO 참고 수량 = 발주수량 합 - 입고완료(입고일 존재 + receipt_status=COMPLETED) 합. 음수는 0으로 clamp한다. 가용재고 계산에는 더하지 않는 참고 열이다';


--
-- Name: v_available_stock; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_available_stock WITH (security_invoker='true') AS
 SELECT im.item_id,
    im.item_name,
    im.item_type,
    COALESCE(ivr.visibility_scope, 'GENERAL'::text) AS visibility_scope,
    sb.normal_qty AS normal_warehouse_qty,
    sb.snapshot_at,
    COALESCE(aq.temporary_allocated_qty, (0)::numeric) AS temporary_allocated_qty,
    COALESCE(aq.firm_allocated_qty, (0)::numeric) AS firm_allocated_qty,
    COALESCE(aq.approval_hold_qty, (0)::numeric) AS approval_hold_qty,
        CASE
            WHEN (sb.normal_qty IS NULL) THEN NULL::numeric
            ELSE (sb.normal_qty - COALESCE(aq.committed_qty, (0)::numeric))
        END AS available_qty,
    po.open_po_qty,
    ib.inbound_qty AS in_transit_qty,
        CASE
            WHEN (sb.item_id IS NULL) THEN 'INVENTORY_SCOPE_UNCLASSIFIED'::text
            ELSE NULL::text
        END AS reason_code
   FROM (((((core.v_item_master im
     LEFT JOIN core.item_visibility_rule ivr ON ((ivr.raw_item_type = im.item_type)))
     LEFT JOIN core.stock_balance sb ON ((sb.item_id = im.item_id)))
     LEFT JOIN core.v_item_allocation_qty aq ON ((aq.item_id = im.item_id)))
     LEFT JOIN core.v_inbound_qty ib ON ((ib.item_id = im.item_id)))
     LEFT JOIN core.v_open_po_qty po ON ((po.item_id = im.item_id)))
  WHERE (core.has_permission('STOCK_VIEW_ALL'::text) OR (core.has_permission('STOCK_VIEW_PAPER'::text) AND (COALESCE(ivr.visibility_scope, 'GENERAL'::text) = 'PAPER_CARD_READER'::text)) OR (core.has_permission('STOCK_VIEW_SUPPLY'::text) AND (COALESCE(ivr.visibility_scope, 'GENERAL'::text) = 'CONSUMABLE'::text)));


--
-- Name: VIEW v_available_stock; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_available_stock IS 'Task 4 · 5 — 부서 권한과 품목 범위로 제한한 정상 창고재고 · 가용재고 상세. 가용재고 = 정상 창고재고 − 임시배정 − 확정배정 − 승인대기 확보(core.v_item_allocation_qty). 분류 불가 품목은 null + INVENTORY_SCOPE_UNCLASSIFIED';


--
-- Name: backtest_run; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.backtest_run (
    backtest_run_id uuid DEFAULT gen_random_uuid() NOT NULL,
    forecast_run_id uuid NOT NULL,
    test_start date,
    test_end date,
    metric text NOT NULL,
    reference_model_id text,
    status text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    triggered_by uuid,
    message text,
    test_input_row_count bigint,
    test_input_qty_sum numeric,
    test_input_max_loaded_at timestamp with time zone,
    test_input_md5 text,
    test_input_fingerprinted_at timestamp with time zone,
    CONSTRAINT backtest_run_status_check CHECK ((status = ANY (ARRAY['RUNNING'::text, 'SUCCESS'::text, 'FAILED'::text])))
);


--
-- Name: COLUMN backtest_run.test_input_md5; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.backtest_run.test_input_md5 IS 'Task 9b — Backtest가 SUCCESS가 될 때 core.v_test_actual 행의 md5(정렬한 품목 · 일자 · 수량 · 배치). null이면 입력 추적 불가';


--
-- Name: v_backtest_run; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_backtest_run AS
 SELECT backtest_run_id,
    forecast_run_id,
    test_start,
    test_end,
    metric,
    reference_model_id,
    status,
    started_at,
    finished_at,
    triggered_by,
    message
   FROM core.backtest_run;


--
-- Name: dim_item; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.dim_item (
    item_code text NOT NULL,
    hoc_code text,
    description text,
    family text,
    item_type text,
    source_types text
);


--
-- Name: TABLE dim_item; Type: COMMENT; Schema: raw; Owner: -
--

COMMENT ON TABLE raw.dim_item IS '품목 통합 마스터. 실데이터 원본. 수정 금지';


--
-- Name: v_item; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_item AS
 SELECT item_code,
    COALESCE(NULLIF(btrim(hoc_code), ''::text), item_code) AS hoc_code,
    description,
    family,
    item_type,
    source_types
   FROM raw.dim_item;


--
-- Name: bridge_bom; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.bridge_bom (
    model_key text,
    model_base text,
    bom_group text,
    item_code text,
    qty numeric(18,4),
    active text,
    start_date text,
    end_date text,
    source_file text
);


--
-- Name: bridge_cap_option; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.bridge_cap_option (
    model_key text,
    cap_item_code text,
    option_item_code text,
    option_desc text,
    role text
);


--
-- Name: bridge_mc_cap; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.bridge_mc_cap (
    model_key text,
    model_base text,
    predecessor_model text,
    cap_item_code text,
    cap_item_name text,
    neutral_item_code text,
    remark text
);


--
-- Name: v_bom_requirement; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_bom_requirement AS
 WITH cap AS (
         SELECT bridge_mc_cap.model_base,
            bridge_mc_cap.model_key,
            bridge_mc_cap.cap_item_code,
            bridge_mc_cap.cap_item_name,
            bridge_mc_cap.neutral_item_code
           FROM raw.bridge_mc_cap
          WHERE ((bridge_mc_cap.model_base IS NOT NULL) AND (btrim(bridge_mc_cap.model_base) <> ''::text))
        )
 SELECT c.model_base,
    c.model_key,
    'CAP'::text AS part_role,
    c.cap_item_code AS item_code,
    COALESCE(NULLIF(btrim(c.cap_item_name), ''::text), i.description) AS description,
    (1)::numeric AS qty,
    NULL::text AS bom_group
   FROM (cap c
     LEFT JOIN core.v_item i ON ((i.item_code = c.cap_item_code)))
UNION ALL
 SELECT c.model_base,
    c.model_key,
    'NEUTRAL'::text AS part_role,
    c.neutral_item_code AS item_code,
    i.description,
    (1)::numeric AS qty,
    NULL::text AS bom_group
   FROM (cap c
     LEFT JOIN core.v_item i ON ((i.item_code = c.neutral_item_code)))
  WHERE ((c.neutral_item_code IS NOT NULL) AND (btrim(c.neutral_item_code) <> ''::text))
UNION ALL
 SELECT c.model_base,
    c.model_key,
    o.role AS part_role,
    o.option_item_code AS item_code,
    COALESCE(NULLIF(btrim(o.option_desc), ''::text), i.description) AS description,
    (1)::numeric AS qty,
    NULL::text AS bom_group
   FROM ((raw.bridge_cap_option o
     JOIN cap c ON ((c.cap_item_code = o.cap_item_code)))
     LEFT JOIN core.v_item i ON ((i.item_code = o.option_item_code)))
UNION ALL
 SELECT b.model_base,
    b.model_key,
    'BOM'::text AS part_role,
    b.item_code,
    i.description,
    COALESCE(b.qty, (1)::numeric) AS qty,
    b.bom_group
   FROM (raw.bridge_bom b
     LEFT JOIN core.v_item i ON ((i.item_code = b.item_code)))
  WHERE ((b.model_base IS NOT NULL) AND (btrim(b.model_base) <> ''::text) AND (COALESCE(btrim(b.active), ''::text) <> 'X'::text));


--
-- Name: VIEW v_bom_requirement; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_bom_requirement IS '기종 1대 판매 시 필요한 CAP · Neutral · 필수옵션 · SCC · BOM 구성 통합';


--
-- Name: bridge_option_model; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.bridge_option_model (
    item_code text,
    model_key text,
    model_base text,
    link_type text,
    cat text,
    common text,
    detail text
);


--
-- Name: v_option_commonality; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_option_commonality AS
 SELECT item_code,
    count(DISTINCT model_base) FILTER (WHERE (model_base IS NOT NULL)) AS n_models,
    max(common) AS common_flag
   FROM raw.bridge_option_model
  GROUP BY item_code;


--
-- Name: v_bom_requirement_x; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_bom_requirement_x AS
 SELECT r.model_base,
    r.model_key,
    r.part_role,
    r.item_code,
    r.description,
    r.qty,
    r.bom_group,
    oc.n_models,
    oc.common_flag,
        CASE
            WHEN (oc.common_flag = 'COMMON'::text) THEN '복수 기종 공용 — 기종별 합산 시 이중 계상 주의'::text
            ELSE NULL::text
        END AS common_note
   FROM (analytics.v_bom_requirement r
     LEFT JOIN core.v_option_commonality oc ON ((oc.item_code = r.item_code)));


--
-- Name: app_user; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.app_user (
    user_id uuid NOT NULL,
    email text NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    department text,
    role text DEFAULT 'USER'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    job_role text,
    CONSTRAINT app_user_role_check CHECK ((role = ANY (ARRAY['ADMIN'::text, 'USER'::text])))
);


--
-- Name: COLUMN app_user.department; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.app_user.department IS '소속 부서 — SCM · MARKETING · SALES · SERVICE · BIZ_DEV';


--
-- Name: COLUMN app_user.job_role; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.app_user.job_role IS '업무 직책 — 권한은 이 값으로 결정됩니다. role(ADMIN·USER)과 다른 축입니다';


--
-- Name: business_calendar; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.business_calendar (
    country_code text NOT NULL,
    calendar_date date NOT NULL,
    is_business_day boolean NOT NULL,
    holiday_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE business_calendar; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.business_calendar IS 'stage1 §8 — 영업일 판정. 행이 없는 날짜는 주말 여부로만 판정합니다';


--
-- Name: business_calendar_readiness; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.business_calendar_readiness (
    country_code text NOT NULL,
    cal_year integer NOT NULL,
    cal_month integer NOT NULL,
    ready boolean DEFAULT false NOT NULL,
    note text,
    marked_by uuid,
    marked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT business_calendar_readiness_cal_month_check CHECK (((cal_month >= 1) AND (cal_month <= 12))),
    CONSTRAINT business_calendar_readiness_cal_year_check CHECK (((cal_year >= 2000) AND (cal_year <= 2100)))
);


--
-- Name: TABLE business_calendar_readiness; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.business_calendar_readiness IS 'Task 10a — 국가·연·월 단위 "공휴일을 다 입력했다" 선언. 공휴일을 자동 생성하지 않고 관리자가 직접 표시한다';


--
-- Name: v_calendar_readiness; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_calendar_readiness AS
 SELECT r.country_code,
    r.cal_year,
    r.cal_month,
    r.ready,
    r.note,
    r.marked_by,
    u.name AS marked_by_name,
    r.marked_at,
    ( SELECT count(*) AS count
           FROM core.business_calendar c
          WHERE ((c.country_code = r.country_code) AND (c.is_business_day = false) AND ((EXTRACT(year FROM c.calendar_date))::integer = r.cal_year) AND ((EXTRACT(month FROM c.calendar_date))::integer = r.cal_month))) AS n_holidays
   FROM (core.business_calendar_readiness r
     LEFT JOIN core.app_user u ON ((u.user_id = r.marked_by)))
  WHERE core.is_admin();


--
-- Name: VIEW v_calendar_readiness; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_calendar_readiness IS 'Task 10a — 국가·연·월별 "공휴일을 다 입력했다" 선언과 등록된 공휴일 수. 행이 없으면 아직 선언하지 않은 달이다(준비 안 됨으로 취급). 관리자(core.is_admin())만 조회한다';


--
-- Name: champion_model_selection; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.champion_model_selection (
    selection_id uuid DEFAULT gen_random_uuid() NOT NULL,
    backtest_run_id uuid NOT NULL,
    item_id text NOT NULL,
    champion_model_id text,
    model_version uuid,
    champion_metric text NOT NULL,
    champion_metric_value numeric,
    wape numeric,
    mape numeric,
    bias numeric,
    rmse numeric,
    mae numeric,
    candidate_performance jsonb DEFAULT '[]'::jsonb NOT NULL,
    selection_reason text NOT NULL,
    selection_method text NOT NULL,
    selected_at timestamp with time zone DEFAULT now() NOT NULL,
    selected_by uuid,
    CONSTRAINT champion_model_selection_selection_method_check CHECK ((selection_method = ANY (ARRAY['AUTO'::text, 'MANUAL'::text])))
);


--
-- Name: v_champion_model; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_champion_model AS
 SELECT DISTINCT ON (item_id) selection_id,
    backtest_run_id,
    item_id,
    champion_model_id,
    model_version,
    champion_metric,
    champion_metric_value,
    wape,
    mape,
    bias,
    rmse,
    mae,
    candidate_performance,
    selection_reason,
    selection_method,
    selected_at,
    selected_by
   FROM core.champion_model_selection
  ORDER BY item_id, selected_at DESC;


--
-- Name: planning_cycle; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.planning_cycle (
    cycle_id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_month date NOT NULL,
    submission_deadline date NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    opened_by uuid NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_by uuid,
    closed_at timestamp with time zone,
    CONSTRAINT planning_cycle_close_check CHECK ((((status = 'OPEN'::text) AND is_active AND (closed_by IS NULL) AND (closed_at IS NULL)) OR ((status = 'CLOSED'::text) AND (NOT is_active) AND (closed_by IS NOT NULL) AND (closed_at IS NOT NULL)))),
    CONSTRAINT planning_cycle_plan_month_check CHECK ((plan_month = (date_trunc('month'::text, (plan_month)::timestamp with time zone))::date)),
    CONSTRAINT planning_cycle_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'CLOSED'::text])))
);


--
-- Name: TABLE planning_cycle; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.planning_cycle IS 'Task 7 — SCM 품목담당자(PLAN_CONFIRM) 또는 ADMIN이 여는 월별 수요 취합 주기';


--
-- Name: v_current_planning_cycle; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_current_planning_cycle WITH (security_invoker='true') AS
 SELECT c.cycle_id,
    c.plan_month,
    c.status,
    c.submission_deadline,
    c.is_active,
    c.opened_at,
        CASE
            WHEN (c.cycle_id IS NULL) THEN 'PLANNING_CYCLE_NOT_OPEN'::text
            ELSE NULL::text
        END AS reason_code
   FROM (( VALUES (1)) base(x)
     LEFT JOIN ( SELECT planning_cycle.cycle_id,
            planning_cycle.plan_month,
            planning_cycle.submission_deadline,
            planning_cycle.status,
            planning_cycle.is_active,
            planning_cycle.opened_by,
            planning_cycle.opened_at,
            planning_cycle.closed_by,
            planning_cycle.closed_at
           FROM core.planning_cycle
          WHERE planning_cycle.is_active
          ORDER BY planning_cycle.plan_month DESC, planning_cycle.opened_at DESC
         LIMIT 1) c ON (true));


--
-- Name: VIEW v_current_planning_cycle; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_current_planning_cycle IS 'Task 12 — 운영 기준월과 취합 주기 상태를 한 행으로 돌려준다. 활성 주기가 없으면 null + PLANNING_CYCLE_NOT_OPEN(행은 항상 1개). 대시보드 · 사이드바 · 상단바가 이 값으로 하드코딩된 기준월을 대체한다(procurement-app.tsx 레거시 프로토타입은 대상이 아니다)';


--
-- Name: forecast_setting; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.forecast_setting (
    setting_id uuid DEFAULT gen_random_uuid() NOT NULL,
    active boolean DEFAULT true NOT NULL,
    train_start date,
    train_end date,
    test_start date,
    test_end date,
    granularity text DEFAULT 'DAY'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    forecast_horizon integer DEFAULT 3 NOT NULL,
    champion_metric text DEFAULT 'WAPE'::text NOT NULL,
    reference_model_id text DEFAULT 'WMA_3M'::text NOT NULL,
    CONSTRAINT forecast_setting_granularity_check CHECK ((granularity = ANY (ARRAY['DAY'::text, 'WEEK'::text, 'MONTH'::text]))),
    CONSTRAINT forecast_setting_horizon_positive CHECK ((forecast_horizon > 0))
);


--
-- Name: usage_history; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.usage_history (
    usage_id text,
    item_id text,
    use_date date,
    qty numeric,
    warehouse text,
    note text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);


--
-- Name: v_test_actual; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_test_actual AS
 WITH active_setting AS (
         SELECT forecast_setting.test_start,
            forecast_setting.test_end
           FROM core.forecast_setting
          WHERE (forecast_setting.active AND core.is_valid_forecast_window(forecast_setting.train_start, forecast_setting.train_end, forecast_setting.test_start, forecast_setting.test_end, forecast_setting.granularity))
          ORDER BY forecast_setting.updated_at DESC
         LIMIT 1
        )
 SELECT u.usage_id,
    u.item_id,
    u.use_date,
    u.qty,
    u.warehouse,
    u.note,
    u.batch_id,
    u.source_type,
    u.loaded_at,
    u.source_record_id
   FROM (raw.usage_history u
     CROSS JOIN active_setting s)
  WHERE ((u.use_date >= s.test_start) AND (u.use_date <= s.test_end));


--
-- Name: v_train_demand; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_train_demand AS
 WITH active_setting AS (
         SELECT forecast_setting.train_start,
            forecast_setting.train_end
           FROM core.forecast_setting
          WHERE (forecast_setting.active AND core.is_valid_forecast_window(forecast_setting.train_start, forecast_setting.train_end, forecast_setting.test_start, forecast_setting.test_end, forecast_setting.granularity))
          ORDER BY forecast_setting.updated_at DESC
         LIMIT 1
        )
 SELECT u.usage_id,
    u.item_id,
    u.use_date,
    u.qty,
    u.warehouse,
    u.note,
    u.batch_id,
    u.source_type,
    u.loaded_at,
    u.source_record_id
   FROM (raw.usage_history u
     CROSS JOIN active_setting s)
  WHERE ((u.use_date >= s.train_start) AND (u.use_date <= s.train_end));


--
-- Name: v_data_coverage; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_data_coverage AS
 WITH data_coverage AS (
         SELECT min(usage_history.use_date) AS data_start,
            max(usage_history.use_date) AS data_end
           FROM raw.usage_history
        ), active_setting AS (
         SELECT forecast_setting.train_start,
            forecast_setting.train_end,
            forecast_setting.test_start,
            forecast_setting.test_end,
            forecast_setting.granularity
           FROM core.forecast_setting
          WHERE forecast_setting.active
          ORDER BY forecast_setting.updated_at DESC
         LIMIT 1
        ), train_rows AS (
         SELECT count(*) AS row_count
           FROM core.v_train_demand
        ), test_rows AS (
         SELECT count(*) AS row_count
           FROM core.v_test_actual
        )
 SELECT d.data_start,
    d.data_end,
    s.train_start,
    s.train_end,
    s.test_start,
    s.test_end,
    s.granularity,
    tr.row_count AS train_row_count,
    te.row_count AS test_row_count,
    COALESCE((core.is_valid_forecast_window(s.train_start, s.train_end, s.test_start, s.test_end, s.granularity) AND (d.data_start IS NOT NULL) AND (s.train_start >= d.data_start) AND (s.train_end <= d.data_end)), false) AS train_window_ok,
    COALESCE((core.is_valid_forecast_window(s.train_start, s.train_end, s.test_start, s.test_end, s.granularity) AND (d.data_start IS NOT NULL) AND (s.test_start >= d.data_start) AND (s.test_end <= d.data_end)), false) AS test_window_ok,
    COALESCE((core.is_valid_forecast_window(s.train_start, s.train_end, s.test_start, s.test_end, s.granularity) AND (d.data_start IS NOT NULL) AND (s.train_start >= d.data_start) AND (s.train_end <= d.data_end) AND (s.test_start >= d.data_start) AND (s.test_end <= d.data_end)), false) AS data_isolation_ok,
        CASE
            WHEN (NOT COALESCE(core.is_valid_forecast_window(s.train_start, s.train_end, s.test_start, s.test_end, s.granularity), false)) THEN 'BLOCKED_INVALID_SETTING'::text
            WHEN (NOT COALESCE(((d.data_start IS NOT NULL) AND (s.train_start >= d.data_start) AND (s.train_end <= d.data_end) AND (s.test_start >= d.data_start) AND (s.test_end <= d.data_end)), false)) THEN 'WINDOW_OUTSIDE_DATA'::text
            ELSE 'READY'::text
        END AS data_isolation_status
   FROM (((data_coverage d
     LEFT JOIN active_setting s ON (true))
     CROSS JOIN train_rows tr)
     CROSS JOIN test_rows te);


--
-- Name: policy_config; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.policy_config (
    policy_key text NOT NULL,
    policy_value jsonb NOT NULL,
    description text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: v_sku_demand_profile; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_sku_demand_profile AS
 WITH active_setting AS (
         SELECT forecast_setting.train_start,
            forecast_setting.train_end
           FROM core.forecast_setting
          WHERE (forecast_setting.active AND core.is_valid_forecast_window(forecast_setting.train_start, forecast_setting.train_end, forecast_setting.test_start, forecast_setting.test_end, forecast_setting.granularity))
          ORDER BY forecast_setting.updated_at DESC
         LIMIT 1
        ), policy AS (
         SELECT max(((policy_config.policy_value ->> 'value'::text))::numeric) FILTER (WHERE (policy_config.policy_key = 'SEASONALITY_INDEX_CV_THRESHOLD'::text)) AS seasonality_threshold,
            max(((policy_config.policy_value ->> 'value'::text))::integer) FILTER (WHERE (policy_config.policy_key = 'DEMAND_PROFILE_RECENT_PERIODS'::text)) AS recent_periods
           FROM core.policy_config
          WHERE policy_config.active
        ), periods AS (
         SELECT (generate_series(date_trunc('month'::text, (active_setting.train_start)::timestamp with time zone), date_trunc('month'::text, (active_setting.train_end)::timestamp with time zone), '1 mon'::interval))::date AS period
           FROM active_setting
        ), items AS (
         SELECT v_item_master.item_id,
            v_item_master.item_name
           FROM core.v_item_master
        ), monthly_demand AS (
         SELECT v_train_demand.item_id,
            (date_trunc('month'::text, (v_train_demand.use_date)::timestamp with time zone))::date AS period,
            sum(v_train_demand.qty) AS qty,
            count(v_train_demand.qty) AS n_qty
           FROM core.v_train_demand
          GROUP BY v_train_demand.item_id, ((date_trunc('month'::text, (v_train_demand.use_date)::timestamp with time zone))::date)
        ), grid AS (
         SELECT i.item_id,
            i.item_name,
            p_1.period,
            row_number() OVER (PARTITION BY i.item_id ORDER BY p_1.period) AS period_number,
                CASE
                    WHEN (d.item_id IS NULL) THEN (0)::numeric
                    WHEN (d.n_qty = 0) THEN NULL::numeric
                    ELSE d.qty
                END AS qty
           FROM ((items i
             CROSS JOIN periods p_1)
             LEFT JOIN monthly_demand d ON (((d.item_id = i.item_id) AND (d.period = p_1.period))))
        ), metrics AS (
         SELECT grid.item_id,
            max(grid.item_name) AS item_name,
            count(*) AS n_periods,
            count(*) FILTER (WHERE (grid.qty > (0)::numeric)) AS n_nonzero_periods,
            count(*) FILTER (WHERE (grid.qty IS NULL)) AS n_null_periods,
            avg(grid.qty) FILTER (WHERE (grid.qty > (0)::numeric)) AS mean_nonzero,
            stddev_samp(grid.qty) FILTER (WHERE (grid.qty > (0)::numeric)) AS sd_nonzero,
            ((count(*) FILTER (WHERE (grid.qty = (0)::numeric)))::numeric / (NULLIF(count(*), 0))::numeric) AS zero_demand_rate,
            regr_slope((grid.qty)::double precision, (grid.period_number)::double precision) FILTER (WHERE (grid.qty IS NOT NULL)) AS trend_per_period
           FROM grid
          GROUP BY grid.item_id
        ), peak_period AS (
         SELECT DISTINCT ON (grid.item_id) grid.item_id,
            grid.period AS peak_period
           FROM grid
          WHERE (grid.qty IS NOT NULL)
          ORDER BY grid.item_id, grid.qty DESC, grid.period
        ), recent_change AS (
         SELECT g.item_id,
            avg(g.qty) FILTER (WHERE (g.period_number > (m_1.n_periods - p_1.recent_periods))) AS recent_average,
            avg(g.qty) FILTER (WHERE ((g.period_number >= ((m_1.n_periods - (2 * p_1.recent_periods)) + 1)) AND (g.period_number <= (m_1.n_periods - p_1.recent_periods)))) AS previous_average
           FROM ((grid g
             JOIN metrics m_1 USING (item_id))
             CROSS JOIN policy p_1)
          GROUP BY g.item_id
        ), seasonal_months AS (
         SELECT grid.item_id,
            (EXTRACT(month FROM grid.period))::integer AS month_number,
            avg(grid.qty) AS monthly_average
           FROM grid
          WHERE (grid.qty IS NOT NULL)
          GROUP BY grid.item_id, ((EXTRACT(month FROM grid.period))::integer)
        ), seasonality_metric AS (
         SELECT seasonal_months.item_id,
            (stddev_samp(seasonal_months.monthly_average) / NULLIF(avg(seasonal_months.monthly_average), (0)::numeric)) AS seasonal_index_cv
           FROM seasonal_months
          GROUP BY seasonal_months.item_id
        )
 SELECT m.item_id,
    m.item_name,
    m.n_periods,
    m.n_nonzero_periods,
        CASE
            WHEN (m.n_nonzero_periods = 0) THEN NULL::numeric
            ELSE ((m.n_periods)::numeric / (m.n_nonzero_periods)::numeric)
        END AS adi,
        CASE
            WHEN ((m.n_nonzero_periods < 2) OR (m.mean_nonzero = (0)::numeric)) THEN NULL::numeric
            ELSE (m.sd_nonzero / m.mean_nonzero)
        END AS cv,
        CASE
            WHEN ((m.n_nonzero_periods < 2) OR (m.mean_nonzero = (0)::numeric)) THEN NULL::numeric
            ELSE power((m.sd_nonzero / m.mean_nonzero), (2)::numeric)
        END AS cv_squared,
    m.zero_demand_rate,
    m.trend_per_period,
        CASE
            WHEN ((m.n_null_periods > 0) OR (p.recent_periods IS NULL) OR (p.recent_periods <= 0)) THEN NULL::numeric
            WHEN (m.n_periods < (2 * p.recent_periods)) THEN NULL::numeric
            WHEN ((r.previous_average IS NULL) OR (r.previous_average = (0)::numeric)) THEN NULL::numeric
            ELSE ((r.recent_average - r.previous_average) / r.previous_average)
        END AS recent_change_rate,
    peak.peak_period,
        CASE
            WHEN ((m.n_null_periods > 0) OR (m.n_nonzero_periods < 2)) THEN NULL::text
            WHEN ((((m.n_periods)::numeric / (m.n_nonzero_periods)::numeric) < 1.32) AND (power((m.sd_nonzero / m.mean_nonzero), (2)::numeric) < 0.49)) THEN 'SMOOTH'::text
            WHEN ((((m.n_periods)::numeric / (m.n_nonzero_periods)::numeric) >= 1.32) AND (power((m.sd_nonzero / m.mean_nonzero), (2)::numeric) < 0.49)) THEN 'INTERMITTENT'::text
            WHEN ((((m.n_periods)::numeric / (m.n_nonzero_periods)::numeric) < 1.32) AND (power((m.sd_nonzero / m.mean_nonzero), (2)::numeric) >= 0.49)) THEN 'ERRATIC'::text
            ELSE 'LUMPY'::text
        END AS demand_type,
        CASE
            WHEN ((m.n_null_periods > 0) OR (m.n_periods < 24) OR (sm.seasonal_index_cv IS NULL) OR (p.seasonality_threshold IS NULL)) THEN NULL::boolean
            ELSE (sm.seasonal_index_cv >= p.seasonality_threshold)
        END AS seasonality,
        CASE
            WHEN (m.n_null_periods > 0) THEN 'NULL_QUANTITY'::text
            WHEN (m.n_nonzero_periods = 0) THEN 'NO_DEMAND'::text
            WHEN (m.n_nonzero_periods < 2) THEN 'INSUFFICIENT_NONZERO_PERIODS'::text
            WHEN (m.n_periods < 24) THEN 'INSUFFICIENT_PERIODS'::text
            WHEN ((p.seasonality_threshold IS NULL) OR (p.recent_periods IS NULL) OR (p.recent_periods <= 0)) THEN 'POLICY_UNAVAILABLE'::text
            WHEN (sm.seasonal_index_cv IS NULL) THEN 'CALCULATION_UNAVAILABLE'::text
            WHEN (m.n_periods < (2 * p.recent_periods)) THEN 'INSUFFICIENT_RECENT_PERIODS'::text
            WHEN ((r.previous_average IS NULL) OR (r.previous_average = (0)::numeric)) THEN 'ZERO_BASELINE'::text
            ELSE NULL::text
        END AS reason_code,
        CASE
            WHEN ((m.n_nonzero_periods < 2) OR (m.mean_nonzero = (0)::numeric)) THEN NULL::text
            WHEN (power((m.sd_nonzero / m.mean_nonzero), (2)::numeric) < 0.49) THEN 'STABLE'::text
            ELSE 'VOLATILE'::text
        END AS stability
   FROM ((((metrics m
     CROSS JOIN policy p)
     LEFT JOIN peak_period peak USING (item_id))
     LEFT JOIN recent_change r USING (item_id))
     LEFT JOIN seasonality_metric sm USING (item_id));


--
-- Name: v_demand_profile_kpi; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_demand_profile_kpi AS
 SELECT count(*) AS total_items,
    count(*) FILTER (WHERE (demand_type = 'SMOOTH'::text)) AS n_smooth,
    count(*) FILTER (WHERE (demand_type = 'INTERMITTENT'::text)) AS n_intermittent,
    count(*) FILTER (WHERE (demand_type = 'ERRATIC'::text)) AS n_erratic,
    count(*) FILTER (WHERE (demand_type = 'LUMPY'::text)) AS n_lumpy,
    count(*) FILTER (WHERE (demand_type = ANY (ARRAY['INTERMITTENT'::text, 'LUMPY'::text]))) AS n_croston_needed,
    count(*) FILTER (WHERE (demand_type IS NULL)) AS n_calculation_unavailable
   FROM analytics.v_sku_demand_profile;


--
-- Name: demand_submission_line; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.demand_submission_line (
    line_id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid NOT NULL,
    line_no integer NOT NULL,
    raw_item_code text,
    item_id text,
    qty numeric,
    need_month date,
    issues jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT demand_submission_line_issues_check CHECK ((jsonb_typeof(issues) = 'array'::text)),
    CONSTRAINT demand_submission_line_line_no_check CHECK ((line_no > 0))
);


--
-- Name: TABLE demand_submission_line; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.demand_submission_line IS 'Task 7 — 부서 제출 한 줄. 품목코드 불일치·null 수량·잘못된 날짜도 행을 지우지 않고 issues로 남긴다';


--
-- Name: v_demand_submission_line; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_demand_submission_line WITH (security_invoker='true') AS
 SELECT l.line_id,
    l.submission_id,
    l.line_no,
    l.raw_item_code,
    l.item_id,
    im.item_name,
    l.qty,
    l.need_month,
    l.issues,
    l.created_at
   FROM (core.demand_submission_line l
     LEFT JOIN core.v_item_master im ON ((im.item_id = l.item_id)));


--
-- Name: v_demand_submission_status; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_demand_submission_status WITH (security_invoker='true') AS
 SELECT s.submission_id,
    s.cycle_id,
    s.plan_month,
    s.department,
    s.status,
    c.submission_deadline,
    COALESCE(l.total_line_count, (0)::bigint) AS total_line_count,
    COALESCE(l.error_line_count, (0)::bigint) AS error_line_count,
    s.submitted_by,
    core.order_actor_name(s.submitted_by) AS submitted_by_name,
    s.submitted_at,
    s.withdrawn_by,
    core.order_actor_name(s.withdrawn_by) AS withdrawn_by_name,
    s.withdrawn_at,
    s.withdraw_reason,
    s.agreed_by,
    core.order_actor_name(s.agreed_by) AS agreed_by_name,
    s.agreed_at,
    s.last_modified_by,
    core.order_actor_name(s.last_modified_by) AS last_modified_by_name,
    s.last_modified_at,
    s.version,
    s.created_at,
    ((s.status = ANY (ARRAY['DRAFT'::text, 'WITHDRAWN'::text])) AND (clock_timestamp() > (((c.submission_deadline + 1))::timestamp without time zone AT TIME ZONE 'Asia/Seoul'::text))) AS is_overdue
   FROM ((core.demand_submission s
     JOIN core.planning_cycle c ON ((c.cycle_id = s.cycle_id)))
     LEFT JOIN ( SELECT demand_submission_line.submission_id,
            count(*) AS total_line_count,
            count(*) FILTER (WHERE (jsonb_array_length(demand_submission_line.issues) > 0)) AS error_line_count
           FROM core.demand_submission_line
          GROUP BY demand_submission_line.submission_id) l ON ((l.submission_id = s.submission_id)));


--
-- Name: VIEW v_demand_submission_status; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_demand_submission_status IS 'Task 7 — SCM 취합 화면용. 제출 여부·오류 건수·마지막 수정자와 시각을 한 행에 모은다';


--
-- Name: forecast_result; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.forecast_result (
    run_id uuid NOT NULL,
    model_id text NOT NULL,
    item_id text NOT NULL,
    period date NOT NULL,
    model_version uuid NOT NULL,
    predicted_qty numeric,
    p50 numeric,
    p80 numeric,
    p90 numeric,
    sigma numeric,
    basis jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: v_forecast_result; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_forecast_result AS
 SELECT f.run_id,
    f.model_id,
    f.item_id,
    i.item_name,
    f.period,
    f.model_version,
    f.predicted_qty,
    f.p50,
    f.p80,
    f.p90,
    f.sigma,
    f.basis,
    f.created_at
   FROM (core.forecast_result f
     LEFT JOIN core.v_item_master i ON ((i.item_id = f.item_id)));


--
-- Name: forecast_run; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.forecast_run (
    run_id uuid DEFAULT gen_random_uuid() NOT NULL,
    status text NOT NULL,
    granularity text,
    train_start date,
    train_end date,
    horizon integer,
    champion_metric text,
    data_snapshot_at timestamp with time zone,
    stale_at timestamp with time zone,
    models jsonb DEFAULT '[]'::jsonb NOT NULL,
    n_models integer DEFAULT 0 NOT NULL,
    n_items integer DEFAULT 0 NOT NULL,
    n_rows integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    duration_ms bigint,
    triggered_by uuid,
    triggered_email text,
    note text,
    message text,
    train_input_row_count bigint,
    train_input_qty_sum numeric,
    train_input_max_loaded_at timestamp with time zone,
    train_input_md5 text,
    train_input_fingerprinted_at timestamp with time zone,
    CONSTRAINT forecast_run_status_check CHECK ((status = ANY (ARRAY['RUNNING'::text, 'SUCCESS'::text, 'FAILED'::text])))
);


--
-- Name: COLUMN forecast_run.train_input_md5; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.forecast_run.train_input_md5 IS 'Task 9b — 실행이 SUCCESS가 될 때 core.v_train_demand 행의 md5(정렬한 품목 · 일자 · 수량 · 배치). null이면 입력 추적 불가';


--
-- Name: upload_batch; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.upload_batch (
    batch_id uuid DEFAULT gen_random_uuid() NOT NULL,
    file_name text NOT NULL,
    import_type text NOT NULL,
    import_mode text NOT NULL,
    total_rows integer DEFAULT 0 NOT NULL,
    success_rows integer DEFAULT 0 NOT NULL,
    warning_rows integer DEFAULT 0 NOT NULL,
    error_rows integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'PARSED'::text NOT NULL,
    uploaded_by uuid,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    imported_at timestamp with time zone,
    rolled_back_at timestamp with time zone,
    forecast_stale_marked boolean DEFAULT false NOT NULL,
    CONSTRAINT upload_batch_import_mode_check CHECK ((import_mode = ANY (ARRAY['append'::text, 'upsert'::text, 'replace'::text]))),
    CONSTRAINT upload_batch_import_type_check CHECK ((import_type = ANY (ARRAY['usage_history'::text, 'inventory'::text, 'item_master'::text, 'supplier_master'::text, 'purchase_order'::text, 'goods_receipt'::text, 'sales_order'::text, 'business_event'::text]))),
    CONSTRAINT upload_batch_status_check CHECK ((status = ANY (ARRAY['PARSED'::text, 'VALIDATING'::text, 'VALIDATED'::text, 'IMPORTED'::text, 'FAILED'::text, 'ROLLED_BACK'::text])))
);


--
-- Name: v_forecast_run; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_forecast_run AS
 SELECT run_id,
    status,
    granularity,
    train_start,
    train_end,
    horizon,
    champion_metric,
    data_snapshot_at,
    stale_at,
    models,
    n_models,
    n_items,
    n_rows,
    started_at,
    finished_at,
    duration_ms,
    triggered_by,
    triggered_email,
    note,
    message,
    COALESCE(((stale_at IS NOT NULL) OR (EXISTS ( SELECT 1
           FROM core.upload_batch b
          WHERE ((b.status = 'IMPORTED'::text) AND (b.import_type = ANY (ARRAY['usage_history'::text, 'sales_order'::text, 'business_event'::text])) AND (r.data_snapshot_at IS NOT NULL) AND (b.imported_at > r.data_snapshot_at))))), false) AS is_stale
   FROM core.forecast_run r;


--
-- Name: v_forecast_run_kpi; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_forecast_run_kpi AS
 SELECT count(*) AS total_runs,
    count(*) FILTER (WHERE (status = 'SUCCESS'::text)) AS success_runs,
    count(*) FILTER (WHERE (status = 'FAILED'::text)) AS failed_runs,
    count(*) FILTER (WHERE is_stale) AS stale_runs,
    max(finished_at) FILTER (WHERE (status = 'SUCCESS'::text)) AS latest_success_at
   FROM analytics.v_forecast_run;


--
-- Name: item_policy_revision; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.item_policy_revision (
    revision_id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id text NOT NULL,
    proposed_target_dos_days numeric,
    proposed_allocation_mode text NOT NULL,
    proposed_target_stock_qty numeric,
    proposed_unit_price numeric,
    proposed_moq numeric,
    proposed_pack_size numeric,
    proposed_min_order_amount numeric,
    previous_target_dos_days numeric,
    previous_allocation_mode text,
    previous_target_stock_qty numeric,
    previous_unit_price numeric,
    previous_moq numeric,
    previous_pack_size numeric,
    previous_min_order_amount numeric,
    reason text NOT NULL,
    requested_by uuid NOT NULL,
    requester_name text NOT NULL,
    requested_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    approval_id uuid,
    decided_by uuid,
    decider_name text,
    decided_at timestamp with time zone,
    decision_comment text,
    CONSTRAINT item_policy_revision_decision_check CHECK ((((status = 'PENDING'::text) AND (decided_by IS NULL) AND (decided_at IS NULL) AND (decider_name IS NULL)) OR ((status = ANY (ARRAY['APPROVED'::text, 'REJECTED'::text, 'CANCELLED'::text])) AND (decided_by IS NOT NULL) AND (decided_at IS NOT NULL) AND (NULLIF(btrim(decider_name), ''::text) IS NOT NULL)))),
    CONSTRAINT item_policy_revision_proposed_allocation_mode_check CHECK ((proposed_allocation_mode = ANY (ARRAY['AUTO'::text, 'MANUAL'::text]))),
    CONSTRAINT item_policy_revision_proposed_min_order_amount_check CHECK (((proposed_min_order_amount IS NULL) OR (proposed_min_order_amount >= (0)::numeric))),
    CONSTRAINT item_policy_revision_proposed_moq_check CHECK (((proposed_moq IS NULL) OR (proposed_moq > (0)::numeric))),
    CONSTRAINT item_policy_revision_proposed_pack_size_check CHECK (((proposed_pack_size IS NULL) OR (proposed_pack_size > (0)::numeric))),
    CONSTRAINT item_policy_revision_proposed_target_dos_days_check CHECK (((proposed_target_dos_days IS NULL) OR (proposed_target_dos_days > (0)::numeric))),
    CONSTRAINT item_policy_revision_proposed_target_stock_qty_check CHECK (((proposed_target_stock_qty IS NULL) OR (proposed_target_stock_qty >= (0)::numeric))),
    CONSTRAINT item_policy_revision_proposed_unit_price_check CHECK (((proposed_unit_price IS NULL) OR (proposed_unit_price >= (0)::numeric))),
    CONSTRAINT item_policy_revision_reason_check CHECK ((btrim(reason) <> ''::text)),
    CONSTRAINT item_policy_revision_requester_name_check CHECK ((btrim(requester_name) <> ''::text)),
    CONSTRAINT item_policy_revision_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELLED'::text])))
);


--
-- Name: TABLE item_policy_revision; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.item_policy_revision IS 'Task 9a — 품목 정책 변경안. 제안값과 요청 시점의 기존값을 함께 보관하고, 승인 시에만 core.item_policy 운영값에 반영된다(core.apply_item_policy_decision, 같은 트랜잭션)';


--
-- Name: v_item_policy; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_item_policy AS
 SELECT p.item_id,
    p.target_dos_days,
    p.allocation_mode,
    p.target_stock_qty,
    p.unit_price,
    p.unit_price_basis,
    p.moq,
    p.pack_size,
    p.min_order_amount,
    p.item_grade,
    p.service_level,
    p.updated_at,
    COALESCE(p.moq, (1)::numeric) AS effective_moq,
    (NOT (EXISTS ( SELECT 1
           FROM core.item_policy_revision r
          WHERE ((r.item_id = p.item_id) AND (r.status = 'APPROVED'::text) AND (r.proposed_target_dos_days IS NOT NULL))))) AS order_blocked,
        CASE
            WHEN (NOT (EXISTS ( SELECT 1
               FROM core.item_policy_revision r
              WHERE ((r.item_id = p.item_id) AND (r.status = 'APPROVED'::text) AND (r.proposed_target_dos_days IS NOT NULL))))) THEN 'TARGET_DOS_UNSET'::text
            ELSE NULL::text
        END AS reason_code,
    (EXISTS ( SELECT 1
           FROM core.item_policy_revision r
          WHERE ((r.item_id = p.item_id) AND (r.status = 'APPROVED'::text) AND (r.proposed_target_dos_days IS NOT NULL)))) AS target_dos_approved,
    av.approved_target_dos_days,
    av.approved_unit_price,
        CASE
            WHEN (av.approved_unit_price IS NULL) THEN 'UNIT_PRICE_UNSET'::text
            ELSE NULL::text
        END AS unit_price_reason_code,
    av.approved_moq,
    COALESCE(av.approved_moq, (1)::numeric) AS approved_effective_moq,
        CASE
            WHEN (av.approved_moq IS NULL) THEN 'MOQ_UNSET'::text
            ELSE NULL::text
        END AS moq_reason_code,
    av.approved_target_stock_qty,
        CASE
            WHEN (av.approved_target_stock_qty IS NULL) THEN 'TARGET_STOCK_UNSET'::text
            ELSE NULL::text
        END AS target_stock_reason_code
   FROM (core.item_policy p
     LEFT JOIN LATERAL ( SELECT ( SELECT r.proposed_target_dos_days
                   FROM core.item_policy_revision r
                  WHERE ((r.item_id = p.item_id) AND (r.status = 'APPROVED'::text) AND (r.proposed_target_dos_days IS NOT NULL))
                  ORDER BY r.decided_at DESC, r.requested_at DESC
                 LIMIT 1) AS approved_target_dos_days,
            ( SELECT r.proposed_unit_price
                   FROM core.item_policy_revision r
                  WHERE ((r.item_id = p.item_id) AND (r.status = 'APPROVED'::text) AND (r.proposed_unit_price IS NOT NULL))
                  ORDER BY r.decided_at DESC, r.requested_at DESC
                 LIMIT 1) AS approved_unit_price,
            ( SELECT r.proposed_moq
                   FROM core.item_policy_revision r
                  WHERE ((r.item_id = p.item_id) AND (r.status = 'APPROVED'::text) AND (r.proposed_moq IS NOT NULL))
                  ORDER BY r.decided_at DESC, r.requested_at DESC
                 LIMIT 1) AS approved_moq,
            ( SELECT r.proposed_target_stock_qty
                   FROM core.item_policy_revision r
                  WHERE ((r.item_id = p.item_id) AND (r.status = 'APPROVED'::text) AND (r.proposed_target_stock_qty IS NOT NULL))
                  ORDER BY r.decided_at DESC, r.requested_at DESC
                 LIMIT 1) AS approved_target_stock_qty) av ON (true));


--
-- Name: VIEW v_item_policy; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_item_policy IS 'Task 9a — target_dos_approved · order_blocked는 승인된 core.item_policy_revision 이력으로 판정한다. Task 9b — approved_* 열은 그 필드를 제안한 최신 승인 변경안의 값이다(직접 넣은 운영값은 승인이 아니다). 발주계획 계산과 Task 12는 approved_* 열만 쓴다';


--
-- Name: month_end_inventory_snapshot; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.month_end_inventory_snapshot (
    plan_month date NOT NULL,
    item_id text NOT NULL,
    normal_qty numeric NOT NULL,
    snapshot_at timestamp with time zone NOT NULL,
    source_batch_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT month_end_inventory_snapshot_normal_qty_check CHECK ((normal_qty >= (0)::numeric)),
    CONSTRAINT month_end_inventory_snapshot_plan_month_check CHECK ((plan_month = (date_trunc('month'::text, (plan_month)::timestamp with time zone))::date))
);


--
-- Name: TABLE month_end_inventory_snapshot; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.month_end_inventory_snapshot IS 'Task 12 — (기준월, 품목)당 그 달 안에서 가장 최근인 NORMAL 분류 재고 스냅샷. raw.inventory가 재적재로 지워져도 이 표는 append 방식으로 남는다. NORMAL 스냅샷이 한 번도 없던 달·품목은 행 자체가 없다(0이 아니라 모른다는 뜻) — analytics.v_inventory_performance가 MONTH_END_SNAPSHOT_MISSING으로 보여준다';


--
-- Name: COLUMN month_end_inventory_snapshot.normal_qty; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.month_end_inventory_snapshot.normal_qty IS '그 달 안에서 가장 최근 NORMAL 스냅샷 시각의 수량 합(core.classify_inventory_scope 기준, Task 4)';


--
-- Name: COLUMN month_end_inventory_snapshot.snapshot_at; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.month_end_inventory_snapshot.snapshot_at IS '위 normal_qty를 관측한 실제 시각(그 달 안에서 가장 최근). 화면에 그대로 표시한다';


--
-- Name: v_inventory_performance; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_inventory_performance WITH (security_invoker='true') AS
 WITH months AS (
         SELECT planning_cycle.plan_month
           FROM core.planning_cycle
        UNION
         SELECT month_end_inventory_snapshot.plan_month
           FROM core.month_end_inventory_snapshot
        ), items AS (
         SELECT v_item_master.item_id,
            v_item_master.item_name
           FROM core.v_item_master
        )
 SELECT m.plan_month,
    i.item_id,
    i.item_name,
    mes.normal_qty AS actual_qty,
    mes.snapshot_at,
        CASE
            WHEN (sb.item_id IS NULL) THEN 'INVENTORY_SCOPE_UNCLASSIFIED'::text
            WHEN (mes.normal_qty IS NULL) THEN 'MONTH_END_SNAPSHOT_MISSING'::text
            ELSE NULL::text
        END AS qty_reason_code,
    ip.approved_unit_price AS unit_price,
        CASE
            WHEN ((mes.normal_qty IS NOT NULL) AND (ip.approved_unit_price IS NOT NULL)) THEN (mes.normal_qty * ip.approved_unit_price)
            ELSE NULL::numeric
        END AS actual_value,
        CASE
            WHEN (sb.item_id IS NULL) THEN 'INVENTORY_SCOPE_UNCLASSIFIED'::text
            WHEN (mes.normal_qty IS NULL) THEN 'MONTH_END_SNAPSHOT_MISSING'::text
            WHEN (ip.approved_unit_price IS NULL) THEN 'UNIT_PRICE_UNSET'::text
            ELSE NULL::text
        END AS value_reason_code,
    ip.approved_target_stock_qty AS target_stock_qty,
        CASE
            WHEN (ip.approved_target_stock_qty IS NULL) THEN 'TARGET_STOCK_UNSET'::text
            ELSE NULL::text
        END AS target_stock_reason_code,
        CASE
            WHEN ((mes.normal_qty IS NOT NULL) AND (ip.approved_target_stock_qty IS NOT NULL)) THEN (mes.normal_qty - ip.approved_target_stock_qty)
            ELSE NULL::numeric
        END AS diff_qty,
        CASE
            WHEN (sb.item_id IS NULL) THEN 'INVENTORY_SCOPE_UNCLASSIFIED'::text
            WHEN (mes.normal_qty IS NULL) THEN 'MONTH_END_SNAPSHOT_MISSING'::text
            WHEN (ip.approved_target_stock_qty IS NULL) THEN 'TARGET_STOCK_UNSET'::text
            ELSE NULL::text
        END AS diff_reason_code
   FROM ((((months m
     CROSS JOIN items i)
     LEFT JOIN core.month_end_inventory_snapshot mes ON (((mes.plan_month = m.plan_month) AND (mes.item_id = i.item_id))))
     LEFT JOIN core.stock_balance sb ON ((sb.item_id = i.item_id)))
     LEFT JOIN analytics.v_item_policy ip ON ((ip.item_id = i.item_id)))
  WHERE core.has_permission('STOCK_VIEW_ALL'::text);


--
-- Name: VIEW v_inventory_performance; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_inventory_performance IS 'Task 12 — 품목 × 달별 월말 재고 실적. 실제 수량은 그 달 안 가장 최근 NORMAL 스냅샷만 쓰고 없으면 null + MONTH_END_SNAPSHOT_MISSING(품목 자체가 분류된 적 없으면 INVENTORY_SCOPE_UNCLASSIFIED). 금액 · 목표재고는 analytics.v_item_policy의 승인값만 쓴다(UNIT_PRICE_UNSET · TARGET_STOCK_UNSET). STOCK_VIEW_ALL(SCM팀)만 조회한다 — 배정 · 조회 화면과 달리 원가 정보라 부서별 조회 범위를 두지 않는다';


--
-- Name: v_inventory_performance_kpi; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_inventory_performance_kpi WITH (security_invoker='true') AS
 SELECT plan_month,
    count(*) AS n_items,
    count(*) FILTER (WHERE (actual_qty IS NOT NULL)) AS n_qty_available,
    count(*) FILTER (WHERE (qty_reason_code = 'MONTH_END_SNAPSHOT_MISSING'::text)) AS n_month_end_snapshot_missing,
    count(*) FILTER (WHERE (qty_reason_code = 'INVENTORY_SCOPE_UNCLASSIFIED'::text)) AS n_inventory_scope_unclassified,
    sum(actual_qty) FILTER (WHERE (actual_qty IS NOT NULL)) AS total_actual_qty,
    count(*) FILTER (WHERE (actual_value IS NOT NULL)) AS n_value_available,
    count(*) FILTER (WHERE (value_reason_code = 'UNIT_PRICE_UNSET'::text)) AS n_unit_price_unset,
    sum(actual_value) FILTER (WHERE (actual_value IS NOT NULL)) AS total_actual_value,
    count(*) FILTER (WHERE (target_stock_qty IS NOT NULL)) AS n_target_available,
    count(*) FILTER (WHERE (target_stock_reason_code = 'TARGET_STOCK_UNSET'::text)) AS n_target_stock_unset,
    sum(target_stock_qty) FILTER (WHERE (target_stock_qty IS NOT NULL)) AS total_target_stock_qty,
    sum(diff_qty) FILTER (WHERE (diff_qty IS NOT NULL)) AS total_diff_qty,
    count(*) FILTER (WHERE (diff_qty IS NOT NULL)) AS n_diff_available
   FROM analytics.v_inventory_performance p
  GROUP BY plan_month;


--
-- Name: VIEW v_inventory_performance_kpi; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_inventory_performance_kpi IS 'Task 12 — 달별 월말 재고 총수량 · 총금액 · 목표재고 대비 차이 요약. 합계는 값이 있는 품목만 더하고(n_* 열이 제외 건수와 사유를 함께 보고한다), 계산 불가 품목을 0으로 조용히 포함하지 않는다. Forecast WAPE·Bias(STEP 7)는 이 뷰에 합치지 않는다 — 별도 분석 화면에서만 조회한다';


--
-- Name: bridge_xcn; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.bridge_xcn (
    family text,
    related_item text,
    related_desc text,
    hoc_item text,
    hoc_desc text
);


--
-- Name: v_part_linkage; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_part_linkage AS
 SELECT DISTINCT related_item,
    hoc_item
   FROM raw.bridge_xcn
  WHERE ((related_item IS NOT NULL) AND (hoc_item IS NOT NULL));


--
-- Name: fact_shipment; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.fact_shipment (
    item_code text NOT NULL,
    ym character(7) NOT NULL,
    qty numeric(18,4) NOT NULL,
    item_type text NOT NULL,
    source_file text NOT NULL
);


--
-- Name: TABLE fact_shipment; Type: COMMENT; Schema: raw; Owner: -
--

COMMENT ON TABLE raw.fact_shipment IS '월별 출고 실적. 수량 0인 달은 미저장. PART 2023-04~2026-07 / OPTION 2020-01~2026-07';


--
-- Name: v_shipment_by_hoc; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_shipment_by_hoc AS
 SELECT COALESCE(x.hoc_item, f.item_code) AS hoc_item,
    f.item_type,
    f.ym,
    sum(f.qty) AS qty,
    count(*) AS n_source_codes
   FROM (raw.fact_shipment f
     LEFT JOIN core.v_part_linkage x ON (((x.related_item = f.item_code) AND (f.item_type = 'PART'::text))))
  GROUP BY COALESCE(x.hoc_item, f.item_code), f.item_type, f.ym;


--
-- Name: VIEW v_shipment_by_hoc; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON VIEW core.v_shipment_by_hoc IS 'XCN 연계를 합산한 대표코드 기준 월별 출고량. Tool 은 반드시 이 뷰를 읽는다';


--
-- Name: v_item_demand_profile; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_item_demand_profile AS
 WITH bound AS (
         SELECT max(fact_shipment.ym) AS max_ym,
            max((((SUBSTRING(fact_shipment.ym FROM 1 FOR 4))::integer * 12) + (SUBSTRING(fact_shipment.ym FROM 6 FOR 2))::integer)) AS max_idx
           FROM raw.fact_shipment
        ), agg AS (
         SELECT h.hoc_item,
            max(h.item_type) AS item_type,
            b.max_ym,
            (count(*))::integer AS n_nonzero,
            ((b.max_idx - min((((SUBSTRING(h.ym FROM 1 FOR 4))::integer * 12) + (SUBSTRING(h.ym FROM 6 FOR 2))::integer))) + 1) AS n_span,
            avg(h.qty) AS mean_nz,
            stddev_samp(h.qty) AS sd_nz,
            min(h.ym) AS first_ym,
            max(h.ym) AS last_ym
           FROM (core.v_shipment_by_hoc h
             CROSS JOIN bound b)
          GROUP BY h.hoc_item, b.max_idx, b.max_ym
        )
 SELECT a.hoc_item AS item_code,
    i.description,
    i.family,
    a.item_type,
    a.max_ym AS data_as_of,
    a.first_ym,
    a.last_ym,
    a.n_span AS n_periods,
    a.n_nonzero,
    round(a.mean_nz, 1) AS mean_nonzero_qty,
        CASE
            WHEN (a.n_span >= 6) THEN round(((a.n_span)::numeric / (a.n_nonzero)::numeric), 2)
            ELSE NULL::numeric
        END AS adi,
        CASE
            WHEN (a.n_span >= 6) THEN round(((1)::numeric - ((a.n_nonzero)::numeric / (a.n_span)::numeric)), 3)
            ELSE NULL::numeric
        END AS zero_demand_rate,
        CASE
            WHEN ((a.n_span >= 6) AND (a.n_nonzero >= 2) AND (a.mean_nz > (0)::numeric)) THEN round(((a.sd_nz / a.mean_nz) ^ (2)::numeric), 3)
            ELSE NULL::numeric
        END AS cv_squared,
        CASE
            WHEN (a.n_span < 6) THEN NULL::text
            WHEN (a.n_nonzero < 2) THEN NULL::text
            WHEN (a.mean_nz <= (0)::numeric) THEN NULL::text
            WHEN ((((a.n_span)::numeric / (a.n_nonzero)::numeric) < 1.32) AND (((a.sd_nz / a.mean_nz) ^ (2)::numeric) < 0.49)) THEN 'SMOOTH'::text
            WHEN (((a.n_span)::numeric / (a.n_nonzero)::numeric) < 1.32) THEN 'ERRATIC'::text
            WHEN (((a.sd_nz / a.mean_nz) ^ (2)::numeric) < 0.49) THEN 'INTERMITTENT'::text
            ELSE 'LUMPY'::text
        END AS demand_type,
        CASE
            WHEN (a.n_span < 6) THEN 'INSUFFICIENT_HISTORY'::text
            WHEN (a.n_nonzero < 2) THEN 'INSUFFICIENT_SAMPLE'::text
            WHEN (a.mean_nz <= (0)::numeric) THEN 'NO_POSITIVE_DEMAND'::text
            ELSE NULL::text
        END AS reason_code
   FROM (agg a
     LEFT JOIN core.v_item i ON ((i.item_code = a.hoc_item)));


--
-- Name: VIEW v_item_demand_profile; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_item_demand_profile IS 'Syntetos-Boylan 수요 유형 분류. 관측 6개월 미만은 유형 null + INSUFFICIENT_HISTORY';


--
-- Name: v_item_demand_kpi; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_item_demand_kpi AS
 SELECT item_type,
    count(*) AS n_items,
    count(*) FILTER (WHERE (demand_type = 'SMOOTH'::text)) AS n_smooth,
    count(*) FILTER (WHERE (demand_type = 'ERRATIC'::text)) AS n_erratic,
    count(*) FILTER (WHERE (demand_type = 'INTERMITTENT'::text)) AS n_intermittent,
    count(*) FILTER (WHERE (demand_type = 'LUMPY'::text)) AS n_lumpy,
    count(*) FILTER (WHERE (demand_type IS NULL)) AS n_unknown,
    count(*) FILTER (WHERE (demand_type = ANY (ARRAY['INTERMITTENT'::text, 'LUMPY'::text]))) AS n_croston_candidate
   FROM analytics.v_item_demand_profile
  GROUP BY item_type;


--
-- Name: v_item_policy_revision; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_item_policy_revision WITH (security_invoker='true') AS
 SELECT r.revision_id,
    r.item_id,
    im.item_name,
    r.proposed_target_dos_days,
    r.proposed_allocation_mode,
    r.proposed_target_stock_qty,
    r.proposed_unit_price,
    r.proposed_moq,
    r.proposed_pack_size,
    r.proposed_min_order_amount,
    r.previous_target_dos_days,
    r.previous_allocation_mode,
    r.previous_target_stock_qty,
    r.previous_unit_price,
    r.previous_moq,
    r.previous_pack_size,
    r.previous_min_order_amount,
    r.reason,
    r.requested_by,
    r.requester_name,
    r.requested_at,
    r.approval_id,
    r.status,
    r.decided_by,
    r.decider_name,
    r.decided_at,
    r.decision_comment
   FROM (core.item_policy_revision r
     LEFT JOIN core.v_item_master im ON ((im.item_id = r.item_id)));


--
-- Name: VIEW v_item_policy_revision; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_item_policy_revision IS 'Task 9a — 품목 정책 변경 요청 이력(대기 · 승인 · 반려). security_invoker로 core.item_policy_revision의 RLS를 그대로 적용한다';


--
-- Name: v_leadtime_gap; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_leadtime_gap AS
 SELECT m."공급업체코드" AS supplier_id,
    m."공급업체명" AS supplier_name,
    m."국가" AS country,
    (m."표준리드타임(일)")::integer AS std_lead_time,
    s.n_samples,
    s.avg_order_to_ship,
    s.avg_ship_to_receive,
    s.mean_days,
    s.p50_days,
    s.p80_days,
    s.p90_days,
    s.std_days,
    (s.p80_days - (m."표준리드타임(일)")::integer) AS gap_days,
    s.confidence
   FROM (raw.supplier_master m
     JOIN core.v_leadtime_stat s ON ((s.supplier_id = m."공급업체코드")))
  WHERE (m."사용여부" = 'Y'::text);


--
-- Name: VIEW v_leadtime_gap; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_leadtime_gap IS '[DEPRECATED 2026-09-04] 5회차 더미 데이터 기준 뷰. 실데이터에는 재고·리드타임이 없으므로 더 이상 갱신되지 않습니다. 신규 코드는 analytics.v_shipment_trend · v_item_demand_profile · v_ol_accuracy · v_bom_requirement_x 를 사용하십시오.';


--
-- Name: audit_log; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.audit_log (
    id bigint NOT NULL,
    actor uuid,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    before jsonb,
    after jsonb,
    at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: v_master_change_history; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_master_change_history AS
 SELECT a.id,
    a.at,
    a.actor,
    u.name AS actor_name,
    a.action,
    a.target_type,
    a.target_id,
    a.before,
    a.after
   FROM (core.audit_log a
     LEFT JOIN core.app_user u ON ((u.user_id = a.actor)))
  WHERE ((a.target_type = ANY (ARRAY['supply_entity'::text, 'supplier'::text, 'supplier_departure'::text, 'business_calendar'::text, 'business_calendar_readiness'::text])) AND core.is_admin())
  ORDER BY a.at DESC;


--
-- Name: VIEW v_master_change_history; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_master_change_history IS 'Task 10a — 마스터 화면이 조회하는 변경 이력. core.audit_log를 마스터 대상 유형으로만 좁힌다. core.audit_log RLS가 관리자 전용이므로 이 뷰도 core.is_admin()일 때만 행을 낸다';


--
-- Name: supplier; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.supplier (
    supplier_id text NOT NULL,
    supplier_name text NOT NULL,
    entity_id text,
    lead_time_days integer,
    active boolean DEFAULT true NOT NULL,
    valid_from date,
    valid_to date,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supplier_check CHECK (((valid_to IS NULL) OR (valid_from IS NULL) OR (valid_from <= valid_to))),
    CONSTRAINT supplier_lead_time_days_check CHECK (((lead_time_days IS NULL) OR (lead_time_days >= 0)))
);


--
-- Name: COLUMN supplier.lead_time_days; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.supplier.lead_time_days IS 'stage1 §4 — 이 값이 없으면 조정 범위의 시작 월을 정할 수 없어 발주량 계산이 멈춥니다';


--
-- Name: supplier_departure; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.supplier_departure (
    departure_id bigint NOT NULL,
    supplier_id text NOT NULL,
    weekday smallint,
    day_of_month smallint,
    valid_from date,
    valid_to date,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    week_of_month smallint,
    active boolean DEFAULT true NOT NULL,
    CONSTRAINT supplier_departure_check CHECK (((weekday IS NULL) <> (day_of_month IS NULL))),
    CONSTRAINT supplier_departure_check1 CHECK (((valid_to IS NULL) OR (valid_from IS NULL) OR (valid_from <= valid_to))),
    CONSTRAINT supplier_departure_day_of_month_check CHECK (((day_of_month IS NULL) OR ((day_of_month >= 1) AND (day_of_month <= 31)))),
    CONSTRAINT supplier_departure_week_of_month_range_chk CHECK (((week_of_month IS NULL) OR ((week_of_month >= 1) AND (week_of_month <= 5)))),
    CONSTRAINT supplier_departure_week_requires_weekday_chk CHECK (((week_of_month IS NULL) OR (weekday IS NOT NULL))),
    CONSTRAINT supplier_departure_weekday_check CHECK (((weekday IS NULL) OR ((weekday >= 0) AND (weekday <= 6))))
);


--
-- Name: COLUMN supplier_departure.week_of_month; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.supplier_departure.week_of_month IS 'Task 10a — "매월 N번째 요일" 규칙(1~5). weekday 와 함께만 채워진다. STEP 18은 요일·매월 일자만 표현했다';


--
-- Name: COLUMN supplier_departure.active; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.supplier_departure.active IS 'Task 10a — 규칙을 끈다(교체·중단). valid_from/valid_to(기간)와 별개다. 행은 지우지 않는다';


--
-- Name: supply_entity; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.supply_entity (
    entity_id text NOT NULL,
    entity_name text NOT NULL,
    country_code text NOT NULL,
    prep_days integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    valid_from date,
    valid_to date,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supply_entity_check CHECK (((valid_to IS NULL) OR (valid_from IS NULL) OR (valid_from <= valid_to))),
    CONSTRAINT supply_entity_prep_days_check CHECK ((prep_days >= 0))
);


--
-- Name: TABLE supply_entity; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.supply_entity IS 'stage1 §8 — 조달 대상 해외법인. 운영 대상은 5곳이며 과거 법인은 지우지 않고 active 로 관리합니다';


--
-- Name: COLUMN supply_entity.prep_days; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.supply_entity.prep_days IS '출항 준비기간(일). 발주일 = 공급처 출항일 − 이 값';


--
-- Name: v_master_readiness; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_master_readiness AS
 SELECT ( SELECT count(*) AS count
           FROM core.supply_entity
          WHERE supply_entity.active) AS n_entities,
    ( SELECT count(*) AS count
           FROM core.supply_entity
          WHERE (supply_entity.active AND (supply_entity.prep_days = 0))) AS n_prep_days_unset,
    ( SELECT count(*) AS count
           FROM core.supplier
          WHERE supplier.active) AS n_suppliers,
    ( SELECT count(*) AS count
           FROM core.supplier
          WHERE (supplier.active AND (supplier.lead_time_days IS NULL))) AS n_leadtime_unset,
    ( SELECT count(*) AS count
           FROM core.supplier_departure
          WHERE supplier_departure.active) AS n_departure_rules,
    ( SELECT count(*) AS count
           FROM core.business_calendar) AS n_calendar_days,
    ( SELECT count(*) AS count
           FROM core.item_policy) AS n_item_policies,
    ( SELECT count(*) AS count
           FROM core.item_policy
          WHERE (item_policy.target_dos_days IS NULL)) AS n_target_dos_unset,
    ( SELECT count(*) AS count
           FROM core.business_calendar_readiness
          WHERE business_calendar_readiness.ready) AS n_calendar_months_ready;


--
-- Name: VIEW v_master_readiness; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_master_readiness IS 'Phase 1 준비 상태. 아직 못 받은 값이 몇 건인지 한 줄로 보여 줍니다';


--
-- Name: v_model_comparison_detail; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_model_comparison_detail AS
 WITH actual AS (
         SELECT v_test_actual.item_id,
            (date_trunc('month'::text, (v_test_actual.use_date)::timestamp with time zone))::date AS period,
            sum(v_test_actual.qty) AS actual_qty,
            count(v_test_actual.qty) AS n_qty
           FROM core.v_test_actual
          GROUP BY v_test_actual.item_id, ((date_trunc('month'::text, (v_test_actual.use_date)::timestamp with time zone))::date)
        )
 SELECT f.run_id,
    f.model_id,
    f.item_id,
    f.period,
    f.p50,
    f.p80,
    f.p90,
    f.predicted_qty,
        CASE
            WHEN (a.n_qty = 0) THEN NULL::numeric
            ELSE a.actual_qty
        END AS actual_qty
   FROM (core.forecast_result f
     LEFT JOIN actual a ON (((a.item_id = f.item_id) AND (a.period = f.period))));


--
-- Name: model_config; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.model_config (
    model_id text NOT NULL,
    model_name text NOT NULL,
    family text NOT NULL,
    engine text NOT NULL,
    version text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    applicable_demand_type text[] NOT NULL,
    parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    description text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT model_config_applicable_demand_type_check CHECK ((applicable_demand_type <@ ARRAY['SMOOTH'::text, 'INTERMITTENT'::text, 'ERRATIC'::text, 'LUMPY'::text])),
    CONSTRAINT model_config_engine_check CHECK ((engine = ANY (ARRAY['SQL'::text, 'PYTHON'::text])))
);


--
-- Name: v_model_config; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_model_config AS
 SELECT model_id,
    model_name,
    family,
    engine,
    version,
    enabled,
    is_default,
    applicable_demand_type,
    parameters,
    description,
    updated_at,
    updated_by
   FROM core.model_config;


--
-- Name: model_performance; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.model_performance (
    backtest_run_id uuid NOT NULL,
    forecast_run_id uuid NOT NULL,
    model_id text NOT NULL,
    model_version uuid NOT NULL,
    item_id text NOT NULL,
    n_periods integer DEFAULT 0 NOT NULL,
    wape numeric,
    mape numeric,
    bias numeric,
    rmse numeric,
    mae numeric,
    baseline_improvement numeric,
    rank integer,
    calculation_status text DEFAULT 'SUCCESS'::text NOT NULL,
    reason_code text,
    calculated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE model_performance; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.model_performance IS 'Bias = 평균(Forecast - Actual): 양수는 과대예측, 음수는 과소예측. MAPE는 Actual=0 기간을 제외한다.';


--
-- Name: COLUMN model_performance.wape; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.model_performance.wape IS 'sum(abs(forecast-actual))/sum(abs(actual)); Actual 절대합 0이면 null.';


--
-- Name: v_model_performance; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_model_performance AS
 SELECT p.backtest_run_id,
    p.forecast_run_id,
    p.model_id,
    p.model_version,
    p.item_id,
    p.n_periods,
    p.wape,
    p.mape,
    p.bias,
    p.rmse,
    p.mae,
    p.baseline_improvement,
    p.rank,
    p.calculation_status,
    p.reason_code,
    p.calculated_at,
    r.metric,
    r.test_start,
    r.test_end
   FROM (core.model_performance p
     JOIN core.backtest_run r USING (backtest_run_id));


--
-- Name: v_my_approval_inbox; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_my_approval_inbox WITH (security_invoker='true') AS
 SELECT approval_id,
    approval_type,
    target_type,
    target_id,
    payload,
    status,
    reason_code,
    reason_text,
    requested_by,
    requested_at,
    decided_by,
    decided_at,
    decision_comment,
    requester_name,
    decider_name
   FROM core.approval_request r
  WHERE ((status = 'PENDING'::text) AND (requested_by <> auth.uid()) AND core.has_permission(
        CASE approval_type
            WHEN 'ITEM_POLICY'::text THEN 'ITEM_POLICY_APPROVE'::text
            WHEN 'ALLOC_PRIORITY'::text THEN 'ALLOC_PRIORITY_APPROVE'::text
            WHEN 'EVENT_ORDER'::text THEN 'EVENT_ORDER_APPROVE'::text
            WHEN 'PURCHASE_PLAN'::text THEN 'PLAN_APPROVE'::text
            ELSE NULL::text
        END));


--
-- Name: VIEW v_my_approval_inbox; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_my_approval_inbox IS '현재 사용자가 권한으로 처리할 수 있고 본인이 요청하지 않은 PENDING 승인';


--
-- Name: notification_outbox; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.notification_outbox (
    notification_id uuid DEFAULT gen_random_uuid() NOT NULL,
    dedupe_key text NOT NULL,
    template_code text NOT NULL,
    recipient_user_id uuid NOT NULL,
    channel text NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    claimed_at timestamp with time zone,
    claimed_by uuid,
    claim_token uuid,
    claim_expires_at timestamp with time zone,
    last_error text,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_outbox_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT notification_outbox_channel_check CHECK ((channel = ANY (ARRAY['IN_APP'::text, 'EMAIL'::text]))),
    CONSTRAINT notification_outbox_dedupe_key_check CHECK ((btrim(dedupe_key) <> ''::text)),
    CONSTRAINT notification_outbox_max_attempts_check CHECK (((max_attempts >= 1) AND (max_attempts <= 20))),
    CONSTRAINT notification_outbox_payload_check CHECK ((jsonb_typeof(payload) = 'object'::text)),
    CONSTRAINT notification_outbox_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'PROCESSING'::text, 'SENT'::text, 'FAILED'::text, 'CANCELLED'::text]))),
    CONSTRAINT notification_outbox_template_code_check CHECK ((btrim(template_code) <> ''::text))
);


--
-- Name: TABLE notification_outbox; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.notification_outbox IS 'Task 3 발송 대기 원장. 업무 트랜잭션은 외부 통신 대신 이 테이블에 중복 없이 예약합니다';


--
-- Name: user_notification; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.user_notification (
    user_notification_id bigint NOT NULL,
    notification_id uuid NOT NULL,
    recipient_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone
);


--
-- Name: TABLE user_notification; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.user_notification IS '사용자 앱 알림과 읽음 상태. 이메일 실패와 독립적으로 유지합니다';


--
-- Name: v_my_notification; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_my_notification WITH (security_invoker='true') AS
 SELECT o.notification_id,
    o.template_code,
    COALESCE(NULLIF((o.payload ->> 'title'::text), ''::text), '알림'::text) AS title,
    COALESCE((o.payload ->> 'message'::text), ''::text) AS message,
    o.payload,
    n.created_at,
    n.read_at
   FROM (core.user_notification n
     JOIN core.notification_outbox o ON ((o.notification_id = n.notification_id)))
  WHERE (n.recipient_user_id = auth.uid());


--
-- Name: sales_order_event; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.sales_order_event (
    event_id bigint NOT NULL,
    order_id uuid NOT NULL,
    event_type text NOT NULL,
    previous_status text,
    next_status text NOT NULL,
    actor uuid,
    actor_name text NOT NULL,
    reason text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT sales_order_event_event_type_check CHECK ((event_type = ANY (ARRAY['CREATED'::text, 'REVIEW_REQUESTED'::text, 'ALLOCATION_CHANGED'::text, 'PRIORITY_CHANGED'::text, 'CONFIRMED'::text, 'CANCELLED'::text, 'EXPIRED'::text, 'COPIED'::text]))),
    CONSTRAINT sales_order_event_next_status_check CHECK ((next_status = ANY (ARRAY['DRAFT'::text, 'REVIEW_REQUESTED'::text, 'PARTIALLY_ALLOCATED'::text, 'WAITING_FULL'::text, 'CONFIRMED'::text, 'EXPIRED'::text, 'CANCELLED'::text]))),
    CONSTRAINT sales_order_event_payload_check CHECK ((jsonb_typeof(payload) = 'object'::text)),
    CONSTRAINT sales_order_event_previous_status_check CHECK (((previous_status IS NULL) OR (previous_status = ANY (ARRAY['DRAFT'::text, 'REVIEW_REQUESTED'::text, 'PARTIALLY_ALLOCATED'::text, 'WAITING_FULL'::text, 'CONFIRMED'::text, 'EXPIRED'::text, 'CANCELLED'::text]))))
);


--
-- Name: TABLE sales_order_event; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.sales_order_event IS 'Task 5 주문 상태 · 배정 수량 · 변경자 · 시각 · 사유 append-only 이력. actor가 null이면 시스템 처리';


--
-- Name: v_my_sales_order; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_my_sales_order WITH (security_invoker='true') AS
 SELECT o.order_id,
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
    src.order_no AS replaces_order_no,
    rep.order_id AS replaced_by_order_id,
    rep.order_no AS replaced_by_order_no,
    o.note,
    t.line_count,
    t.requested_qty,
    t.temporary_allocated_qty,
    t.firm_allocated_qty,
    t.approval_hold_qty,
    t.shortage_qty,
    t.lines,
    COALESCE(ev.events, '[]'::jsonb) AS events
   FROM ((((core.sales_order o
     LEFT JOIN core.sales_order src ON ((src.order_id = o.replaces_order_id)))
     LEFT JOIN core.sales_order rep ON ((rep.replaces_order_id = o.order_id)))
     LEFT JOIN LATERAL ( SELECT count(l.line_id) AS line_count,
            sum(l.requested_qty) AS requested_qty,
            sum(l.temporary_allocated_qty) AS temporary_allocated_qty,
            sum(l.firm_allocated_qty) AS firm_allocated_qty,
            sum(l.approval_hold_qty) AS approval_hold_qty,
            sum(l.shortage_qty) AS shortage_qty,
            COALESCE(jsonb_agg(jsonb_build_object('line_id', l.line_id, 'line_no', l.line_no, 'item_id', l.item_id, 'item_name', im.item_name, 'requested_qty', l.requested_qty, 'temporary_allocated_qty', l.temporary_allocated_qty, 'firm_allocated_qty', l.firm_allocated_qty, 'approval_hold_qty', l.approval_hold_qty, 'shortage_qty', l.shortage_qty) ORDER BY l.line_no) FILTER (WHERE (l.line_id IS NOT NULL)), '[]'::jsonb) AS lines
           FROM (core.sales_order_line l
             LEFT JOIN core.v_item_master im ON ((im.item_id = l.item_id)))
          WHERE (l.order_id = o.order_id)) t ON (true))
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('event_id', e.event_id, 'event_type', e.event_type, 'previous_status', e.previous_status, 'next_status', e.next_status, 'actor_name', e.actor_name, 'reason', e.reason, 'payload', e.payload, 'at', e.at) ORDER BY e.at, e.event_id) AS events
           FROM core.sales_order_event e
          WHERE (e.order_id = o.order_id)) ev ON (true))
  WHERE (o.owner_user_id = auth.uid());


--
-- Name: VIEW v_my_sales_order; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_my_sales_order IS 'Task 5 — 로그인한 영업담당자 본인의 주문, 품목별 임시·확정·승인대기·부족수량과 주문 이력. security_invoker';


--
-- Name: notification_delivery; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.notification_delivery (
    delivery_id bigint NOT NULL,
    notification_id uuid NOT NULL,
    recipient_user_id uuid NOT NULL,
    recipient_email text,
    channel text NOT NULL,
    status text NOT NULL,
    attempt_number integer,
    retryable boolean,
    attempted_at timestamp with time zone DEFAULT now() NOT NULL,
    error_message text,
    external_message_id text,
    CONSTRAINT notification_delivery_attempt_number_check CHECK (((attempt_number IS NULL) OR (attempt_number > 0))),
    CONSTRAINT notification_delivery_channel_check CHECK ((channel = ANY (ARRAY['IN_APP'::text, 'EMAIL'::text]))),
    CONSTRAINT notification_delivery_status_check CHECK ((status = ANY (ARRAY['SUCCESS'::text, 'FAILED'::text])))
);


--
-- Name: TABLE notification_delivery; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.notification_delivery IS '앱 알림과 이메일의 성공·실패를 채널별로 보존하는 append-only 이력';


--
-- Name: v_notification_delivery; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_notification_delivery WITH (security_invoker='true') AS
 SELECT d.delivery_id,
    d.notification_id,
    o.template_code,
    d.recipient_user_id,
    d.recipient_email,
    COALESCE(NULLIF(u.name, ''::text), u.email, (d.recipient_user_id)::text) AS recipient_name,
    d.channel,
    d.status,
    d.attempted_at,
    d.error_message,
    d.external_message_id,
    d.attempt_number,
    d.retryable
   FROM ((core.notification_delivery d
     JOIN core.notification_outbox o ON ((o.notification_id = d.notification_id)))
     LEFT JOIN core.app_user u ON ((u.user_id = d.recipient_user_id)))
  WHERE core.is_admin();


--
-- Name: fact_mc_plan_actual; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.fact_mc_plan_actual (
    fy_sheet text,
    model_key text NOT NULL,
    model_base text,
    biz text,
    iot_code text,
    ym character(7) NOT NULL,
    sales_ol numeric(18,4),
    scm_ol numeric(18,4),
    act numeric(18,4)
);


--
-- Name: TABLE fact_mc_plan_actual; Type: COMMENT; Schema: raw; Owner: -
--

COMMENT ON TABLE raw.fact_mc_plan_actual IS '기계 OL vs 실적. Bias = SUM(ol-act)/SUM(act), 양수가 과대예측';


--
-- Name: v_ol_accuracy; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_ol_accuracy AS
 SELECT COALESCE(NULLIF(btrim(model_base), ''::text), '(미분류)'::text) AS model_base,
    fy_sheet,
    max(biz) AS biz,
    (count(*))::integer AS n_rows,
    min(ym) AS first_ym,
    max(ym) AS last_ym,
    round(sum(act) FILTER (WHERE (act IS NOT NULL)), 1) AS total_act,
    (count(*) FILTER (WHERE ((sales_ol IS NOT NULL) AND (act IS NOT NULL))))::integer AS n_scored_sales,
    round((sum(abs((sales_ol - act))) FILTER (WHERE ((sales_ol IS NOT NULL) AND (act IS NOT NULL))) / NULLIF(sum(act) FILTER (WHERE ((sales_ol IS NOT NULL) AND (act IS NOT NULL))), (0)::numeric)), 3) AS sales_wape,
    round((sum((sales_ol - act)) FILTER (WHERE ((sales_ol IS NOT NULL) AND (act IS NOT NULL))) / NULLIF(sum(act) FILTER (WHERE ((sales_ol IS NOT NULL) AND (act IS NOT NULL))), (0)::numeric)), 3) AS sales_bias,
    (count(*) FILTER (WHERE ((scm_ol IS NOT NULL) AND (act IS NOT NULL))))::integer AS n_scored_scm,
    round((sum(abs((scm_ol - act))) FILTER (WHERE ((scm_ol IS NOT NULL) AND (act IS NOT NULL))) / NULLIF(sum(act) FILTER (WHERE ((scm_ol IS NOT NULL) AND (act IS NOT NULL))), (0)::numeric)), 3) AS scm_wape,
    round((sum((scm_ol - act)) FILTER (WHERE ((scm_ol IS NOT NULL) AND (act IS NOT NULL))) / NULLIF(sum(act) FILTER (WHERE ((scm_ol IS NOT NULL) AND (act IS NOT NULL))), (0)::numeric)), 3) AS scm_bias,
        CASE
            WHEN ((sum(act) FILTER (WHERE (act IS NOT NULL)) IS NULL) OR (sum(act) FILTER (WHERE (act IS NOT NULL)) = (0)::numeric)) THEN 'NO_ACTUAL'::text
            ELSE NULL::text
        END AS reason_code
   FROM raw.fact_mc_plan_actual
  GROUP BY COALESCE(NULLIF(btrim(model_base), ''::text), '(미분류)'::text), fy_sheet;


--
-- Name: VIEW v_ol_accuracy; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_ol_accuracy IS '기종 × 회계연도 OL 정확도. Bias 양수 = 과대예측. act null 행은 채점 제외';


--
-- Name: v_ol_accuracy_fy; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_ol_accuracy_fy AS
 SELECT fy_sheet,
    (count(*))::integer AS n_rows,
    (count(*) FILTER (WHERE ((sales_ol IS NOT NULL) AND (scm_ol IS NOT NULL) AND (act IS NOT NULL))))::integer AS n_scored,
    round((sum(abs((sales_ol - act))) FILTER (WHERE ((sales_ol IS NOT NULL) AND (scm_ol IS NOT NULL) AND (act IS NOT NULL))) / NULLIF(sum(act) FILTER (WHERE ((sales_ol IS NOT NULL) AND (scm_ol IS NOT NULL) AND (act IS NOT NULL))), (0)::numeric)), 3) AS sales_wape,
    round((sum(abs((scm_ol - act))) FILTER (WHERE ((sales_ol IS NOT NULL) AND (scm_ol IS NOT NULL) AND (act IS NOT NULL))) / NULLIF(sum(act) FILTER (WHERE ((sales_ol IS NOT NULL) AND (scm_ol IS NOT NULL) AND (act IS NOT NULL))), (0)::numeric)), 3) AS scm_wape,
    round((sum((sales_ol - act)) FILTER (WHERE ((sales_ol IS NOT NULL) AND (scm_ol IS NOT NULL) AND (act IS NOT NULL))) / NULLIF(sum(act) FILTER (WHERE ((sales_ol IS NOT NULL) AND (scm_ol IS NOT NULL) AND (act IS NOT NULL))), (0)::numeric)), 3) AS sales_bias,
    round((sum((scm_ol - act)) FILTER (WHERE ((sales_ol IS NOT NULL) AND (scm_ol IS NOT NULL) AND (act IS NOT NULL))) / NULLIF(sum(act) FILTER (WHERE ((sales_ol IS NOT NULL) AND (scm_ol IS NOT NULL) AND (act IS NOT NULL))), (0)::numeric)), 3) AS scm_bias
   FROM raw.fact_mc_plan_actual
  GROUP BY fy_sheet;


--
-- Name: v_order_available_stock; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_order_available_stock WITH (security_invoker='true') AS
 SELECT im.item_id,
    im.item_name,
        CASE
            WHEN (sb.normal_qty IS NULL) THEN NULL::numeric
            ELSE (sb.normal_qty - COALESCE(aq.committed_qty, (0)::numeric))
        END AS available_qty,
        CASE
            WHEN (sb.item_id IS NULL) THEN 'INVENTORY_SCOPE_UNCLASSIFIED'::text
            ELSE NULL::text
        END AS reason_code
   FROM ((core.v_item_master im
     LEFT JOIN core.stock_balance sb ON ((sb.item_id = im.item_id)))
     LEFT JOIN core.v_item_allocation_qty aq ON ((aq.item_id = im.item_id)))
  WHERE core.has_permission('ATP_VIEW'::text);


--
-- Name: VIEW v_order_available_stock; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_order_available_stock IS 'Task 4 · 5 — 영업(ATP_VIEW) 전용 주문 가능 수량 = 정상 창고재고 − 모든 영업담당자의 임시 · 확정 · 승인대기 합계. 재고 상세는 노출하지 않는다';


--
-- Name: v_part_linkage; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_part_linkage AS
 SELECT x.related_item,
    xi.description AS related_desc,
    x.hoc_item,
    hi.description AS hoc_desc,
    hi.family
   FROM ((core.v_part_linkage x
     LEFT JOIN core.v_item xi ON ((xi.item_code = x.related_item)))
     LEFT JOIN core.v_item hi ON ((hi.item_code = x.hoc_item)));


--
-- Name: permission; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.permission (
    permission_code text NOT NULL,
    description text NOT NULL,
    domain text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: role_permission; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.role_permission (
    job_role text NOT NULL,
    permission_code text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: v_permission_matrix; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_permission_matrix WITH (security_invoker='true') AS
 SELECT rp.job_role,
    p.domain,
    p.permission_code,
    p.description
   FROM (core.role_permission rp
     JOIN core.permission p ON ((p.permission_code = rp.permission_code)));


--
-- Name: v_planning_cycle; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_planning_cycle WITH (security_invoker='true') AS
 SELECT cycle_id,
    plan_month,
    submission_deadline,
    status,
    is_active,
    opened_by,
    opened_at,
    closed_by,
    closed_at
   FROM core.planning_cycle;


--
-- Name: procurement_plan; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.procurement_plan (
    plan_id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_month date NOT NULL,
    version integer NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    horizon_months integer DEFAULT 6 NOT NULL,
    forecast_run_id uuid,
    forecast_train_start date,
    forecast_train_end date,
    forecast_data_snapshot_at timestamp with time zone,
    source_status text NOT NULL,
    built_by uuid NOT NULL,
    built_by_name text NOT NULL,
    built_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    confirmed_by uuid,
    confirmed_by_name text,
    confirmed_at timestamp with time zone,
    approval_id uuid,
    decided_by uuid,
    decider_name text,
    decided_at timestamp with time zone,
    decision_comment text,
    superseded_by_plan_id uuid,
    superseded_at timestamp with time zone,
    CONSTRAINT procurement_plan_built_by_name_check CHECK ((btrim(built_by_name) <> ''::text)),
    CONSTRAINT procurement_plan_horizon_months_check CHECK ((horizon_months = 6)),
    CONSTRAINT procurement_plan_plan_month_check CHECK ((EXTRACT(day FROM plan_month) = (1)::numeric)),
    CONSTRAINT procurement_plan_source_status_check CHECK ((source_status = ANY (ARRAY['VERIFIED'::text, 'FORECAST_SOURCE_UNVERIFIED'::text, 'FORECAST_WINDOW_CHANGED'::text, 'FORECAST_INPUT_UNTRACED'::text, 'FORECAST_INPUT_CHANGED'::text]))),
    CONSTRAINT procurement_plan_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'PENDING_APPROVAL'::text, 'APPROVED'::text, 'REJECTED'::text, 'SUPERSEDED'::text]))),
    CONSTRAINT procurement_plan_status_fields_check CHECK ((((status <> 'APPROVED'::text) OR ((approval_id IS NOT NULL) AND (confirmed_by IS NOT NULL) AND (decided_by IS NOT NULL) AND (NULLIF(btrim(decider_name), ''::text) IS NOT NULL) AND (decided_at IS NOT NULL))) AND ((status <> 'REJECTED'::text) OR ((decided_by IS NOT NULL) AND (decided_at IS NOT NULL) AND (NULLIF(btrim(decision_comment), ''::text) IS NOT NULL))) AND ((status <> 'SUPERSEDED'::text) OR (superseded_at IS NOT NULL)))),
    CONSTRAINT procurement_plan_version_check CHECK ((version > 0))
);


--
-- Name: TABLE procurement_plan; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.procurement_plan IS 'Task 9b — 월별 발주계획 버전. APPROVED만 최종본이며 변경할 수 없다. 재계산은 새 버전을 만든다';


--
-- Name: COLUMN procurement_plan.source_status; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.procurement_plan.source_status IS '생성 시점 Forecast 원천 판정(core.procurement_forecast_source_status). VERIFIED가 아니면 모든 라인이 계산 불가다';


--
-- Name: procurement_plan_line; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.procurement_plan_line (
    line_id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_id uuid NOT NULL,
    item_id text NOT NULL,
    item_name text,
    month_no smallint NOT NULL,
    target_month date NOT NULL,
    champion_model_id text,
    model_version uuid,
    base_forecast_qty numeric,
    department_agreed_qty numeric,
    candidate_source text,
    candidate_qty numeric,
    flex_min_qty numeric,
    flex_max_qty numeric,
    flex_applied boolean DEFAULT false NOT NULL,
    adjusted_demand_qty numeric,
    confirmed_order_qty numeric,
    meeting_qty numeric,
    event_qty numeric,
    approved_added_qty numeric,
    demand_qty numeric,
    normal_stock_qty numeric,
    allocated_qty numeric,
    available_qty numeric,
    stock_snapshot_at timestamp with time zone,
    start_stock_qty numeric,
    target_dos_days numeric,
    target_dos_approved boolean DEFAULT false NOT NULL,
    unit_price numeric,
    moq numeric,
    pack_size numeric,
    min_order_amount numeric,
    avg_usage_6m numeric,
    stockout_prevention_qty numeric,
    dos_required_qty numeric,
    selected_qty numeric,
    selection_reason text,
    effective_moq numeric NOT NULL,
    final_order_qty numeric,
    projected_month_end_qty numeric,
    projected_dos_days numeric,
    projected_inventory_value numeric,
    calculation_status text NOT NULL,
    reason_code text,
    reason_codes text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT procurement_plan_line_calculation_status_check CHECK ((calculation_status = ANY (ARRAY['CALCULATED'::text, 'CALCULATION_UNAVAILABLE'::text]))),
    CONSTRAINT procurement_plan_line_candidate_source_check CHECK (((candidate_source IS NULL) OR (candidate_source = ANY (ARRAY['DEPARTMENT_AGREED'::text, 'BASE_FORECAST'::text])))),
    CONSTRAINT procurement_plan_line_effective_moq_check CHECK ((effective_moq > (0)::numeric)),
    CONSTRAINT procurement_plan_line_item_id_check CHECK ((btrim(item_id) <> ''::text)),
    CONSTRAINT procurement_plan_line_month_no_check CHECK (((month_no >= 1) AND (month_no <= 6))),
    CONSTRAINT procurement_plan_line_reason_check CHECK ((NOT (reason_code IS DISTINCT FROM reason_codes[1]))),
    CONSTRAINT procurement_plan_line_result_check CHECK ((((calculation_status = 'CALCULATED'::text) AND (start_stock_qty IS NOT NULL) AND (demand_qty IS NOT NULL) AND (stockout_prevention_qty IS NOT NULL) AND (dos_required_qty IS NOT NULL) AND (selected_qty IS NOT NULL) AND (selection_reason IS NOT NULL) AND (final_order_qty IS NOT NULL) AND (projected_month_end_qty IS NOT NULL) AND (projected_inventory_value IS NOT NULL)) OR ((calculation_status = 'CALCULATION_UNAVAILABLE'::text) AND (reason_code IS NOT NULL) AND (stockout_prevention_qty IS NULL) AND (dos_required_qty IS NULL) AND (selected_qty IS NULL) AND (selection_reason IS NULL) AND (final_order_qty IS NULL) AND (projected_month_end_qty IS NULL) AND (projected_dos_days IS NULL) AND (projected_inventory_value IS NULL)))),
    CONSTRAINT procurement_plan_line_selection_reason_check CHECK (((selection_reason IS NULL) OR (selection_reason = ANY (ARRAY['STOCKOUT_PREVENTION'::text, 'DOS_TARGET'::text, 'INVENTORY_VALUE_MIN'::text])))),
    CONSTRAINT procurement_plan_line_target_month_check CHECK ((EXTRACT(day FROM target_month) = (1)::numeric))
);


--
-- Name: TABLE procurement_plan_line; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.procurement_plan_line IS 'Task 9b — 품목 × 1~6개월차 계산 단계별 수량과 입력 스냅샷. 생성 후 수정 · 삭제할 수 없다';


--
-- Name: COLUMN procurement_plan_line.reason_codes; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.procurement_plan_line.reason_codes IS '확인 순서대로 모은 모든 사유. reason_code는 첫 번째 사유다. AVG_USAGE_ZERO만 정보성이고 나머지는 확정을 막는다';


--
-- Name: v_procurement_plan; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_procurement_plan WITH (security_invoker='true') AS
 SELECT p.plan_id,
    p.plan_month,
    p.version,
    p.status,
    p.horizon_months,
    p.forecast_run_id,
    p.forecast_train_start,
    p.forecast_train_end,
    p.forecast_data_snapshot_at,
    p.source_status,
    p.built_by,
    p.built_by_name,
    p.built_at,
    p.confirmed_by,
    p.confirmed_by_name,
    p.confirmed_at,
    p.approval_id,
    p.decided_by,
    p.decider_name,
    p.decided_at,
    p.decision_comment,
    p.superseded_by_plan_id,
    p.superseded_at,
    (p.status = 'APPROVED'::text) AS is_final,
    (NOT (EXISTS ( SELECT 1
           FROM core.procurement_plan newer
          WHERE ((newer.plan_month = p.plan_month) AND (newer.version > p.version))))) AS is_latest_version,
    ((p.status = 'APPROVED'::text) AND (NOT (EXISTS ( SELECT 1
           FROM core.procurement_plan newer
          WHERE ((newer.plan_month = p.plan_month) AND (newer.status = 'APPROVED'::text) AND (newer.version > p.version)))))) AS is_latest_approved,
    COALESCE(s.n_items, (0)::bigint) AS n_items,
    COALESCE(s.n_lines, (0)::bigint) AS n_lines,
    COALESCE(s.n_calculated_lines, (0)::bigint) AS n_calculated_lines,
    COALESCE(s.n_unavailable_lines, (0)::bigint) AS n_unavailable_lines,
    COALESCE(s.n_target_dos_unset_items, (0)::bigint) AS n_target_dos_unset_items,
    ((p.status = ANY (ARRAY['DRAFT'::text, 'REJECTED'::text])) AND (COALESCE(s.n_lines, (0)::bigint) > 0) AND (COALESCE(s.n_blocking_lines, (0)::bigint) = 0)) AS confirmable
   FROM (core.procurement_plan p
     LEFT JOIN LATERAL ( SELECT count(DISTINCT l.item_id) AS n_items,
            count(*) AS n_lines,
            count(*) FILTER (WHERE (l.calculation_status = 'CALCULATED'::text)) AS n_calculated_lines,
            count(*) FILTER (WHERE (l.calculation_status = 'CALCULATION_UNAVAILABLE'::text)) AS n_unavailable_lines,
            count(DISTINCT l.item_id) FILTER (WHERE ('TARGET_DOS_UNSET'::text = ANY (l.reason_codes))) AS n_target_dos_unset_items,
            count(*) FILTER (WHERE ((l.calculation_status = 'CALCULATION_UNAVAILABLE'::text) OR ('TARGET_DOS_UNSET'::text = ANY (l.reason_codes)))) AS n_blocking_lines
           FROM core.procurement_plan_line l
          WHERE (l.plan_id = p.plan_id)) s ON (true));


--
-- Name: VIEW v_procurement_plan; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_procurement_plan IS 'Task 9b — 발주계획 버전 목록. is_final = 승인본, is_latest_approved = 그 달의 최신 승인본(Task 10이 읽는다), confirmable = 확정 가능(미확정이고 차단 라인 0)';


--
-- Name: v_procurement_plan_blocker; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_procurement_plan_blocker WITH (security_invoker='true') AS
 SELECT l.plan_id,
    u.code AS reason_code,
    count(*) AS line_count,
    count(DISTINCT l.item_id) AS item_count,
    COALESCE(array_position(ARRAY['FORECAST_SOURCE_UNVERIFIED'::text, 'FORECAST_WINDOW_CHANGED'::text, 'FORECAST_INPUT_UNTRACED'::text, 'FORECAST_INPUT_CHANGED'::text, 'CHAMPION_UNAVAILABLE'::text, 'BASE_FORECAST_UNAVAILABLE'::text, 'AVG_USAGE_UNAVAILABLE'::text, 'INVENTORY_SCOPE_UNCLASSIFIED'::text, 'AVAILABLE_STOCK_UNAVAILABLE'::text, 'PRIOR_MONTH_UNAVAILABLE'::text, 'ITEM_POLICY_MISSING'::text, 'UNIT_PRICE_UNSET'::text, 'TARGET_DOS_UNSET'::text], u.code), 99) AS reason_rank
   FROM (core.procurement_plan_line l
     CROSS JOIN LATERAL unnest(l.reason_codes) u(code))
  WHERE (((l.calculation_status = 'CALCULATION_UNAVAILABLE'::text) OR ('TARGET_DOS_UNSET'::text = ANY (l.reason_codes))) AND (u.code <> 'AVG_USAGE_ZERO'::text))
  GROUP BY l.plan_id, u.code;


--
-- Name: procurement_plan_event; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.procurement_plan_event (
    event_id bigint NOT NULL,
    plan_id uuid NOT NULL,
    event_type text NOT NULL,
    previous_status text,
    next_status text NOT NULL,
    actor uuid NOT NULL,
    actor_name text NOT NULL,
    approval_id uuid,
    comment text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT procurement_plan_event_event_type_check CHECK ((event_type = ANY (ARRAY['BUILT'::text, 'SUPERSEDED'::text, 'CONFIRM_BLOCKED'::text, 'CONFIRMED'::text, 'APPROVED'::text, 'REJECTED'::text, 'APPROVAL_CANCELLED'::text]))),
    CONSTRAINT procurement_plan_event_payload_check CHECK ((jsonb_typeof(payload) = 'object'::text))
);


--
-- Name: TABLE procurement_plan_event; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.procurement_plan_event IS 'Task 9b — 발주계획 생성 · 대체 · 확정 차단 · 확정 · 승인 · 반려 · 승인 취소 append-only 이력(stage1 §9)';


--
-- Name: v_procurement_plan_event; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_procurement_plan_event WITH (security_invoker='true') AS
 SELECT event_id,
    plan_id,
    event_type,
    previous_status,
    next_status,
    actor,
    actor_name,
    approval_id,
    comment,
    payload,
    at
   FROM core.procurement_plan_event e;


--
-- Name: v_procurement_plan_kpi; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_procurement_plan_kpi WITH (security_invoker='true') AS
 SELECT p.plan_id,
    p.plan_month,
    p.version,
    p.status AS plan_status,
    (p.status = 'APPROVED'::text) AS is_final,
    l.month_no,
    l.target_month,
    count(DISTINCT l.item_id) AS n_items,
    count(*) FILTER (WHERE (l.calculation_status = 'CALCULATED'::text)) AS n_calculated_lines,
    count(*) FILTER (WHERE (l.calculation_status = 'CALCULATION_UNAVAILABLE'::text)) AS n_unavailable_lines,
        CASE
            WHEN (count(*) FILTER (WHERE (l.calculation_status = 'CALCULATION_UNAVAILABLE'::text)) = 0) THEN sum(l.final_order_qty)
            ELSE NULL::numeric
        END AS total_final_order_qty,
        CASE
            WHEN (count(*) FILTER (WHERE (l.calculation_status = 'CALCULATION_UNAVAILABLE'::text)) = 0) THEN sum(l.projected_month_end_qty)
            ELSE NULL::numeric
        END AS total_projected_month_end_qty,
        CASE
            WHEN (count(*) FILTER (WHERE (l.calculation_status = 'CALCULATION_UNAVAILABLE'::text)) = 0) THEN sum(l.projected_inventory_value)
            ELSE NULL::numeric
        END AS total_projected_inventory_value,
        CASE
            WHEN (count(*) FILTER (WHERE (l.calculation_status = 'CALCULATED'::text)) = 0) THEN 'CALCULATION_UNAVAILABLE'::text
            WHEN (count(*) FILTER (WHERE (l.calculation_status = 'CALCULATION_UNAVAILABLE'::text)) > 0) THEN 'PARTIAL_CALCULATION'::text
            ELSE NULL::text
        END AS kpi_reason_code
   FROM (core.procurement_plan p
     JOIN core.procurement_plan_line l ON ((l.plan_id = p.plan_id)))
  GROUP BY p.plan_id, p.plan_month, p.version, p.status, l.month_no, l.target_month;


--
-- Name: VIEW v_procurement_plan_kpi; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_procurement_plan_kpi IS 'Task 9b — 계획 · 월별 기대값 합계(발주량 · 예상 월말재고 · 예상 재고금액). 계산 불가 라인이 있으면 합계 null + kpi_reason_code';


--
-- Name: v_procurement_plan_line; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_procurement_plan_line WITH (security_invoker='true') AS
 SELECT l.line_id,
    l.plan_id,
    p.plan_month,
    p.version,
    p.status AS plan_status,
    (p.status = 'APPROVED'::text) AS is_final,
    l.item_id,
    l.item_name,
    l.month_no,
    l.target_month,
    l.champion_model_id,
    l.model_version,
    l.base_forecast_qty,
    l.department_agreed_qty,
    l.candidate_source,
    l.candidate_qty,
    l.flex_min_qty,
    l.flex_max_qty,
    l.flex_applied,
    l.adjusted_demand_qty,
    l.confirmed_order_qty,
    l.meeting_qty,
    l.event_qty,
    l.approved_added_qty,
    l.demand_qty,
    l.normal_stock_qty,
    l.allocated_qty,
    l.available_qty,
    l.stock_snapshot_at,
    l.start_stock_qty,
    l.target_dos_days,
    l.target_dos_approved,
    l.unit_price,
    l.moq,
    l.pack_size,
    l.min_order_amount,
    l.avg_usage_6m,
    l.stockout_prevention_qty,
    l.dos_required_qty,
    l.selected_qty,
    l.selection_reason,
    l.effective_moq,
    l.final_order_qty,
    l.projected_month_end_qty,
    l.projected_dos_days,
    l.projected_inventory_value,
    l.calculation_status,
    l.reason_code,
    l.reason_codes,
    l.created_at
   FROM (core.procurement_plan_line l
     JOIN core.procurement_plan p ON ((p.plan_id = l.plan_id)));


--
-- Name: VIEW v_procurement_plan_line; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_procurement_plan_line IS 'Task 9b — 계획 라인(계산 단계별 수량 · 입력 스냅샷 · 사유). 화면은 이 값을 다시 계산하지 않고 그대로 보여준다';


--
-- Name: procurement_schedule; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.procurement_schedule (
    schedule_id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_id uuid NOT NULL,
    plan_line_id uuid NOT NULL,
    item_id text NOT NULL,
    supplier_id text,
    entity_id text,
    departure_date date,
    prep_days integer,
    base_order_date date,
    requested_order_date date,
    planned_receipt_date date,
    confirmed_receipt_date date,
    bundle_iso_year integer,
    bundle_iso_week integer,
    calculation_status text NOT NULL,
    reason_code text,
    built_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    superseded_at timestamp with time zone,
    superseded_by_plan_id uuid,
    CONSTRAINT procurement_schedule_bundle_iso_week_check CHECK (((bundle_iso_week IS NULL) OR ((bundle_iso_week >= 1) AND (bundle_iso_week <= 53)))),
    CONSTRAINT procurement_schedule_calculation_status_check CHECK ((calculation_status = ANY (ARRAY['SCHEDULED'::text, 'EXCLUDED'::text]))),
    CONSTRAINT procurement_schedule_item_id_check CHECK ((btrim(item_id) <> ''::text)),
    CONSTRAINT procurement_schedule_prep_days_check CHECK (((prep_days IS NULL) OR (prep_days > 0))),
    CONSTRAINT procurement_schedule_reason_code_check CHECK (((reason_code IS NULL) OR (reason_code = ANY (ARRAY['SUPPLIER_UNSET'::text, 'DEPARTURE_RULE_UNSET'::text, 'DEPARTURE_RULE_AMBIGUOUS'::text, 'SUPPLIER_INACTIVE'::text, 'PREP_DAYS_UNSET'::text, 'CALENDAR_NOT_READY'::text])))),
    CONSTRAINT procurement_schedule_status_check CHECK ((((calculation_status = 'SCHEDULED'::text) AND (reason_code IS NULL) AND (confirmed_receipt_date IS NOT NULL) AND (supplier_id IS NOT NULL) AND (entity_id IS NOT NULL) AND (departure_date IS NOT NULL) AND (prep_days IS NOT NULL) AND (base_order_date IS NOT NULL) AND (requested_order_date IS NOT NULL) AND (planned_receipt_date IS NOT NULL)) OR ((calculation_status = 'EXCLUDED'::text) AND (reason_code IS NOT NULL) AND (confirmed_receipt_date IS NULL))))
);


--
-- Name: TABLE procurement_schedule; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.procurement_schedule IS 'Task 10b — 승인된 발주계획 1개월차 라인 × 공급처 출항일로 만든 발주 · 입고 일정 한 줄. core.build_procurement_schedule이 채우며 화면 · Server Action은 직접 쓰지 않는다';


--
-- Name: COLUMN procurement_schedule.reason_code; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.procurement_schedule.reason_code IS 'EXCLUDED일 때만 채운다. 그때까지 계산된 값(예: departure_date)은 남기고 그 뒤 값은 비운다';


--
-- Name: COLUMN procurement_schedule.superseded_at; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.procurement_schedule.superseded_at IS 'fix round 1 — 이 달의 더 최신 승인본으로 일정을 다시 만들면 채워진다(행은 지우지 않는다). null이면 지금 유효한(대체되지 않은) 행이다';


--
-- Name: receipt_schedule_result; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.receipt_schedule_result (
    result_id uuid DEFAULT gen_random_uuid() NOT NULL,
    schedule_id uuid NOT NULL,
    confirmed_receipt_date date,
    actual_receipt_date date,
    gap_days integer GENERATED ALWAYS AS ((actual_receipt_date - confirmed_receipt_date)) STORED,
    recorded_by uuid,
    recorded_by_name text,
    recorded_at timestamp with time zone,
    note text,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: TABLE receipt_schedule_result; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.receipt_schedule_result IS 'Task 10b — 확정 계획 입고일 · 실제 입고일 · 차이(부호 있는 일수). 실제 입고일은 SCM 품목담당자가 core.record_actual_receipt_date로만 입력한다. 입고 실적에 자동 매칭하지 않는다(브리프 규칙)';


--
-- Name: COLUMN receipt_schedule_result.gap_days; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON COLUMN core.receipt_schedule_result.gap_days IS '입고 차이 = 실제 입고일 − 확정 계획 입고일. 조기/지연 상태 코드를 별도로 두지 않는다';


--
-- Name: v_procurement_schedule; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_procurement_schedule WITH (security_invoker='true') AS
 SELECT s.schedule_id,
    s.plan_id,
    p.plan_month,
    p.status AS plan_status,
    s.item_id,
    l.item_name,
    l.final_order_qty,
    s.supplier_id,
    sup.supplier_name,
    s.entity_id,
    ent.entity_name,
    s.departure_date,
    s.prep_days,
    s.base_order_date,
    s.requested_order_date,
    s.planned_receipt_date,
    s.confirmed_receipt_date,
    s.bundle_iso_year,
    s.bundle_iso_week,
        CASE
            WHEN ((s.bundle_iso_year IS NOT NULL) AND (s.bundle_iso_week IS NOT NULL)) THEN (((s.bundle_iso_year)::text || '-W'::text) || lpad((s.bundle_iso_week)::text, 2, '0'::text))
            ELSE NULL::text
        END AS bundle_key,
    s.calculation_status,
    s.reason_code,
    s.built_at,
    r.actual_receipt_date,
    r.gap_days,
    r.recorded_by_name,
    r.recorded_at,
    r.note,
        CASE
            WHEN (s.calculation_status <> 'SCHEDULED'::text) THEN s.reason_code
            WHEN (r.actual_receipt_date IS NULL) THEN 'ACTUAL_RECEIPT_UNSET'::text
            ELSE NULL::text
        END AS gap_reason_code,
    s.superseded_at,
    s.superseded_by_plan_id
   FROM (((((core.procurement_schedule s
     JOIN core.procurement_plan p ON ((p.plan_id = s.plan_id)))
     JOIN core.procurement_plan_line l ON ((l.line_id = s.plan_line_id)))
     LEFT JOIN core.supplier sup ON ((sup.supplier_id = s.supplier_id)))
     LEFT JOIN core.supply_entity ent ON ((ent.entity_id = s.entity_id)))
     LEFT JOIN core.receipt_schedule_result r ON ((r.schedule_id = s.schedule_id)));


--
-- Name: VIEW v_procurement_schedule; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_procurement_schedule IS 'Task 10b — 발주 일정 한 줄(출항일 · 기준/요청 발주일 · 계획/확정 입고일 · 실제 입고일 · 차이). EXCLUDED 행도 그대로 보여준다(조용히 빼지 않는다). gap_reason_code는 EXCLUDED 행의 제외 사유 또는 SCHEDULED인데 실제 입고일이 아직 없을 때의 ACTUAL_RECEIPT_UNSET이다. superseded_at이 있으면 이 달의 더 최신 승인본이 대체한 옛 행이다(fix round 1)';


--
-- Name: dim_model; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.dim_model (
    model_key text NOT NULL,
    model_base text,
    biz text,
    iot_code text,
    sources text
);


--
-- Name: COLUMN dim_model.model_base; Type: COMMENT; Schema: raw; Owner: -
--

COMMENT ON COLUMN raw.dim_model.model_base IS 'NULL/빈값인 8행은 기종이 아니라 Option MAP 헤더에서 온 그룹 키(DT Common · Newline Q+ 02" 등). 조회 시 반드시 제외';


--
-- Name: v_model; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_model AS
 SELECT model_key,
    model_base,
    NULLIF(btrim(biz), ''::text) AS biz,
    NULLIF(btrim(iot_code), ''::text) AS iot_code,
    sources
   FROM raw.dim_model
  WHERE ((model_base IS NOT NULL) AND (btrim(model_base) <> ''::text));


--
-- Name: v_realdata_kpi; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_realdata_kpi AS
 SELECT ( SELECT count(*) AS count
           FROM raw.dim_item) AS n_items,
    ( SELECT count(*) AS count
           FROM core.v_model) AS n_models,
    ( SELECT count(*) AS count
           FROM raw.fact_shipment) AS n_shipment_rows,
    ( SELECT max(fact_shipment.ym) AS max
           FROM raw.fact_shipment) AS data_as_of,
    ( SELECT min(fact_shipment.ym) AS min
           FROM raw.fact_shipment) AS data_from,
    ( SELECT count(*) AS count
           FROM analytics.v_item_demand_profile
          WHERE (v_item_demand_profile.demand_type = ANY (ARRAY['INTERMITTENT'::text, 'LUMPY'::text]))) AS n_croston_candidate,
    ( SELECT count(*) AS count
           FROM analytics.v_item_demand_profile
          WHERE (v_item_demand_profile.reason_code = 'INSUFFICIENT_HISTORY'::text)) AS n_insufficient,
    ( SELECT count(*) AS count
           FROM raw.bridge_xcn) AS n_xcn_links;


--
-- Name: v_receipt_gap_entity; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_receipt_gap_entity WITH (security_invoker='true') AS
 SELECT s.entity_id,
    ent.entity_name,
    count(*) AS n_total,
    count(*) FILTER (WHERE (r.actual_receipt_date IS NOT NULL)) AS n_actual_recorded,
    count(*) FILTER (WHERE (r.actual_receipt_date IS NULL)) AS n_actual_unset,
    avg(r.gap_days) FILTER (WHERE (r.actual_receipt_date IS NOT NULL)) AS avg_gap_days,
    sum(r.gap_days) FILTER (WHERE (r.actual_receipt_date IS NOT NULL)) AS sum_gap_days
   FROM ((core.procurement_schedule s
     JOIN core.receipt_schedule_result r ON ((r.schedule_id = s.schedule_id)))
     LEFT JOIN core.supply_entity ent ON ((ent.entity_id = s.entity_id)))
  WHERE ((s.calculation_status = 'SCHEDULED'::text) AND (s.superseded_at IS NULL))
  GROUP BY s.entity_id, ent.entity_name;


--
-- Name: VIEW v_receipt_gap_entity; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_receipt_gap_entity IS 'Task 10b — 해외법인별 계획 입고일 대비 실제 입고일 차이 집계. 실제 입고일이 있는 행만 평균 · 합계에 쓴다';


--
-- Name: v_receipt_gap_item; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_receipt_gap_item WITH (security_invoker='true') AS
 SELECT s.item_id,
    l.item_name,
    count(*) AS n_total,
    count(*) FILTER (WHERE (r.actual_receipt_date IS NOT NULL)) AS n_actual_recorded,
    count(*) FILTER (WHERE (r.actual_receipt_date IS NULL)) AS n_actual_unset,
    avg(r.gap_days) FILTER (WHERE (r.actual_receipt_date IS NOT NULL)) AS avg_gap_days,
    sum(r.gap_days) FILTER (WHERE (r.actual_receipt_date IS NOT NULL)) AS sum_gap_days
   FROM ((core.procurement_schedule s
     JOIN core.receipt_schedule_result r ON ((r.schedule_id = s.schedule_id)))
     JOIN core.procurement_plan_line l ON ((l.line_id = s.plan_line_id)))
  WHERE ((s.calculation_status = 'SCHEDULED'::text) AND (s.superseded_at IS NULL))
  GROUP BY s.item_id, l.item_name;


--
-- Name: VIEW v_receipt_gap_item; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_receipt_gap_item IS 'Task 10b — 품목별 계획 입고일 대비 실제 입고일 차이 집계. 실제 입고일이 있는 행만 평균 · 합계에 쓴다';


--
-- Name: v_receipt_gap_month; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_receipt_gap_month WITH (security_invoker='true') AS
 SELECT (date_trunc('month'::text, (s.confirmed_receipt_date)::timestamp with time zone))::date AS target_month,
    count(*) AS n_total,
    count(*) FILTER (WHERE (r.actual_receipt_date IS NOT NULL)) AS n_actual_recorded,
    count(*) FILTER (WHERE (r.actual_receipt_date IS NULL)) AS n_actual_unset,
    avg(r.gap_days) FILTER (WHERE (r.actual_receipt_date IS NOT NULL)) AS avg_gap_days,
    sum(r.gap_days) FILTER (WHERE (r.actual_receipt_date IS NOT NULL)) AS sum_gap_days
   FROM (core.procurement_schedule s
     JOIN core.receipt_schedule_result r ON ((r.schedule_id = s.schedule_id)))
  WHERE ((s.calculation_status = 'SCHEDULED'::text) AND (s.superseded_at IS NULL))
  GROUP BY (date_trunc('month'::text, (s.confirmed_receipt_date)::timestamp with time zone));


--
-- Name: VIEW v_receipt_gap_month; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_receipt_gap_month IS 'Task 10b — 확정 계획 입고일이 속한 월별 차이 집계(브리프 규칙 — 계획 입고일 기준). 실제 입고일이 있는 행만 평균 · 합계에 쓴다';


--
-- Name: v_shipment_trend; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_shipment_trend AS
 WITH bound AS (
         SELECT max(fact_shipment.ym) AS max_ym,
            max((((SUBSTRING(fact_shipment.ym FROM 1 FOR 4))::integer * 12) + (SUBSTRING(fact_shipment.ym FROM 6 FOR 2))::integer)) AS max_idx
           FROM raw.fact_shipment
        ), s AS (
         SELECT h.hoc_item,
            h.item_type,
            h.ym,
            h.qty,
            (((SUBSTRING(h.ym FROM 1 FOR 4))::integer * 12) + (SUBSTRING(h.ym FROM 6 FOR 2))::integer) AS idx
           FROM core.v_shipment_by_hoc h
        )
 SELECT s.hoc_item AS item_code,
    i.description,
    i.family,
    max(s.item_type) AS item_type,
    b.max_ym AS data_as_of,
    (count(*))::integer AS n_months,
    min(s.ym) AS first_ym,
    max(s.ym) AS last_ym,
    (b.max_idx - max(s.idx)) AS months_since_last,
    ((b.max_idx - min(s.idx)) + 1) AS n_span,
    round(sum(s.qty), 1) AS total_qty,
    round(COALESCE(max(s.qty) FILTER (WHERE (s.idx = b.max_idx)), (0)::numeric), 1) AS latest_qty,
    round((COALESCE(sum(s.qty) FILTER (WHERE (s.idx > (b.max_idx - 3))), (0)::numeric) / 3.0), 1) AS avg_3m,
    round((COALESCE(sum(s.qty) FILTER (WHERE (s.idx > (b.max_idx - 6))), (0)::numeric) / 6.0), 1) AS avg_6m,
    round((COALESCE(sum(s.qty) FILTER (WHERE (s.idx > (b.max_idx - 12))), (0)::numeric) / 12.0), 1) AS avg_12m,
    round(((COALESCE(sum(s.qty) FILTER (WHERE (s.idx > (b.max_idx - 3))), (0)::numeric) / 3.0) / NULLIF((COALESCE(sum(s.qty) FILTER (WHERE (s.idx > (b.max_idx - 12))), (0)::numeric) / 12.0), (0)::numeric)), 2) AS trend_3m_vs_12m,
        CASE
            WHEN (((b.max_idx - min(s.idx)) + 1) < 6) THEN 'INSUFFICIENT_HISTORY'::text
            ELSE NULL::text
        END AS reason_code
   FROM ((s
     CROSS JOIN bound b)
     LEFT JOIN core.v_item i ON ((i.item_code = s.hoc_item)))
  GROUP BY s.hoc_item, i.description, i.family, b.max_ym, b.max_idx;


--
-- Name: VIEW v_shipment_trend; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_shipment_trend IS 'XCN 합산 기준 품목별 출고 추이. 이동평균은 0인 달을 포함해 계산(합계÷고정개월수)';


--
-- Name: usage_profile; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.usage_profile (
    item_id text NOT NULL,
    valid_days integer,
    daily_usage_avg numeric,
    daily_usage_sd numeric,
    cv numeric,
    confirmed_at timestamp with time zone DEFAULT now()
);


--
-- Name: inventory; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.inventory (
    "품목코드" text,
    "창고" text,
    "현재고" text,
    "기준일자" text,
    "안전재고" text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text,
    inventory_status text,
    snapshot_at timestamp with time zone,
    warehouse_code text
);


--
-- Name: COLUMN inventory.inventory_status; Type: COMMENT; Schema: raw; Owner: -
--

COMMENT ON COLUMN raw.inventory.inventory_status IS '원본 재고상태 텍스트. core.inventory_scope_rule로 NORMAL 등 여섯 범위에 매핑한다';


--
-- Name: COLUMN inventory.snapshot_at; Type: COMMENT; Schema: raw; Owner: -
--

COMMENT ON COLUMN raw.inventory.snapshot_at IS '이 재고 수량을 확인한 시각. 없으면 정상 창고재고 분류에 포함하지 않는다';


--
-- Name: COLUMN inventory.warehouse_code; Type: COMMENT; Schema: raw; Owner: -
--

COMMENT ON COLUMN raw.inventory.warehouse_code IS '정규화된 창고 코드. null이면 창고 범위를 알 수 없어 분류에서 제외한다. 서비스센터·파트너처럼
   창고 자체가 범위를 정하는 경우 core.inventory_scope_rule의 창고전용 규칙과 매칭된다';


--
-- Name: v_stock_on_hand; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_stock_on_hand AS
 SELECT upper(regexp_replace("품목코드", '[\s\-_]'::text, ''::text, 'g'::text)) AS item_id,
    sum((NULLIF("현재고", ''::text))::numeric) AS current_stock
   FROM raw.inventory
  GROUP BY (upper(regexp_replace("품목코드", '[\s\-_]'::text, ''::text, 'g'::text)));


--
-- Name: v_usage_effective; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_usage_effective AS
 WITH calc AS (
         SELECT upper(regexp_replace(usage_history.item_id, '[\s\-_]'::text, ''::text, 'g'::text)) AS item_id,
            count(*) AS valid_days,
            round(avg(usage_history.qty), 2) AS daily_usage_avg,
            round(stddev_samp(usage_history.qty), 2) AS daily_usage_sd
           FROM raw.usage_history
          WHERE ((usage_history.qty >= (0)::numeric) AND (COALESCE(usage_history.note, ''::text) !~~* '%프로젝트%'::text))
          GROUP BY (upper(regexp_replace(usage_history.item_id, '[\s\-_]'::text, ''::text, 'g'::text)))
        )
 SELECT c.item_id,
    COALESCE((p.valid_days)::bigint, c.valid_days) AS valid_days,
    COALESCE(p.daily_usage_avg, c.daily_usage_avg) AS daily_usage_avg,
    COALESCE(p.daily_usage_sd, c.daily_usage_sd) AS daily_usage_sd,
    round(COALESCE(p.daily_usage_avg, c.daily_usage_avg), 2) AS usage_used,
    round((COALESCE(p.daily_usage_sd, c.daily_usage_sd) / NULLIF(COALESCE(p.daily_usage_avg, c.daily_usage_avg), (0)::numeric)), 2) AS cv,
        CASE
            WHEN (p.item_id IS NOT NULL) THEN '확정값'::text
            ELSE '정제 기준'::text
        END AS source
   FROM (calc c
     LEFT JOIN core.usage_profile p ON ((p.item_id = c.item_id)));


--
-- Name: v_stockout_risk; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_stockout_risk AS
 WITH base AS (
         SELECT i.item_id,
            i.item_name,
            i.supplier_id,
            COALESCE(st.current_stock, (0)::numeric) AS current_stock,
            COALESCE(ib.inbound_qty, (0)::numeric) AS inbound_qty,
            ue.daily_usage_avg,
            ue.cv,
            le.effective_lead_time
           FROM ((((core.v_item_master i
             LEFT JOIN core.v_stock_on_hand st ON ((st.item_id = i.item_id)))
             LEFT JOIN core.v_inbound_qty ib ON ((ib.item_id = i.item_id)))
             LEFT JOIN core.v_usage_effective ue ON ((ue.item_id = i.item_id)))
             LEFT JOIN core.v_leadtime_effective le ON ((le.supplier_id = i.supplier_id)))
          WHERE (i.is_active = 'Y'::text)
        )
 SELECT item_id,
    item_name,
    supplier_id,
    current_stock,
    inbound_qty,
    (current_stock + inbound_qty) AS available_qty,
    daily_usage_avg,
    cv,
    effective_lead_time AS planned_lead_time,
        CASE
            WHEN (COALESCE(daily_usage_avg, (0)::numeric) > (0)::numeric) THEN round(((current_stock + inbound_qty) / daily_usage_avg), 1)
            ELSE NULL::numeric
        END AS stockout_days,
        CASE
            WHEN (COALESCE(daily_usage_avg, (0)::numeric) > (0)::numeric) THEN (CURRENT_DATE + (floor(((current_stock + inbound_qty) / daily_usage_avg)))::integer)
            ELSE NULL::date
        END AS stockout_date,
        CASE
            WHEN (COALESCE(daily_usage_avg, (0)::numeric) = (0)::numeric) THEN 'UNKNOWN'::text
            WHEN (effective_lead_time IS NULL) THEN 'UNKNOWN'::text
            WHEN (((current_stock + inbound_qty) / daily_usage_avg) <= (effective_lead_time)::numeric) THEN 'CRITICAL'::text
            ELSE 'SAFE'::text
        END AS risk_status,
        CASE
            WHEN (COALESCE(daily_usage_avg, (0)::numeric) = (0)::numeric) THEN 'NO_USAGE'::text
            WHEN (effective_lead_time IS NULL) THEN 'NO_LEADTIME'::text
            ELSE NULL::text
        END AS reason
   FROM base;


--
-- Name: VIEW v_stockout_risk; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_stockout_risk IS '[DEPRECATED 2026-09-04] 5회차 더미 데이터 기준 뷰. 실데이터에는 재고·리드타임이 없으므로 더 이상 갱신되지 않습니다. 신규 코드는 analytics.v_shipment_trend · v_item_demand_profile · v_ol_accuracy · v_bom_requirement_x 를 사용하십시오.';


--
-- Name: v_stockout_kpi; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_stockout_kpi AS
 SELECT count(*) AS n_items,
    count(*) FILTER (WHERE (risk_status = 'CRITICAL'::text)) AS n_critical,
    count(*) FILTER (WHERE (risk_status = 'SAFE'::text)) AS n_safe,
    count(*) FILTER (WHERE (risk_status = 'UNKNOWN'::text)) AS n_unknown,
    count(*) FILTER (WHERE (stockout_days <= (30)::numeric)) AS n_within_30d,
    round(avg(stockout_days), 1) AS avg_stockout_days
   FROM analytics.v_stockout_risk;


--
-- Name: VIEW v_stockout_kpi; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_stockout_kpi IS '[DEPRECATED 2026-09-04] 5회차 더미 데이터 기준 뷰. 실데이터에는 재고·리드타임이 없으므로 더 이상 갱신되지 않습니다. 신규 코드는 analytics.v_shipment_trend · v_item_demand_profile · v_ol_accuracy · v_bom_requirement_x 를 사용하십시오.';


--
-- Name: v_supplier; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_supplier AS
 SELECT s.supplier_id,
    s.supplier_name,
    s.entity_id,
    e.entity_name,
    e.country_code,
    s.lead_time_days,
    s.active,
    s.valid_from,
    s.valid_to,
    s.note,
    ( SELECT count(*) AS count
           FROM core.supplier_departure d
          WHERE (d.supplier_id = s.supplier_id)) AS n_departure_rules,
        CASE
            WHEN (s.lead_time_days IS NULL) THEN 'LEADTIME_UNSET'::text
            ELSE NULL::text
        END AS reason_code
   FROM (core.supplier s
     LEFT JOIN core.supply_entity e ON ((e.entity_id = s.entity_id)));


--
-- Name: v_supplier_departure; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_supplier_departure AS
 SELECT d.departure_id,
    d.supplier_id,
    s.supplier_name,
    s.entity_id,
    d.weekday,
    d.day_of_month,
    d.valid_from,
    d.valid_to,
    d.note,
    d.week_of_month,
    d.active
   FROM (core.supplier_departure d
     JOIN core.supplier s ON ((s.supplier_id = d.supplier_id)));


--
-- Name: v_supply_entity; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_supply_entity AS
 SELECT entity_id,
    entity_name,
    country_code,
    prep_days,
    active,
    valid_from,
    valid_to,
    note,
    ( SELECT count(*) AS count
           FROM core.supplier s
          WHERE ((s.entity_id = e.entity_id) AND s.active)) AS n_active_suppliers,
        CASE
            WHEN (prep_days = 0) THEN 'PREP_DAYS_UNSET'::text
            ELSE NULL::text
        END AS reason_code
   FROM core.supply_entity e;


--
-- Name: urgent_order; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.urgent_order (
    urgent_order_id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id text NOT NULL,
    qty numeric NOT NULL,
    needed_by date NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'REQUESTED'::text NOT NULL,
    owner_user_id uuid NOT NULL,
    owner_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT urgent_order_item_id_check CHECK ((btrim(item_id) <> ''::text)),
    CONSTRAINT urgent_order_owner_name_check CHECK ((btrim(owner_name) <> ''::text)),
    CONSTRAINT urgent_order_qty_check CHECK ((qty > (0)::numeric)),
    CONSTRAINT urgent_order_reason_check CHECK ((btrim(reason) <> ''::text)),
    CONSTRAINT urgent_order_status_check CHECK ((status = ANY (ARRAY['REQUESTED'::text, 'IN_PROGRESS'::text, 'COMPLETED'::text, 'CANCELLED'::text])))
);


--
-- Name: TABLE urgent_order; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.urgent_order IS 'Task 5 긴급발주 요청(품목 · 수량 · 필요일 · 사유 · 상태 · 담당자). 이번 Task는 조회 구조와 RLS만 만들고 등록 함수와 화면은 Task 11에서 연결한다';


--
-- Name: v_urgent_order; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_urgent_order WITH (security_invoker='true') AS
 SELECT u.urgent_order_id,
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
   FROM (core.urgent_order u
     LEFT JOIN core.v_item_master im ON ((im.item_id = u.item_id)))
  WHERE (core.has_permission('STOCK_VIEW_ALL'::text) OR (core.has_permission('URGENT_ORDER_VIEW'::text) AND (core.item_visibility_scope(u.item_id) = 'CONSUMABLE'::text)));


--
-- Name: VIEW v_urgent_order; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_urgent_order IS 'Task 5 — 긴급발주 현황. SCM(STOCK_VIEW_ALL)은 전체, 서비스부(URGENT_ORDER_VIEW)는 소모품만. security_invoker';


--
-- Name: v_urgent_order_history; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_urgent_order_history AS
 SELECT a.id,
    a.at,
    a.actor,
    COALESCE(NULLIF(btrim(u.name), ''::text), (a.actor)::text) AS actor_name,
    a.action,
    a.target_id AS urgent_order_id,
    o.item_id,
    a.before,
    a.after
   FROM ((core.audit_log a
     LEFT JOIN core.app_user u ON ((u.user_id = a.actor)))
     LEFT JOIN core.urgent_order o ON (((o.urgent_order_id)::text = a.target_id)))
  WHERE ((a.target_type = 'urgent_order'::text) AND (core.has_permission('STOCK_VIEW_ALL'::text) OR (core.has_permission('URGENT_ORDER_VIEW'::text) AND (core.item_visibility_scope(o.item_id) = 'CONSUMABLE'::text))))
  ORDER BY a.at DESC;


--
-- Name: VIEW v_urgent_order_history; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_urgent_order_history IS 'Task 11 — 긴급발주 등록 · 수정 · 상태 변경 이력. core.audit_log(target_type=urgent_order)를 재사용한다. SCM(STOCK_VIEW_ALL)은 전체, 서비스부(URGENT_ORDER_VIEW)는 소모품 품목 이력만';


--
-- Name: v_usage_anomaly; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_usage_anomaly AS
 WITH stat AS (
         SELECT usage_history.item_id,
            avg(usage_history.qty) AS avg_qty,
            stddev_samp(usage_history.qty) AS sd_qty
           FROM raw.usage_history
          GROUP BY usage_history.item_id
        )
 SELECT u.usage_id,
    u.item_id,
    u.use_date,
    u.qty,
    round(s.avg_qty, 1) AS avg_qty,
    round((u.qty / NULLIF(s.avg_qty, (0)::numeric)), 1) AS ratio,
    u.note,
        CASE
            WHEN (u.qty < (0)::numeric) THEN 'RETURN'::text
            WHEN (COALESCE(u.note, ''::text) ~~* '%프로젝트%'::text) THEN 'PROJECT'::text
            ELSE 'UNEXPLAINED'::text
        END AS anomaly_type
   FROM (raw.usage_history u
     JOIN stat s ON ((s.item_id = u.item_id)))
  WHERE ((u.qty > (s.avg_qty + ((3)::numeric * s.sd_qty))) OR (u.qty < (0)::numeric));


--
-- Name: VIEW v_usage_anomaly; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_usage_anomaly IS '[DEPRECATED 2026-09-04] 5회차 더미 데이터 기준 뷰. 실데이터에는 재고·리드타임이 없으므로 더 이상 갱신되지 않습니다. 신규 코드는 analytics.v_shipment_trend · v_item_demand_profile · v_ol_accuracy · v_bom_requirement_x 를 사용하십시오.';


--
-- Name: v_usage_profile; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_usage_profile AS
 SELECT u.item_id,
    i.item_name,
    i.item_type,
    i.supplier_id,
    u.valid_days,
    u.daily_usage_avg,
    u.daily_usage_sd,
    u.cv,
        CASE
            WHEN (u.cv >= 0.5) THEN '변동 큼'::text
            WHEN (u.cv >= 0.3) THEN '보통'::text
            ELSE '안정'::text
        END AS stability,
    u.source
   FROM (core.v_usage_effective u
     JOIN core.v_item_master i ON ((i.item_id = u.item_id)));


--
-- Name: VIEW v_usage_profile; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_usage_profile IS '[DEPRECATED 2026-09-04] 5회차 더미 데이터 기준 뷰. 실데이터에는 재고·리드타임이 없으므로 더 이상 갱신되지 않습니다. 신규 코드는 analytics.v_shipment_trend · v_item_demand_profile · v_ol_accuracy · v_bom_requirement_x 를 사용하십시오.';


--
-- Name: v_user_access; Type: VIEW; Schema: analytics; Owner: -
--

CREATE VIEW analytics.v_user_access WITH (security_invoker='true') AS
 SELECT user_id,
    email,
    name,
    department,
    job_role,
    role,
    active,
    ( SELECT count(*) AS count
           FROM core.role_permission rp
          WHERE (rp.job_role = u.job_role)) AS n_permissions,
        CASE
            WHEN (job_role IS NULL) THEN 'JOB_ROLE_UNSET'::text
            WHEN (NOT (EXISTS ( SELECT 1
               FROM core.role_permission rp
              WHERE (rp.job_role = u.job_role)))) THEN 'JOB_ROLE_UNKNOWN'::text
            ELSE NULL::text
        END AS reason_code
   FROM core.app_user u;


--
-- Name: VIEW v_user_access; Type: COMMENT; Schema: analytics; Owner: -
--

COMMENT ON VIEW analytics.v_user_access IS 'STEP 19 계정별 시스템·업무 권한. security_invoker로 호출자 RLS를 그대로 적용합니다';


--
-- Name: agent_conversation; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.agent_conversation (
    conversation_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_message_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE agent_conversation; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.agent_conversation IS 'STEP 16 — AI Agent 대화. 본인 대화만 조회·기록하고 관리자는 감사 목적으로 전체 조회';


--
-- Name: agent_conversation_legacy_202609092017; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.agent_conversation_legacy_202609092017 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    user_email text,
    title text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_message; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.agent_message (
    message_id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    question text NOT NULL,
    answer jsonb,
    tool_trace jsonb DEFAULT '[]'::jsonb NOT NULL,
    guardrail jsonb,
    token_usage jsonb,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE agent_message; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.agent_message IS 'STEP 16 — 질문 · 답변(JSON 계약) · Tool Trace · Guardrail 결과. 저장 실패가 답변을 없애지 않습니다';


--
-- Name: agent_message_legacy_202609092017; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.agent_message_legacy_202609092017 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    role text NOT NULL,
    content text,
    answer jsonb,
    tool_trace jsonb,
    usage jsonb,
    guardrail jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_message_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
);


--
-- Name: allocation_priority; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.allocation_priority (
    priority_id bigint NOT NULL,
    order_id uuid NOT NULL,
    previous_priority integer NOT NULL,
    priority integer NOT NULL,
    reason text NOT NULL,
    changed_by uuid NOT NULL,
    changed_by_name text NOT NULL,
    changed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT allocation_priority_changed_check CHECK ((previous_priority <> priority)),
    CONSTRAINT allocation_priority_previous_priority_check CHECK (((previous_priority >= 1) AND (previous_priority <= 9))),
    CONSTRAINT allocation_priority_priority_check CHECK (((priority >= 1) AND (priority <= 9))),
    CONSTRAINT allocation_priority_reason_check CHECK ((btrim(reason) <> ''::text))
);


--
-- Name: TABLE allocation_priority; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.allocation_priority IS 'Task 5 사업강화부 우선순위 변경 이력(변경 전후 · 변경자 · 시각 · 사유). append-only이며 현재 값은 core.sales_order.allocation_priority에 같은 트랜잭션으로 반영한다';


--
-- Name: allocation_priority_priority_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.allocation_priority ALTER COLUMN priority_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME core.allocation_priority_priority_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: approval_event; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.approval_event (
    event_id bigint NOT NULL,
    approval_id uuid NOT NULL,
    event_type text NOT NULL,
    previous_status text,
    next_status text NOT NULL,
    actor uuid NOT NULL,
    comment text,
    payload_snapshot jsonb NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT approval_event_event_type_check CHECK ((event_type = ANY (ARRAY['REQUESTED'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELLED'::text]))),
    CONSTRAINT approval_event_next_status_check CHECK ((next_status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELLED'::text]))),
    CONSTRAINT approval_event_previous_status_check CHECK (((previous_status IS NULL) OR (previous_status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELLED'::text])))),
    CONSTRAINT approval_event_transition_check CHECK ((((event_type = 'REQUESTED'::text) AND (previous_status IS NULL) AND (next_status = 'PENDING'::text)) OR ((event_type = ANY (ARRAY['APPROVED'::text, 'REJECTED'::text, 'CANCELLED'::text])) AND (previous_status = 'PENDING'::text) AND (next_status = event_type))))
);


--
-- Name: TABLE approval_event; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.approval_event IS 'Task 2 승인 상태 변경 append-only 이력. UPDATE와 DELETE는 트리거로도 차단합니다';


--
-- Name: approval_event_event_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.approval_event ALTER COLUMN event_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.approval_event_event_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.audit_log ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: column_mapping; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.column_mapping (
    mapping_id uuid DEFAULT gen_random_uuid() NOT NULL,
    import_type text NOT NULL,
    source_column text NOT NULL,
    target_column text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: demand_submission_event; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.demand_submission_event (
    event_id bigint NOT NULL,
    submission_id uuid NOT NULL,
    event_type text NOT NULL,
    previous_status text,
    next_status text NOT NULL,
    version integer NOT NULL,
    actor uuid NOT NULL,
    actor_name text NOT NULL,
    reason text,
    payload_snapshot jsonb NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT demand_submission_event_event_type_check CHECK ((event_type = ANY (ARRAY['CREATED'::text, 'SUBMITTED'::text, 'WITHDRAWN'::text, 'EDITED'::text, 'AGREED'::text]))),
    CONSTRAINT demand_submission_event_next_status_check CHECK ((next_status = ANY (ARRAY['DRAFT'::text, 'SUBMITTED'::text, 'WITHDRAWN'::text, 'AGREED'::text]))),
    CONSTRAINT demand_submission_event_previous_status_check CHECK (((previous_status IS NULL) OR (previous_status = ANY (ARRAY['DRAFT'::text, 'SUBMITTED'::text, 'WITHDRAWN'::text, 'AGREED'::text]))))
);


--
-- Name: TABLE demand_submission_event; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.demand_submission_event IS 'Task 7 — 제출·회수·수정·합의 append-only 이력. 버전·행위자·시각·사유(있으면)를 모두 남긴다';


--
-- Name: demand_submission_event_event_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.demand_submission_event ALTER COLUMN event_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.demand_submission_event_event_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: import_row_backup; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.import_row_backup (
    backup_id bigint NOT NULL,
    batch_id uuid NOT NULL,
    target_table text NOT NULL,
    row_data jsonb NOT NULL,
    backup_reason text NOT NULL,
    CONSTRAINT import_row_backup_backup_reason_check CHECK ((backup_reason = ANY (ARRAY['UPSERT'::text, 'REPLACE'::text])))
);


--
-- Name: import_row_backup_backup_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.import_row_backup ALTER COLUMN backup_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.import_row_backup_backup_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: import_staging; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.import_staging (
    staging_id bigint NOT NULL,
    batch_id uuid NOT NULL,
    row_number integer NOT NULL,
    original_data jsonb NOT NULL,
    mapped_data jsonb,
    validation_status text DEFAULT 'PENDING'::text NOT NULL,
    CONSTRAINT import_staging_validation_status_check CHECK ((validation_status = ANY (ARRAY['PENDING'::text, 'SUCCESS'::text, 'WARNING'::text, 'ERROR'::text])))
);


--
-- Name: import_staging_staging_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.import_staging ALTER COLUMN staging_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.import_staging_staging_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: inventory_scope_rule; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.inventory_scope_rule (
    rule_id bigint NOT NULL,
    warehouse_code text,
    raw_status text,
    scope_code text NOT NULL,
    description text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_scope_rule_key_required CHECK (((warehouse_code IS NOT NULL) OR (raw_status IS NOT NULL))),
    CONSTRAINT inventory_scope_rule_scope_code_check CHECK ((scope_code = ANY (ARRAY['NORMAL'::text, 'INSPECTION'::text, 'DEFECT'::text, 'SERVICE_CENTER'::text, 'PARTNER'::text, 'IN_TRANSIT'::text])))
);


--
-- Name: TABLE inventory_scope_rule; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.inventory_scope_rule IS 'stage1 §6 — (창고코드, 재고상태) 조합을 여섯 범위로 매핑. 둘 중 하나는 null일 수 있다.
   더 구체적인 규칙이 우선한다(core.classify_inventory_scope 참고). 매핑에 없는 조합은
   분류 불가로 제외한다';


--
-- Name: inventory_scope_rule_rule_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.inventory_scope_rule ALTER COLUMN rule_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.inventory_scope_rule_rule_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: model_version; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.model_version (
    model_version uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    model_id text NOT NULL,
    version text NOT NULL,
    definition jsonb NOT NULL,
    parameters jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- Name: notification_delivery_delivery_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.notification_delivery ALTER COLUMN delivery_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.notification_delivery_delivery_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: outlier_rule; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.outlier_rule (
    rule_id uuid DEFAULT gen_random_uuid() NOT NULL,
    rule_type text NOT NULL,
    rule_name text NOT NULL,
    rule_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    exclude_from_training boolean DEFAULT true NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT outlier_rule_rule_type_check CHECK ((rule_type = ANY (ARRAY['PROJECT'::text, 'RETURN'::text, 'DUPLICATE'::text, 'CUSTOM'::text])))
);


--
-- Name: procurement_plan_event_event_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.procurement_plan_event ALTER COLUMN event_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME core.procurement_plan_event_event_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sales_order_event_event_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.sales_order_event ALTER COLUMN event_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME core.sales_order_event_event_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sales_order_line_line_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.sales_order_line ALTER COLUMN line_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME core.sales_order_line_line_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sales_order_no_seq; Type: SEQUENCE; Schema: core; Owner: -
--

CREATE SEQUENCE core.sales_order_no_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_order_order_seq_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.sales_order ALTER COLUMN order_seq ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME core.sales_order_order_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: stock_allocation_event; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.stock_allocation_event (
    event_id bigint NOT NULL,
    allocation_id uuid NOT NULL,
    order_id uuid NOT NULL,
    line_id bigint NOT NULL,
    item_id text NOT NULL,
    event_type text NOT NULL,
    previous_status text,
    next_status text NOT NULL,
    qty numeric NOT NULL,
    approval_id uuid,
    actor uuid,
    actor_name text NOT NULL,
    reason text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT stock_allocation_event_event_type_check CHECK ((event_type = ANY (ARRAY['CREATED'::text, 'CONVERTED_TO_FIRM'::text, 'RELEASED'::text]))),
    CONSTRAINT stock_allocation_event_payload_check CHECK ((jsonb_typeof(payload) = 'object'::text)),
    CONSTRAINT stock_allocation_event_qty_check CHECK ((qty > (0)::numeric)),
    CONSTRAINT stock_allocation_event_transition_check CHECK ((((event_type = 'CREATED'::text) AND (previous_status IS NULL) AND (next_status = ANY (ARRAY['TEMPORARY'::text, 'APPROVAL_HOLD'::text, 'FIRM'::text]))) OR ((event_type = 'CONVERTED_TO_FIRM'::text) AND (previous_status = ANY (ARRAY['TEMPORARY'::text, 'APPROVAL_HOLD'::text])) AND (next_status = 'FIRM'::text)) OR ((event_type = 'RELEASED'::text) AND (previous_status = ANY (ARRAY['TEMPORARY'::text, 'APPROVAL_HOLD'::text, 'FIRM'::text])) AND (next_status = 'RELEASED'::text))))
);


--
-- Name: TABLE stock_allocation_event; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.stock_allocation_event IS 'Task 5 배정 생성 · 확정 전환 · 해제 append-only 이력. 우선 배정의 대상 · 수량 · 처리자 · 시각 · 사유와 팀장 의견(승인·반려)을 변경할 수 없게 보관한다';


--
-- Name: stock_allocation_event_event_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.stock_allocation_event ALTER COLUMN event_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME core.stock_allocation_event_event_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: stock_receipt_ledger; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.stock_receipt_ledger (
    ledger_id bigint NOT NULL,
    item_id text NOT NULL,
    source_record_id text NOT NULL,
    qty numeric NOT NULL,
    completed_at timestamp with time zone NOT NULL,
    source_batch_id uuid,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_receipt_ledger_qty_check CHECK ((qty > (0)::numeric))
);


--
-- Name: TABLE stock_receipt_ledger; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.stock_receipt_ledger IS '완료된 입고가 정상 창고재고를 늘린 append-only 이력. (source_record_id, item_id) 조합당
   한 행만 존재한다 — 같은 입고번호에 품목이 여러 줄이어도 품목별로 각각 반영된다.
   core.recompute_stock_balance_totals가 이 표를 읽어 core.stock_balance.normal_qty를 다시
   계산한다 — 이 표 자체는 절대 update·delete하지 않는다(감사 이력)';


--
-- Name: stock_receipt_ledger_ledger_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.stock_receipt_ledger ALTER COLUMN ledger_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.stock_receipt_ledger_ledger_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: supplier_alias; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.supplier_alias (
    alias text NOT NULL,
    supplier_id text
);


--
-- Name: supplier_departure_departure_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

CREATE SEQUENCE core.supplier_departure_departure_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: supplier_departure_departure_id_seq; Type: SEQUENCE OWNED BY; Schema: core; Owner: -
--

ALTER SEQUENCE core.supplier_departure_departure_id_seq OWNED BY core.supplier_departure.departure_id;


--
-- Name: supply_meeting_result_event; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.supply_meeting_result_event (
    event_id bigint NOT NULL,
    result_id uuid NOT NULL,
    plan_month date NOT NULL,
    item_id text NOT NULL,
    previous_qty numeric,
    qty numeric NOT NULL,
    previous_approved boolean,
    approved boolean NOT NULL,
    actor uuid NOT NULL,
    actor_name text NOT NULL,
    reason text,
    at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: TABLE supply_meeting_result_event; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON TABLE core.supply_meeting_result_event IS 'Task 8 — 수급회의 결과 수정 append-only 이력. previous_* 열이 수정 전 값을 보존한다';


--
-- Name: supply_meeting_result_event_event_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.supply_meeting_result_event ALTER COLUMN event_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME core.supply_meeting_result_event_event_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: user_notification_user_notification_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.user_notification ALTER COLUMN user_notification_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.user_notification_user_notification_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: v_import_supplier_reference; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_import_supplier_reference AS
 SELECT DISTINCT "공급업체코드" AS supplier_id
   FROM raw.supplier_master
  WHERE ("공급업체코드" IS NOT NULL);


--
-- Name: v_ym_calendar; Type: VIEW; Schema: core; Owner: -
--

CREATE VIEW core.v_ym_calendar AS
 SELECT DISTINCT ym
   FROM raw.fact_shipment;


--
-- Name: VIEW v_ym_calendar; Type: COMMENT; Schema: core; Owner: -
--

COMMENT ON VIEW core.v_ym_calendar IS '출고 데이터에 존재하는 월 목록. 희소 저장 보정용';


--
-- Name: validation_error; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.validation_error (
    validation_error_id bigint NOT NULL,
    batch_id uuid NOT NULL,
    row_number integer NOT NULL,
    field_name text NOT NULL,
    error_code text NOT NULL,
    error_message text NOT NULL,
    severity text NOT NULL,
    original_value text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT validation_error_severity_check CHECK ((severity = ANY (ARRAY['WARNING'::text, 'ERROR'::text])))
);


--
-- Name: validation_error_validation_error_id_seq; Type: SEQUENCE; Schema: core; Owner: -
--

ALTER TABLE core.validation_error ALTER COLUMN validation_error_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME core.validation_error_validation_error_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: bridge_scc_config; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.bridge_scc_config (
    model_key text,
    model_base text,
    neutral_item_code text,
    neutral_desc text,
    scc_item_code text,
    scc_desc text,
    qty numeric(18,4)
);


--
-- Name: business_event; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.business_event (
    business_event_id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_date date NOT NULL,
    event_type text NOT NULL,
    item_id text,
    supplier_id text,
    quantity numeric,
    note text,
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);


--
-- Name: forecast; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.forecast (
    "품목코드" text,
    "품목명" text,
    "2026-09" text,
    "2026-10" text,
    "2026-11" text,
    "2026-12" text,
    "2027-01" text,
    "2027-02" text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);


--
-- Name: item_substitute; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.item_substitute (
    item_substitute_id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id text NOT NULL,
    substitute_item_id text NOT NULL,
    priority integer,
    valid_from date,
    valid_to date,
    note text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text,
    CONSTRAINT item_substitute_check CHECK ((item_id <> substitute_item_id)),
    CONSTRAINT item_substitute_check1 CHECK (((valid_to IS NULL) OR (valid_from IS NULL) OR (valid_from <= valid_to)))
);


--
-- Name: sales_order; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.sales_order (
    sales_order_id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_no text,
    order_date date,
    requested_date date,
    customer_id text,
    item_id text,
    quantity numeric,
    unit text,
    order_status text,
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);


--
-- Name: supplier_departure departure_id; Type: DEFAULT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.supplier_departure ALTER COLUMN departure_id SET DEFAULT nextval('core.supplier_departure_departure_id_seq'::regclass);


--
-- Name: agent_conversation_legacy_202609092017 agent_conversation_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.agent_conversation_legacy_202609092017
    ADD CONSTRAINT agent_conversation_pkey PRIMARY KEY (id);


--
-- Name: agent_conversation agent_conversation_pkey1; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.agent_conversation
    ADD CONSTRAINT agent_conversation_pkey1 PRIMARY KEY (conversation_id);


--
-- Name: agent_message_legacy_202609092017 agent_message_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.agent_message_legacy_202609092017
    ADD CONSTRAINT agent_message_pkey PRIMARY KEY (id);


--
-- Name: agent_message agent_message_pkey1; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.agent_message
    ADD CONSTRAINT agent_message_pkey1 PRIMARY KEY (message_id);


--
-- Name: allocation_priority allocation_priority_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.allocation_priority
    ADD CONSTRAINT allocation_priority_pkey PRIMARY KEY (priority_id);


--
-- Name: app_user app_user_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.app_user
    ADD CONSTRAINT app_user_pkey PRIMARY KEY (user_id);


--
-- Name: approval_event approval_event_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.approval_event
    ADD CONSTRAINT approval_event_pkey PRIMARY KEY (event_id);


--
-- Name: approval_request approval_request_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.approval_request
    ADD CONSTRAINT approval_request_pkey PRIMARY KEY (approval_id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: backtest_run backtest_run_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.backtest_run
    ADD CONSTRAINT backtest_run_pkey PRIMARY KEY (backtest_run_id);


--
-- Name: business_calendar business_calendar_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.business_calendar
    ADD CONSTRAINT business_calendar_pkey PRIMARY KEY (country_code, calendar_date);


--
-- Name: business_calendar_readiness business_calendar_readiness_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.business_calendar_readiness
    ADD CONSTRAINT business_calendar_readiness_pkey PRIMARY KEY (country_code, cal_year, cal_month);


--
-- Name: champion_model_selection champion_model_selection_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.champion_model_selection
    ADD CONSTRAINT champion_model_selection_pkey PRIMARY KEY (selection_id);


--
-- Name: column_mapping column_mapping_import_type_source_column_target_column_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.column_mapping
    ADD CONSTRAINT column_mapping_import_type_source_column_target_column_key UNIQUE (import_type, source_column, target_column);


--
-- Name: column_mapping column_mapping_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.column_mapping
    ADD CONSTRAINT column_mapping_pkey PRIMARY KEY (mapping_id);


--
-- Name: demand_submission demand_submission_cycle_id_department_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.demand_submission
    ADD CONSTRAINT demand_submission_cycle_id_department_key UNIQUE (cycle_id, department);


--
-- Name: demand_submission_event demand_submission_event_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.demand_submission_event
    ADD CONSTRAINT demand_submission_event_pkey PRIMARY KEY (event_id);


--
-- Name: demand_submission_line demand_submission_line_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.demand_submission_line
    ADD CONSTRAINT demand_submission_line_pkey PRIMARY KEY (line_id);


--
-- Name: demand_submission_line demand_submission_line_submission_id_line_no_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.demand_submission_line
    ADD CONSTRAINT demand_submission_line_submission_id_line_no_key UNIQUE (submission_id, line_no);


--
-- Name: demand_submission demand_submission_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.demand_submission
    ADD CONSTRAINT demand_submission_pkey PRIMARY KEY (submission_id);


--
-- Name: event_demand event_demand_approval_id_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.event_demand
    ADD CONSTRAINT event_demand_approval_id_key UNIQUE (approval_id);


--
-- Name: event_demand event_demand_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.event_demand
    ADD CONSTRAINT event_demand_pkey PRIMARY KEY (event_demand_id);


--
-- Name: forecast_result forecast_result_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.forecast_result
    ADD CONSTRAINT forecast_result_pkey PRIMARY KEY (run_id, model_id, item_id, period);


--
-- Name: forecast_run forecast_run_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.forecast_run
    ADD CONSTRAINT forecast_run_pkey PRIMARY KEY (run_id);


--
-- Name: forecast_setting forecast_setting_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.forecast_setting
    ADD CONSTRAINT forecast_setting_pkey PRIMARY KEY (setting_id);


--
-- Name: import_row_backup import_row_backup_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.import_row_backup
    ADD CONSTRAINT import_row_backup_pkey PRIMARY KEY (backup_id);


--
-- Name: import_staging import_staging_batch_id_row_number_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.import_staging
    ADD CONSTRAINT import_staging_batch_id_row_number_key UNIQUE (batch_id, row_number);


--
-- Name: import_staging import_staging_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.import_staging
    ADD CONSTRAINT import_staging_pkey PRIMARY KEY (staging_id);


--
-- Name: inventory_scope_rule inventory_scope_rule_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.inventory_scope_rule
    ADD CONSTRAINT inventory_scope_rule_pkey PRIMARY KEY (rule_id);


--
-- Name: item_policy item_policy_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.item_policy
    ADD CONSTRAINT item_policy_pkey PRIMARY KEY (item_id);


--
-- Name: item_policy_revision item_policy_revision_approval_id_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.item_policy_revision
    ADD CONSTRAINT item_policy_revision_approval_id_key UNIQUE (approval_id);


--
-- Name: item_policy_revision item_policy_revision_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.item_policy_revision
    ADD CONSTRAINT item_policy_revision_pkey PRIMARY KEY (revision_id);


--
-- Name: item_visibility_rule item_visibility_rule_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.item_visibility_rule
    ADD CONSTRAINT item_visibility_rule_pkey PRIMARY KEY (raw_item_type);


--
-- Name: leadtime_plan leadtime_plan_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.leadtime_plan
    ADD CONSTRAINT leadtime_plan_pkey PRIMARY KEY (supplier_id);


--
-- Name: model_config model_config_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.model_config
    ADD CONSTRAINT model_config_pkey PRIMARY KEY (model_id);


--
-- Name: model_performance model_performance_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.model_performance
    ADD CONSTRAINT model_performance_pkey PRIMARY KEY (backtest_run_id, model_id, item_id);


--
-- Name: model_version model_version_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.model_version
    ADD CONSTRAINT model_version_pkey PRIMARY KEY (model_version);


--
-- Name: model_version model_version_run_id_model_id_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.model_version
    ADD CONSTRAINT model_version_run_id_model_id_key UNIQUE (run_id, model_id);


--
-- Name: month_end_inventory_snapshot month_end_inventory_snapshot_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.month_end_inventory_snapshot
    ADD CONSTRAINT month_end_inventory_snapshot_pkey PRIMARY KEY (plan_month, item_id);


--
-- Name: notification_delivery notification_delivery_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.notification_delivery
    ADD CONSTRAINT notification_delivery_pkey PRIMARY KEY (delivery_id);


--
-- Name: notification_outbox notification_outbox_dedupe_key_recipient_user_id_channel_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.notification_outbox
    ADD CONSTRAINT notification_outbox_dedupe_key_recipient_user_id_channel_key UNIQUE (dedupe_key, recipient_user_id, channel);


--
-- Name: notification_outbox notification_outbox_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.notification_outbox
    ADD CONSTRAINT notification_outbox_pkey PRIMARY KEY (notification_id);


--
-- Name: outlier_rule outlier_rule_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.outlier_rule
    ADD CONSTRAINT outlier_rule_pkey PRIMARY KEY (rule_id);


--
-- Name: outlier_rule outlier_rule_rule_type_rule_name_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.outlier_rule
    ADD CONSTRAINT outlier_rule_rule_type_rule_name_key UNIQUE (rule_type, rule_name);


--
-- Name: permission permission_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.permission
    ADD CONSTRAINT permission_pkey PRIMARY KEY (permission_code);


--
-- Name: planning_cycle planning_cycle_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.planning_cycle
    ADD CONSTRAINT planning_cycle_pkey PRIMARY KEY (cycle_id);


--
-- Name: policy_config policy_config_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.policy_config
    ADD CONSTRAINT policy_config_pkey PRIMARY KEY (policy_key);


--
-- Name: procurement_plan procurement_plan_approval_id_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.procurement_plan
    ADD CONSTRAINT procurement_plan_approval_id_key UNIQUE (approval_id);


--
-- Name: procurement_plan_event procurement_plan_event_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.procurement_plan_event
    ADD CONSTRAINT procurement_plan_event_pkey PRIMARY KEY (event_id);


--
-- Name: procurement_plan_line procurement_plan_line_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.procurement_plan_line
    ADD CONSTRAINT procurement_plan_line_pkey PRIMARY KEY (line_id);


--
-- Name: procurement_plan_line procurement_plan_line_plan_id_item_id_month_no_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.procurement_plan_line
    ADD CONSTRAINT procurement_plan_line_plan_id_item_id_month_no_key UNIQUE (plan_id, item_id, month_no);


--
-- Name: procurement_plan procurement_plan_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.procurement_plan
    ADD CONSTRAINT procurement_plan_pkey PRIMARY KEY (plan_id);


--
-- Name: procurement_plan procurement_plan_plan_month_version_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.procurement_plan
    ADD CONSTRAINT procurement_plan_plan_month_version_key UNIQUE (plan_month, version);


--
-- Name: procurement_schedule procurement_schedule_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.procurement_schedule
    ADD CONSTRAINT procurement_schedule_pkey PRIMARY KEY (schedule_id);


--
-- Name: procurement_schedule procurement_schedule_plan_line_id_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.procurement_schedule
    ADD CONSTRAINT procurement_schedule_plan_line_id_key UNIQUE (plan_line_id);


--
-- Name: receipt_schedule_result receipt_schedule_result_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.receipt_schedule_result
    ADD CONSTRAINT receipt_schedule_result_pkey PRIMARY KEY (result_id);


--
-- Name: receipt_schedule_result receipt_schedule_result_schedule_id_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.receipt_schedule_result
    ADD CONSTRAINT receipt_schedule_result_schedule_id_key UNIQUE (schedule_id);


--
-- Name: role_permission role_permission_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.role_permission
    ADD CONSTRAINT role_permission_pkey PRIMARY KEY (job_role, permission_code);


--
-- Name: sales_order_event sales_order_event_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sales_order_event
    ADD CONSTRAINT sales_order_event_pkey PRIMARY KEY (event_id);


--
-- Name: sales_order_line sales_order_line_order_id_item_id_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sales_order_line
    ADD CONSTRAINT sales_order_line_order_id_item_id_key UNIQUE (order_id, item_id);


--
-- Name: sales_order_line sales_order_line_order_id_line_no_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sales_order_line
    ADD CONSTRAINT sales_order_line_order_id_line_no_key UNIQUE (order_id, line_no);


--
-- Name: sales_order_line sales_order_line_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sales_order_line
    ADD CONSTRAINT sales_order_line_pkey PRIMARY KEY (line_id);


--
-- Name: sales_order sales_order_order_no_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sales_order
    ADD CONSTRAINT sales_order_order_no_key UNIQUE (order_no);


--
-- Name: sales_order sales_order_order_seq_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sales_order
    ADD CONSTRAINT sales_order_order_seq_key UNIQUE (order_seq);


--
-- Name: sales_order sales_order_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sales_order
    ADD CONSTRAINT sales_order_pkey PRIMARY KEY (order_id);


--
-- Name: stock_allocation_event stock_allocation_event_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.stock_allocation_event
    ADD CONSTRAINT stock_allocation_event_pkey PRIMARY KEY (event_id);


--
-- Name: stock_allocation stock_allocation_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.stock_allocation
    ADD CONSTRAINT stock_allocation_pkey PRIMARY KEY (allocation_id);


--
-- Name: stock_balance stock_balance_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.stock_balance
    ADD CONSTRAINT stock_balance_pkey PRIMARY KEY (item_id);


--
-- Name: stock_receipt_ledger stock_receipt_ledger_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.stock_receipt_ledger
    ADD CONSTRAINT stock_receipt_ledger_pkey PRIMARY KEY (ledger_id);


--
-- Name: supplier_alias supplier_alias_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.supplier_alias
    ADD CONSTRAINT supplier_alias_pkey PRIMARY KEY (alias);


--
-- Name: supplier_departure supplier_departure_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.supplier_departure
    ADD CONSTRAINT supplier_departure_pkey PRIMARY KEY (departure_id);


--
-- Name: supplier supplier_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.supplier
    ADD CONSTRAINT supplier_pkey PRIMARY KEY (supplier_id);


--
-- Name: supply_entity supply_entity_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.supply_entity
    ADD CONSTRAINT supply_entity_pkey PRIMARY KEY (entity_id);


--
-- Name: supply_meeting_result_event supply_meeting_result_event_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.supply_meeting_result_event
    ADD CONSTRAINT supply_meeting_result_event_pkey PRIMARY KEY (event_id);


--
-- Name: supply_meeting_result supply_meeting_result_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.supply_meeting_result
    ADD CONSTRAINT supply_meeting_result_pkey PRIMARY KEY (result_id);


--
-- Name: supply_meeting_result supply_meeting_result_plan_month_item_id_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.supply_meeting_result
    ADD CONSTRAINT supply_meeting_result_plan_month_item_id_key UNIQUE (plan_month, item_id);


--
-- Name: upload_batch upload_batch_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.upload_batch
    ADD CONSTRAINT upload_batch_pkey PRIMARY KEY (batch_id);


--
-- Name: urgent_order urgent_order_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.urgent_order
    ADD CONSTRAINT urgent_order_pkey PRIMARY KEY (urgent_order_id);


--
-- Name: usage_profile usage_profile_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.usage_profile
    ADD CONSTRAINT usage_profile_pkey PRIMARY KEY (item_id);


--
-- Name: user_notification user_notification_notification_id_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.user_notification
    ADD CONSTRAINT user_notification_notification_id_key UNIQUE (notification_id);


--
-- Name: user_notification user_notification_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.user_notification
    ADD CONSTRAINT user_notification_pkey PRIMARY KEY (user_notification_id);


--
-- Name: validation_error validation_error_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.validation_error
    ADD CONSTRAINT validation_error_pkey PRIMARY KEY (validation_error_id);


--
-- Name: business_event business_event_pkey; Type: CONSTRAINT; Schema: raw; Owner: -
--

ALTER TABLE ONLY raw.business_event
    ADD CONSTRAINT business_event_pkey PRIMARY KEY (business_event_id);


--
-- Name: dim_item dim_item_pkey; Type: CONSTRAINT; Schema: raw; Owner: -
--

ALTER TABLE ONLY raw.dim_item
    ADD CONSTRAINT dim_item_pkey PRIMARY KEY (item_code);


--
-- Name: dim_model dim_model_pkey; Type: CONSTRAINT; Schema: raw; Owner: -
--

ALTER TABLE ONLY raw.dim_model
    ADD CONSTRAINT dim_model_pkey PRIMARY KEY (model_key);


--
-- Name: item_substitute item_substitute_pkey; Type: CONSTRAINT; Schema: raw; Owner: -
--

ALTER TABLE ONLY raw.item_substitute
    ADD CONSTRAINT item_substitute_pkey PRIMARY KEY (item_substitute_id);


--
-- Name: sales_order sales_order_pkey; Type: CONSTRAINT; Schema: raw; Owner: -
--

ALTER TABLE ONLY raw.sales_order
    ADD CONSTRAINT sales_order_pkey PRIMARY KEY (sales_order_id);


--
-- Name: agent_conversation_user_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX agent_conversation_user_idx ON core.agent_conversation USING btree (user_id, last_message_at DESC);


--
-- Name: agent_message_conversation_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX agent_message_conversation_idx ON core.agent_message USING btree (conversation_id, created_at);


--
-- Name: allocation_priority_order_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX allocation_priority_order_idx ON core.allocation_priority USING btree (order_id, changed_at DESC);


--
-- Name: app_user_role_active_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX app_user_role_active_idx ON core.app_user USING btree (role, active);


--
-- Name: approval_event_request_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX approval_event_request_idx ON core.approval_event USING btree (approval_id, at, event_id);


--
-- Name: approval_request_inbox_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX approval_request_inbox_idx ON core.approval_request USING btree (status, approval_type, requested_at DESC);


--
-- Name: approval_request_requester_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX approval_request_requester_idx ON core.approval_request USING btree (requested_by, requested_at DESC);


--
-- Name: approval_request_target_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX approval_request_target_idx ON core.approval_request USING btree (target_type, target_id, requested_at DESC);


--
-- Name: audit_log_actor_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX audit_log_actor_idx ON core.audit_log USING btree (actor, at DESC);


--
-- Name: audit_log_target_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX audit_log_target_idx ON core.audit_log USING btree (target_type, target_id, at DESC);


--
-- Name: champion_selection_item_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX champion_selection_item_idx ON core.champion_model_selection USING btree (item_id, selected_at DESC);


--
-- Name: demand_submission_department_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX demand_submission_department_idx ON core.demand_submission USING btree (department, plan_month DESC);


--
-- Name: demand_submission_event_submission_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX demand_submission_event_submission_idx ON core.demand_submission_event USING btree (submission_id, at, event_id);


--
-- Name: demand_submission_line_submission_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX demand_submission_line_submission_idx ON core.demand_submission_line USING btree (submission_id, line_no);


--
-- Name: event_demand_item_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX event_demand_item_idx ON core.event_demand USING btree (item_id, plan_month DESC);


--
-- Name: event_demand_status_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX event_demand_status_idx ON core.event_demand USING btree (status, requested_at DESC);


--
-- Name: forecast_result_run_item_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX forecast_result_run_item_idx ON core.forecast_result USING btree (run_id, item_id, period);


--
-- Name: forecast_run_status_started_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX forecast_run_status_started_idx ON core.forecast_run USING btree (status, started_at DESC);


--
-- Name: forecast_setting_one_active_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE UNIQUE INDEX forecast_setting_one_active_idx ON core.forecast_setting USING btree (active) WHERE active;


--
-- Name: import_staging_batch_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX import_staging_batch_idx ON core.import_staging USING btree (batch_id, row_number);


--
-- Name: inventory_scope_rule_key_uq; Type: INDEX; Schema: core; Owner: -
--

CREATE UNIQUE INDEX inventory_scope_rule_key_uq ON core.inventory_scope_rule USING btree (warehouse_code, raw_status) NULLS NOT DISTINCT;


--
-- Name: item_policy_revision_item_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX item_policy_revision_item_idx ON core.item_policy_revision USING btree (item_id, requested_at DESC);


--
-- Name: item_policy_revision_one_pending_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE UNIQUE INDEX item_policy_revision_one_pending_idx ON core.item_policy_revision USING btree (item_id) WHERE (status = 'PENDING'::text);


--
-- Name: item_policy_revision_requester_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX item_policy_revision_requester_idx ON core.item_policy_revision USING btree (requested_by, requested_at DESC);


--
-- Name: item_policy_revision_status_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX item_policy_revision_status_idx ON core.item_policy_revision USING btree (status, requested_at DESC);


--
-- Name: ix_agent_conv_user; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX ix_agent_conv_user ON core.agent_conversation_legacy_202609092017 USING btree (user_id, last_at DESC);


--
-- Name: ix_agent_msg_conv; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX ix_agent_msg_conv ON core.agent_message_legacy_202609092017 USING btree (conversation_id, created_at);


--
-- Name: model_performance_run_item_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX model_performance_run_item_idx ON core.model_performance USING btree (backtest_run_id, item_id, rank);


--
-- Name: model_version_run_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX model_version_run_idx ON core.model_version USING btree (run_id, model_id);


--
-- Name: notification_delivery_notice_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX notification_delivery_notice_idx ON core.notification_delivery USING btree (notification_id, attempted_at DESC);


--
-- Name: notification_outbox_due_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX notification_outbox_due_idx ON core.notification_outbox USING btree (status, scheduled_at, created_at);


--
-- Name: notification_outbox_recipient_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX notification_outbox_recipient_idx ON core.notification_outbox USING btree (recipient_user_id, created_at DESC);


--
-- Name: outlier_rule_active_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX outlier_rule_active_idx ON core.outlier_rule USING btree (active, rule_type);


--
-- Name: planning_cycle_active_month_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE UNIQUE INDEX planning_cycle_active_month_idx ON core.planning_cycle USING btree (plan_month) WHERE is_active;


--
-- Name: procurement_plan_event_plan_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX procurement_plan_event_plan_idx ON core.procurement_plan_event USING btree (plan_id, at, event_id);


--
-- Name: procurement_plan_line_plan_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX procurement_plan_line_plan_idx ON core.procurement_plan_line USING btree (plan_id, item_id, month_no);


--
-- Name: procurement_plan_month_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX procurement_plan_month_idx ON core.procurement_plan USING btree (plan_month DESC, version DESC);


--
-- Name: procurement_plan_one_open_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE UNIQUE INDEX procurement_plan_one_open_idx ON core.procurement_plan USING btree (plan_month) WHERE (status = ANY (ARRAY['DRAFT'::text, 'PENDING_APPROVAL'::text, 'REJECTED'::text]));


--
-- Name: procurement_schedule_active_item_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX procurement_schedule_active_item_idx ON core.procurement_schedule USING btree (item_id, supplier_id) WHERE (superseded_at IS NULL);


--
-- Name: procurement_schedule_bundle_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX procurement_schedule_bundle_idx ON core.procurement_schedule USING btree (bundle_iso_year, bundle_iso_week);


--
-- Name: procurement_schedule_plan_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX procurement_schedule_plan_idx ON core.procurement_schedule USING btree (plan_id);


--
-- Name: procurement_schedule_superseded_by_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX procurement_schedule_superseded_by_idx ON core.procurement_schedule USING btree (superseded_by_plan_id) WHERE (superseded_by_plan_id IS NOT NULL);


--
-- Name: procurement_schedule_supplier_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX procurement_schedule_supplier_idx ON core.procurement_schedule USING btree (supplier_id);


--
-- Name: receipt_schedule_result_actual_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX receipt_schedule_result_actual_idx ON core.receipt_schedule_result USING btree (confirmed_receipt_date) WHERE (actual_receipt_date IS NOT NULL);


--
-- Name: sales_order_confirmed_no_uq; Type: INDEX; Schema: core; Owner: -
--

CREATE UNIQUE INDEX sales_order_confirmed_no_uq ON core.sales_order USING btree (confirmed_order_no) WHERE (status = 'CONFIRMED'::text);


--
-- Name: sales_order_event_order_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX sales_order_event_order_idx ON core.sales_order_event USING btree (order_id, at, event_id);


--
-- Name: sales_order_line_item_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX sales_order_line_item_idx ON core.sales_order_line USING btree (item_id, order_id);


--
-- Name: sales_order_owner_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX sales_order_owner_idx ON core.sales_order USING btree (owner_user_id, requested_at DESC);


--
-- Name: sales_order_replaces_uq; Type: INDEX; Schema: core; Owner: -
--

CREATE UNIQUE INDEX sales_order_replaces_uq ON core.sales_order USING btree (replaces_order_id) WHERE (replaces_order_id IS NOT NULL);


--
-- Name: sales_order_status_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX sales_order_status_idx ON core.sales_order USING btree (status, allocation_priority, first_review_requested_at, order_seq);


--
-- Name: stock_allocation_approval_uq; Type: INDEX; Schema: core; Owner: -
--

CREATE UNIQUE INDEX stock_allocation_approval_uq ON core.stock_allocation USING btree (approval_id) WHERE (approval_id IS NOT NULL);


--
-- Name: stock_allocation_event_allocation_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX stock_allocation_event_allocation_idx ON core.stock_allocation_event USING btree (allocation_id, at, event_id);


--
-- Name: stock_allocation_event_order_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX stock_allocation_event_order_idx ON core.stock_allocation_event USING btree (order_id, at, event_id);


--
-- Name: stock_allocation_item_active_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX stock_allocation_item_active_idx ON core.stock_allocation USING btree (item_id, status) WHERE (status <> 'RELEASED'::text);


--
-- Name: stock_allocation_line_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX stock_allocation_line_idx ON core.stock_allocation USING btree (line_id, status);


--
-- Name: stock_allocation_order_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX stock_allocation_order_idx ON core.stock_allocation USING btree (order_id, status);


--
-- Name: stock_receipt_ledger_item_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX stock_receipt_ledger_item_idx ON core.stock_receipt_ledger USING btree (item_id, completed_at);


--
-- Name: stock_receipt_ledger_source_item_uq; Type: INDEX; Schema: core; Owner: -
--

CREATE UNIQUE INDEX stock_receipt_ledger_source_item_uq ON core.stock_receipt_ledger USING btree (source_record_id, item_id);


--
-- Name: supplier_departure_active_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX supplier_departure_active_idx ON core.supplier_departure USING btree (supplier_id) WHERE active;


--
-- Name: supplier_departure_supplier_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX supplier_departure_supplier_idx ON core.supplier_departure USING btree (supplier_id);


--
-- Name: supplier_entity_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX supplier_entity_idx ON core.supplier USING btree (entity_id) WHERE active;


--
-- Name: supply_meeting_result_event_result_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX supply_meeting_result_event_result_idx ON core.supply_meeting_result_event USING btree (result_id, at, event_id);


--
-- Name: supply_meeting_result_item_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX supply_meeting_result_item_idx ON core.supply_meeting_result USING btree (item_id, plan_month DESC);


--
-- Name: urgent_order_status_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX urgent_order_status_idx ON core.urgent_order USING btree (status, needed_by);


--
-- Name: user_notification_recipient_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX user_notification_recipient_idx ON core.user_notification USING btree (recipient_user_id, read_at, created_at DESC);


--
-- Name: validation_error_batch_idx; Type: INDEX; Schema: core; Owner: -
--

CREATE INDEX validation_error_batch_idx ON core.validation_error USING btree (batch_id, row_number);


--
-- Name: ix_bom_item; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_bom_item ON raw.bridge_bom USING btree (item_code);


--
-- Name: ix_bom_model; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_bom_model ON raw.bridge_bom USING btree (model_base);


--
-- Name: ix_cap_model; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_cap_model ON raw.bridge_mc_cap USING btree (model_base);


--
-- Name: ix_capopt_cap; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_capopt_cap ON raw.bridge_cap_option USING btree (cap_item_code);


--
-- Name: ix_item_hoc; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_item_hoc ON raw.dim_item USING btree (hoc_code);


--
-- Name: ix_item_type; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_item_type ON raw.dim_item USING btree (item_type);


--
-- Name: ix_mc_fy; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_mc_fy ON raw.fact_mc_plan_actual USING btree (fy_sheet);


--
-- Name: ix_mc_model; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_mc_model ON raw.fact_mc_plan_actual USING btree (model_base, ym);


--
-- Name: ix_optmodel; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_optmodel ON raw.bridge_option_model USING btree (item_code, model_base);


--
-- Name: ix_scc_model; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_scc_model ON raw.bridge_scc_config USING btree (model_base);


--
-- Name: ix_scc_neutral; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_scc_neutral ON raw.bridge_scc_config USING btree (neutral_item_code);


--
-- Name: ix_ship_item; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_ship_item ON raw.fact_shipment USING btree (item_code);


--
-- Name: ix_ship_type_ym; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_ship_type_ym ON raw.fact_shipment USING btree (item_type, ym);


--
-- Name: ix_ship_ym; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_ship_ym ON raw.fact_shipment USING btree (ym);


--
-- Name: ix_xcn_hoc; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_xcn_hoc ON raw.bridge_xcn USING btree (hoc_item);


--
-- Name: ix_xcn_rel; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX ix_xcn_rel ON raw.bridge_xcn USING btree (related_item);


--
-- Name: raw_business_event_date_idx; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX raw_business_event_date_idx ON raw.business_event USING btree (event_date, item_id);


--
-- Name: raw_item_substitute_item_idx; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX raw_item_substitute_item_idx ON raw.item_substitute USING btree (item_id, substitute_item_id);


--
-- Name: raw_sales_order_date_idx; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX raw_sales_order_date_idx ON raw.sales_order USING btree (order_date, item_id);


--
-- Name: raw_usage_history_use_date_idx; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX raw_usage_history_use_date_idx ON raw.usage_history USING btree (use_date, item_id);


--
-- Name: approval_request alloc_priority_decision_apply; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER alloc_priority_decision_apply AFTER UPDATE OF status ON core.approval_request FOR EACH ROW WHEN (((new.approval_type = 'ALLOC_PRIORITY'::text) AND (old.status = 'PENDING'::text) AND (new.status <> 'PENDING'::text))) EXECUTE FUNCTION core.apply_alloc_priority_decision();


--
-- Name: approval_request alloc_priority_request_guard; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER alloc_priority_request_guard BEFORE INSERT ON core.approval_request FOR EACH ROW EXECUTE FUNCTION core.guard_alloc_priority_approval_request();


--
-- Name: allocation_priority allocation_priority_append_only; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER allocation_priority_append_only BEFORE DELETE OR UPDATE ON core.allocation_priority FOR EACH ROW EXECUTE FUNCTION core.reject_order_history_mutation();


--
-- Name: app_user app_user_audit_change; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER app_user_audit_change AFTER UPDATE OF role, active ON core.app_user FOR EACH ROW EXECUTE FUNCTION core.audit_app_user_change();


--
-- Name: app_user app_user_protect_self_change; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER app_user_protect_self_change BEFORE UPDATE OF role, active ON core.app_user FOR EACH ROW EXECUTE FUNCTION core.protect_self_admin_change();


--
-- Name: app_user app_user_set_updated_at; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER app_user_set_updated_at BEFORE UPDATE ON core.app_user FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


--
-- Name: approval_event approval_event_append_only; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER approval_event_append_only BEFORE DELETE OR UPDATE ON core.approval_event FOR EACH ROW EXECUTE FUNCTION core.reject_approval_event_mutation();


--
-- Name: approval_request approval_notification_sync; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER approval_notification_sync AFTER INSERT OR UPDATE OF status ON core.approval_request FOR EACH ROW EXECUTE FUNCTION core.sync_approval_notifications();


--
-- Name: backtest_run backtest_run_input_fingerprint; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER backtest_run_input_fingerprint BEFORE INSERT OR UPDATE OF status ON core.backtest_run FOR EACH ROW EXECUTE FUNCTION core.record_backtest_run_input_fingerprint();


--
-- Name: demand_submission_event demand_submission_event_append_only; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER demand_submission_event_append_only BEFORE DELETE OR UPDATE ON core.demand_submission_event FOR EACH ROW EXECUTE FUNCTION core.reject_demand_submission_event_mutation();


--
-- Name: demand_submission demand_submission_guard_cycle_active; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER demand_submission_guard_cycle_active BEFORE INSERT OR UPDATE ON core.demand_submission FOR EACH ROW EXECUTE FUNCTION core.guard_demand_submission_cycle_active();


--
-- Name: demand_submission_line demand_submission_line_guard_cycle_active; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER demand_submission_line_guard_cycle_active BEFORE INSERT OR DELETE OR UPDATE ON core.demand_submission_line FOR EACH ROW EXECUTE FUNCTION core.guard_demand_submission_line_cycle_active();


--
-- Name: approval_request event_demand_decision_apply; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER event_demand_decision_apply AFTER UPDATE OF status ON core.approval_request FOR EACH ROW WHEN (((new.approval_type = 'EVENT_ORDER'::text) AND (old.status = 'PENDING'::text) AND (new.status <> 'PENDING'::text))) EXECUTE FUNCTION core.apply_event_demand_decision();


--
-- Name: event_demand event_demand_guard; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER event_demand_guard BEFORE DELETE OR UPDATE ON core.event_demand FOR EACH ROW EXECUTE FUNCTION core.guard_event_demand_mutation();


--
-- Name: approval_request event_order_request_guard; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER event_order_request_guard BEFORE INSERT ON core.approval_request FOR EACH ROW EXECUTE FUNCTION core.guard_event_order_approval_request();


--
-- Name: forecast_run forecast_run_input_fingerprint; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER forecast_run_input_fingerprint BEFORE INSERT OR UPDATE OF status ON core.forecast_run FOR EACH ROW EXECUTE FUNCTION core.record_forecast_run_input_fingerprint();


--
-- Name: forecast_setting forecast_setting_set_updated_at; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER forecast_setting_set_updated_at BEFORE UPDATE ON core.forecast_setting FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


--
-- Name: approval_request item_policy_decision_apply; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER item_policy_decision_apply AFTER UPDATE OF status ON core.approval_request FOR EACH ROW WHEN (((new.approval_type = 'ITEM_POLICY'::text) AND (old.status = 'PENDING'::text) AND (new.status <> 'PENDING'::text))) EXECUTE FUNCTION core.apply_item_policy_decision();


--
-- Name: approval_request item_policy_request_guard; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER item_policy_request_guard BEFORE INSERT ON core.approval_request FOR EACH ROW EXECUTE FUNCTION core.guard_item_policy_approval_request();


--
-- Name: item_policy item_policy_set_updated_at; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER item_policy_set_updated_at BEFORE UPDATE ON core.item_policy FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


--
-- Name: model_config model_config_set_updated_at; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER model_config_set_updated_at BEFORE UPDATE ON core.model_config FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


--
-- Name: outlier_rule outlier_rule_set_updated_at; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER outlier_rule_set_updated_at BEFORE UPDATE ON core.outlier_rule FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


--
-- Name: policy_config policy_config_set_updated_at; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER policy_config_set_updated_at BEFORE UPDATE ON core.policy_config FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


--
-- Name: approval_request procurement_plan_decision_apply; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER procurement_plan_decision_apply AFTER UPDATE OF status ON core.approval_request FOR EACH ROW WHEN (((new.approval_type = 'PURCHASE_PLAN'::text) AND (old.status = 'PENDING'::text) AND (new.status <> 'PENDING'::text))) EXECUTE FUNCTION core.apply_procurement_plan_decision();


--
-- Name: procurement_plan_event procurement_plan_event_append_only; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER procurement_plan_event_append_only BEFORE DELETE OR UPDATE ON core.procurement_plan_event FOR EACH ROW EXECUTE FUNCTION core.reject_procurement_plan_event_mutation();


--
-- Name: procurement_plan procurement_plan_guard; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER procurement_plan_guard BEFORE DELETE OR UPDATE ON core.procurement_plan FOR EACH ROW EXECUTE FUNCTION core.guard_procurement_plan_mutation();


--
-- Name: procurement_plan_line procurement_plan_line_guard; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER procurement_plan_line_guard BEFORE INSERT OR DELETE OR UPDATE ON core.procurement_plan_line FOR EACH ROW EXECUTE FUNCTION core.guard_procurement_plan_line_mutation();


--
-- Name: approval_request purchase_plan_request_guard; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER purchase_plan_request_guard BEFORE INSERT ON core.approval_request FOR EACH ROW EXECUTE FUNCTION core.guard_purchase_plan_approval_request();


--
-- Name: sales_order_event sales_order_event_append_only; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER sales_order_event_append_only BEFORE DELETE OR UPDATE ON core.sales_order_event FOR EACH ROW EXECUTE FUNCTION core.reject_order_history_mutation();


--
-- Name: sales_order sales_order_guard; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER sales_order_guard BEFORE DELETE OR UPDATE ON core.sales_order FOR EACH ROW EXECUTE FUNCTION core.guard_sales_order_mutation();


--
-- Name: sales_order_line sales_order_line_guard; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER sales_order_line_guard BEFORE DELETE OR UPDATE ON core.sales_order_line FOR EACH ROW EXECUTE FUNCTION core.guard_sales_order_line_mutation();


--
-- Name: stock_allocation_event stock_allocation_event_append_only; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER stock_allocation_event_append_only BEFORE DELETE OR UPDATE ON core.stock_allocation_event FOR EACH ROW EXECUTE FUNCTION core.reject_order_history_mutation();


--
-- Name: stock_allocation stock_allocation_guard; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER stock_allocation_guard BEFORE DELETE OR UPDATE ON core.stock_allocation FOR EACH ROW EXECUTE FUNCTION core.guard_stock_allocation_mutation();


--
-- Name: supply_meeting_result_event supply_meeting_result_event_append_only; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER supply_meeting_result_event_append_only BEFORE DELETE OR UPDATE ON core.supply_meeting_result_event FOR EACH ROW EXECUTE FUNCTION core.reject_supply_meeting_result_event_mutation();


--
-- Name: supply_meeting_result supply_meeting_result_guard; Type: TRIGGER; Schema: core; Owner: -
--

CREATE TRIGGER supply_meeting_result_guard BEFORE DELETE OR UPDATE ON core.supply_meeting_result FOR EACH ROW EXECUTE FUNCTION core.guard_supply_meeting_result_mutation();


--
-- Name: agent_conversation_legacy_202609092017 agent_conversation_user_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.agent_conversation_legacy_202609092017
    ADD CONSTRAINT agent_conversation_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: agent_conversation agent_conversation_user_id_fkey1; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.agent_conversation
    ADD CONSTRAINT agent_conversation_user_id_fkey1 FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: agent_message_legacy_202609092017 agent_message_conversation_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.agent_message_legacy_202609092017
    ADD CONSTRAINT agent_message_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES core.agent_conversation_legacy_202609092017(id) ON DELETE CASCADE;


--
-- Name: agent_message agent_message_conversation_id_fkey1; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.agent_message
    ADD CONSTRAINT agent_message_conversation_id_fkey1 FOREIGN KEY (conversation_id) REFERENCES core.agent_conversation(conversation_id) ON DELETE CASCADE;


--
-- Name: agent_message agent_message_user_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.agent_message
    ADD CONSTRAINT agent_message_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: allocation_priority allocation_priority_changed_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.allocation_priority
    ADD CONSTRAINT allocation_priority_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: allocation_priority allocation_priority_order_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.allocation_priority
    ADD CONSTRAINT allocation_priority_order_id_fkey FOREIGN KEY (order_id) REFERENCES core.sales_order(order_id) ON DELETE RESTRICT;


--
-- Name: app_user app_user_user_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.app_user
    ADD CONSTRAINT app_user_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: approval_event approval_event_actor_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.approval_event
    ADD CONSTRAINT approval_event_actor_fkey FOREIGN KEY (actor) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: approval_event approval_event_approval_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.approval_event
    ADD CONSTRAINT approval_event_approval_id_fkey FOREIGN KEY (approval_id) REFERENCES core.approval_request(approval_id) ON DELETE RESTRICT;


--
-- Name: approval_request approval_request_decided_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.approval_request
    ADD CONSTRAINT approval_request_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: approval_request approval_request_requested_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.approval_request
    ADD CONSTRAINT approval_request_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: audit_log audit_log_actor_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.audit_log
    ADD CONSTRAINT audit_log_actor_fkey FOREIGN KEY (actor) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: backtest_run backtest_run_forecast_run_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.backtest_run
    ADD CONSTRAINT backtest_run_forecast_run_id_fkey FOREIGN KEY (forecast_run_id) REFERENCES core.forecast_run(run_id);


--
-- Name: backtest_run backtest_run_triggered_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.backtest_run
    ADD CONSTRAINT backtest_run_triggered_by_fkey FOREIGN KEY (triggered_by) REFERENCES auth.users(id);


--
-- Name: business_calendar_readiness business_calendar_readiness_marked_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.business_calendar_readiness
    ADD CONSTRAINT business_calendar_readiness_marked_by_fkey FOREIGN KEY (marked_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: champion_model_selection champion_model_selection_backtest_run_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.champion_model_selection
    ADD CONSTRAINT champion_model_selection_backtest_run_id_fkey FOREIGN KEY (backtest_run_id) REFERENCES core.backtest_run(backtest_run_id);


--
-- Name: champion_model_selection champion_model_selection_model_version_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.champion_model_selection
    ADD CONSTRAINT champion_model_selection_model_version_fkey FOREIGN KEY (model_version) REFERENCES core.model_version(model_version);


--
-- Name: champion_model_selection champion_model_selection_selected_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.champion_model_selection
    ADD CONSTRAINT champion_model_selection_selected_by_fkey FOREIGN KEY (selected_by) REFERENCES auth.users(id);


--
-- Name: column_mapping column_mapping_created_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.column_mapping
    ADD CONSTRAINT column_mapping_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: demand_submission demand_submission_agreed_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.demand_submission
    ADD CONSTRAINT demand_submission_agreed_by_fkey FOREIGN KEY (agreed_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: demand_submission demand_submission_created_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.demand_submission
    ADD CONSTRAINT demand_submission_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: demand_submission demand_submission_cycle_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.demand_submission
    ADD CONSTRAINT demand_submission_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES core.planning_cycle(cycle_id) ON DELETE RESTRICT;


--
-- Name: demand_submission_event demand_submission_event_actor_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.demand_submission_event
    ADD CONSTRAINT demand_submission_event_actor_fkey FOREIGN KEY (actor) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: demand_submission_event demand_submission_event_submission_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.demand_submission_event
    ADD CONSTRAINT demand_submission_event_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES core.demand_submission(submission_id) ON DELETE RESTRICT;


--
-- Name: demand_submission demand_submission_last_modified_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.demand_submission
    ADD CONSTRAINT demand_submission_last_modified_by_fkey FOREIGN KEY (last_modified_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: demand_submission_line demand_submission_line_submission_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.demand_submission_line
    ADD CONSTRAINT demand_submission_line_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES core.demand_submission(submission_id) ON DELETE CASCADE;


--
-- Name: demand_submission demand_submission_submitted_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.demand_submission
    ADD CONSTRAINT demand_submission_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: demand_submission demand_submission_withdrawn_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.demand_submission
    ADD CONSTRAINT demand_submission_withdrawn_by_fkey FOREIGN KEY (withdrawn_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: event_demand event_demand_approval_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.event_demand
    ADD CONSTRAINT event_demand_approval_id_fkey FOREIGN KEY (approval_id) REFERENCES core.approval_request(approval_id) ON DELETE RESTRICT;


--
-- Name: event_demand event_demand_decided_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.event_demand
    ADD CONSTRAINT event_demand_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: event_demand event_demand_requested_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.event_demand
    ADD CONSTRAINT event_demand_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: forecast_result forecast_result_model_version_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.forecast_result
    ADD CONSTRAINT forecast_result_model_version_fkey FOREIGN KEY (model_version) REFERENCES core.model_version(model_version);


--
-- Name: forecast_result forecast_result_run_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.forecast_result
    ADD CONSTRAINT forecast_result_run_id_fkey FOREIGN KEY (run_id) REFERENCES core.forecast_run(run_id) ON DELETE CASCADE;


--
-- Name: forecast_run forecast_run_triggered_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.forecast_run
    ADD CONSTRAINT forecast_run_triggered_by_fkey FOREIGN KEY (triggered_by) REFERENCES auth.users(id);


--
-- Name: import_row_backup import_row_backup_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.import_row_backup
    ADD CONSTRAINT import_row_backup_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES core.upload_batch(batch_id) ON DELETE CASCADE;


--
-- Name: import_staging import_staging_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.import_staging
    ADD CONSTRAINT import_staging_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES core.upload_batch(batch_id) ON DELETE CASCADE;


--
-- Name: item_policy_revision item_policy_revision_approval_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.item_policy_revision
    ADD CONSTRAINT item_policy_revision_approval_id_fkey FOREIGN KEY (approval_id) REFERENCES core.approval_request(approval_id) ON DELETE RESTRICT;


--
-- Name: item_policy_revision item_policy_revision_decided_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.item_policy_revision
    ADD CONSTRAINT item_policy_revision_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: item_policy_revision item_policy_revision_item_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.item_policy_revision
    ADD CONSTRAINT item_policy_revision_item_id_fkey FOREIGN KEY (item_id) REFERENCES core.item_policy(item_id) ON DELETE RESTRICT;


--
-- Name: item_policy_revision item_policy_revision_requested_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.item_policy_revision
    ADD CONSTRAINT item_policy_revision_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: model_config model_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.model_config
    ADD CONSTRAINT model_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);


--
-- Name: model_performance model_performance_backtest_run_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.model_performance
    ADD CONSTRAINT model_performance_backtest_run_id_fkey FOREIGN KEY (backtest_run_id) REFERENCES core.backtest_run(backtest_run_id) ON DELETE CASCADE;


--
-- Name: model_performance model_performance_forecast_run_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.model_performance
    ADD CONSTRAINT model_performance_forecast_run_id_fkey FOREIGN KEY (forecast_run_id) REFERENCES core.forecast_run(run_id);


--
-- Name: model_performance model_performance_model_version_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.model_performance
    ADD CONSTRAINT model_performance_model_version_fkey FOREIGN KEY (model_version) REFERENCES core.model_version(model_version);


--
-- Name: model_version model_version_created_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.model_version
    ADD CONSTRAINT model_version_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: model_version model_version_run_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.model_version
    ADD CONSTRAINT model_version_run_id_fkey FOREIGN KEY (run_id) REFERENCES core.forecast_run(run_id) ON DELETE CASCADE;


--
-- Name: month_end_inventory_snapshot month_end_inventory_snapshot_source_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.month_end_inventory_snapshot
    ADD CONSTRAINT month_end_inventory_snapshot_source_batch_id_fkey FOREIGN KEY (source_batch_id) REFERENCES core.upload_batch(batch_id) ON DELETE SET NULL;


--
-- Name: notification_delivery notification_delivery_notification_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.notification_delivery
    ADD CONSTRAINT notification_delivery_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES core.notification_outbox(notification_id) ON DELETE RESTRICT;


--
-- Name: notification_delivery notification_delivery_recipient_user_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.notification_delivery
    ADD CONSTRAINT notification_delivery_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: notification_outbox notification_outbox_recipient_user_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.notification_outbox
    ADD CONSTRAINT notification_outbox_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: planning_cycle planning_cycle_closed_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.planning_cycle
    ADD CONSTRAINT planning_cycle_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: planning_cycle planning_cycle_opened_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.planning_cycle
    ADD CONSTRAINT planning_cycle_opened_by_fkey FOREIGN KEY (opened_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: procurement_plan procurement_plan_approval_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.procurement_plan
    ADD CONSTRAINT procurement_plan_approval_id_fkey FOREIGN KEY (approval_id) REFERENCES core.approval_request(approval_id) ON DELETE RESTRICT;


--
-- Name: procurement_plan procurement_plan_built_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.procurement_plan
    ADD CONSTRAINT procurement_plan_built_by_fkey FOREIGN KEY (built_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: procurement_plan procurement_plan_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.procurement_plan
    ADD CONSTRAINT procurement_plan_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: procurement_plan procurement_plan_decided_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.procurement_plan
    ADD CONSTRAINT procurement_plan_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: procurement_plan_event procurement_plan_event_actor_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.procurement_plan_event
    ADD CONSTRAINT procurement_plan_event_actor_fkey FOREIGN KEY (actor) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: procurement_plan_event procurement_plan_event_plan_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.procurement_plan_event
    ADD CONSTRAINT procurement_plan_event_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES core.procurement_plan(plan_id) ON DELETE RESTRICT;


--
-- Name: procurement_plan procurement_plan_forecast_run_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.procurement_plan
    ADD CONSTRAINT procurement_plan_forecast_run_id_fkey FOREIGN KEY (forecast_run_id) REFERENCES core.forecast_run(run_id) ON DELETE RESTRICT;


--
-- Name: procurement_plan_line procurement_plan_line_plan_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.procurement_plan_line
    ADD CONSTRAINT procurement_plan_line_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES core.procurement_plan(plan_id) ON DELETE RESTRICT;


--
-- Name: procurement_plan procurement_plan_superseded_by_plan_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.procurement_plan
    ADD CONSTRAINT procurement_plan_superseded_by_plan_id_fkey FOREIGN KEY (superseded_by_plan_id) REFERENCES core.procurement_plan(plan_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: procurement_schedule procurement_schedule_entity_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.procurement_schedule
    ADD CONSTRAINT procurement_schedule_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES core.supply_entity(entity_id) ON DELETE RESTRICT;


--
-- Name: procurement_schedule procurement_schedule_plan_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.procurement_schedule
    ADD CONSTRAINT procurement_schedule_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES core.procurement_plan(plan_id) ON DELETE RESTRICT;


--
-- Name: procurement_schedule procurement_schedule_plan_line_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.procurement_schedule
    ADD CONSTRAINT procurement_schedule_plan_line_id_fkey FOREIGN KEY (plan_line_id) REFERENCES core.procurement_plan_line(line_id) ON DELETE RESTRICT;


--
-- Name: procurement_schedule procurement_schedule_superseded_by_plan_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.procurement_schedule
    ADD CONSTRAINT procurement_schedule_superseded_by_plan_id_fkey FOREIGN KEY (superseded_by_plan_id) REFERENCES core.procurement_plan(plan_id) ON DELETE RESTRICT;


--
-- Name: procurement_schedule procurement_schedule_supplier_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.procurement_schedule
    ADD CONSTRAINT procurement_schedule_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES core.supplier(supplier_id) ON DELETE RESTRICT;


--
-- Name: receipt_schedule_result receipt_schedule_result_recorded_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.receipt_schedule_result
    ADD CONSTRAINT receipt_schedule_result_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: receipt_schedule_result receipt_schedule_result_schedule_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.receipt_schedule_result
    ADD CONSTRAINT receipt_schedule_result_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES core.procurement_schedule(schedule_id) ON DELETE RESTRICT;


--
-- Name: role_permission role_permission_permission_code_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.role_permission
    ADD CONSTRAINT role_permission_permission_code_fkey FOREIGN KEY (permission_code) REFERENCES core.permission(permission_code) ON DELETE CASCADE;


--
-- Name: sales_order sales_order_allocation_choice_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sales_order
    ADD CONSTRAINT sales_order_allocation_choice_by_fkey FOREIGN KEY (allocation_choice_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: sales_order sales_order_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sales_order
    ADD CONSTRAINT sales_order_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: sales_order sales_order_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sales_order
    ADD CONSTRAINT sales_order_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: sales_order_event sales_order_event_actor_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sales_order_event
    ADD CONSTRAINT sales_order_event_actor_fkey FOREIGN KEY (actor) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: sales_order_event sales_order_event_order_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sales_order_event
    ADD CONSTRAINT sales_order_event_order_id_fkey FOREIGN KEY (order_id) REFERENCES core.sales_order(order_id) ON DELETE RESTRICT;


--
-- Name: sales_order_line sales_order_line_order_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sales_order_line
    ADD CONSTRAINT sales_order_line_order_id_fkey FOREIGN KEY (order_id) REFERENCES core.sales_order(order_id) ON DELETE RESTRICT;


--
-- Name: sales_order sales_order_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sales_order
    ADD CONSTRAINT sales_order_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: sales_order sales_order_replaces_order_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sales_order
    ADD CONSTRAINT sales_order_replaces_order_id_fkey FOREIGN KEY (replaces_order_id) REFERENCES core.sales_order(order_id) ON DELETE RESTRICT;


--
-- Name: stock_allocation stock_allocation_approval_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.stock_allocation
    ADD CONSTRAINT stock_allocation_approval_id_fkey FOREIGN KEY (approval_id) REFERENCES core.approval_request(approval_id) ON DELETE RESTRICT;


--
-- Name: stock_allocation stock_allocation_created_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.stock_allocation
    ADD CONSTRAINT stock_allocation_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: stock_allocation_event stock_allocation_event_actor_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.stock_allocation_event
    ADD CONSTRAINT stock_allocation_event_actor_fkey FOREIGN KEY (actor) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: stock_allocation_event stock_allocation_event_allocation_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.stock_allocation_event
    ADD CONSTRAINT stock_allocation_event_allocation_id_fkey FOREIGN KEY (allocation_id) REFERENCES core.stock_allocation(allocation_id) ON DELETE RESTRICT;


--
-- Name: stock_allocation_event stock_allocation_event_line_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.stock_allocation_event
    ADD CONSTRAINT stock_allocation_event_line_id_fkey FOREIGN KEY (line_id) REFERENCES core.sales_order_line(line_id) ON DELETE RESTRICT;


--
-- Name: stock_allocation_event stock_allocation_event_order_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.stock_allocation_event
    ADD CONSTRAINT stock_allocation_event_order_id_fkey FOREIGN KEY (order_id) REFERENCES core.sales_order(order_id) ON DELETE RESTRICT;


--
-- Name: stock_allocation stock_allocation_line_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.stock_allocation
    ADD CONSTRAINT stock_allocation_line_id_fkey FOREIGN KEY (line_id) REFERENCES core.sales_order_line(line_id) ON DELETE RESTRICT;


--
-- Name: stock_allocation stock_allocation_order_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.stock_allocation
    ADD CONSTRAINT stock_allocation_order_id_fkey FOREIGN KEY (order_id) REFERENCES core.sales_order(order_id) ON DELETE RESTRICT;


--
-- Name: stock_allocation stock_allocation_released_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.stock_allocation
    ADD CONSTRAINT stock_allocation_released_by_fkey FOREIGN KEY (released_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: stock_balance stock_balance_source_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.stock_balance
    ADD CONSTRAINT stock_balance_source_batch_id_fkey FOREIGN KEY (source_batch_id) REFERENCES core.upload_batch(batch_id) ON DELETE SET NULL;


--
-- Name: stock_receipt_ledger stock_receipt_ledger_source_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.stock_receipt_ledger
    ADD CONSTRAINT stock_receipt_ledger_source_batch_id_fkey FOREIGN KEY (source_batch_id) REFERENCES core.upload_batch(batch_id) ON DELETE SET NULL;


--
-- Name: supplier_departure supplier_departure_supplier_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.supplier_departure
    ADD CONSTRAINT supplier_departure_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES core.supplier(supplier_id) ON DELETE CASCADE;


--
-- Name: supplier supplier_entity_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.supplier
    ADD CONSTRAINT supplier_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES core.supply_entity(entity_id);


--
-- Name: supply_meeting_result supply_meeting_result_basis_submission_line_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.supply_meeting_result
    ADD CONSTRAINT supply_meeting_result_basis_submission_line_id_fkey FOREIGN KEY (basis_submission_line_id) REFERENCES core.demand_submission_line(line_id) ON DELETE SET NULL;


--
-- Name: supply_meeting_result supply_meeting_result_entered_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.supply_meeting_result
    ADD CONSTRAINT supply_meeting_result_entered_by_fkey FOREIGN KEY (entered_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: supply_meeting_result_event supply_meeting_result_event_actor_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.supply_meeting_result_event
    ADD CONSTRAINT supply_meeting_result_event_actor_fkey FOREIGN KEY (actor) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: supply_meeting_result_event supply_meeting_result_event_result_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.supply_meeting_result_event
    ADD CONSTRAINT supply_meeting_result_event_result_id_fkey FOREIGN KEY (result_id) REFERENCES core.supply_meeting_result(result_id) ON DELETE RESTRICT;


--
-- Name: supply_meeting_result supply_meeting_result_updated_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.supply_meeting_result
    ADD CONSTRAINT supply_meeting_result_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: upload_batch upload_batch_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.upload_batch
    ADD CONSTRAINT upload_batch_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id);


--
-- Name: urgent_order urgent_order_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.urgent_order
    ADD CONSTRAINT urgent_order_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: user_notification user_notification_notification_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.user_notification
    ADD CONSTRAINT user_notification_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES core.notification_outbox(notification_id) ON DELETE RESTRICT;


--
-- Name: user_notification user_notification_recipient_user_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.user_notification
    ADD CONSTRAINT user_notification_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: validation_error validation_error_batch_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.validation_error
    ADD CONSTRAINT validation_error_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES core.upload_batch(batch_id) ON DELETE CASCADE;


--
-- Name: agent_conversation; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.agent_conversation ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_conversation_legacy_202609092017; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.agent_conversation_legacy_202609092017 ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_conversation agent_conversation_owner_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY agent_conversation_owner_select ON core.agent_conversation FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR core.is_admin()));


--
-- Name: agent_conversation agent_conversation_owner_write; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY agent_conversation_owner_write ON core.agent_conversation TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: agent_message; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.agent_message ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_message_legacy_202609092017; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.agent_message_legacy_202609092017 ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_message agent_message_owner_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY agent_message_owner_select ON core.agent_message FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR core.is_admin()));


--
-- Name: agent_message agent_message_owner_write; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY agent_message_owner_write ON core.agent_message TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: allocation_priority; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.allocation_priority ENABLE ROW LEVEL SECURITY;

--
-- Name: allocation_priority allocation_priority_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY allocation_priority_read ON core.allocation_priority FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM core.sales_order o
  WHERE (o.order_id = allocation_priority.order_id))));


--
-- Name: app_user; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.app_user ENABLE ROW LEVEL SECURITY;

--
-- Name: app_user app_user_admin_update; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY app_user_admin_update ON core.app_user FOR UPDATE TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: app_user app_user_select_self_or_admin; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY app_user_select_self_or_admin ON core.app_user FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR core.is_admin()));


--
-- Name: approval_event; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.approval_event ENABLE ROW LEVEL SECURITY;

--
-- Name: approval_event approval_event_read_related; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY approval_event_read_related ON core.approval_event FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM core.approval_request r
  WHERE (r.approval_id = approval_event.approval_id))));


--
-- Name: approval_request; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.approval_request ENABLE ROW LEVEL SECURITY;

--
-- Name: approval_request approval_request_read_related; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY approval_request_read_related ON core.approval_request FOR SELECT TO authenticated USING (((requested_by = auth.uid()) OR (decided_by = auth.uid()) OR core.has_permission(
CASE approval_type
    WHEN 'ITEM_POLICY'::text THEN 'ITEM_POLICY_APPROVE'::text
    WHEN 'ALLOC_PRIORITY'::text THEN 'ALLOC_PRIORITY_APPROVE'::text
    WHEN 'EVENT_ORDER'::text THEN 'EVENT_ORDER_APPROVE'::text
    WHEN 'PURCHASE_PLAN'::text THEN 'PLAN_APPROVE'::text
    ELSE NULL::text
END)));


--
-- Name: audit_log; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log audit_log_admin_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY audit_log_admin_select ON core.audit_log FOR SELECT TO authenticated USING (core.is_admin());


--
-- Name: backtest_run; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.backtest_run ENABLE ROW LEVEL SECURITY;

--
-- Name: backtest_run backtest_run_active_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY backtest_run_active_select ON core.backtest_run FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: backtest_run backtest_run_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY backtest_run_admin_mutation ON core.backtest_run TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: business_calendar; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.business_calendar ENABLE ROW LEVEL SECURITY;

--
-- Name: business_calendar business_calendar_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY business_calendar_read ON core.business_calendar FOR SELECT TO authenticated USING (true);


--
-- Name: business_calendar_readiness; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.business_calendar_readiness ENABLE ROW LEVEL SECURITY;

--
-- Name: business_calendar_readiness business_calendar_readiness_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY business_calendar_readiness_read ON core.business_calendar_readiness FOR SELECT TO authenticated USING (true);


--
-- Name: business_calendar_readiness business_calendar_readiness_write_admin; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY business_calendar_readiness_write_admin ON core.business_calendar_readiness TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: business_calendar business_calendar_write_admin; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY business_calendar_write_admin ON core.business_calendar TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: champion_model_selection; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.champion_model_selection ENABLE ROW LEVEL SECURITY;

--
-- Name: champion_model_selection champion_model_selection_active_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY champion_model_selection_active_select ON core.champion_model_selection FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: champion_model_selection champion_model_selection_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY champion_model_selection_admin_mutation ON core.champion_model_selection TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: column_mapping; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.column_mapping ENABLE ROW LEVEL SECURITY;

--
-- Name: column_mapping column_mapping_active_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY column_mapping_active_select ON core.column_mapping FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: column_mapping column_mapping_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY column_mapping_admin_mutation ON core.column_mapping TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: agent_conversation_legacy_202609092017 conv_insert_own; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY conv_insert_own ON core.agent_conversation_legacy_202609092017 FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: agent_conversation_legacy_202609092017 conv_select_admin; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY conv_select_admin ON core.agent_conversation_legacy_202609092017 FOR SELECT TO authenticated USING (core.is_admin());


--
-- Name: agent_conversation_legacy_202609092017 conv_select_own; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY conv_select_own ON core.agent_conversation_legacy_202609092017 FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: agent_conversation_legacy_202609092017 conv_update_own; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY conv_update_own ON core.agent_conversation_legacy_202609092017 FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: demand_submission; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.demand_submission ENABLE ROW LEVEL SECURITY;

--
-- Name: demand_submission_event; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.demand_submission_event ENABLE ROW LEVEL SECURITY;

--
-- Name: demand_submission_event demand_submission_event_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY demand_submission_event_read ON core.demand_submission_event FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM core.demand_submission s
  WHERE (s.submission_id = demand_submission_event.submission_id))));


--
-- Name: demand_submission_line; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.demand_submission_line ENABLE ROW LEVEL SECURITY;

--
-- Name: demand_submission_line demand_submission_line_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY demand_submission_line_read ON core.demand_submission_line FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM core.demand_submission s
  WHERE (s.submission_id = demand_submission_line.submission_id))));


--
-- Name: demand_submission demand_submission_read_own_or_scm; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY demand_submission_read_own_or_scm ON core.demand_submission FOR SELECT TO authenticated USING (((core.has_permission('DEMAND_SUBMIT'::text) AND (department = ( SELECT u.department
   FROM core.app_user u
  WHERE (u.user_id = auth.uid())))) OR core.has_permission('DEMAND_CONSOLIDATE'::text) OR core.has_permission('PLAN_CONFIRM'::text) OR core.is_admin()));


--
-- Name: event_demand; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.event_demand ENABLE ROW LEVEL SECURITY;

--
-- Name: event_demand event_demand_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY event_demand_read ON core.event_demand FOR SELECT TO authenticated USING (((requested_by = auth.uid()) OR core.has_permission('DEMAND_CONSOLIDATE'::text) OR core.has_permission('EVENT_ORDER_APPROVE'::text) OR core.has_permission('PLAN_CONFIRM'::text) OR core.is_admin()));


--
-- Name: forecast_result; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.forecast_result ENABLE ROW LEVEL SECURITY;

--
-- Name: forecast_result forecast_result_active_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY forecast_result_active_select ON core.forecast_result FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: forecast_result forecast_result_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY forecast_result_admin_mutation ON core.forecast_result TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: forecast_run; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.forecast_run ENABLE ROW LEVEL SECURITY;

--
-- Name: forecast_run forecast_run_active_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY forecast_run_active_select ON core.forecast_run FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: forecast_run forecast_run_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY forecast_run_admin_mutation ON core.forecast_run TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: forecast_setting; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.forecast_setting ENABLE ROW LEVEL SECURITY;

--
-- Name: forecast_setting forecast_setting_active_user_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY forecast_setting_active_user_select ON core.forecast_setting FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: forecast_setting forecast_setting_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY forecast_setting_admin_mutation ON core.forecast_setting TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: import_row_backup; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.import_row_backup ENABLE ROW LEVEL SECURITY;

--
-- Name: import_row_backup import_row_backup_active_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY import_row_backup_active_select ON core.import_row_backup FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: import_row_backup import_row_backup_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY import_row_backup_admin_mutation ON core.import_row_backup TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: import_staging; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.import_staging ENABLE ROW LEVEL SECURITY;

--
-- Name: import_staging import_staging_active_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY import_staging_active_select ON core.import_staging FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: import_staging import_staging_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY import_staging_admin_mutation ON core.import_staging TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: inventory_scope_rule; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.inventory_scope_rule ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_scope_rule inventory_scope_rule_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY inventory_scope_rule_read ON core.inventory_scope_rule FOR SELECT TO authenticated USING (true);


--
-- Name: inventory_scope_rule inventory_scope_rule_write; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY inventory_scope_rule_write ON core.inventory_scope_rule TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: item_policy; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.item_policy ENABLE ROW LEVEL SECURITY;

--
-- Name: item_policy item_policy_active_user_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY item_policy_active_user_select ON core.item_policy FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: item_policy item_policy_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY item_policy_admin_mutation ON core.item_policy TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: item_policy item_policy_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY item_policy_read ON core.item_policy FOR SELECT TO authenticated USING (true);


--
-- Name: item_policy_revision; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.item_policy_revision ENABLE ROW LEVEL SECURITY;

--
-- Name: item_policy_revision item_policy_revision_read_related; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY item_policy_revision_read_related ON core.item_policy_revision FOR SELECT TO authenticated USING (((requested_by = auth.uid()) OR (decided_by = auth.uid()) OR core.has_permission('ITEM_POLICY_EDIT'::text) OR core.has_permission('ITEM_POLICY_APPROVE'::text)));


--
-- Name: item_policy item_policy_write; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY item_policy_write ON core.item_policy TO authenticated USING ((core.has_permission('ITEM_POLICY_EDIT'::text) OR core.is_admin())) WITH CHECK ((core.has_permission('ITEM_POLICY_EDIT'::text) OR core.is_admin()));


--
-- Name: item_visibility_rule; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.item_visibility_rule ENABLE ROW LEVEL SECURITY;

--
-- Name: item_visibility_rule item_visibility_rule_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY item_visibility_rule_read ON core.item_visibility_rule FOR SELECT TO authenticated USING (true);


--
-- Name: item_visibility_rule item_visibility_rule_write; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY item_visibility_rule_write ON core.item_visibility_rule TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: leadtime_plan; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.leadtime_plan ENABLE ROW LEVEL SECURITY;

--
-- Name: leadtime_plan leadtime_plan_admin_delete; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY leadtime_plan_admin_delete ON core.leadtime_plan FOR DELETE TO authenticated USING (core.is_admin());


--
-- Name: leadtime_plan leadtime_plan_admin_insert; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY leadtime_plan_admin_insert ON core.leadtime_plan FOR INSERT TO authenticated WITH CHECK (core.is_admin());


--
-- Name: leadtime_plan leadtime_plan_admin_update; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY leadtime_plan_admin_update ON core.leadtime_plan FOR UPDATE TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: leadtime_plan leadtime_plan_user_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY leadtime_plan_user_select ON core.leadtime_plan FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: model_config; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.model_config ENABLE ROW LEVEL SECURITY;

--
-- Name: model_config model_config_active_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY model_config_active_select ON core.model_config FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: model_config model_config_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY model_config_admin_mutation ON core.model_config TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: model_performance; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.model_performance ENABLE ROW LEVEL SECURITY;

--
-- Name: model_performance model_performance_active_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY model_performance_active_select ON core.model_performance FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: model_performance model_performance_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY model_performance_admin_mutation ON core.model_performance TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: model_version; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.model_version ENABLE ROW LEVEL SECURITY;

--
-- Name: model_version model_version_active_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY model_version_active_select ON core.model_version FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: model_version model_version_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY model_version_admin_mutation ON core.model_version TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: month_end_inventory_snapshot; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.month_end_inventory_snapshot ENABLE ROW LEVEL SECURITY;

--
-- Name: month_end_inventory_snapshot month_end_inventory_snapshot_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY month_end_inventory_snapshot_read ON core.month_end_inventory_snapshot FOR SELECT TO authenticated USING (core.has_permission('STOCK_VIEW_ALL'::text));


--
-- Name: agent_message_legacy_202609092017 msg_insert_own; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY msg_insert_own ON core.agent_message_legacy_202609092017 FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM core.agent_conversation_legacy_202609092017 c
  WHERE ((c.id = agent_message_legacy_202609092017.conversation_id) AND (c.user_id = auth.uid())))));


--
-- Name: agent_message_legacy_202609092017 msg_select_admin; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY msg_select_admin ON core.agent_message_legacy_202609092017 FOR SELECT TO authenticated USING (core.is_admin());


--
-- Name: agent_message_legacy_202609092017 msg_select_own; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY msg_select_own ON core.agent_message_legacy_202609092017 FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM core.agent_conversation_legacy_202609092017 c
  WHERE ((c.id = agent_message_legacy_202609092017.conversation_id) AND (c.user_id = auth.uid())))));


--
-- Name: notification_delivery; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.notification_delivery ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_delivery notification_delivery_read_admin; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY notification_delivery_read_admin ON core.notification_delivery FOR SELECT TO authenticated USING (core.is_admin());


--
-- Name: notification_outbox; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.notification_outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_outbox notification_outbox_read_own; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY notification_outbox_read_own ON core.notification_outbox FOR SELECT TO authenticated USING (((recipient_user_id = auth.uid()) OR core.is_admin()));


--
-- Name: outlier_rule; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.outlier_rule ENABLE ROW LEVEL SECURITY;

--
-- Name: outlier_rule outlier_rule_active_user_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY outlier_rule_active_user_select ON core.outlier_rule FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: outlier_rule outlier_rule_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY outlier_rule_admin_mutation ON core.outlier_rule TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: permission; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.permission ENABLE ROW LEVEL SECURITY;

--
-- Name: permission permission_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY permission_read ON core.permission FOR SELECT TO authenticated USING (true);


--
-- Name: permission permission_write; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY permission_write ON core.permission TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: planning_cycle; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.planning_cycle ENABLE ROW LEVEL SECURITY;

--
-- Name: planning_cycle planning_cycle_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY planning_cycle_read ON core.planning_cycle FOR SELECT TO authenticated USING (true);


--
-- Name: policy_config; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.policy_config ENABLE ROW LEVEL SECURITY;

--
-- Name: policy_config policy_config_active_user_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY policy_config_active_user_select ON core.policy_config FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: policy_config policy_config_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY policy_config_admin_mutation ON core.policy_config TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: procurement_plan; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.procurement_plan ENABLE ROW LEVEL SECURITY;

--
-- Name: procurement_plan_event; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.procurement_plan_event ENABLE ROW LEVEL SECURITY;

--
-- Name: procurement_plan_event procurement_plan_event_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY procurement_plan_event_read ON core.procurement_plan_event FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM core.procurement_plan p
  WHERE (p.plan_id = procurement_plan_event.plan_id))));


--
-- Name: procurement_plan_line; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.procurement_plan_line ENABLE ROW LEVEL SECURITY;

--
-- Name: procurement_plan_line procurement_plan_line_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY procurement_plan_line_read ON core.procurement_plan_line FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM core.procurement_plan p
  WHERE (p.plan_id = procurement_plan_line.plan_id))));


--
-- Name: procurement_plan procurement_plan_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY procurement_plan_read ON core.procurement_plan FOR SELECT TO authenticated USING ((core.has_permission('PLAN_CONFIRM'::text) OR core.has_permission('PLAN_APPROVE'::text) OR core.is_admin()));


--
-- Name: procurement_schedule; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.procurement_schedule ENABLE ROW LEVEL SECURITY;

--
-- Name: procurement_schedule procurement_schedule_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY procurement_schedule_read ON core.procurement_schedule FOR SELECT TO authenticated USING ((core.has_permission('PLAN_CONFIRM'::text) OR core.has_permission('PLAN_APPROVE'::text) OR core.is_admin()));


--
-- Name: receipt_schedule_result; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.receipt_schedule_result ENABLE ROW LEVEL SECURITY;

--
-- Name: receipt_schedule_result receipt_schedule_result_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY receipt_schedule_result_read ON core.receipt_schedule_result FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM core.procurement_schedule s
  WHERE (s.schedule_id = receipt_schedule_result.schedule_id))));


--
-- Name: role_permission; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.role_permission ENABLE ROW LEVEL SECURITY;

--
-- Name: role_permission role_permission_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY role_permission_read ON core.role_permission FOR SELECT TO authenticated USING (true);


--
-- Name: role_permission role_permission_write; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY role_permission_write ON core.role_permission TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: sales_order; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.sales_order ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_order_event; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.sales_order_event ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_order_event sales_order_event_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY sales_order_event_read ON core.sales_order_event FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM core.sales_order o
  WHERE (o.order_id = sales_order_event.order_id))));


--
-- Name: sales_order_line; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.sales_order_line ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_order_line sales_order_line_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY sales_order_line_read ON core.sales_order_line FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM core.sales_order o
  WHERE (o.order_id = sales_order_line.order_id))));


--
-- Name: sales_order sales_order_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY sales_order_read ON core.sales_order FOR SELECT TO authenticated USING (core.can_view_sales_order(owner_user_id));


--
-- Name: stock_allocation; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.stock_allocation ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_allocation_event; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.stock_allocation_event ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_allocation_event stock_allocation_event_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY stock_allocation_event_read ON core.stock_allocation_event FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM core.sales_order o
  WHERE (o.order_id = stock_allocation_event.order_id))));


--
-- Name: stock_allocation stock_allocation_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY stock_allocation_read ON core.stock_allocation FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM core.sales_order o
  WHERE (o.order_id = stock_allocation.order_id))));


--
-- Name: stock_balance; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.stock_balance ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_balance stock_balance_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY stock_balance_read ON core.stock_balance FOR SELECT TO authenticated USING ((core.has_permission('STOCK_VIEW_ALL'::text) OR core.has_permission('ATP_VIEW'::text) OR core.has_permission('STOCK_VIEW_PAPER'::text) OR core.has_permission('STOCK_VIEW_SUPPLY'::text) OR core.is_admin()));


--
-- Name: stock_receipt_ledger; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.stock_receipt_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_receipt_ledger stock_receipt_ledger_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY stock_receipt_ledger_read ON core.stock_receipt_ledger FOR SELECT TO authenticated USING ((core.has_permission('STOCK_VIEW_ALL'::text) OR core.has_permission('ATP_VIEW'::text) OR core.has_permission('STOCK_VIEW_PAPER'::text) OR core.has_permission('STOCK_VIEW_SUPPLY'::text) OR core.is_admin()));


--
-- Name: supplier; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.supplier ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_alias; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.supplier_alias ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_departure; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.supplier_departure ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_departure supplier_departure_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY supplier_departure_read ON core.supplier_departure FOR SELECT TO authenticated USING (true);


--
-- Name: supplier_departure supplier_departure_write_admin; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY supplier_departure_write_admin ON core.supplier_departure TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: supplier supplier_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY supplier_read ON core.supplier FOR SELECT TO authenticated USING (true);


--
-- Name: supplier supplier_write_admin; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY supplier_write_admin ON core.supplier TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: supply_entity; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.supply_entity ENABLE ROW LEVEL SECURITY;

--
-- Name: supply_entity supply_entity_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY supply_entity_read ON core.supply_entity FOR SELECT TO authenticated USING (true);


--
-- Name: supply_entity supply_entity_write_admin; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY supply_entity_write_admin ON core.supply_entity TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: supply_meeting_result; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.supply_meeting_result ENABLE ROW LEVEL SECURITY;

--
-- Name: supply_meeting_result_event; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.supply_meeting_result_event ENABLE ROW LEVEL SECURITY;

--
-- Name: supply_meeting_result_event supply_meeting_result_event_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY supply_meeting_result_event_read ON core.supply_meeting_result_event FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM core.supply_meeting_result r
  WHERE (r.result_id = supply_meeting_result_event.result_id))));


--
-- Name: supply_meeting_result supply_meeting_result_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY supply_meeting_result_read ON core.supply_meeting_result FOR SELECT TO authenticated USING ((core.has_permission('SUPPLY_MEETING_INPUT'::text) OR core.has_permission('DEMAND_CONSOLIDATE'::text) OR core.has_permission('PLAN_CONFIRM'::text) OR core.has_permission('PLAN_APPROVE'::text) OR core.is_admin()));


--
-- Name: upload_batch; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.upload_batch ENABLE ROW LEVEL SECURITY;

--
-- Name: upload_batch upload_batch_active_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY upload_batch_active_select ON core.upload_batch FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: upload_batch upload_batch_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY upload_batch_admin_mutation ON core.upload_batch TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: urgent_order; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.urgent_order ENABLE ROW LEVEL SECURITY;

--
-- Name: urgent_order urgent_order_read; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY urgent_order_read ON core.urgent_order FOR SELECT TO authenticated USING ((core.has_permission('STOCK_VIEW_ALL'::text) OR (core.has_permission('URGENT_ORDER_VIEW'::text) AND (core.item_visibility_scope(item_id) = 'CONSUMABLE'::text))));


--
-- Name: usage_profile; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.usage_profile ENABLE ROW LEVEL SECURITY;

--
-- Name: usage_profile usage_profile_admin_delete; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY usage_profile_admin_delete ON core.usage_profile FOR DELETE TO authenticated USING (core.is_admin());


--
-- Name: usage_profile usage_profile_admin_insert; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY usage_profile_admin_insert ON core.usage_profile FOR INSERT TO authenticated WITH CHECK (core.is_admin());


--
-- Name: usage_profile usage_profile_admin_update; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY usage_profile_admin_update ON core.usage_profile FOR UPDATE TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: usage_profile usage_profile_user_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY usage_profile_user_select ON core.usage_profile FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: user_notification; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.user_notification ENABLE ROW LEVEL SECURITY;

--
-- Name: user_notification user_notification_read_own; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY user_notification_read_own ON core.user_notification FOR SELECT TO authenticated USING ((recipient_user_id = auth.uid()));


--
-- Name: validation_error; Type: ROW SECURITY; Schema: core; Owner: -
--

ALTER TABLE core.validation_error ENABLE ROW LEVEL SECURITY;

--
-- Name: validation_error validation_error_active_select; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY validation_error_active_select ON core.validation_error FOR SELECT TO authenticated USING (core.is_active_user());


--
-- Name: validation_error validation_error_admin_mutation; Type: POLICY; Schema: core; Owner: -
--

CREATE POLICY validation_error_admin_mutation ON core.validation_error TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());


--
-- Name: bridge_bom; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.bridge_bom ENABLE ROW LEVEL SECURITY;

--
-- Name: bridge_cap_option; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.bridge_cap_option ENABLE ROW LEVEL SECURITY;

--
-- Name: bridge_mc_cap; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.bridge_mc_cap ENABLE ROW LEVEL SECURITY;

--
-- Name: bridge_option_model; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.bridge_option_model ENABLE ROW LEVEL SECURITY;

--
-- Name: bridge_scc_config; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.bridge_scc_config ENABLE ROW LEVEL SECURITY;

--
-- Name: bridge_xcn; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.bridge_xcn ENABLE ROW LEVEL SECURITY;

--
-- Name: business_event; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.business_event ENABLE ROW LEVEL SECURITY;

--
-- Name: dim_item; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.dim_item ENABLE ROW LEVEL SECURITY;

--
-- Name: dim_model; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.dim_model ENABLE ROW LEVEL SECURITY;

--
-- Name: fact_mc_plan_actual; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.fact_mc_plan_actual ENABLE ROW LEVEL SECURITY;

--
-- Name: fact_shipment; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.fact_shipment ENABLE ROW LEVEL SECURITY;

--
-- Name: forecast; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.forecast ENABLE ROW LEVEL SECURITY;

--
-- Name: goods_receipt; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.goods_receipt ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.inventory ENABLE ROW LEVEL SECURITY;

--
-- Name: item_master; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.item_master ENABLE ROW LEVEL SECURITY;

--
-- Name: item_substitute; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.item_substitute ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_order; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.purchase_order ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_order; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.sales_order ENABLE ROW LEVEL SECURITY;

--
-- Name: shipment_log; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.shipment_log ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_master; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.supplier_master ENABLE ROW LEVEL SECURITY;

--
-- Name: usage_history; Type: ROW SECURITY; Schema: raw; Owner: -
--

ALTER TABLE raw.usage_history ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA analytics; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA analytics TO authenticated;


--
-- Name: SCHEMA core; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA core TO authenticated;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION add_business_holiday(p_country_code text, p_calendar_date date, p_holiday_name text, p_reason text); Type: ACL; Schema: core; Owner: -
--

GRANT ALL ON FUNCTION core.add_business_holiday(p_country_code text, p_calendar_date date, p_holiday_name text, p_reason text) TO authenticated;


--
-- Name: TABLE demand_submission; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.demand_submission TO authenticated;


--
-- Name: FUNCTION agree_demand_submission(p_submission_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.agree_demand_submission(p_submission_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION core.agree_demand_submission(p_submission_id uuid) TO authenticated;


--
-- Name: FUNCTION allocate_new_stock(p_item_id text, p_receipt_id bigint); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.allocate_new_stock(p_item_id text, p_receipt_id bigint) FROM PUBLIC;


--
-- Name: FUNCTION allocate_to_order_line(p_line_id bigint, p_max_qty numeric, p_source text, p_actor uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.allocate_to_order_line(p_line_id bigint, p_max_qty numeric, p_source text, p_actor uuid) FROM PUBLIC;


--
-- Name: FUNCTION apply_alloc_priority_decision(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.apply_alloc_priority_decision() FROM PUBLIC;


--
-- Name: FUNCTION apply_event_demand_decision(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.apply_event_demand_decision() FROM PUBLIC;


--
-- Name: FUNCTION apply_item_policy_decision(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.apply_item_policy_decision() FROM PUBLIC;


--
-- Name: FUNCTION apply_month_end_inventory_snapshot_from_batch(p_batch_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.apply_month_end_inventory_snapshot_from_batch(p_batch_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION apply_procurement_plan_decision(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.apply_procurement_plan_decision() FROM PUBLIC;


--
-- Name: FUNCTION apply_sales_order_status(p_order_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.apply_sales_order_status(p_order_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION apply_stock_balance_from_batch(p_batch_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.apply_stock_balance_from_batch(p_batch_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION apply_stock_receipts_from_batch(p_batch_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.apply_stock_receipts_from_batch(p_batch_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION approve_procurement_plan(p_plan_id uuid, p_approval_id uuid, p_comment text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.approve_procurement_plan(p_plan_id uuid, p_approval_id uuid, p_comment text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.approve_procurement_plan(p_plan_id uuid, p_approval_id uuid, p_comment text) TO authenticated;


--
-- Name: FUNCTION audit_app_user_change(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.audit_app_user_change() FROM PUBLIC;


--
-- Name: FUNCTION build_procurement_plan(p_plan_month date, p_forecast_run_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.build_procurement_plan(p_plan_month date, p_forecast_run_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION core.build_procurement_plan(p_plan_month date, p_forecast_run_id uuid) TO authenticated;


--
-- Name: FUNCTION build_procurement_schedule(p_plan_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.build_procurement_schedule(p_plan_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION core.build_procurement_schedule(p_plan_id uuid) TO authenticated;


--
-- Name: FUNCTION calculate_procurement_plan_month(p_month_no integer, p_base_forecast_qty numeric, p_department_agreed_qty numeric, p_approved_added_qty numeric, p_start_stock_qty numeric, p_target_dos_days numeric, p_usage_6m_total numeric, p_moq numeric, p_unit_price numeric); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.calculate_procurement_plan_month(p_month_no integer, p_base_forecast_qty numeric, p_department_agreed_qty numeric, p_approved_added_qty numeric, p_start_stock_qty numeric, p_target_dos_days numeric, p_usage_6m_total numeric, p_moq numeric, p_unit_price numeric) FROM PUBLIC;


--
-- Name: FUNCTION can_view_sales_order(p_owner_user_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.can_view_sales_order(p_owner_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION core.can_view_sales_order(p_owner_user_id uuid) TO authenticated;


--
-- Name: FUNCTION cancel_alloc_priority_approval(p_approval_id uuid, p_actor uuid, p_comment text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.cancel_alloc_priority_approval(p_approval_id uuid, p_actor uuid, p_comment text) FROM PUBLIC;


--
-- Name: FUNCTION cancel_firm_allocation(p_allocation_id uuid, p_reason text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.cancel_firm_allocation(p_allocation_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.cancel_firm_allocation(p_allocation_id uuid, p_reason text) TO authenticated;


--
-- Name: FUNCTION cancel_item_policy_change(p_revision_id uuid, p_reason text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.cancel_item_policy_change(p_revision_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.cancel_item_policy_change(p_revision_id uuid, p_reason text) TO authenticated;


--
-- Name: FUNCTION cancel_notification_series(p_series_type text, p_series_id text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.cancel_notification_series(p_series_type text, p_series_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.cancel_notification_series(p_series_type text, p_series_id text) TO service_role;


--
-- Name: FUNCTION cancel_sales_order(p_order_id uuid, p_reason text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.cancel_sales_order(p_order_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.cancel_sales_order(p_order_id uuid, p_reason text) TO authenticated;


--
-- Name: FUNCTION change_allocation_priority(p_order_id uuid, p_priority integer, p_reason text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.change_allocation_priority(p_order_id uuid, p_priority integer, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.change_allocation_priority(p_order_id uuid, p_priority integer, p_reason text) TO authenticated;


--
-- Name: FUNCTION change_urgent_order_status(p_urgent_order_id uuid, p_status text, p_reason text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.change_urgent_order_status(p_urgent_order_id uuid, p_status text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.change_urgent_order_status(p_urgent_order_id uuid, p_status text, p_reason text) TO authenticated;


--
-- Name: FUNCTION claim_due_notifications(p_limit integer, p_worker_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.claim_due_notifications(p_limit integer, p_worker_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION core.claim_due_notifications(p_limit integer, p_worker_id uuid) TO service_role;


--
-- Name: FUNCTION classify_inventory_scope(p_warehouse_code text, p_raw_status text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.classify_inventory_scope(p_warehouse_code text, p_raw_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.classify_inventory_scope(p_warehouse_code text, p_raw_status text) TO authenticated;


--
-- Name: FUNCTION close_planning_cycle(p_cycle_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.close_planning_cycle(p_cycle_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION core.close_planning_cycle(p_cycle_id uuid) TO authenticated;


--
-- Name: FUNCTION commit_import_batch(p_batch_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.commit_import_batch(p_batch_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION core.commit_import_batch(p_batch_id uuid) TO authenticated;


--
-- Name: FUNCTION confirm_kr_business_day(p_date date); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.confirm_kr_business_day(p_date date) FROM PUBLIC;


--
-- Name: FUNCTION confirm_procurement_plan(p_plan_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.confirm_procurement_plan(p_plan_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION core.confirm_procurement_plan(p_plan_id uuid) TO authenticated;


--
-- Name: FUNCTION confirm_sales_order(p_order_id uuid, p_confirmed_order_no text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.confirm_sales_order(p_order_id uuid, p_confirmed_order_no text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.confirm_sales_order(p_order_id uuid, p_confirmed_order_no text) TO authenticated;


--
-- Name: FUNCTION copy_cancelled_order(p_order_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.copy_cancelled_order(p_order_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION core.copy_cancelled_order(p_order_id uuid) TO authenticated;


--
-- Name: FUNCTION create_sales_order(p_customer_id text, p_customer_name text, p_lines jsonb, p_note text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.create_sales_order(p_customer_id text, p_customer_name text, p_lines jsonb, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.create_sales_order(p_customer_id text, p_customer_name text, p_lines jsonb, p_note text) TO authenticated;


--
-- Name: FUNCTION create_stock_allocation(p_line_id bigint, p_status text, p_qty numeric, p_source text, p_actor uuid, p_reason text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.create_stock_allocation(p_line_id bigint, p_status text, p_qty numeric, p_source text, p_actor uuid, p_reason text) FROM PUBLIC;


--
-- Name: FUNCTION create_urgent_order(p_item_id text, p_qty numeric, p_needed_by date, p_reason text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.create_urgent_order(p_item_id text, p_qty numeric, p_needed_by date, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.create_urgent_order(p_item_id text, p_qty numeric, p_needed_by date, p_reason text) TO authenticated;


--
-- Name: FUNCTION deactivate_supplier_departure_rule(p_departure_id bigint, p_reason text); Type: ACL; Schema: core; Owner: -
--

GRANT ALL ON FUNCTION core.deactivate_supplier_departure_rule(p_departure_id bigint, p_reason text) TO authenticated;


--
-- Name: FUNCTION decide_approval(p_approval_id uuid, p_decision text, p_decision_comment text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.decide_approval(p_approval_id uuid, p_decision text, p_decision_comment text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.decide_approval(p_approval_id uuid, p_decision text, p_decision_comment text) TO authenticated;


--
-- Name: FUNCTION enqueue_auto_allocation_notice(p_order_id uuid, p_dedupe_suffix text, p_item_id text, p_allocated_qty numeric, p_remaining_shortage_qty numeric); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.enqueue_auto_allocation_notice(p_order_id uuid, p_dedupe_suffix text, p_item_id text, p_allocated_qty numeric, p_remaining_shortage_qty numeric) FROM PUBLIC;


--
-- Name: FUNCTION enqueue_notification(p_dedupe_key text, p_template_code text, p_recipient_user_id uuid, p_channel text, p_scheduled_at timestamp with time zone, p_payload jsonb); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.enqueue_notification(p_dedupe_key text, p_template_code text, p_recipient_user_id uuid, p_channel text, p_scheduled_at timestamp with time zone, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION core.enqueue_notification(p_dedupe_key text, p_template_code text, p_recipient_user_id uuid, p_channel text, p_scheduled_at timestamp with time zone, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION enqueue_order_notice(p_dedupe_key text, p_template_code text, p_recipient_user_ids uuid[], p_payload jsonb); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.enqueue_order_notice(p_dedupe_key text, p_template_code text, p_recipient_user_ids uuid[], p_payload jsonb) FROM PUBLIC;


--
-- Name: FUNCTION enqueue_temporary_allocation_released(p_allocation_id text, p_recipient_user_ids uuid[]); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.enqueue_temporary_allocation_released(p_allocation_id text, p_recipient_user_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION core.enqueue_temporary_allocation_released(p_allocation_id text, p_recipient_user_ids uuid[]) TO service_role;


--
-- Name: FUNCTION expire_temporary_allocations(p_now timestamp with time zone); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.expire_temporary_allocations(p_now timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION core.expire_temporary_allocations(p_now timestamp with time zone) TO service_role;


--
-- Name: FUNCTION finish_notification(p_notification_id uuid, p_worker_id uuid, p_claim_token uuid, p_success boolean, p_retryable boolean, p_error_message text, p_external_message_id text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.finish_notification(p_notification_id uuid, p_worker_id uuid, p_claim_token uuid, p_success boolean, p_retryable boolean, p_error_message text, p_external_message_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.finish_notification(p_notification_id uuid, p_worker_id uuid, p_claim_token uuid, p_success boolean, p_retryable boolean, p_error_message text, p_external_message_id text) TO service_role;


--
-- Name: FUNCTION guard_alloc_priority_approval_request(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.guard_alloc_priority_approval_request() FROM PUBLIC;


--
-- Name: FUNCTION guard_demand_submission_cycle_active(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.guard_demand_submission_cycle_active() FROM PUBLIC;


--
-- Name: FUNCTION guard_demand_submission_line_cycle_active(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.guard_demand_submission_line_cycle_active() FROM PUBLIC;


--
-- Name: FUNCTION guard_event_demand_mutation(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.guard_event_demand_mutation() FROM PUBLIC;


--
-- Name: FUNCTION guard_event_order_approval_request(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.guard_event_order_approval_request() FROM PUBLIC;


--
-- Name: FUNCTION guard_item_policy_approval_request(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.guard_item_policy_approval_request() FROM PUBLIC;


--
-- Name: FUNCTION guard_procurement_plan_line_mutation(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.guard_procurement_plan_line_mutation() FROM PUBLIC;


--
-- Name: FUNCTION guard_procurement_plan_mutation(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.guard_procurement_plan_mutation() FROM PUBLIC;


--
-- Name: FUNCTION guard_purchase_plan_approval_request(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.guard_purchase_plan_approval_request() FROM PUBLIC;


--
-- Name: FUNCTION guard_sales_order_line_mutation(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.guard_sales_order_line_mutation() FROM PUBLIC;


--
-- Name: FUNCTION guard_sales_order_mutation(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.guard_sales_order_mutation() FROM PUBLIC;


--
-- Name: FUNCTION guard_stock_allocation_mutation(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.guard_stock_allocation_mutation() FROM PUBLIC;


--
-- Name: FUNCTION guard_supply_meeting_result_mutation(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.guard_supply_meeting_result_mutation() FROM PUBLIC;


--
-- Name: FUNCTION handle_new_auth_user(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.handle_new_auth_user() FROM PUBLIC;


--
-- Name: FUNCTION has_permission(p_code text, p_user uuid); Type: ACL; Schema: core; Owner: -
--

GRANT ALL ON FUNCTION core.has_permission(p_code text, p_user uuid) TO authenticated;


--
-- Name: FUNCTION import_target_table(p_type text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.import_target_table(p_type text) FROM PUBLIC;


--
-- Name: FUNCTION insert_sales_order(p_actor uuid, p_customer_id text, p_customer_name text, p_note text, p_lines jsonb, p_replaces_order_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.insert_sales_order(p_actor uuid, p_customer_id text, p_customer_name text, p_note text, p_lines jsonb, p_replaces_order_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION is_active_user(check_user_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.is_active_user(check_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION core.is_active_user(check_user_id uuid) TO authenticated;


--
-- Name: FUNCTION is_admin(check_user_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.is_admin(check_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION core.is_admin(check_user_id uuid) TO authenticated;


--
-- Name: FUNCTION is_business_day(p_date date, p_country text); Type: ACL; Schema: core; Owner: -
--

GRANT ALL ON FUNCTION core.is_business_day(p_date date, p_country text) TO authenticated;


--
-- Name: FUNCTION is_valid_forecast_window(p_train_start date, p_train_end date, p_test_start date, p_test_end date, p_granularity text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.is_valid_forecast_window(p_train_start date, p_train_end date, p_test_start date, p_test_end date, p_granularity text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.is_valid_forecast_window(p_train_start date, p_train_end date, p_test_start date, p_test_end date, p_granularity text) TO authenticated;


--
-- Name: FUNCTION item_committed_qty(p_item_id text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.item_committed_qty(p_item_id text) FROM PUBLIC;


--
-- Name: FUNCTION item_visibility_scope(p_item_id text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.item_visibility_scope(p_item_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.item_visibility_scope(p_item_id text) TO authenticated;


--
-- Name: FUNCTION list_manual_allocation_candidates(p_item_id text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.list_manual_allocation_candidates(p_item_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.list_manual_allocation_candidates(p_item_id text) TO authenticated;


--
-- Name: FUNCTION lock_order_pending_approvals(p_order_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.lock_order_pending_approvals(p_order_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION lock_stock_balance_items(p_item_ids text[], p_require_all boolean); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.lock_stock_balance_items(p_item_ids text[], p_require_all boolean) FROM PUBLIC;


--
-- Name: FUNCTION log_sales_order_event(p_order_id uuid, p_event_type text, p_previous_status text, p_next_status text, p_actor uuid, p_reason text, p_payload jsonb); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.log_sales_order_event(p_order_id uuid, p_event_type text, p_previous_status text, p_next_status text, p_actor uuid, p_reason text, p_payload jsonb) FROM PUBLIC;


--
-- Name: FUNCTION mark_login(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.mark_login() FROM PUBLIC;
GRANT ALL ON FUNCTION core.mark_login() TO authenticated;


--
-- Name: FUNCTION mark_notification_read(p_notification_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.mark_notification_read(p_notification_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION core.mark_notification_read(p_notification_id uuid) TO authenticated;


--
-- Name: FUNCTION my_permissions(p_user uuid); Type: ACL; Schema: core; Owner: -
--

GRANT ALL ON FUNCTION core.my_permissions(p_user uuid) TO authenticated;


--
-- Name: FUNCTION normalize_item_id(p_item_id text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.normalize_item_id(p_item_id text) FROM PUBLIC;


--
-- Name: FUNCTION notify_manual_allocation_needed(p_item_id text, p_receipt_id bigint, p_qty numeric); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.notify_manual_allocation_needed(p_item_id text, p_receipt_id bigint, p_qty numeric) FROM PUBLIC;


--
-- Name: FUNCTION open_planning_cycle(p_plan_month date); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.open_planning_cycle(p_plan_month date) FROM PUBLIC;
GRANT ALL ON FUNCTION core.open_planning_cycle(p_plan_month date) TO authenticated;


--
-- Name: FUNCTION order_actor_name(p_user uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.order_actor_name(p_user uuid) FROM PUBLIC;


--
-- Name: FUNCTION previous_business_day(p_date date, p_country text); Type: ACL; Schema: core; Owner: -
--

GRANT ALL ON FUNCTION core.previous_business_day(p_date date, p_country text) TO authenticated;


--
-- Name: FUNCTION procurement_forecast_source_status(p_run_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.procurement_forecast_source_status(p_run_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION protect_self_admin_change(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.protect_self_admin_change() FROM PUBLIC;


--
-- Name: FUNCTION raise_demand_submission_reminders(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.raise_demand_submission_reminders() FROM PUBLIC;
GRANT ALL ON FUNCTION core.raise_demand_submission_reminders() TO service_role;


--
-- Name: FUNCTION recompute_stock_balance_totals(p_item_ids text[]); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.recompute_stock_balance_totals(p_item_ids text[]) FROM PUBLIC;


--
-- Name: FUNCTION record_actual_receipt_date(p_schedule_id uuid, p_actual_receipt_date date, p_note text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.record_actual_receipt_date(p_schedule_id uuid, p_actual_receipt_date date, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.record_actual_receipt_date(p_schedule_id uuid, p_actual_receipt_date date, p_note text) TO authenticated;


--
-- Name: FUNCTION record_backtest_run_input_fingerprint(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.record_backtest_run_input_fingerprint() FROM PUBLIC;


--
-- Name: FUNCTION record_forecast_run_input_fingerprint(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.record_forecast_run_input_fingerprint() FROM PUBLIC;


--
-- Name: FUNCTION refresh_sales_order_line_totals(p_order_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.refresh_sales_order_line_totals(p_order_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION refresh_stock_balance(p_batch_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.refresh_stock_balance(p_batch_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION core.refresh_stock_balance(p_batch_id uuid) TO authenticated;


--
-- Name: FUNCTION reject_approval_event_mutation(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.reject_approval_event_mutation() FROM PUBLIC;


--
-- Name: FUNCTION reject_demand_submission_event_mutation(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.reject_demand_submission_event_mutation() FROM PUBLIC;


--
-- Name: FUNCTION reject_order_history_mutation(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.reject_order_history_mutation() FROM PUBLIC;


--
-- Name: FUNCTION reject_procurement_plan_event_mutation(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.reject_procurement_plan_event_mutation() FROM PUBLIC;


--
-- Name: FUNCTION reject_supply_meeting_result_event_mutation(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.reject_supply_meeting_result_event_mutation() FROM PUBLIC;


--
-- Name: FUNCTION release_order_allocations(p_order_id uuid, p_actor uuid, p_reason text, p_cause text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.release_order_allocations(p_order_id uuid, p_actor uuid, p_reason text, p_cause text) FROM PUBLIC;


--
-- Name: FUNCTION remove_business_holiday(p_country_code text, p_calendar_date date, p_reason text); Type: ACL; Schema: core; Owner: -
--

GRANT ALL ON FUNCTION core.remove_business_holiday(p_country_code text, p_calendar_date date, p_reason text) TO authenticated;


--
-- Name: FUNCTION request_approval(p_approval_type text, p_target_type text, p_target_id text, p_payload jsonb, p_reason_code text, p_reason_text text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.request_approval(p_approval_type text, p_target_type text, p_target_id text, p_payload jsonb, p_reason_code text, p_reason_text text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.request_approval(p_approval_type text, p_target_type text, p_target_id text, p_payload jsonb, p_reason_code text, p_reason_text text) TO authenticated;


--
-- Name: FUNCTION request_event_demand(p_plan_month date, p_item_id text, p_customer_name text, p_qty numeric, p_reason text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.request_event_demand(p_plan_month date, p_item_id text, p_customer_name text, p_qty numeric, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.request_event_demand(p_plan_month date, p_item_id text, p_customer_name text, p_qty numeric, p_reason text) TO authenticated;


--
-- Name: FUNCTION request_item_policy_change(p_item_id text, p_target_dos_days numeric, p_allocation_mode text, p_target_stock_qty numeric, p_unit_price numeric, p_moq numeric, p_pack_size numeric, p_min_order_amount numeric, p_reason text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.request_item_policy_change(p_item_id text, p_target_dos_days numeric, p_allocation_mode text, p_target_stock_qty numeric, p_unit_price numeric, p_moq numeric, p_pack_size numeric, p_min_order_amount numeric, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.request_item_policy_change(p_item_id text, p_target_dos_days numeric, p_allocation_mode text, p_target_stock_qty numeric, p_unit_price numeric, p_moq numeric, p_pack_size numeric, p_min_order_amount numeric, p_reason text) TO authenticated;


--
-- Name: FUNCTION request_manual_allocation(p_order_id uuid, p_item_id text, p_qty numeric, p_reason text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.request_manual_allocation(p_order_id uuid, p_item_id text, p_qty numeric, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.request_manual_allocation(p_order_id uuid, p_item_id text, p_qty numeric, p_reason text) TO authenticated;


--
-- Name: FUNCTION request_order_review(p_order_id uuid, p_choice text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.request_order_review(p_order_id uuid, p_choice text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.request_order_review(p_order_id uuid, p_choice text) TO authenticated;


--
-- Name: FUNCTION rollback_import_batch(p_batch_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.rollback_import_batch(p_batch_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION core.rollback_import_batch(p_batch_id uuid) TO authenticated;


--
-- Name: FUNCTION run_backtest(p_forecast_run_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.run_backtest(p_forecast_run_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION core.run_backtest(p_forecast_run_id uuid) TO authenticated;


--
-- Name: FUNCTION run_baseline_forecast(p_note text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.run_baseline_forecast(p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.run_baseline_forecast(p_note text) TO authenticated;


--
-- Name: FUNCTION sales_order_notice_recipients(p_order_id uuid, p_include_planners boolean); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.sales_order_notice_recipients(p_order_id uuid, p_include_planners boolean) FROM PUBLIC;


--
-- Name: FUNCTION sales_order_transition_allowed(p_from text, p_to text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.sales_order_transition_allowed(p_from text, p_to text) FROM PUBLIC;


--
-- Name: FUNCTION save_demand_submission_lines(p_submission_id uuid, p_lines jsonb); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.save_demand_submission_lines(p_submission_id uuid, p_lines jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION core.save_demand_submission_lines(p_submission_id uuid, p_lines jsonb) TO authenticated;


--
-- Name: FUNCTION schedule_demand_submission_reminder(p_submission_cycle_id text, p_first_at timestamp with time zone, p_recipient_user_ids uuid[]); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.schedule_demand_submission_reminder(p_submission_cycle_id text, p_first_at timestamp with time zone, p_recipient_user_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION core.schedule_demand_submission_reminder(p_submission_cycle_id text, p_first_at timestamp with time zone, p_recipient_user_ids uuid[]) TO service_role;


--
-- Name: FUNCTION schedule_sales_order_expiry_notices(p_order_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.schedule_sales_order_expiry_notices(p_order_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION schedule_temporary_allocation_expiry(p_allocation_id text, p_expires_at timestamp with time zone, p_recipient_user_ids uuid[]); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.schedule_temporary_allocation_expiry(p_allocation_id text, p_expires_at timestamp with time zone, p_recipient_user_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION core.schedule_temporary_allocation_expiry(p_allocation_id text, p_expires_at timestamp with time zone, p_recipient_user_ids uuid[]) TO service_role;


--
-- Name: FUNCTION select_manual_champion(p_backtest_run_id uuid, p_item_id text, p_model_id text, p_reason text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.select_manual_champion(p_backtest_run_id uuid, p_item_id text, p_model_id text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.select_manual_champion(p_backtest_run_id uuid, p_item_id text, p_model_id text, p_reason text) TO authenticated;


--
-- Name: FUNCTION set_calendar_month_ready(p_country_code text, p_cal_year integer, p_cal_month integer, p_ready boolean, p_reason text); Type: ACL; Schema: core; Owner: -
--

GRANT ALL ON FUNCTION core.set_calendar_month_ready(p_country_code text, p_cal_year integer, p_cal_month integer, p_ready boolean, p_reason text) TO authenticated;


--
-- Name: FUNCTION set_supplier_departure_rule(p_departure_id bigint, p_supplier_id text, p_weekday integer, p_week_of_month integer, p_day_of_month integer, p_valid_from date, p_valid_to date, p_note text, p_reason text); Type: ACL; Schema: core; Owner: -
--

GRANT ALL ON FUNCTION core.set_supplier_departure_rule(p_departure_id bigint, p_supplier_id text, p_weekday integer, p_week_of_month integer, p_day_of_month integer, p_valid_from date, p_valid_to date, p_note text, p_reason text) TO authenticated;


--
-- Name: FUNCTION set_supply_meeting_result(p_plan_month date, p_item_id text, p_qty numeric, p_approved boolean, p_basis_submission_line_id uuid, p_reason text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.set_supply_meeting_result(p_plan_month date, p_item_id text, p_qty numeric, p_approved boolean, p_basis_submission_line_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.set_supply_meeting_result(p_plan_month date, p_item_id text, p_qty numeric, p_approved boolean, p_basis_submission_line_id uuid, p_reason text) TO authenticated;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.set_updated_at() FROM PUBLIC;


--
-- Name: FUNCTION start_demand_submission(p_plan_month date); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.start_demand_submission(p_plan_month date) FROM PUBLIC;
GRANT ALL ON FUNCTION core.start_demand_submission(p_plan_month date) TO authenticated;


--
-- Name: FUNCTION submission_deadline(p_plan_month date); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.submission_deadline(p_plan_month date) FROM PUBLIC;
GRANT ALL ON FUNCTION core.submission_deadline(p_plan_month date) TO authenticated;
GRANT ALL ON FUNCTION core.submission_deadline(p_plan_month date) TO service_role;


--
-- Name: FUNCTION submit_demand_submission(p_submission_id uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.submit_demand_submission(p_submission_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION core.submit_demand_submission(p_submission_id uuid) TO authenticated;


--
-- Name: FUNCTION sync_approval_notifications(); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.sync_approval_notifications() FROM PUBLIC;


--
-- Name: TABLE stock_allocation; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.stock_allocation TO authenticated;


--
-- Name: FUNCTION transition_stock_allocation(p_allocation_id uuid, p_next_status text, p_actor uuid, p_reason text, p_cause text, p_payload jsonb); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.transition_stock_allocation(p_allocation_id uuid, p_next_status text, p_actor uuid, p_reason text, p_cause text, p_payload jsonb) FROM PUBLIC;


--
-- Name: FUNCTION update_urgent_order(p_urgent_order_id uuid, p_qty numeric, p_needed_by date, p_reason text, p_change_reason text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.update_urgent_order(p_urgent_order_id uuid, p_qty numeric, p_needed_by date, p_reason text, p_change_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.update_urgent_order(p_urgent_order_id uuid, p_qty numeric, p_needed_by date, p_reason text, p_change_reason text) TO authenticated;


--
-- Name: FUNCTION upsert_supplier(p_supplier_id text, p_supplier_name text, p_entity_id text, p_lead_time_days integer, p_active boolean, p_valid_from date, p_valid_to date, p_note text, p_reason text); Type: ACL; Schema: core; Owner: -
--

GRANT ALL ON FUNCTION core.upsert_supplier(p_supplier_id text, p_supplier_name text, p_entity_id text, p_lead_time_days integer, p_active boolean, p_valid_from date, p_valid_to date, p_note text, p_reason text) TO authenticated;


--
-- Name: FUNCTION upsert_supply_entity(p_entity_id text, p_entity_name text, p_country_code text, p_prep_days integer, p_active boolean, p_valid_from date, p_valid_to date, p_note text, p_reason text); Type: ACL; Schema: core; Owner: -
--

GRANT ALL ON FUNCTION core.upsert_supply_entity(p_entity_id text, p_entity_name text, p_country_code text, p_prep_days integer, p_active boolean, p_valid_from date, p_valid_to date, p_note text, p_reason text) TO authenticated;


--
-- Name: FUNCTION usage_input_fingerprint(p_split text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.usage_input_fingerprint(p_split text) FROM PUBLIC;


--
-- Name: FUNCTION validate_claimed_notification(p_notification_id uuid, p_worker_id uuid, p_claim_token uuid); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.validate_claimed_notification(p_notification_id uuid, p_worker_id uuid, p_claim_token uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION core.validate_claimed_notification(p_notification_id uuid, p_worker_id uuid, p_claim_token uuid) TO service_role;


--
-- Name: FUNCTION withdraw_demand_submission(p_submission_id uuid, p_reason text); Type: ACL; Schema: core; Owner: -
--

REVOKE ALL ON FUNCTION core.withdraw_demand_submission(p_submission_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION core.withdraw_demand_submission(p_submission_id uuid, p_reason text) TO authenticated;


--
-- Name: TABLE item_policy; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.item_policy TO authenticated;


--
-- Name: COLUMN item_policy.item_grade; Type: ACL; Schema: core; Owner: -
--

GRANT UPDATE(item_grade) ON TABLE core.item_policy TO authenticated;


--
-- Name: COLUMN item_policy.service_level; Type: ACL; Schema: core; Owner: -
--

GRANT UPDATE(service_level) ON TABLE core.item_policy TO authenticated;


--
-- Name: COLUMN item_policy.updated_at; Type: ACL; Schema: core; Owner: -
--

GRANT UPDATE(updated_at) ON TABLE core.item_policy TO authenticated;


--
-- Name: COLUMN item_policy.unit_price_basis; Type: ACL; Schema: core; Owner: -
--

GRANT UPDATE(unit_price_basis) ON TABLE core.item_policy TO authenticated;


--
-- Name: TABLE sales_order; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.sales_order TO authenticated;


--
-- Name: TABLE sales_order_line; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.sales_order_line TO authenticated;


--
-- Name: TABLE stock_balance; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.stock_balance TO authenticated;


--
-- Name: TABLE v_allocation_queue_line; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_allocation_queue_line TO authenticated;


--
-- Name: TABLE v_item_allocation_qty; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_item_allocation_qty TO authenticated;


--
-- Name: TABLE v_item_master; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_item_master TO authenticated;


--
-- Name: TABLE v_allocation_queue; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_allocation_queue TO authenticated;


--
-- Name: TABLE approval_request; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.approval_request TO authenticated;


--
-- Name: TABLE v_approval_history; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_approval_history TO authenticated;


--
-- Name: TABLE event_demand; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.event_demand TO authenticated;


--
-- Name: TABLE supply_meeting_result; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.supply_meeting_result TO authenticated;


--
-- Name: TABLE v_approved_demand_source; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_approved_demand_source TO authenticated;


--
-- Name: TABLE v_approved_demand_detail; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_approved_demand_detail TO authenticated;


--
-- Name: TABLE v_approved_demand_monthly; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_approved_demand_monthly TO authenticated;


--
-- Name: TABLE item_visibility_rule; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.item_visibility_rule TO authenticated;


--
-- Name: TABLE leadtime_plan; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.leadtime_plan TO authenticated;


--
-- Name: TABLE v_fact_shipment; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_fact_shipment TO authenticated;


--
-- Name: TABLE v_shipment_valid; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_shipment_valid TO authenticated;


--
-- Name: TABLE v_leadtime_stat; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_leadtime_stat TO authenticated;


--
-- Name: TABLE v_leadtime_effective; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_leadtime_effective TO authenticated;


--
-- Name: TABLE v_inbound_qty; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_inbound_qty TO authenticated;


--
-- Name: TABLE v_open_po_qty; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_open_po_qty TO authenticated;


--
-- Name: TABLE v_available_stock; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_available_stock TO authenticated;


--
-- Name: TABLE backtest_run; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.backtest_run TO authenticated;


--
-- Name: TABLE v_backtest_run; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_backtest_run TO authenticated;


--
-- Name: TABLE v_item; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_item TO authenticated;


--
-- Name: TABLE v_bom_requirement; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_bom_requirement TO authenticated;


--
-- Name: TABLE v_option_commonality; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_option_commonality TO authenticated;


--
-- Name: TABLE v_bom_requirement_x; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_bom_requirement_x TO authenticated;


--
-- Name: TABLE app_user; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.app_user TO authenticated;


--
-- Name: COLUMN app_user.role; Type: ACL; Schema: core; Owner: -
--

GRANT UPDATE(role) ON TABLE core.app_user TO authenticated;


--
-- Name: COLUMN app_user.active; Type: ACL; Schema: core; Owner: -
--

GRANT UPDATE(active) ON TABLE core.app_user TO authenticated;


--
-- Name: TABLE business_calendar; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.business_calendar TO authenticated;


--
-- Name: TABLE business_calendar_readiness; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.business_calendar_readiness TO authenticated;


--
-- Name: TABLE v_calendar_readiness; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_calendar_readiness TO authenticated;


--
-- Name: TABLE champion_model_selection; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.champion_model_selection TO authenticated;


--
-- Name: TABLE v_champion_model; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_champion_model TO authenticated;


--
-- Name: TABLE planning_cycle; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.planning_cycle TO authenticated;


--
-- Name: TABLE v_current_planning_cycle; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_current_planning_cycle TO authenticated;


--
-- Name: TABLE forecast_setting; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.forecast_setting TO authenticated;


--
-- Name: TABLE v_test_actual; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_test_actual TO authenticated;


--
-- Name: TABLE v_train_demand; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_train_demand TO authenticated;


--
-- Name: TABLE v_data_coverage; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_data_coverage TO authenticated;


--
-- Name: TABLE policy_config; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.policy_config TO authenticated;


--
-- Name: TABLE v_sku_demand_profile; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_sku_demand_profile TO authenticated;


--
-- Name: TABLE v_demand_profile_kpi; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_demand_profile_kpi TO authenticated;


--
-- Name: TABLE demand_submission_line; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.demand_submission_line TO authenticated;


--
-- Name: TABLE v_demand_submission_line; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_demand_submission_line TO authenticated;


--
-- Name: TABLE v_demand_submission_status; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_demand_submission_status TO authenticated;


--
-- Name: TABLE forecast_result; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.forecast_result TO authenticated;


--
-- Name: TABLE v_forecast_result; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_forecast_result TO authenticated;


--
-- Name: TABLE forecast_run; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.forecast_run TO authenticated;


--
-- Name: TABLE upload_batch; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.upload_batch TO authenticated;


--
-- Name: TABLE v_forecast_run; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_forecast_run TO authenticated;


--
-- Name: TABLE v_forecast_run_kpi; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_forecast_run_kpi TO authenticated;


--
-- Name: TABLE item_policy_revision; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.item_policy_revision TO authenticated;


--
-- Name: TABLE v_item_policy; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_item_policy TO authenticated;


--
-- Name: TABLE month_end_inventory_snapshot; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.month_end_inventory_snapshot TO authenticated;


--
-- Name: TABLE v_inventory_performance; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_inventory_performance TO authenticated;


--
-- Name: TABLE v_inventory_performance_kpi; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_inventory_performance_kpi TO authenticated;


--
-- Name: TABLE v_part_linkage; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_part_linkage TO authenticated;


--
-- Name: TABLE v_shipment_by_hoc; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_shipment_by_hoc TO authenticated;


--
-- Name: TABLE v_item_demand_profile; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_item_demand_profile TO authenticated;


--
-- Name: TABLE v_item_demand_kpi; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_item_demand_kpi TO authenticated;


--
-- Name: TABLE v_item_policy_revision; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_item_policy_revision TO authenticated;


--
-- Name: TABLE v_leadtime_gap; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_leadtime_gap TO authenticated;


--
-- Name: TABLE audit_log; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.audit_log TO authenticated;


--
-- Name: TABLE v_master_change_history; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_master_change_history TO authenticated;


--
-- Name: TABLE supplier; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE core.supplier TO authenticated;


--
-- Name: TABLE supplier_departure; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE core.supplier_departure TO authenticated;


--
-- Name: TABLE supply_entity; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE core.supply_entity TO authenticated;


--
-- Name: TABLE v_master_readiness; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_master_readiness TO authenticated;


--
-- Name: TABLE v_model_comparison_detail; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_model_comparison_detail TO authenticated;


--
-- Name: TABLE model_config; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.model_config TO authenticated;


--
-- Name: TABLE v_model_config; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_model_config TO authenticated;


--
-- Name: TABLE model_performance; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.model_performance TO authenticated;


--
-- Name: TABLE v_model_performance; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_model_performance TO authenticated;


--
-- Name: TABLE v_my_approval_inbox; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_my_approval_inbox TO authenticated;


--
-- Name: TABLE notification_outbox; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.notification_outbox TO authenticated;


--
-- Name: TABLE user_notification; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.user_notification TO authenticated;


--
-- Name: TABLE v_my_notification; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_my_notification TO authenticated;


--
-- Name: TABLE sales_order_event; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.sales_order_event TO authenticated;


--
-- Name: TABLE v_my_sales_order; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_my_sales_order TO authenticated;


--
-- Name: TABLE notification_delivery; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.notification_delivery TO authenticated;


--
-- Name: TABLE v_notification_delivery; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_notification_delivery TO authenticated;


--
-- Name: TABLE v_ol_accuracy; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_ol_accuracy TO authenticated;


--
-- Name: TABLE v_ol_accuracy_fy; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_ol_accuracy_fy TO authenticated;


--
-- Name: TABLE v_order_available_stock; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_order_available_stock TO authenticated;


--
-- Name: TABLE v_part_linkage; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_part_linkage TO authenticated;


--
-- Name: TABLE permission; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.permission TO authenticated;


--
-- Name: TABLE role_permission; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.role_permission TO authenticated;


--
-- Name: TABLE v_permission_matrix; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_permission_matrix TO authenticated;


--
-- Name: TABLE v_planning_cycle; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_planning_cycle TO authenticated;


--
-- Name: TABLE procurement_plan; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.procurement_plan TO authenticated;


--
-- Name: TABLE procurement_plan_line; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.procurement_plan_line TO authenticated;


--
-- Name: TABLE v_procurement_plan; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_procurement_plan TO authenticated;


--
-- Name: TABLE v_procurement_plan_blocker; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_procurement_plan_blocker TO authenticated;


--
-- Name: TABLE procurement_plan_event; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.procurement_plan_event TO authenticated;


--
-- Name: TABLE v_procurement_plan_event; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_procurement_plan_event TO authenticated;


--
-- Name: TABLE v_procurement_plan_kpi; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_procurement_plan_kpi TO authenticated;


--
-- Name: TABLE v_procurement_plan_line; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_procurement_plan_line TO authenticated;


--
-- Name: TABLE procurement_schedule; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.procurement_schedule TO authenticated;


--
-- Name: TABLE receipt_schedule_result; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.receipt_schedule_result TO authenticated;


--
-- Name: TABLE v_procurement_schedule; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_procurement_schedule TO authenticated;


--
-- Name: TABLE v_model; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_model TO authenticated;


--
-- Name: TABLE v_realdata_kpi; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_realdata_kpi TO authenticated;


--
-- Name: TABLE v_receipt_gap_entity; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_receipt_gap_entity TO authenticated;


--
-- Name: TABLE v_receipt_gap_item; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_receipt_gap_item TO authenticated;


--
-- Name: TABLE v_receipt_gap_month; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_receipt_gap_month TO authenticated;


--
-- Name: TABLE v_shipment_trend; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_shipment_trend TO authenticated;


--
-- Name: TABLE usage_profile; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.usage_profile TO authenticated;


--
-- Name: TABLE v_stock_on_hand; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_stock_on_hand TO authenticated;


--
-- Name: TABLE v_usage_effective; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_usage_effective TO authenticated;


--
-- Name: TABLE v_stockout_risk; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_stockout_risk TO authenticated;


--
-- Name: TABLE v_stockout_kpi; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_stockout_kpi TO authenticated;


--
-- Name: TABLE v_supplier; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_supplier TO authenticated;


--
-- Name: TABLE v_supplier_departure; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_supplier_departure TO authenticated;


--
-- Name: TABLE v_supply_entity; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_supply_entity TO authenticated;


--
-- Name: TABLE urgent_order; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.urgent_order TO authenticated;


--
-- Name: TABLE v_urgent_order; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_urgent_order TO authenticated;


--
-- Name: TABLE v_urgent_order_history; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_urgent_order_history TO authenticated;


--
-- Name: TABLE v_usage_anomaly; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_usage_anomaly TO authenticated;


--
-- Name: TABLE v_usage_profile; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_usage_profile TO authenticated;


--
-- Name: TABLE v_user_access; Type: ACL; Schema: analytics; Owner: -
--

GRANT SELECT ON TABLE analytics.v_user_access TO authenticated;


--
-- Name: TABLE agent_conversation; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.agent_conversation TO authenticated;


--
-- Name: TABLE agent_conversation_legacy_202609092017; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE core.agent_conversation_legacy_202609092017 TO authenticated;


--
-- Name: TABLE agent_message; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.agent_message TO authenticated;


--
-- Name: TABLE agent_message_legacy_202609092017; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT ON TABLE core.agent_message_legacy_202609092017 TO authenticated;


--
-- Name: TABLE allocation_priority; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.allocation_priority TO authenticated;


--
-- Name: TABLE approval_event; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.approval_event TO authenticated;


--
-- Name: SEQUENCE audit_log_id_seq; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE core.audit_log_id_seq TO authenticated;


--
-- Name: TABLE column_mapping; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.column_mapping TO authenticated;


--
-- Name: TABLE demand_submission_event; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.demand_submission_event TO authenticated;


--
-- Name: TABLE import_row_backup; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.import_row_backup TO authenticated;


--
-- Name: SEQUENCE import_row_backup_backup_id_seq; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE core.import_row_backup_backup_id_seq TO authenticated;


--
-- Name: TABLE import_staging; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.import_staging TO authenticated;


--
-- Name: SEQUENCE import_staging_staging_id_seq; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE core.import_staging_staging_id_seq TO authenticated;


--
-- Name: TABLE inventory_scope_rule; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.inventory_scope_rule TO authenticated;


--
-- Name: TABLE model_version; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.model_version TO authenticated;


--
-- Name: TABLE outlier_rule; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.outlier_rule TO authenticated;


--
-- Name: TABLE stock_allocation_event; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.stock_allocation_event TO authenticated;


--
-- Name: TABLE stock_receipt_ledger; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.stock_receipt_ledger TO authenticated;


--
-- Name: TABLE supplier_alias; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.supplier_alias TO authenticated;


--
-- Name: SEQUENCE supplier_departure_departure_id_seq; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE core.supplier_departure_departure_id_seq TO authenticated;


--
-- Name: TABLE supply_meeting_result_event; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.supply_meeting_result_event TO authenticated;


--
-- Name: TABLE v_import_supplier_reference; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_import_supplier_reference TO authenticated;


--
-- Name: TABLE v_ym_calendar; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT ON TABLE core.v_ym_calendar TO authenticated;


--
-- Name: TABLE validation_error; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE core.validation_error TO authenticated;


--
-- Name: SEQUENCE validation_error_validation_error_id_seq; Type: ACL; Schema: core; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE core.validation_error_validation_error_id_seq TO authenticated;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: analytics; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA analytics GRANT SELECT ON TABLES TO authenticated;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: core; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA core GRANT SELECT ON TABLES TO authenticated;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict 5RwlkNBhW08dAR34JWwSPDF81f2hcV1mBCWWLvPjWJRZ8oFTvRdWLvvc4MGpEUa

