-- Task 9a · 품목 정책 변경 요청과 SCM팀장 승인
--
-- stage1 §2 line 89-90 "품목별 배정 방식의 설정값... 이력으로 관리한다. ...SCM 품목담당자가
-- 설정하고 SCM팀장이 승인한다", §6 line 171-172 "목표 DoS 일수를 관리한다. ...설정되지 않으면
-- ...발주 확정을 차단한다", §9 "품목별 목표 DoS 일수는 SCM팀 내 품목담당자가 설정하고 SCM팀장이
-- 승인한다. ...이력으로 관리해야 한다"를 구현한다.
--
-- 여기서 만드는 것
--   core.item_policy_revision              변경안(제안값 · 요청 시점의 기존값 · 사유 · 승인 연결)
--   core.request_item_policy_change(...)    변경안 제출 + Task 2 승인 요청 생성(ITEM_POLICY)
--   core.apply_item_policy_decision()       승인 결정과 같은 트랜잭션에서 운영값 반영(Task 5 · 8과 같은 방식)
--   analytics.v_item_policy_revision        변경 이력 조회 뷰
--   analytics.v_item_policy 재정의           target_dos_approved 추가 — 값 존재가 아니라 승인 이력으로 판정
--
-- ★ 운영값(target_dos_days · allocation_mode · target_stock_qty · unit_price · moq · pack_size ·
--   min_order_amount 일곱 개, task-9-brief.md 계산 규칙 1번·컨트롤러 판정 2번 그대로)은 이 마이그
--   레이션부터 core.decide_approval(ITEM_POLICY) 트랜잭션 안에서만 바뀐다. Task 1(20260911000300)이
--   target_dos_days · allocation_mode 두 컬럼만 막았던 직접 authenticated UPDATE 권한을 나머지
--   다섯 컬럼까지 회수한다 — item_grade · service_level · unit_price_basis는 stage1 승인 규칙이
--   명시한 대상이 아니므로(단가 자체와 달리 승인을 요구하는 값이 아니라 부가 설명 텍스트다) 계속
--   직접 쓸 수 있다.
--
-- ★ target_dos_approved는 core.item_policy.target_dos_days가 null이 아니라는 사실이 아니라
--   "승인된 변경안이 있었다"는 사실로 판정한다. 이 마이그레이션 이전에 이미 값이 들어 있던 행이
--   있어도 그 값은 이 승인 절차를 거치지 않았으므로 승인된 것으로 보지 않는다(임의로 승인 이력을
--   만들지 않는다) — Task 9b가 발주 확정을 막을 때 이 플래그를 쓴다.
--
-- 다시 실행해도 안전합니다. 실제 Supabase 적용은 사용자가 SQL Editor에서 수동으로 수행합니다.


-- ══ 1. 변경안 원장 ════════════════════════════════════════════

create table if not exists core.item_policy_revision (
  revision_id                  uuid primary key default gen_random_uuid(),
  item_id                      text not null references core.item_policy(item_id) on delete restrict,

  -- 제안값 — null이면 "이 항목은 바꾸지 않는다"는 뜻이다(운영값을 null로 지우지 않는다. 아래 5번 함수 참고)
  proposed_target_dos_days     numeric check (proposed_target_dos_days is null or proposed_target_dos_days > 0),
  proposed_allocation_mode     text not null check (proposed_allocation_mode in ('AUTO', 'MANUAL')),
  proposed_target_stock_qty    numeric check (proposed_target_stock_qty is null or proposed_target_stock_qty >= 0),
  proposed_unit_price          numeric check (proposed_unit_price is null or proposed_unit_price >= 0),
  proposed_moq                 numeric check (proposed_moq is null or proposed_moq > 0),
  proposed_pack_size           numeric check (proposed_pack_size is null or proposed_pack_size > 0),
  proposed_min_order_amount    numeric check (proposed_min_order_amount is null or proposed_min_order_amount >= 0),

  -- 요청 시점의 기존 운영값 스냅샷 — 승인 화면이 "무엇이 바뀌는지" 비교할 수 있게 한다
  previous_target_dos_days     numeric,
  previous_allocation_mode     text,
  previous_target_stock_qty    numeric,
  previous_unit_price          numeric,
  previous_moq                 numeric,
  previous_pack_size           numeric,
  previous_min_order_amount    numeric,

  reason                       text not null check (btrim(reason) <> ''),
  requested_by                 uuid not null references auth.users(id) on delete restrict,
  requester_name               text not null check (btrim(requester_name) <> ''),
  requested_at                 timestamptz not null default clock_timestamp(),

  status                       text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  approval_id                  uuid references core.approval_request(approval_id) on delete restrict,
  decided_by                   uuid references auth.users(id) on delete restrict,
  decider_name                 text,
  decided_at                   timestamptz,
  decision_comment             text,

  unique (approval_id),
  constraint item_policy_revision_decision_check check (
    (status = 'PENDING' and decided_by is null and decided_at is null and decider_name is null)
    or (status in ('APPROVED', 'REJECTED') and decided_by is not null and decided_at is not null
        and nullif(btrim(decider_name), '') is not null)
  )
);

create index if not exists item_policy_revision_item_idx on core.item_policy_revision (item_id, requested_at desc);
create index if not exists item_policy_revision_status_idx on core.item_policy_revision (status, requested_at desc);
create index if not exists item_policy_revision_requester_idx on core.item_policy_revision (requested_by, requested_at desc);

-- 품목당 대기 중인 변경안은 최대 한 건이다(컨트롤러 판정 2). core.request_item_policy_change가
-- core.item_policy 행을 먼저 잠가 동시 요청을 직렬화하지만, 이 인덱스가 최종 방어선이다.
create unique index if not exists item_policy_revision_one_pending_idx
  on core.item_policy_revision (item_id) where status = 'PENDING';

comment on table core.item_policy_revision is
  'Task 9a — 품목 정책 변경안. 제안값과 요청 시점의 기존값을 함께 보관하고, 승인 시에만 '
  'core.item_policy 운영값에 반영된다(core.apply_item_policy_decision, 같은 트랜잭션)';


-- ══ 2. 변경 요청 — 품목담당자(ITEM_POLICY_EDIT) ═══════════════

create or replace function core.request_item_policy_change(
  p_item_id text,
  p_target_dos_days numeric,
  p_allocation_mode text,
  p_target_stock_qty numeric,
  p_unit_price numeric,
  p_moq numeric,
  p_pack_size numeric,
  p_min_order_amount numeric,
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

comment on function core.request_item_policy_change(text, numeric, text, numeric, numeric, numeric, numeric, numeric, text) is
  'Task 9a — 품목 정책 변경안 제출(ITEM_POLICY_EDIT). 행을 먼저 만들어 target_id로 쓰고, Task 2 '
  'core.request_approval(ITEM_POLICY)로 SCM팀장 승인을 요청한 뒤 승인ID를 연결한다(Task 5 ALLOC_PRIORITY · '
  'Task 8 EVENT_ORDER와 같은 방식)';


-- ══ 3. ITEM_POLICY 승인 요청 가드 ═══════════════════════════════
--
-- 승인대기 확보 없이 만든 우선 배정 승인과 같은 이유다 — core.request_item_policy_change가 만든
-- 대기 변경안 없이 ITEM_POLICY 승인을 직접 만들면 승인해도 반영할 대상이 없다.

create or replace function core.guard_item_policy_approval_request()
returns trigger
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
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

drop trigger if exists item_policy_request_guard on core.approval_request;
create trigger item_policy_request_guard
  before insert on core.approval_request
  for each row execute function core.guard_item_policy_approval_request();


-- ══ 4. ITEM_POLICY 승인 후처리 — 운영값 반영은 여기서만 ═══════
--
-- Task 2의 core.decide_approval이 승인 상태를 바꾸는 같은 트랜잭션에서 아래 트리거가 실행된다.
-- decide_approval을 다시 정의하지 않는다(Task 5 · 8과 같은 방식).

create or replace function core.apply_item_policy_decision()
returns trigger
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_revision core.item_policy_revision%rowtype;
  v_policy_before core.item_policy%rowtype;
  v_before jsonb;
  v_after jsonb;
begin
  if new.approval_type <> 'ITEM_POLICY' or old.status <> 'PENDING' or new.status not in ('APPROVED', 'REJECTED') then
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
      'title', case new.status when 'APPROVED' then '품목 정책 변경이 승인되었습니다' else '품목 정책 변경이 반려되었습니다' end,
      'message', format(
        '품목 %s · 결과 %s · 팀장 의견: %s',
        v_revision.item_id,
        case new.status when 'APPROVED' then '승인(운영값 반영)' else '반려(운영값 유지)' end,
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

drop trigger if exists item_policy_decision_apply on core.approval_request;
create trigger item_policy_decision_apply
  after update of status on core.approval_request
  for each row
  when (new.approval_type = 'ITEM_POLICY' and old.status = 'PENDING' and new.status <> 'PENDING')
  execute function core.apply_item_policy_decision();


-- ══ 5. 승인 전 직접 쓰기 차단을 나머지 운영값까지 넓힌다 ═══════
--
-- Task 1(20260911000300)이 target_dos_days · allocation_mode 두 컬럼만 authenticated 직접 쓰기를
-- 막았다. 이제 "품목담당자가 제출하고 팀장이 승인한 값만 운영값으로 반영한다"는 규칙을 나머지
-- 다섯 컬럼(목표재고 · 단가 · MOQ · 포장단위 · 최소주문금액)까지 넓힌다. item_grade · service_level ·
-- unit_price_basis는 stage1 승인 규칙 대상이 아니므로 계속 직접 쓸 수 있다.

revoke update on core.item_policy from authenticated;
grant update (item_grade, service_level, unit_price_basis, updated_at) on core.item_policy to authenticated;

comment on column core.item_policy.target_stock_qty is
  '승인된 목표재고 운영값. authenticated 직접 쓰기 금지, core.request_item_policy_change + 승인 함수로만 변경합니다(Task 9a)';
comment on column core.item_policy.unit_price is
  '승인된 단가 운영값. authenticated 직접 쓰기 금지, core.request_item_policy_change + 승인 함수로만 변경합니다(Task 9a)';
comment on column core.item_policy.moq is
  '승인된 최소주문수량 운영값. 미설정이면 계산에서 1로 봅니다(stage1 §7). authenticated 직접 쓰기 금지(Task 9a)';
comment on column core.item_policy.pack_size is
  '승인된 포장단위. ★ 현재 발주 계산에 적용하지 않습니다(저장 · 표시만). authenticated 직접 쓰기 금지(Task 9a)';
comment on column core.item_policy.min_order_amount is
  '승인된 최소주문금액. ★ 현재 발주 계산에 적용하지 않습니다(저장 · 표시만). authenticated 직접 쓰기 금지(Task 9a)';


-- ══ 6. analytics.v_item_policy 재정의 — target_dos_approved ════
--
-- ★ order_blocked · reason_code를 "값이 비어 있는가"가 아니라 "승인 이력이 있는가"로 다시
--   정의한다. 이 마이그레이션 전에 이미 값이 들어 있던 행이 있어도 승인 이력이 없으면 여전히
--   차단이다(컨트롤러 판정 5 — 승인을 임의로 만들지 않는다).

-- ★ create or replace view는 기존 컬럼을 같은 이름·순서로 유지해야 한다(중간에 끼워 넣으면
--   "rename column" 오류가 난다) — target_dos_approved는 기존 컬럼 뒤(맨 끝)에 추가한다.
create or replace view analytics.v_item_policy as
select p.item_id,
       p.target_dos_days, p.allocation_mode, p.target_stock_qty,
       p.unit_price, p.unit_price_basis,
       p.moq, p.pack_size, p.min_order_amount, p.item_grade, p.service_level,
       p.updated_at,
       coalesce(p.moq, 1) as effective_moq,
       not exists (
         select 1 from core.item_policy_revision r
          where r.item_id = p.item_id and r.status = 'APPROVED' and r.proposed_target_dos_days is not null
       ) as order_blocked,
       case when not exists (
         select 1 from core.item_policy_revision r
          where r.item_id = p.item_id and r.status = 'APPROVED' and r.proposed_target_dos_days is not null
       ) then 'TARGET_DOS_UNSET' end as reason_code,
       exists (
         select 1 from core.item_policy_revision r
          where r.item_id = p.item_id and r.status = 'APPROVED' and r.proposed_target_dos_days is not null
       ) as target_dos_approved
  from core.item_policy p;

comment on view analytics.v_item_policy is
  'Task 9a — target_dos_approved · order_blocked는 target_dos_days의 존재가 아니라 승인된 '
  'core.item_policy_revision 이력의 존재로 판정한다(Task 9b가 order_blocked로 발주 확정을 막는다)';


-- ══ 7. analytics.v_item_policy_revision ═════════════════════════

create or replace view analytics.v_item_policy_revision
with (security_invoker = true)
as
select
  r.revision_id, r.item_id, im.item_name,
  r.proposed_target_dos_days, r.proposed_allocation_mode, r.proposed_target_stock_qty,
  r.proposed_unit_price, r.proposed_moq, r.proposed_pack_size, r.proposed_min_order_amount,
  r.previous_target_dos_days, r.previous_allocation_mode, r.previous_target_stock_qty,
  r.previous_unit_price, r.previous_moq, r.previous_pack_size, r.previous_min_order_amount,
  r.reason, r.requested_by, r.requester_name, r.requested_at,
  r.approval_id, r.status,
  r.decided_by, r.decider_name, r.decided_at, r.decision_comment
from core.item_policy_revision r
left join core.v_item_master im on im.item_id = r.item_id;

comment on view analytics.v_item_policy_revision is
  'Task 9a — 품목 정책 변경 요청 이력(대기 · 승인 · 반려). security_invoker로 core.item_policy_revision의 RLS를 그대로 적용한다';


-- ══ 8. RLS와 실행 권한 ═══════════════════════════════════════

alter table core.item_policy_revision enable row level security;

drop policy if exists item_policy_revision_read_related on core.item_policy_revision;
create policy item_policy_revision_read_related
  on core.item_policy_revision
  for select
  to authenticated
  using (
    requested_by = auth.uid()
    or decided_by = auth.uid()
    or core.has_permission('ITEM_POLICY_EDIT')
    or core.has_permission('ITEM_POLICY_APPROVE')
  );

revoke all on core.item_policy_revision from anon, public;
revoke insert, update, delete on core.item_policy_revision from authenticated;
grant select on core.item_policy_revision to authenticated;
grant select on analytics.v_item_policy_revision to authenticated;
grant select on analytics.v_item_policy to authenticated;

revoke all on function core.request_item_policy_change(text, numeric, text, numeric, numeric, numeric, numeric, numeric, text) from public, anon;
grant execute on function core.request_item_policy_change(text, numeric, text, numeric, numeric, numeric, numeric, numeric, text) to authenticated;
revoke all on function core.guard_item_policy_approval_request() from public, anon, authenticated;
revoke all on function core.apply_item_policy_decision() from public, anon, authenticated;


-- ══ 9. 수동 적용 후 확인 쿼리 ═══════════════════════════════

select item_id, target_dos_days, allocation_mode, target_dos_approved, order_blocked, reason_code
from analytics.v_item_policy
order by item_id;
-- 기대: 이 마이그레이션 이전부터 target_dos_days가 채워져 있던 품목도 target_dos_approved=false ·
--       order_blocked=true (승인 이력이 없으면 값이 있어도 승인된 것으로 보지 않는다)

select grantee, privilege_type, column_name
from information_schema.column_privileges
where table_schema = 'core' and table_name = 'item_policy' and grantee = 'authenticated' and privilege_type = 'UPDATE'
order by column_name;
-- 기대: item_grade, service_level, unit_price_basis, updated_at 네 컬럼만 나와야 함

select revision_id, item_id, status, approval_id
from core.item_policy_revision
order by requested_at desc;

-- 아래 실패 검증은 SQL Editor에서 SCM 품목담당자와 SCM팀장의 실제 UUID를 넣고 각각 실행합니다.
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claim.sub', '<SCM 품목담당자 UUID>', true);
-- select core.request_item_policy_change('ITEM001', 30, 'AUTO', null, null, null, null, null, '테스트');
-- rollback;
-- 1) ITEM_POLICY_EDIT 권한 없는 사용자 → SQLSTATE 42501
-- 2) 같은 품목에 대기 중인 변경안이 있는 상태에서 다시 요청 → "이미 처리 대기 중인 품목 정책 변경안이 있습니다."
-- 3) 요청자 본인 UUID로 core.decide_approval(...) → "자신이 요청한 승인은 직접 결정할 수 없습니다."(Task 2)
