-- Task 11 · 부서별 운영 화면과 권한 범위 완성
--
-- 목적: 같은 데이터를 부서별 권한과 업무 목적에 맞게 보여준다 (stage1 §2, refactor_260911 계획서 Task 11).
--
-- ★ 컨트롤러 판정 반영
--   1) 긴급발주 등록·수정·상태 변경은 SCM 품목담당자(ALLOC_MANUAL)만 한다. 서비스부
--      (URGENT_ORDER_VIEW)는 analytics.v_urgent_order로 조회만 한다(Task 5가 이미 만든 뷰 ·
--      RLS 그대로, 이번 마이그레이션에서 바꾸지 않는다). 상태 변경 · 수정은 append-only 이력으로
--      남긴다.
--   2) Task 4의 analytics.v_available_stock · v_order_available_stock이 마케팅(용지·카드리더기),
--      서비스(소모품), 영업(ATP)의 재고 화면 요구를 이미 만족한다 — 이번 마이그레이션은 재고 뷰를
--      다시 만들지 않는다. 사업강화부 우선순위 화면(analytics.v_allocation_queue + 이 마이그레이션
--      이전의 core.change_allocation_priority)도 이미 있다.
--   3) core.list_manual_allocation_candidates(Task 6)는 계산 없이 대기 순번만 보여주는 읽기 전용
--      함수로 이미 존재한다 — 이 마이그레이션은 새 DB 객체를 추가하지 않고 화면(app/(user)/allocations)만
--      이 함수를 부르도록 연결한다.
--
-- ★ 이력은 새 표를 만들지 않고 기존 core.audit_log(actor · action · target_type · target_id ·
--   before · after · at, STEP 2)를 재사용한다 — analytics.v_master_change_history(Task 10a)와
--   같은 방식이다. core.audit_log는 관리자만 직접 SELECT할 수 있으므로(step2
--   audit_log_admin_select), 아래 조회 뷰는 security_invoker를 쓰지 않고(뷰 소유자 권한으로
--   core.audit_log를 읽는다) WHERE 절에서 core.has_permission()으로 직접 범위를 가른다 —
--   core.has_permission은 STABLE이지만 매 호출 시 auth.uid()를 실제로 읽으므로 뷰 소유자 권한으로
--   실행돼도 호출자별로 다른 결과를 돌려준다(core.v_item_allocation_qty와 같은 패턴).
--
-- 다시 실행해도 안전합니다. 실제 Supabase 적용은 사용자가 SQL Editor에서 수동으로 수행합니다.


-- ══ 1. 긴급발주 등록 · 수정 · 상태 변경 ═══════════════════════════════

create or replace function core.create_urgent_order(
  p_item_id text,
  p_qty numeric,
  p_needed_by date,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
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

comment on function core.create_urgent_order(text, numeric, date, text) is
  'Task 11 — 긴급발주 등록. SCM 품목담당자(ALLOC_MANUAL)만 등록한다(컨트롤러 판정 1). '
  '등록 사실이 core.audit_log(target_type=urgent_order)에 남는다';

revoke all on function core.create_urgent_order(text, numeric, date, text) from public, anon;
grant execute on function core.create_urgent_order(text, numeric, date, text) to authenticated;


create or replace function core.update_urgent_order(
  p_urgent_order_id uuid,
  p_qty numeric,
  p_needed_by date,
  p_reason text,
  p_change_reason text
)
returns uuid
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
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

comment on function core.update_urgent_order(uuid, numeric, date, text, text) is
  'Task 11 — 긴급발주 수량 · 필요일 · 사유 수정. 종료(COMPLETED · CANCELLED) 건은 수정할 수 없다. '
  '변경 전후 값과 변경 사유가 core.audit_log에 남는다(append-only)';

revoke all on function core.update_urgent_order(uuid, numeric, date, text, text) from public, anon;
grant execute on function core.update_urgent_order(uuid, numeric, date, text, text) to authenticated;


create or replace function core.change_urgent_order_status(
  p_urgent_order_id uuid,
  p_status text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
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

comment on function core.change_urgent_order_status(uuid, text, text) is
  'Task 11 — 긴급발주 상태 변경(REQUESTED → IN_PROGRESS → COMPLETED, 또는 CANCELLED). 종료 상태에서는 '
  '더 바꿀 수 없다. 사유는 필수이며 core.audit_log에 append-only로 남는다';

revoke all on function core.change_urgent_order_status(uuid, text, text) from public, anon;
grant execute on function core.change_urgent_order_status(uuid, text, text) to authenticated;

-- 쓰기는 위 세 SECURITY DEFINER 함수만 한다 — 표 자체의 직접 쓰기 권한은 Task 5(0600)와
-- 마찬가지로 authenticated에 주지 않는다(재확인, 드리프트 방지용).
revoke insert, update, delete on core.urgent_order from authenticated;


-- ══ 2. 긴급발주 변경 이력 조회 ═════════════════════════════════════
--
-- ★ security_invoker를 쓰지 않는다 — core.audit_log RLS는 관리자만 직접 SELECT를 허용하므로,
--   invoker 권한으로 이 뷰를 실행하면 관리자가 아닌 SCM 품목담당자 · 서비스부는 항상 0행을
--   받는다. 뷰 소유자 권한(기본 동작)으로 core.audit_log를 읽고, WHERE 절의 core.has_permission()이
--   호출자별 조회 범위를 대신 가른다analytics.v_urgent_order와 같은 범위다.

create or replace view analytics.v_urgent_order_history as
select
  a.id,
  a.at,
  a.actor,
  coalesce(nullif(btrim(u.name), ''), a.actor::text) as actor_name,
  a.action,
  a.target_id as urgent_order_id,
  o.item_id,
  a.before,
  a.after
from core.audit_log a
left join core.app_user u on u.user_id = a.actor
left join core.urgent_order o on o.urgent_order_id::text = a.target_id
where a.target_type = 'urgent_order'
  and (
    core.has_permission('STOCK_VIEW_ALL')
    or (core.has_permission('URGENT_ORDER_VIEW') and core.item_visibility_scope(o.item_id) = 'CONSUMABLE')
  )
order by a.at desc;

comment on view analytics.v_urgent_order_history is
  'Task 11 — 긴급발주 등록 · 수정 · 상태 변경 이력. core.audit_log(target_type=urgent_order)를 재사용한다. '
  'SCM(STOCK_VIEW_ALL)은 전체, 서비스부(URGENT_ORDER_VIEW)는 소모품 품목 이력만';

grant select on analytics.v_urgent_order_history to authenticated;
revoke all on analytics.v_urgent_order_history from anon, public;


-- ══ 3. 확인 ════════════════════════════════════════════════════════
--
-- 실제 Supabase 적용 뒤 SQL Editor에서 손으로 확인한다(예시 데이터를 이 마이그레이션에는 넣지 않는다).
--
-- (a) SCM 품목담당자(ALLOC_MANUAL)로 로그인 후:
-- select core.create_urgent_order('CONS001', 10, current_date + 7, '재고 부족 확인');
--   -- 기대: uuid 반환. analytics.v_urgent_order · analytics.v_urgent_order_history에 즉시 보임.
--
-- (b) 서비스부(URGENT_ORDER_VIEW)로 로그인 후 위에서 만든 건이 소모품이면:
-- select * from analytics.v_urgent_order;              -- 기대: 그 건이 보인다(CONSUMABLE 범위)
-- select core.create_urgent_order('CONS001', 5, current_date, '사유');
--   -- 기대: 42501 permission denied — 서비스부는 등록할 수 없다(URGENT_ORDER_VIEW ≠ ALLOC_MANUAL)
--
-- (c) 마케팅부(STOCK_VIEW_PAPER만 있고 URGENT_ORDER_VIEW 없음)로 로그인 후:
-- select * from analytics.v_urgent_order;               -- 기대: 0행(권한 없음, 오류 아님)
--
-- (d) 종료된 건 재수정 거부:
-- select core.change_urgent_order_status('<위 uuid>', 'COMPLETED', '처리 완료');
-- select core.update_urgent_order('<위 uuid>', 20, current_date, '사유', '변경사유');
--   -- 기대: '이미 종료된 긴급발주는 수정할 수 없습니다' 오류
