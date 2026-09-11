-- Task 1 · 현재 기반 고정 및 상충 정의 차단
--
-- 이 마이그레이션은 STEP 18·19를 stage1 운영 전환의 출발점으로 고정합니다.
-- 실제 Supabase 적용은 사용자가 SQL Editor에서 수동으로 수행합니다.

-- ══ 1. 사용자별 analytics 운영 뷰의 공통 보안 규칙 ═══════════
--
-- ★ 앞으로 사용자·부서·담당 품목에 따라 행이 달라지는 analytics 뷰는 반드시
--   `with (security_invoker = true)`로 생성합니다. 뷰 소유자 권한으로 기초 테이블의
--   RLS를 우회하지 말고, authenticated 호출자의 RLS 결과만 보여야 합니다.
-- ★ 전체 공통 기준만 보여 주는 뷰에도 가능하면 같은 옵션을 사용해 기본값을 안전하게 둡니다.

alter view if exists analytics.v_permission_matrix set (security_invoker = true);
alter view if exists analytics.v_user_access set (security_invoker = true);

comment on view analytics.v_user_access is
  'STEP 19 계정별 시스템·업무 권한. security_invoker로 호출자 RLS를 그대로 적용합니다';


-- ══ 2. 승인 전 품목 정책의 운영값 직접 변경 차단 ═════════════
--
-- target_dos_days와 allocation_mode는 승인된 운영값입니다. Task 2 이후 변경안은
-- 승인 요청 payload에 초안으로 저장하고, 승인 함수만 이 두 컬럼에 반영합니다.
-- 지금은 authenticated의 테이블 단위 쓰기 권한을 회수한 뒤 보호 컬럼을 제외한
-- 기존 행의 컬럼별 UPDATE 권한만 다시 부여합니다. 따라서 REST·앱에서 보호 컬럼을
-- 직접 지정하거나, 행 삭제 후 기본값으로 재삽입해 승인 절차를 우회할 수 없습니다.
-- 기존 승인값은 삭제하거나 기본값으로 덮어쓰지 않습니다.

revoke insert, update, delete on core.item_policy from authenticated;

grant update (
  moq, pack_size, item_grade, service_level, updated_at,
  target_stock_qty, unit_price, unit_price_basis, min_order_amount
) on core.item_policy to authenticated;

comment on column core.item_policy.target_dos_days is
  '승인된 목표 DoS 운영값. authenticated 직접 쓰기 금지, 승인 함수로만 변경합니다';
comment on column core.item_policy.allocation_mode is
  '승인된 배정 방식 운영값. authenticated 직접 쓰기 금지, 승인 함수로만 변경합니다';


-- ══ 3. 적용 후 확인 쿼리 ═════════════════════════════════════

select entity_id, entity_name, active
from core.supply_entity
where active
order by entity_id;
-- 기대: CN, JP, NL, SG, VN 5행

select job_role, count(*)
from core.role_permission
group by job_role
order by job_role;
-- 기대: 정의된 6개 직책 모두 1개 이상의 권한

select c.relname, c.reloptions
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'analytics'
  and c.relname in ('v_permission_matrix', 'v_user_access')
order by c.relname;
-- 기대: 두 뷰 모두 reloptions에 security_invoker=true

select grantee, privilege_type, column_name
from information_schema.column_privileges
where table_schema = 'core'
  and table_name = 'item_policy'
  and grantee = 'authenticated'
  and privilege_type in ('INSERT', 'UPDATE')
order by privilege_type, column_name;
-- 기대: target_dos_days, allocation_mode가 결과에 없어야 함

select grantee, privilege_type
from information_schema.table_privileges
where table_schema = 'core'
  and table_name = 'item_policy'
  and grantee = 'authenticated'
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
order by privilege_type;
-- 기대: 0행. UPDATE는 위 column_privileges에 허용 컬럼만 있어야 함
