-- 관리자 계정 관리 — refactor_260911.md "Admin account management" 작업
--
-- 배경. 배포된 운영 Supabase에는 계정이 insightdany@naver.com(ADMIN) 하나뿐이고 job_role·
-- department가 비어 있다. 여섯 개 업무 직책(STEP 19)을 실제로 시연하려면 관리자가 화면에서
-- 계정을 만들고 없앨 수 있어야 한다. 지금까지는 core.app_user.role·active만 직접 UPDATE로
-- 바꿀 수 있었고(STEP 2), job_role·department는 core.app_user 컬럼만 있을 뿐 편집 경로가
-- 없었다(STEP 19는 조회 뷰만 두었다) — 계정 자체를 새로 만들거나 지우는 경로도 없었다.
--
-- ★ Supabase Auth 사용자(auth.users)는 이 마이그레이션이 만들지 않는다. Admin API
--   (auth.admin.createUser · auth.admin.deleteUser)는 SQL에서 부를 수 없고 반드시 secret key를
--   쓰는 서버 코드(lib/supabase/admin.ts)가 호출한다. 이 파일은 core.app_user "프로필" 쪽만
--   맡는다 — 생성 뒤 최종 role·job_role·department를 확정하고(auth.users 트리거가 만든 기본
--   USER 행을 덮어쓴다), 활성 여부를 바꾸고, 완전 삭제 전 업무 이력 참조를 확인한다.
-- ★ 판정은 여기(security definer 함수) 한 곳에서 한다. 화면(app/(admin)/admin/users)은
--   그 결과를 그대로 보여줄 뿐이다 — STEP 19 core.has_permission()과 같은 이유다.
-- ★ 자기 자신의 관리자 권한 해제·비활성화는 core.protect_self_admin_change()(STEP 2)가 이미
--   막는다. 이 파일의 함수들은 그 트리거보다 먼저(더 친절한 문구로) 같은 조건을 확인한다 —
--   레이어를 하나 더 둘 뿐 트리거를 대신하지 않는다.
-- ★ 완전 삭제는 core.app_user 행만 지운다. auth.users 삭제는 서버가 그 다음에 Admin API로
--   한다 — 순서를 이렇게 둔 이유는 아래 §3 완전 삭제 함수 주석 참고.
--
-- 다시 실행해도 안전합니다. 실제 Supabase 적용은 사용자가 SQL Editor에서 수동으로 수행합니다.


-- ══ 1. job_role · department 값 검증 ══════════════════════════
--
-- STEP 19가 정의한 값(core.role_permission의 job_role, lib/permission.ts의 DEPARTMENTS)만
-- 허용한다. 여기서 새 값을 지어내지 않는다 — 늘리려면 STEP 19를 다시 열어 권한 표부터 정한다.

alter table core.app_user drop constraint if exists app_user_job_role_chk;
alter table core.app_user add constraint app_user_job_role_chk
  check (job_role is null or job_role in ('SALES_REP', 'SCM_PLANNER', 'SCM_LEAD', 'BIZ_DEV', 'MARKETING', 'SERVICE'));

alter table core.app_user drop constraint if exists app_user_department_chk;
alter table core.app_user add constraint app_user_department_chk
  check (department is null or department in ('SCM', 'SALES', 'MARKETING', 'SERVICE', 'BIZ_DEV'));


-- ══ 2. 업무 이력 참조 확인 ═══════════════════════════════════════
--
-- "완전 삭제는 업무 이력(주문·승인·제출·감사기록…)이 있으면 거절한다"를 표 이름을 나열하지
-- 않고 구현한다. auth.users(id)를 단일 컬럼 FK로 참조하는 모든 표를 pg_constraint에서 훑는다 —
-- 표를 나열하면 새 업무 표가 생길 때마다 이 함수를 잊지 않고 고쳐야 하고, 잊으면 이력이 있는
-- 계정도 조용히 삭제된다. ON DELETE 절이 RESTRICT든 SET NULL이든(core.audit_log.actor는
-- SET NULL) 참조가 있으면 똑같이 막는다 — audit_log는 SET NULL이라 DB가 스스로는 삭제를
-- 막지 않지만, 감사 기록도 "업무 이력"이라 여기서는 막아야 한다.
create or replace function core.app_user_blocking_tables(p_user_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_conref record;
  v_referenced boolean;
  v_result text[] := array[]::text[];
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;

  for v_conref in
    select con.conrelid::regclass::text as table_name, att.attname as column_name
      from pg_constraint con
      join pg_attribute att
        on att.attrelid = con.conrelid
       and att.attnum = con.conkey[1]
     where con.contype = 'f'
       and con.confrelid = 'auth.users'::regclass
       and array_length(con.conkey, 1) = 1
       and con.conrelid <> 'core.app_user'::regclass
     order by 1, 2
  loop
    execute format('select exists (select 1 from %s where %I = $1)', v_conref.table_name, v_conref.column_name)
      into v_referenced
      using p_user_id;
    if v_referenced then
      v_result := array_append(v_result, v_conref.table_name || '.' || v_conref.column_name);
    end if;
  end loop;

  return v_result;
end;
$$;

comment on function core.app_user_blocking_tables(uuid) is
  'ADMIN 전용. auth.users(id)를 참조하는 모든 표를 훑어 이 계정을 쓴 곳을 돌려준다(빈 배열이면 완전 삭제 가능). '
  '화면이 완전 삭제 버튼을 미리 비활성화하는 데도, 삭제 함수가 최종 확인하는 데도 이 함수 하나를 쓴다.';


-- ══ 3. 계정 프로필 생성·수정 ══════════════════════════════════════
--
-- auth.users에 새 사용자가 생기면 core.handle_new_auth_user()(STEP 2) 트리거가 role=USER ·
-- active=true인 기본 프로필을 이미 넣어 둔다. 이 함수는 그 행을 관리자가 고른 최종 값(ADMIN도
-- 가능한 role · job_role · department · name)으로 덮어쓰거나, 기존 계정을 편집한다 — 하나의
-- 함수가 "생성 뒤 확정"과 "편집"을 모두 맡는다(둘 다 결국 upsert다).
create or replace function core.admin_upsert_app_user_profile(
  p_user_id uuid,
  p_email text,
  p_name text,
  p_role text,
  p_job_role text,
  p_department text,
  p_active boolean,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_action text;
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception '대상 계정이 없습니다.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_email, '')), '') is null then
    raise exception '이메일은 필수입니다.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception '이름은 필수입니다.' using errcode = '22023';
  end if;
  if p_role not in ('ADMIN', 'USER') then
    raise exception '시스템 권한은 ADMIN 또는 USER 여야 합니다.' using errcode = '22023';
  end if;
  if p_job_role is not null and p_job_role not in ('SALES_REP', 'SCM_PLANNER', 'SCM_LEAD', 'BIZ_DEV', 'MARKETING', 'SERVICE') then
    raise exception '알 수 없는 업무 직책입니다: %', p_job_role using errcode = '22023';
  end if;
  if p_department is not null and p_department not in ('SCM', 'SALES', 'MARKETING', 'SERVICE', 'BIZ_DEV') then
    raise exception '알 수 없는 부서입니다: %', p_department using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception '변경 사유는 필수입니다.' using errcode = '22023';
  end if;
  -- core.protect_self_admin_change()가 UPDATE 시점에 다시 막지만(이 함수도 그 트리거를 그대로
  -- 통과한다), 여기서 먼저 분명한 한국어 문구로 거절한다. is_admin()을 통과했다는 것은 이미
  -- auth.uid()의 현재 role=ADMIN · active=true라는 뜻이므로 old 값을 다시 조회할 필요가 없다.
  if auth.uid() = p_user_id and p_role <> 'ADMIN' then
    raise exception '자신의 관리자 권한은 제거할 수 없습니다.' using errcode = '42501';
  end if;
  if auth.uid() = p_user_id and not coalesce(p_active, true) then
    raise exception '자신의 계정은 비활성화할 수 없습니다.' using errcode = '42501';
  end if;

  select to_jsonb(u) into v_before from core.app_user u where u.user_id = p_user_id;
  v_action := case when v_before is null then 'USER_CREATED' else 'USER_PROFILE_UPDATED' end;

  insert into core.app_user (user_id, email, name, department, job_role, role, active)
  values (p_user_id, p_email, p_name, p_department, p_job_role, p_role, coalesce(p_active, true))
  on conflict (user_id) do update
    set email = excluded.email,
        name = excluded.name,
        department = excluded.department,
        job_role = excluded.job_role,
        role = excluded.role,
        active = excluded.active,
        updated_at = now();

  select to_jsonb(u) into v_after from core.app_user u where u.user_id = p_user_id;
  v_after := coalesce(v_after, '{}'::jsonb) || jsonb_build_object('reason', p_reason);

  insert into core.audit_log (actor, action, target_type, target_id, before, after)
  values (auth.uid(), v_action, 'app_user', p_user_id::text, v_before, v_after);
end;
$$;

comment on function core.admin_upsert_app_user_profile(uuid, text, text, text, text, text, boolean, text) is
  'ADMIN 전용. 계정 생성 직후 최종 role·job_role·department·name을 확정하거나 기존 계정을 편집한다. '
  '자신의 role을 ADMIN에서 내리거나 자신을 비활성화하는 시도는 거절한다(core.protect_self_admin_change의 1차 방어).';


-- ══ 4. 활성·비활성 전환(빠른 버튼) ═════════════════════════════════
--
-- 화면의 "비활성화" 버튼 전용 — 다른 필드는 그대로 두고 active만 바꾸며, 감사 로그 action을
-- USER_DEACTIVATED/USER_REACTIVATED로 구체적으로 남긴다(core.audit_app_user_change 트리거가
-- 남기는 일반 USER_ACTIVE_CHANGED 행과 별개로, reason이 담긴 행이 하나 더 남는다 — 두 행이
-- 겹쳐도 해가 되지 않는다. 하나는 "무엇이 바뀌었나"의 표준 이력이고 하나는 "왜"를 담은 이력이다).
create or replace function core.admin_set_app_user_active(p_user_id uuid, p_active boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;
  if auth.uid() = p_user_id and not coalesce(p_active, true) then
    raise exception '자신의 계정은 비활성화할 수 없습니다.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception '변경 사유는 필수입니다.' using errcode = '22023';
  end if;

  select to_jsonb(u) into v_before from core.app_user u where u.user_id = p_user_id;
  if v_before is null then
    raise exception '대상 계정을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  update core.app_user set active = coalesce(p_active, true) where user_id = p_user_id;

  select to_jsonb(u) into v_after from core.app_user u where u.user_id = p_user_id;
  v_after := v_after || jsonb_build_object('reason', p_reason);

  insert into core.audit_log (actor, action, target_type, target_id, before, after)
  values (auth.uid(), case when coalesce(p_active, true) then 'USER_REACTIVATED' else 'USER_DEACTIVATED' end, 'app_user', p_user_id::text, v_before, v_after);
end;
$$;

comment on function core.admin_set_app_user_active(uuid, boolean, text) is
  'ADMIN 전용. 계정을 비활성화·재활성화한다(권장 삭제 경로 — 이력·FK를 그대로 둔다). 자신은 비활성화할 수 없다.';


-- ══ 5. 완전 삭제 ═════════════════════════════════════════════════
--
-- core.app_user 행만 지운다. auth.users 삭제는 이 함수가 성공한 뒤 서버(lib/supabase/admin.ts의
-- service-role 클라이언트)가 Admin API로 별도 수행한다. 순서를 이렇게 둔 이유:
--   먼저 auth.users를 지우면 core.app_user는 on delete cascade로 같이 사라지는데, 그 시점에는
--   이미 늦어서 "업무 이력이 있으니 거절"을 친절한 문구로 보여줄 수 없다(그때는 그저
--   ON DELETE RESTRICT FK 위반 원문이 나갈 뿐이고, ON DELETE SET NULL인 audit_log.actor처럼
--   DB가 스스로는 막지 않는 참조도 있다). 그래서 이 함수가 먼저 core.app_user_blocking_tables()로
--   전부 확인한 뒤에만 지우고, 서버는 이 함수가 성공했을 때만 auth.users 삭제를 마저 진행한다.
-- ★ 그래도 이 함수 실행과 auth.users 삭제 사이에 서버가 실패하면 "프로필은 없고 Auth 계정만
--   남는" 상태가 될 수 있다. core.app_user가 없으면 로그인해도 이 사람은 이 앱에서 아무 권한도
--   갖지 못하므로(lib/auth.ts readAuthenticatedUser) 사실상 이미 잠긴 계정과 같다 — 반대 순서
--   (auth.users를 먼저 지우기)보다 안전한 실패 방향이다. 서버 쪽 처리는 report에 남긴다.
create or replace function core.admin_delete_app_user_profile(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_before jsonb;
  v_blocking text[];
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;
  if auth.uid() = p_user_id then
    raise exception '자신의 계정은 삭제할 수 없습니다.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception '삭제 사유는 필수입니다.' using errcode = '22023';
  end if;

  select to_jsonb(u) into v_before from core.app_user u where u.user_id = p_user_id;
  if v_before is null then
    raise exception '대상 계정을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  v_blocking := core.app_user_blocking_tables(p_user_id);
  if array_length(v_blocking, 1) > 0 then
    raise exception '이 계정은 업무 이력(%)이 있어 완전 삭제할 수 없습니다. 비활성화를 사용하세요.', array_to_string(v_blocking, ', ')
      using errcode = '23503';
  end if;

  delete from core.app_user where user_id = p_user_id;

  insert into core.audit_log (actor, action, target_type, target_id, before, after)
  values (auth.uid(), 'USER_PROFILE_DELETED', 'app_user', p_user_id::text, v_before, jsonb_build_object('reason', p_reason));
end;
$$;

comment on function core.admin_delete_app_user_profile(uuid, text) is
  'ADMIN 전용. 업무 이력이 전혀 없는 계정만 core.app_user에서 완전 삭제한다(auth.users 삭제는 서버가 뒤이어 수행). '
  '자기 자신은 거절하고, core.app_user_blocking_tables()가 하나라도 찾으면 거절한다.';


-- ══ 6. 권한 ═══════════════════════════════════════════════════════
--
-- authenticated는 여전히 core.app_user에 role·active만 직접 UPDATE할 수 있다(STEP 2 grant,
-- 이 마이그레이션에서 넓히지 않는다). job_role·department·생성·삭제는 오직 이 함수들을 통해서만
-- 가능하다 — 함수가 매번 core.is_admin()과 자기 자신 여부를 다시 확인하므로 RLS를 우회하지 않는다.

revoke execute on function core.app_user_blocking_tables(uuid) from public, anon, authenticated;
revoke execute on function core.admin_upsert_app_user_profile(uuid, text, text, text, text, text, boolean, text) from public, anon, authenticated;
revoke execute on function core.admin_set_app_user_active(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function core.admin_delete_app_user_profile(uuid, text) from public, anon, authenticated;

grant execute on function core.app_user_blocking_tables(uuid) to authenticated;
grant execute on function core.admin_upsert_app_user_profile(uuid, text, text, text, text, text, boolean, text) to authenticated;
grant execute on function core.admin_set_app_user_active(uuid, boolean, text) to authenticated;
grant execute on function core.admin_delete_app_user_profile(uuid, text) to authenticated;


-- ══ 7. 확인 ═══════════════════════════════════════════════════════

select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'core' and p.proname like 'admin_%app_user%' order by 1;
-- 기대: admin_delete_app_user_profile · admin_set_app_user_active · admin_upsert_app_user_profile

select conname from pg_constraint where conrelid = 'core.app_user'::regclass and conname like 'app_user_%_chk' order by 1;
-- 기대: app_user_department_chk · app_user_job_role_chk (+ 기존 role 체크가 있다면 함께)
