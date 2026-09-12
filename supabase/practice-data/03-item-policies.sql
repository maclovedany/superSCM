-- 실습 데이터 3 · 품목 정책 — 승인 절차를 그대로 거쳐서 설정
--
-- ★ core.item_policy의 운영값(목표 DoS · 단가 · MOQ · 목표재고)은 **직접 쓸 수 없습니다.** Task 9a가
--   authenticated의 직접 UPDATE를 회수했고, 값은 core.decide_approval(ITEM_POLICY) 트랜잭션 안에서만
--   반영됩니다. 그래서 이 스크립트도 우회하지 않고 진짜 절차를 밟습니다:
--     SCM 품목담당자가 요청(core.request_item_policy_change) → SCM팀장이 승인(core.decide_approval)
--   요청자 ≠ 승인자 규칙도 그대로 지킵니다(서로 다른 실습 계정으로 실행합니다).
--
-- ★ 이렇게 해야 analytics.v_item_policy의 approved_* 열이 채워집니다. 표에 직접 INSERT하면 값은
--   보이지만 "승인된 적 없음"으로 판정되어 발주 확정이 계속 차단됩니다(Task 9b 판정 3).
--
-- ★ core.item_policy의 **최초 행**은 authenticated가 만들 수 없어 여기서 직접 넣습니다(운영에서도
--   이 표의 첫 행은 관리 도구로 만듭니다). 그 행에는 승인이 필요한 값(목표 DoS · 단가 · MOQ)을
--   **넣지 않습니다.** 전부 승인으로 채웁니다.
--
-- ★★ fix round 1 (C1) — 이전 판은 루프 **안**에서만 request.jwt.claim.sub를 설정해, 새 SQL Editor
--    세션에서 첫 core.register_practice_object 호출이 auth.uid() = null → 42501로 파일 전체를
--    롤백시켰습니다. 세션이 이어져 있어도 1회차 끝에 claim이 SCM팀장(role USER)으로 남아 2회차가
--    같은 이유로 실패했습니다. 이제 **파일 맨 위에서 ADMIN claim을 설정**하고, 승인 직후 다음
--    레지스트리 호출 전에 ADMIN claim을 되돌립니다.
--
-- MOQ 시연 — seq 3 품목의 MOQ를 50으로 둡니다. stage1 §7의 "필요량 120 · MOQ 50 → 150" 규칙이
-- 발주계획 라인에서 실제로 올림되는 것을 볼 수 있습니다(규칙 자체의 손검산은 08-verify.sql).

\set ON_ERROR_STOP on

do $$
declare
  v_admin   uuid;   -- 레지스트리 등기 · 정책 최초 행 — ADMIN 필요
  v_planner uuid;   -- SCM 품목담당자 — ITEM_POLICY_EDIT
  v_lead    uuid;   -- SCM팀장       — ITEM_POLICY_APPROVE
  v_label   text := 'PRACTICE-2026-09';
  v_item    record;
  v_revision uuid;
  v_approval uuid;
  v_dos     numeric;
  v_price   numeric;
  v_moq     numeric;
  v_target  numeric;
  v_done    integer := 0;
  v_skipped integer := 0;
begin
  select user_id into v_admin   from core.app_user where email = 'insightdany@naver.com' and active and role = 'ADMIN';
  select user_id into v_planner from core.app_user where email = 'insightdany@naver.com' and active;
  select user_id into v_lead    from core.app_user where email = 'upflash@naver.com'     and active;
  if v_admin is null then
    raise exception '실습 관리자(ADMIN) 계정을 찾을 수 없습니다(docs/stage1-supabase-수동적용.md §9).';
  end if;
  if v_planner is null or v_lead is null then
    raise exception 'SCM 품목담당자 · SCM팀장 실습 계정을 찾을 수 없습니다(docs/stage1-supabase-수동적용.md §9).';
  end if;
  if v_planner = v_lead then
    raise exception '요청자와 승인자가 같습니다 — 승인 절차를 그대로 거칠 수 없습니다.';
  end if;

  -- ★ 맨 위에서 ADMIN claim을 세웁니다. 아래 어떤 등기 호출도 이 값에 의존합니다.
  perform set_config('request.jwt.claim.sub', v_admin::text, false);

  -- ── 순서 가드(fix round 1 · I2) ──────────────────────────────────
  if not exists (select 1 from core.practice_dataset where label = v_label and active) then
    raise exception '열려 있는 실습 묶음(%)이 없습니다. 00-open-dataset.sql을 먼저 실행하세요.', v_label;
  end if;
  if not exists (select 1 from core.practice_object where object_kind = 'ITEM') then
    raise exception '등기된 실습 품목이 없습니다. 02-items.sql을 먼저 실행하세요.';
  end if;

  for v_item in
    select o.object_key as item_id, substring(o.note from 'seq:([0-9]+)')::int as seq
      from core.practice_object o
     where o.object_kind = 'ITEM' and substring(o.note from 'seq:([0-9]+)')::int <= 10
     order by seq
  loop
    -- 이미 승인된 품목은 건너뜁니다(재실행 안전).
    if exists (
      select 1 from core.item_policy_revision r
       where r.item_id = v_item.item_id and r.status = 'APPROVED' and r.proposed_target_dos_days is not null
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- 승인이 필요 없는 부가 값만 담은 최초 행. (ADMIN claim 상태)
    insert into core.item_policy (item_id, item_grade, service_level)
    values (v_item.item_id, case when v_item.seq <= 3 then 'A' when v_item.seq <= 7 then 'B' else 'C' end, 0.95)
    on conflict (item_id) do nothing;
    perform core.register_practice_object(v_label, 'ITEM_POLICY', v_item.item_id, 'seq:' || v_item.seq);

    -- 품목마다 다른 값 — 화면에서 목표 DoS · 단가 · MOQ의 효과가 눈에 보이게 합니다.
    v_dos    := case when v_item.seq <= 3 then 30 when v_item.seq <= 7 then 45 else 20 end;
    v_price  := 1000 * v_item.seq + 500;
    v_moq    := case v_item.seq when 3 then 50 when 6 then 100 when 9 then 10 else null end;
    v_target := 200 * v_item.seq;

    -- ── 요청: SCM 품목담당자 ────────────────────────────────────
    perform set_config('request.jwt.claim.sub', v_planner::text, false);
    v_revision := core.request_item_policy_change(
      v_item.item_id, v_dos, 'AUTO', v_target, v_price, v_moq, null, null,
      '[실습용 ' || v_label || '] 수업 시연용 품목 정책 설정'
    );

    -- 등기는 ADMIN만 할 수 있습니다 — claim을 되돌린 뒤 호출합니다.
    perform set_config('request.jwt.claim.sub', v_admin::text, false);
    perform core.register_practice_object(v_label, 'ITEM_POLICY_REVISION', v_revision::text, 'seq:' || v_item.seq);

    select approval_id into v_approval from core.item_policy_revision where revision_id = v_revision;

    -- ── 승인: SCM팀장 ──────────────────────────────────────────
    perform set_config('request.jwt.claim.sub', v_lead::text, false);
    perform core.decide_approval(v_approval, 'APPROVED', '[실습용] 수업 시연용 승인');

    -- ★ 다음 회차의 등기 호출을 위해 반드시 ADMIN claim으로 되돌립니다(C1의 원인이던 지점).
    perform set_config('request.jwt.claim.sub', v_admin::text, false);

    v_done := v_done + 1;
  end loop;

  if v_done = 0 and v_skipped = 0 then
    raise exception '처리한 품목이 없습니다 — 등기된 실습 품목(seq 1~10)을 찾지 못했습니다. 02-items.sql을 확인하세요.';
  end if;
  raise notice '품목 정책 — 신규 요청·승인 %건 · 이미 승인되어 건너뜀 %건', v_done, v_skipped;
end $$;

-- 확인 — 승인 경로를 거쳤으므로 approved_* 열이 채워지고 order_blocked가 false여야 합니다.
select ip.item_id, ip.approved_target_dos_days, ip.approved_unit_price, ip.approved_moq,
       ip.approved_effective_moq, ip.approved_target_stock_qty, ip.target_dos_approved, ip.order_blocked
  from analytics.v_item_policy ip
  join core.practice_object o on o.object_kind = 'ITEM' and o.object_key = ip.item_id
 order by substring(o.note from 'seq:([0-9]+)')::int;
-- 기대: 10행, target_dos_approved = true, order_blocked = false, approved_unit_price 전부 not null.
--       MOQ가 50인 품목이 1개(seq 3) 있어야 합니다.

select count(*) as pending_left from core.item_policy_revision where status = 'PENDING';
-- 기대: 0 (전부 승인 처리됨)
