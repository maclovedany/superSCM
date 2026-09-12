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
-- fix round 1(리뷰 반영) — 원래 버전이 로컬에서 재현되지 않은 두 가지를 놓쳤다.
--   C1  참조 검사가 confrelid='auth.users'만 봐서 auth 스키마 자신의 FK(auth.identities 등,
--       GoTrue가 이메일/비밀번호 계정마다 반드시 만든다)까지 잡아 방금 만든 새 계정도 완전
--       삭제가 항상 거절됐다. → 참조 검사 대상을 core·public·analytics 스키마로 한정한다.
--   I2  auth.users insert 트리거가 이미 기본 프로필을 만들어 둔 뒤라 운영에서는 "생성" 호출도
--       v_before가 항상 not null이라 늘 USER_PROFILE_UPDATED로만 남았다. → 생성 의도를
--       p_created 인자로 명시적으로 받는다.
--   I4  프로필 삭제(SQL)와 Auth 삭제(Admin API)가 서로 다른 트랜잭션이라 그 사이 업무 행이
--       생기면 이력이 조용히 사라지거나(on delete cascade) actor가 null이 될 수 있다. 한
--       트랜잭션으로 묶을 수 없으므로 정책으로 닫는다 — 완전 삭제는 이미 비활성화된 계정만
--       허용한다(비활성 계정은 새 업무 행을 만들 수 없다 — RLS·업무 함수가 core.is_active_user()를
--       전제한다).
--   I5  Auth 삭제 실패 시 흔적이 남지 않아 core.admin_record_auth_delete_failure()를 추가한다.
--   I6  job_role·department CHECK을 걸기 전 기존 값을 확인하는 사전 점검 쿼리를 아래 §1에
--       주석으로 둔다. 이 CHECK이 걸리면 core.handle_new_auth_user()(STEP 2)가
--       raw_user_meta_data ->> 'department'를 그대로 복사하다가 값이 허용 목록 밖이면 그
--       INSERT ... ON CONFLICT DO UPDATE 자체가 실패한다 — 즉 Supabase 대시보드에서 임의
--       department 메타데이터로 사용자를 만들면 auth.users insert 자체가 막힌다(운영자는
--       메타데이터 없이 만들거나 허용된 값만 넣어야 한다).
--   M2  app_user_blocking_tables()는 admin_delete_app_user_profile 안에서만 쓰는 내부
--       헬퍼이므로 authenticated EXECUTE를 주지 않는다(security definer라 같은 소유자가
--       내부에서 부르는 데는 지장이 없다).
--   M5  거절 문구가 raw table.column을 그대로 보여주던 것을 한국어 업무 용어로 바꾼다.
--
-- 다시 실행해도 안전합니다. 실제 Supabase 적용은 사용자가 SQL Editor에서 수동으로 수행합니다.


-- ══ 1. job_role · department 값 검증 ══════════════════════════
--
-- STEP 19가 정의한 값(core.role_permission의 job_role, lib/permission.ts의 DEPARTMENTS)만
-- 허용한다. 여기서 새 값을 지어내지 않는다 — 늘리려면 STEP 19를 다시 열어 권한 표부터 정한다.
--
-- ★ 사전 점검(적용 전 SQL Editor에서 먼저 돌려 보기를 권장) — 아래 두 CHECK은 NOT VALID
--   없이 즉시 걸린다. 기존 행 중 허용 목록 밖의 값이 하나라도 있으면 ALTER TABLE ADD
--   CONSTRAINT 문 자체가 이 지점에서 멈춘다(SQL Editor는 문장 단위 실행이라 이 파일의 앞
--   문장까지는 이미 적용된 채로 멈춘다). 두 쿼리 모두 0행이어야 통과한다.
--
--   select user_id, job_role from core.app_user
--    where job_role is not null
--      and job_role not in ('SALES_REP', 'SCM_PLANNER', 'SCM_LEAD', 'BIZ_DEV', 'MARKETING', 'SERVICE');
--
--   select user_id, department from core.app_user
--    where department is not null
--      and department not in ('SCM', 'SALES', 'MARKETING', 'SERVICE', 'BIZ_DEV');

alter table core.app_user drop constraint if exists app_user_job_role_chk;
alter table core.app_user add constraint app_user_job_role_chk
  check (job_role is null or job_role in ('SALES_REP', 'SCM_PLANNER', 'SCM_LEAD', 'BIZ_DEV', 'MARKETING', 'SERVICE'));

alter table core.app_user drop constraint if exists app_user_department_chk;
alter table core.app_user add constraint app_user_department_chk
  check (department is null or department in ('SCM', 'SALES', 'MARKETING', 'SERVICE', 'BIZ_DEV'));


-- ══ 2. 업무 이력 참조 확인 ═══════════════════════════════════════
--
-- "완전 삭제는 업무 이력(주문·승인·제출·감사기록…)이 있으면 거절한다"를 표 이름을 나열하지
-- 않고 구현한다. auth.users(id)를 단일 컬럼 FK로 참조하는 표를 pg_constraint에서 훑는다 —
-- 표를 나열하면 새 업무 표가 생길 때마다 이 함수를 잊지 않고 고쳐야 하고, 잊으면 이력이 있는
-- 계정도 조용히 삭제된다. ON DELETE 절이 RESTRICT든 SET NULL이든(core.audit_log.actor는
-- SET NULL) 참조가 있으면 똑같이 막는다 — audit_log는 SET NULL이라 DB가 스스로는 삭제를
-- 막지 않지만, 감사 기록도 "업무 이력"이라 여기서는 막아야 한다.
--
-- ★ fix round 1 · C1 — 참조하는 표의 스키마를 core·public·analytics로 한정한다. GoTrue가
--   관리하는 auth 스키마 자신의 표(auth.identities는 이메일/비밀번호 계정마다 항상 하나
--   생기고, 로그인하면 auth.sessions · auth.one_time_tokens · auth.mfa_factors 등도 생긴다)를
--   그냥 두면, 한 번도 쓰지 않은 새 계정조차 auth.identities가 걸려 완전 삭제가 항상
--   거절된다. storage · vault · realtime · extensions · cron · net 스키마도 같은 이유로
--   제외한다 — 전부 플랫폼이 관리하는 인프라 표이지 이 프로젝트의 업무 이력이 아니다.
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
  v_label text;
  v_result text[] := array[]::text[];
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;

  for v_conref in
    select relns.nspname as schema_name, rel.relname as table_name, att.attname as column_name
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace relns on relns.oid = rel.relnamespace
      join pg_attribute att
        on att.attrelid = con.conrelid
       and att.attnum = con.conkey[1]
     where con.contype = 'f'
       and con.confrelid = 'auth.users'::regclass
       and array_length(con.conkey, 1) = 1
       and con.conrelid <> 'core.app_user'::regclass
       -- fix round 1 · C1: 업무 스키마만 본다. auth·storage·vault·realtime·extensions·
       -- cron·net은 플랫폼 인프라 표라 제외한다.
       and relns.nspname in ('core', 'public', 'analytics')
     order by 1, 2, 3
  loop
    -- 스키마를 항상 명시적으로 붙인다(search_path 해석에 기대지 않는다) — analytics는
    -- 이 함수의 search_path에 없고, public에 같은 이름의 표가 있어도 헷갈리지 않는다.
    execute format('select exists (select 1 from %I.%I where %I = $1)', v_conref.schema_name, v_conref.table_name, v_conref.column_name)
      into v_referenced
      using p_user_id;
    if v_referenced then
      -- fix round 1 · M5: raw table.column 대신 업무 용어로 보여준다. 매핑에 없는 표는
      -- (신규 업무 표가 이 함수를 고치지 않아도 잡히도록) 원래 이름을 그대로 쓴다.
      v_label := case v_conref.table_name
        when 'audit_log' then '감사 로그'
        when 'upload_batch' then '데이터 적재 이력'
        when 'column_mapping' then '적재 컬럼 매핑'
        when 'model_config' then 'Forecast 모델 설정'
        when 'forecast_run' then 'Forecast 실행'
        when 'model_version' then 'Forecast 모델'
        when 'backtest_run' then 'Backtest 실행'
        when 'champion_model_selection' then 'Champion 모델 선정'
        when 'agent_conversation' then 'AI 비서 대화'
        when 'agent_message' then 'AI 비서 대화'
        when 'approval_request' then '승인 요청'
        when 'approval_event' then '승인 이력'
        when 'notification_outbox' then '알림 발송 대기열'
        when 'notification_delivery' then '알림 발송 이력'
        when 'user_notification' then '알림'
        when 'sales_order' then '영업 주문'
        when 'sales_order_event' then '주문 이력'
        when 'stock_allocation' then '재고 배정'
        when 'stock_allocation_event' then '배정 이력'
        when 'allocation_priority' then '배정 우선순위 변경 이력'
        when 'urgent_order' then '긴급발주'
        when 'planning_cycle' then '수요 취합 주기'
        when 'demand_submission' then '수요 제출'
        when 'demand_submission_event' then '수요 제출 이력'
        when 'supply_meeting_result' then '수급회의 결과'
        when 'supply_meeting_result_event' then '수급회의 결과 이력'
        when 'event_demand' then '이벤트성 추가 수요'
        when 'item_policy_revision' then '품목 정책 변경 요청'
        when 'procurement_plan' then '발주계획'
        when 'procurement_plan_event' then '발주계획 이력'
        when 'business_calendar_readiness' then '영업일 달력 준비 상태'
        when 'receipt_schedule_result' then '입고 일정 실적'
        else v_conref.table_name
      end;
      v_result := array_append(v_result, v_label);
    end if;
  end loop;

  return v_result;
end;
$$;

comment on function core.app_user_blocking_tables(uuid) is
  'ADMIN 전용, 내부 헬퍼(authenticated에 직접 GRANT하지 않는다). auth.users(id)를 참조하는 core·public·analytics 표를 '
  '훑어 이 계정을 쓴 곳을 한국어 업무 용어로 돌려준다(빈 배열이면 완전 삭제 가능). '
  'admin_delete_app_user_profile이 최종 확인에 쓴다. auth·storage·vault 등 플랫폼 인프라 표는 보지 않는다(fix round 1 · C1).';


-- ══ 3. 계정 프로필 생성·수정 ══════════════════════════════════════
--
-- auth.users에 새 사용자가 생기면 core.handle_new_auth_user()(STEP 2) 트리거가 role=USER ·
-- active=true인 기본 프로필을 이미 넣어 둔다. 이 함수는 그 행을 관리자가 고른 최종 값(ADMIN도
-- 가능한 role · job_role · department · name)으로 덮어쓰거나, 기존 계정을 편집한다 — 하나의
-- 함수가 "생성 뒤 확정"과 "편집"을 모두 맡는다(둘 다 결국 upsert다).
--
-- ★ fix round 1 · I2 — 운영에서는 트리거가 항상 먼저 행을 만들어 두므로 "v_before가
--   null이면 생성"이라는 판정은 실제로 한 번도 참이 되지 않는다(생성 호출도 항상
--   USER_PROFILE_UPDATED로 남았다). 서버(actions.ts)가 "방금 Auth 계정을 만든 직후 확정
--   호출인지"를 p_created로 명시한다 — v_before가 진짜 null인 방어적 상황(트리거가 어떤
--   이유로 행을 못 만든 경우)도 여전히 USER_CREATED로 남긴다.
create or replace function core.admin_upsert_app_user_profile(
  p_user_id uuid,
  p_email text,
  p_name text,
  p_role text,
  p_job_role text,
  p_department text,
  p_active boolean,
  p_reason text,
  p_created boolean default false
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
  -- fix round 1 · I2: 서버가 명시한 생성 의도(p_created) 또는 행이 진짜 없는 방어적 상황 둘
  -- 다 USER_CREATED로 남긴다.
  v_action := case when p_created or v_before is null then 'USER_CREATED' else 'USER_PROFILE_UPDATED' end;

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

comment on function core.admin_upsert_app_user_profile(uuid, text, text, text, text, text, boolean, text, boolean) is
  'ADMIN 전용. 계정 생성 직후(p_created=true) 최종 role·job_role·department·name을 확정하거나 기존 계정을 편집한다(p_created=false). '
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
  'ADMIN 전용. 계정을 비활성화·재활성화한다(권장 삭제 경로 — 이력·FK를 그대로 둔다). 자신은 비활성화할 수 없다. '
  '완전 삭제는 이 함수로 먼저 비활성화한 뒤에만 가능하다(admin_delete_app_user_profile 참고).';


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
--   (auth.users를 먼저 지우기)보다 안전한 실패 방향이다. 실패 흔적은 §6의
--   admin_record_auth_delete_failure()가 감사 로그에 남긴다(fix round 1 · I5).
-- ★ fix round 1 · I4 — 프로필 삭제(이 함수, SQL 트랜잭션)와 Auth 삭제(서버의 Admin API 호출)는
--   같은 트랜잭션으로 묶을 수 없다. 그 사이에 이 계정으로 업무 행이 새로 생기면(on delete
--   cascade인 agent_conversation 등은 조용히 함께 지워지고, on delete set null인
--   audit_log.actor는 null이 된다) 이력이 훼손된다. 트랜잭션으로 막을 수 없으므로 정책으로
--   막는다 — 완전 삭제는 이미 active=false(비활성화된 상태)인 계정만 허용한다. 비활성 계정은
--   core.is_active_user()를 전제하는 모든 업무 RLS·함수가 막으므로 그 사이 새 업무 행이
--   생길 수 없고, 경쟁 상태 자체가 사라진다.
create or replace function core.admin_delete_app_user_profile(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_row core.app_user%rowtype;
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

  select * into v_row from core.app_user where user_id = p_user_id;
  if not found then
    raise exception '대상 계정을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  v_before := to_jsonb(v_row);

  -- fix round 1 · I4: 경쟁 상태를 트랜잭션이 아니라 정책으로 막는다.
  if v_row.active then
    raise exception '완전 삭제는 먼저 비활성화된 계정만 가능합니다. 계정을 비활성화한 뒤 다시 시도하세요.' using errcode = '55000';
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
  'ADMIN 전용. 이미 비활성화됐고(fix round 1 · I4) 업무 이력이 전혀 없는 계정만 core.app_user에서 완전 삭제한다 '
  '(auth.users 삭제는 서버가 뒤이어 수행). 자기 자신은 거절하고, core.app_user_blocking_tables()가 하나라도 찾으면 거절한다.';


-- ══ 6. Auth 삭제 실패 흔적 남기기 ═════════════════════════════════
--
-- fix round 1 · I5 — 서버(actions.ts)가 admin_delete_app_user_profile을 먼저 성공시킨 뒤
-- Admin API로 auth.users를 지우는데, 그 호출이 실패하면 프로필은 이미 사라져 화면 목록에서
-- 안 보이지만 Auth 계정은 남는다. 나중에 찾아 정리할 수 있도록 실패 사실을 감사 로그에 남긴다.
-- ★ 이 시점에는 대상의 core.app_user 행이 이미 없으므로 target_id는 문자열로만 남긴다
--   (before/after 스냅샷과 달리 참조 무결성이 없다 — audit_log.target_id는 text다).
create or replace function core.admin_record_auth_delete_failure(p_user_id uuid, p_email text, p_error text)
returns void
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;
  insert into core.audit_log (actor, action, target_type, target_id, before, after)
  values (
    auth.uid(), 'USER_AUTH_DELETE_FAILED', 'app_user', p_user_id::text,
    jsonb_build_object('email', p_email),
    jsonb_build_object('error', p_error)
  );
end;
$$;

comment on function core.admin_record_auth_delete_failure(uuid, text, text) is
  'ADMIN 전용. 완전 삭제 중 core.app_user는 지웠지만 Auth 계정 삭제(Admin API)가 실패했을 때 '
  '그 흔적을 감사 로그에 남긴다(fix round 1 · I5) — 프로필이 없어져 화면 목록에서는 사라지므로 이 로그가 유일한 단서다.';


-- ══ 7. 권한 ═══════════════════════════════════════════════════════
--
-- authenticated는 여전히 core.app_user에 role·active만 직접 UPDATE할 수 있다(STEP 2 grant,
-- 이 마이그레이션에서 넓히지 않는다). job_role·department·생성·삭제는 오직 이 함수들을 통해서만
-- 가능하다 — 함수가 매번 core.is_admin()과 자기 자신 여부를 다시 확인하므로 RLS를 우회하지 않는다.
--
-- ★ fix round 1 · M2 — app_user_blocking_tables()는 admin_delete_app_user_profile 안에서만
--   쓰는 내부 헬퍼라 authenticated에 EXECUTE를 주지 않는다. security definer 함수는 같은
--   소유자가 만든 다른 함수를 호출할 때 GRANT 없이도 실행되므로(호출 시점에 함수 소유자
--   권한으로 동작한다) 내부 호출에는 지장이 없다 — 클라이언트가 RPC로 직접 부르는 경로만 막힌다.

revoke execute on function core.app_user_blocking_tables(uuid) from public, anon, authenticated;
revoke execute on function core.admin_upsert_app_user_profile(uuid, text, text, text, text, text, boolean, text, boolean) from public, anon, authenticated;
revoke execute on function core.admin_set_app_user_active(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function core.admin_delete_app_user_profile(uuid, text) from public, anon, authenticated;
revoke execute on function core.admin_record_auth_delete_failure(uuid, text, text) from public, anon, authenticated;

grant execute on function core.admin_upsert_app_user_profile(uuid, text, text, text, text, text, boolean, text, boolean) to authenticated;
grant execute on function core.admin_set_app_user_active(uuid, boolean, text) to authenticated;
grant execute on function core.admin_delete_app_user_profile(uuid, text) to authenticated;
grant execute on function core.admin_record_auth_delete_failure(uuid, text, text) to authenticated;
-- app_user_blocking_tables(uuid)는 의도적으로 authenticated에 GRANT하지 않는다(fix round 1 · M2).


-- ══ 8. 확인 ═══════════════════════════════════════════════════════

select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'core' and p.proname like 'admin_%app_user%' order by 1;
-- 기대: admin_delete_app_user_profile · admin_record_auth_delete_failure · admin_set_app_user_active · admin_upsert_app_user_profile

select conname from pg_constraint where conrelid = 'core.app_user'::regclass and conname like 'app_user_%_chk' order by 1;
-- 기대: app_user_department_chk · app_user_job_role_chk (+ 기존 role 체크가 있다면 함께)

select count(*) as job_role_violations from core.app_user
 where job_role is not null
   and job_role not in ('SALES_REP', 'SCM_PLANNER', 'SCM_LEAD', 'BIZ_DEV', 'MARKETING', 'SERVICE');
-- 기대: 0

select count(*) as department_violations from core.app_user
 where department is not null
   and department not in ('SCM', 'SALES', 'MARKETING', 'SERVICE', 'BIZ_DEV');
-- 기대: 0

select has_function_privilege('authenticated', 'core.app_user_blocking_tables(uuid)', 'execute') as blocking_tables_open_to_authenticated;
-- 기대: false (fix round 1 · M2 — 내부 헬퍼는 클라이언트가 직접 부를 수 없어야 한다)

select has_function_privilege('authenticated', 'core.admin_delete_app_user_profile(uuid,text)', 'execute') as delete_open_to_authenticated;
-- 기대: true
