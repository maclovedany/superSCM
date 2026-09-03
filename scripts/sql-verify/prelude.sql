-- ──────────────────────────────────────────────────────────────
-- Supabase compatibility prelude for the local SQL verification harness.
--
-- The project's sql/*.sql files are written to be pasted into the
-- Supabase SQL Editor. They therefore reference objects that a plain
-- PostgreSQL cluster does not have. This file creates the smallest
-- possible stand-ins so those files can run UNMODIFIED against a
-- throwaway local cluster.
--
-- EVERY object below is a STUB. Read the per-object comments: each one
-- says what real Supabase provides and how this stub differs. A test
-- that passes here proves the SQL parses, resolves and executes -- it
-- does NOT prove the SQL behaves the way it will on Supabase.
--
-- Run order: prelude.sql -> dump.sql -> project sql files.
-- ──────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on

-- ── 1) Roles ──────────────────────────────────────────────────
--
-- Supabase ships these roles preinstalled. PostgREST connects as
-- `authenticator` and SET ROLEs to `anon` (no JWT) or `authenticated`
-- (valid JWT). `service_role` bypasses RLS. `supabase_auth_admin` owns
-- the `auth` schema and is what the GoTrue service connects as.
--
-- Differences from real Supabase:
--   * Real `anon`/`authenticated`/`service_role` are NOLOGIN and are
--     only reachable via SET ROLE from `authenticator`. Same here.
--   * Real `service_role` has BYPASSRLS. We grant BYPASSRLS too so any
--     policy that assumes it will resolve, but no project file uses it.
--   * Supabase also creates supabase_admin, supabase_storage_admin,
--     dashboard_user, pgbouncer, pgsodium_*, etc. None are referenced
--     by this project, so they are deliberately omitted -- if a project
--     file ever starts failing on a missing role, add it HERE rather
--     than changing the project file.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    -- Real Supabase: LOGIN role used by PostgREST, holds no privileges
    -- of its own and only borrows them by SET ROLE.
    create role authenticator login noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    -- Real Supabase: owns the auth schema, CREATEROLE, and runs GoTrue.
    create role supabase_auth_admin nologin noinherit;
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;

-- The cluster superuser is named `postgres` by run.sh so that
-- `session_user in ('postgres')` checks in sql/25-python-models.sql
-- resolve the same way they do on Supabase.
grant anon, authenticated, service_role, supabase_auth_admin to postgres;

-- ── 2) auth schema ────────────────────────────────────────────
--
-- Real Supabase: `auth` is created and owned by supabase_auth_admin and
-- holds ~15 tables managed by GoTrue (users, identities, sessions,
-- refresh_tokens, mfa_*, sso_*, flow_state, audit_log_entries...).
-- Only auth.users is referenced by this project.

create schema if not exists auth authorization supabase_auth_admin;
grant usage on schema auth to postgres, anon, authenticated, service_role;

-- ── 3) auth.users ─────────────────────────────────────────────
--
-- Minimal stand-in. The project references exactly three columns:
--   id                 -> FK target from ~15 tables across sql/03..20
--   email              -> read by core.handle_new_auth_user()
--   raw_user_meta_data -> read by core.handle_new_auth_user()
--
-- Differences from real Supabase auth.users:
--   * Real table has ~35 columns (encrypted_password, phone,
--     email_confirmed_at, confirmation_token, banned_until,
--     is_sso_user, deleted_at, instance_id, aud, role, ...). Adding
--     them would not change how any project file parses or executes,
--     so they are omitted -- EXCEPT the handful below that are NOT
--     NULL in real Supabase and that a future INSERT test might need.
--   * Real table has RLS enabled and is not selectable by anon.
--   * Real table is owned by supabase_auth_admin; ownership matters for
--     the `on_auth_user_created` trigger, which on real Supabase must be
--     created by a superuser. Here the harness runs as superuser, so
--     the trigger always creates -- this harness CANNOT catch a
--     "permission denied to create trigger on auth.users" failure.

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  aud                 varchar(255),
  role                varchar(255),
  email               varchar(255),
  encrypted_password  varchar(255),
  email_confirmed_at  timestamptz,
  raw_app_meta_data   jsonb,
  raw_user_meta_data  jsonb,
  is_super_admin      boolean,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  phone               text,
  deleted_at          timestamptz
);

alter table auth.users owner to supabase_auth_admin;
grant select on auth.users to postgres, service_role;
-- Real Supabase does NOT grant select on auth.users to anon/authenticated.
-- We match that so a project file that accidentally reads it as
-- `authenticated` would fail here the same way it fails there.

-- ── 4) auth.uid() ─────────────────────────────────────────────
--
-- Real Supabase implementation:
--   select coalesce(
--     nullif(current_setting('request.jwt.claim.sub', true), ''),
--     (nullif(current_setting('request.jwt.claims',   true), '')::jsonb ->> 'sub')
--   )::uuid
--
-- PostgREST sets those GUCs per request from the verified JWT. Here
-- there is no JWT: the harness (or a test) sets the GUC directly with
--   set local request.jwt.claim.sub = '<uuid>';
-- so auth.uid() is impersonation-by-GUC, not authentication. Anything
-- that depends on the JWT actually being *verified* is out of scope.
--
-- Returns NULL when unset, exactly like a real anon request.

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims',    true), '')::jsonb ->> 'sub'
  )::uuid
$$;

alter function auth.uid() owner to supabase_auth_admin;
grant execute on function auth.uid() to postgres, anon, authenticated, service_role;

-- ── 5) auth.role() / auth.jwt() ───────────────────────────────
--
-- Not referenced by any current project file, but cheap to provide so
-- that adding a policy that uses them does not fail for a harness
-- reason. Same GUC-based approximation as auth.uid().

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims',     true), '')::jsonb ->> 'role'
  )
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  )
$$;

alter function auth.role() owner to supabase_auth_admin;
alter function auth.jwt()  owner to supabase_auth_admin;
grant execute on function auth.role(), auth.jwt()
  to postgres, anon, authenticated, service_role;

-- ── 6) extensions schema ──────────────────────────────────────
--
-- Supabase installs pgcrypto/uuid-ossp/pg_stat_statements into an
-- `extensions` schema and puts it on the default search_path. No
-- project file references it today; the schema is created empty so a
-- qualified reference like extensions.gen_random_uuid() would at least
-- fail on the function, not on the schema.
--
-- gen_random_uuid() is core PostgreSQL since 13, so no extension is
-- needed for it here.

create schema if not exists extensions;
grant usage on schema extensions to postgres, anon, authenticated, service_role;

-- ── 7) Sanity check ───────────────────────────────────────────

select
  (select count(*) from pg_roles
    where rolname in ('anon','authenticated','authenticator',
                      'service_role','supabase_auth_admin')) as roles_created,
  (select count(*) from pg_namespace where nspname = 'auth')  as auth_schema,
  to_regclass('auth.users')                                   as auth_users,
  auth.uid()                                                  as uid_when_anon;
