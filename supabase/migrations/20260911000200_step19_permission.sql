-- STEP 19 · Phase 2 — 부서와 직책 권한
--
-- refactor.md Phase 2. ADMIN/USER 위에 업무 권한을 올립니다.
--
-- ★ 기존 core.app_user.role(ADMIN·USER)은 **시스템 관리 권한**으로 그대로 둡니다.
--   부서·직책은 그 위에 얹는 **업무 권한**입니다. 둘은 다른 축입니다.
--     role      화면과 마이그레이션을 만질 수 있는가
--     job_role  발주 업무에서 무엇을 할 수 있는가
--   하나로 합치면 "관리자인데 승인 권한은 없는 사람" 을 표현할 수 없습니다.
--
-- ★ 권한은 화면에서 메뉴를 숨기는 것으로 끝나지 않습니다 (gap.md 6.4).
--   core.has_permission() 을 RLS 정책과 서버가 **같이** 씁니다. 판정이 한 곳에 있어야
--   화면과 DB 의 답이 갈라지지 않습니다.
--
-- 다시 실행해도 안전합니다.


-- ══ 1. 사용자에 부서·직책 ═════════════════════════════════════

alter table core.app_user add column if not exists job_role text;

comment on column core.app_user.department is
  '소속 부서 — SCM · MARKETING · SALES · SERVICE · BIZ_DEV';
comment on column core.app_user.job_role is
  '업무 직책 — 권한은 이 값으로 결정됩니다. role(ADMIN·USER)과 다른 축입니다';


-- ══ 2. 권한 코드 ══════════════════════════════════════════════

create table if not exists core.permission (
  permission_code text primary key,
  description     text not null,
  domain          text not null,
  created_at      timestamptz not null default now()
);

insert into core.permission (permission_code, description, domain) values
  ('ORDER_CREATE',            '주문 등록',                        'ORDER'),
  ('ORDER_REVIEW_REQUEST',    '검토 요청 등록 (임시배정 발생)',   'ORDER'),
  ('ATP_VIEW',                '실제 주문 가능 수량 조회',         'ORDER'),
  ('ALLOC_VIEW',              '재고 배정 조회',                   'ALLOC'),
  ('ALLOC_PRIORITY_EDIT',     '배정 우선순위 변경',               'ALLOC'),
  ('ALLOC_PRIORITY_APPROVE',  '순서를 건너뛴 우선 배정 승인',     'ALLOC'),
  ('ALLOC_MANUAL',            '수동 배정 요청',                   'ALLOC'),
  ('ALLOC_FIRM_CANCEL',       '확정배정 취소·해제',               'ALLOC'),
  ('ITEM_POLICY_EDIT',        '품목 정책 설정',                   'POLICY'),
  ('ITEM_POLICY_APPROVE',     '품목 정책 승인',                   'POLICY'),
  ('DEMAND_SUBMIT',           '부서 월간 수요 제출',              'DEMAND'),
  ('DEMAND_CONSOLIDATE',      '수요 취합·표준화',                 'DEMAND'),
  ('SUPPLY_MEETING_INPUT',    '수급회의 결과 대리 입력',          'DEMAND'),
  ('EVENT_ORDER_APPROVE',     '이벤트성 추가 발주 승인',          'DEMAND'),
  ('PLAN_CONFIRM',            '최종 발주량 확정',                 'PLAN'),
  ('PLAN_APPROVE',            '최종 발주량 승인',                 'PLAN'),
  ('STOCK_VIEW_ALL',          '전체 재고 조회',                   'STOCK'),
  ('STOCK_VIEW_PAPER',        '용지·카드리더기 재고 조회',        'STOCK'),
  ('STOCK_VIEW_SUPPLY',       '소모품 재고 조회',                 'STOCK'),
  ('URGENT_ORDER_VIEW',       '긴급발주 현황 조회',               'STOCK')
on conflict (permission_code) do nothing;


-- ══ 3. 직책 → 권한 ════════════════════════════════════════════
--
-- stage1 §2 · §9 와 gap.md 6.4 의 표를 그대로 옮긴 것입니다.

create table if not exists core.role_permission (
  job_role        text not null,
  permission_code text not null references core.permission(permission_code) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (job_role, permission_code)
);

insert into core.role_permission (job_role, permission_code) values
  -- 영업담당자
  ('SALES_REP',      'ORDER_CREATE'),
  ('SALES_REP',      'ORDER_REVIEW_REQUEST'),
  ('SALES_REP',      'ATP_VIEW'),
  -- SCM 품목담당자
  ('SCM_PLANNER',    'ITEM_POLICY_EDIT'),
  ('SCM_PLANNER',    'ALLOC_MANUAL'),
  ('SCM_PLANNER',    'ALLOC_FIRM_CANCEL'),
  ('SCM_PLANNER',    'ALLOC_VIEW'),
  ('SCM_PLANNER',    'PLAN_CONFIRM'),
  ('SCM_PLANNER',    'STOCK_VIEW_ALL'),
  ('SCM_PLANNER',    'DEMAND_CONSOLIDATE'),
  ('SCM_PLANNER',    'SUPPLY_MEETING_INPUT'),
  ('SCM_PLANNER',    'ATP_VIEW'),
  -- SCM팀장 — 승인 권한. ★ 확정과 승인을 같은 사람이 하지 않습니다 (stage1 §9)
  ('SCM_LEAD',       'ITEM_POLICY_APPROVE'),
  ('SCM_LEAD',       'ALLOC_PRIORITY_APPROVE'),
  ('SCM_LEAD',       'PLAN_APPROVE'),
  ('SCM_LEAD',       'EVENT_ORDER_APPROVE'),
  ('SCM_LEAD',       'ALLOC_VIEW'),
  ('SCM_LEAD',       'STOCK_VIEW_ALL'),
  ('SCM_LEAD',       'ATP_VIEW'),
  -- 사업강화부
  ('BIZ_DEV',        'ALLOC_VIEW'),
  ('BIZ_DEV',        'ALLOC_PRIORITY_EDIT'),
  -- 마케팅부
  ('MARKETING',      'STOCK_VIEW_PAPER'),
  ('MARKETING',      'DEMAND_SUBMIT'),
  -- 서비스부
  ('SERVICE',        'STOCK_VIEW_SUPPLY'),
  ('SERVICE',        'URGENT_ORDER_VIEW'),
  ('SERVICE',        'DEMAND_SUBMIT')
on conflict (job_role, permission_code) do nothing;


-- ══ 4. 판정 함수 ★ ════════════════════════════════════════════
--
-- 화면 · 서버 · RLS 가 **모두 이 함수 하나**를 씁니다.
-- 판정이 두 곳에 있으면 언젠가 두 답이 갈라지고, 그때 열리는 쪽이 사고가 됩니다.

create or replace function core.has_permission(p_code text, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = core, public, pg_temp
as $$
  select exists (
    select 1
      from core.app_user u
      join core.role_permission rp on rp.job_role = u.job_role
     where u.user_id = p_user
       and u.active
       and rp.permission_code = p_code
  );
$$;

comment on function core.has_permission(text, uuid) is
  '업무 권한 판정. ★ 비활성 계정은 직책이 있어도 false 입니다 — 퇴사자의 승인 권한이 남으면 안 됩니다';

/** 이 사용자가 가진 권한 코드 전부. 화면이 메뉴를 고를 때 한 번에 받아 갑니다 */
create or replace function core.my_permissions(p_user uuid default auth.uid())
returns table (permission_code text)
language sql
stable
security definer
set search_path = core, public, pg_temp
as $$
  select rp.permission_code
    from core.app_user u
    join core.role_permission rp on rp.job_role = u.job_role
   where u.user_id = p_user and u.active
   order by rp.permission_code;
$$;


-- ══ 5. 조회 뷰 ════════════════════════════════════════════════

create or replace view analytics.v_permission_matrix as
select rp.job_role, p.domain, p.permission_code, p.description
  from core.role_permission rp
  join core.permission p on p.permission_code = rp.permission_code;

create or replace view analytics.v_user_access as
select u.user_id, u.email, u.name, u.department, u.job_role, u.role, u.active,
       (select count(*) from core.role_permission rp where rp.job_role = u.job_role) as n_permissions,
       -- 직책이 없으면 업무 권한이 하나도 없습니다. 화면이 이것을 눈에 띄게 보여야 합니다.
       case when u.job_role is null then 'JOB_ROLE_UNSET'
            when not exists (select 1 from core.role_permission rp where rp.job_role = u.job_role)
                 then 'JOB_ROLE_UNKNOWN' end as reason_code
  from core.app_user u;

comment on view analytics.v_user_access is
  'Phase 2 — 계정별 시스템 권한(role)과 업무 권한(job_role)을 함께 봅니다';


-- ══ 6. 권한 ═══════════════════════════════════════════════════

alter table core.permission      enable row level security;
alter table core.role_permission enable row level security;

drop policy if exists permission_read      on core.permission;
drop policy if exists role_permission_read on core.role_permission;
create policy permission_read      on core.permission      for select to authenticated using (true);
create policy role_permission_read on core.role_permission for select to authenticated using (true);

do $admin_policy$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'core' and p.proname = 'is_admin') then
    drop policy if exists permission_write      on core.permission;
    drop policy if exists role_permission_write on core.role_permission;
    execute 'create policy permission_write on core.permission
               for all to authenticated using (core.is_admin()) with check (core.is_admin())';
    execute 'create policy role_permission_write on core.role_permission
               for all to authenticated using (core.is_admin()) with check (core.is_admin())';
  else
    raise notice 'core.is_admin() 이 없습니다 — 관리자 쓰기 정책을 건너뜁니다';
  end if;
end;
$admin_policy$;

grant select on core.permission, core.role_permission to authenticated;
grant insert, update, delete on core.permission, core.role_permission to authenticated;
grant select on analytics.v_permission_matrix, analytics.v_user_access to authenticated;
grant execute on function core.has_permission(text, uuid) to authenticated;
grant execute on function core.my_permissions(uuid) to authenticated;
revoke all on core.permission, core.role_permission from anon, public;


-- ══ 7. Phase 1 마스터의 쓰기 정책을 업무 권한으로 교체 ═════════
--
-- Phase 1 에서는 "관리자만 쓰기" 였습니다. 이제 품목 정책은 SCM 품목담당자가 씁니다.
-- ★ 관리자는 여전히 통과합니다. 시스템 관리자가 막히면 운영을 할 수 없습니다.

do $master_policy$
begin
  if to_regclass('core.item_policy') is not null then
    alter table core.item_policy enable row level security;
    drop policy if exists item_policy_read  on core.item_policy;
    drop policy if exists item_policy_write on core.item_policy;
    execute 'create policy item_policy_read on core.item_policy
               for select to authenticated using (true)';
    execute 'create policy item_policy_write on core.item_policy
               for all to authenticated
               using (core.has_permission(''ITEM_POLICY_EDIT'') or core.is_admin())
               with check (core.has_permission(''ITEM_POLICY_EDIT'') or core.is_admin())';
  end if;
end;
$master_policy$;

grant select, insert, update, delete on core.item_policy to authenticated;


-- ══ 8. 확인 ═══════════════════════════════════════════════════

select job_role, count(*) as n_permissions
  from core.role_permission group by job_role order by job_role;
-- 기대: BIZ_DEV 2 · MARKETING 2 · SALES_REP 3 · SCM_LEAD 7 · SCM_PLANNER 9 · SERVICE 3

select p.domain, count(*) from core.permission p group by 1 order by 1;
