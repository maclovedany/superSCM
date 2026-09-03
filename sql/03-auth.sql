-- ──────────────────────────────────────────────────────────────
-- STEP 2 · 인증과 권한 (1/2)
--
-- core.app_user      사용자와 역할
-- core.audit_log     누가 · 언제 · 무엇을 바꿨는지
-- core.is_admin()    RLS 정책에서 재사용하는 판정 함수
--
-- Supabase → SQL Editor 에서 03 → 04 순서로 실행하세요.
-- ──────────────────────────────────────────────────────────────

-- 1) 사용자 ────────────────────────────────────────────────────

create table if not exists core.app_user (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  name          text,
  department    text,
  role          text not null default 'USER' check (role in ('ADMIN', 'USER')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_login_at timestamptz
);

comment on table core.app_user is 'renew.prd 4.4 — 인증 사용자와 역할. auth.users 와 1:1';

create index if not exists app_user_role_idx on core.app_user(role) where active;

-- 2) auth.users 에 계정이 생기면 app_user 를 자동 생성 ──────────
--
-- 계정은 Supabase Auth 가 만들고, 역할은 여기서 관리합니다.
-- 기본 역할은 USER 입니다. 관리자는 나중에 명시적으로 올립니다.

create or replace function core.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = core, public
as $$
begin
  insert into core.app_user (user_id, email, name, department)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(new.raw_user_meta_data ->> 'department', '')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function core.handle_new_auth_user();

-- 이미 만들어진 계정을 app_user 로 옮깁니다 (재실행해도 안전).
insert into core.app_user (user_id, email)
select id, email from auth.users
on conflict (user_id) do nothing;

-- 3) updated_at 자동 갱신 ──────────────────────────────────────

create or replace function core.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_user_touch on core.app_user;
create trigger app_user_touch
  before update on core.app_user
  for each row execute function core.touch_updated_at();

-- 4) 관리자 판정 ───────────────────────────────────────────────
--
-- security definer 로 두는 이유: app_user 에 RLS 를 걸면
-- 정책 안에서 다시 app_user 를 읽을 때 재귀가 생깁니다.
-- 소유자(postgres) 권한으로 실행해 이를 피합니다.

create or replace function core.is_admin()
returns boolean
language sql
stable
security definer
set search_path = core
as $$
  select exists (
    select 1
      from core.app_user
     where user_id = auth.uid()
       and role = 'ADMIN'
       and active
  );
$$;

-- 5) 감사 로그 ─────────────────────────────────────────────────
--
-- renew.prd 31.1 — 모든 수정과 승인에 근거와 이력이 남아야 합니다.

create table if not exists core.audit_log (
  id          bigserial primary key,
  actor       uuid references auth.users(id) on delete set null,
  actor_email text,
  action      text not null,
  target_type text,
  target_id   text,
  before      jsonb,
  after       jsonb,
  at          timestamptz not null default now()
);

comment on table core.audit_log is 'renew.prd 31.1 — 감사 로그';

create index if not exists audit_log_at_idx on core.audit_log(at desc);
create index if not exists audit_log_actor_idx on core.audit_log(actor);

-- 6) 권한 ──────────────────────────────────────────────────────
--
-- anon 에게는 아무것도 주지 않습니다. 로그인해야 볼 수 있습니다.

grant select, update on core.app_user to authenticated;
grant select, insert on core.audit_log to authenticated;
grant usage, select on sequence core.audit_log_id_seq to authenticated;

revoke all on core.app_user  from anon;
revoke all on core.audit_log from anon;

-- 7) RLS ───────────────────────────────────────────────────────

alter table core.app_user  enable row level security;
alter table core.audit_log enable row level security;

-- 자기 자신은 볼 수 있고, 관리자는 전부 볼 수 있습니다.
drop policy if exists app_user_select on core.app_user;
create policy app_user_select on core.app_user
  for select to authenticated
  using (user_id = auth.uid() or core.is_admin());

-- 역할과 활성 여부는 관리자만 바꿉니다.
drop policy if exists app_user_update_admin on core.app_user;
create policy app_user_update_admin on core.app_user
  for update to authenticated
  using (core.is_admin())
  with check (core.is_admin());

-- 감사 로그는 관리자만 조회합니다.
drop policy if exists audit_log_select_admin on core.audit_log;
create policy audit_log_select_admin on core.audit_log
  for select to authenticated
  using (core.is_admin());

-- 기록은 로그인한 사용자면 남길 수 있되, 남의 이름으로는 못 남깁니다.
drop policy if exists audit_log_insert_self on core.audit_log;
create policy audit_log_insert_self on core.audit_log
  for insert to authenticated
  with check (actor = auth.uid());

-- 8) 확인 ──────────────────────────────────────────────────────

select 'app_user' as table_name, count(*) as rows from core.app_user
union all
select 'audit_log', count(*) from core.audit_log;

select policyname, cmd, roles
  from pg_policies
 where schemaname = 'core'
   and tablename in ('app_user', 'audit_log')
 order by tablename, policyname;
