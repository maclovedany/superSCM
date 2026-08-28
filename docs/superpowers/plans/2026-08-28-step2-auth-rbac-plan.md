# STEP2 인증·Role·RBAC 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ADMIN과 USER 권한을 Next.js 화면, 서버 코드, Supabase RLS에서 모두 강제한다.

**Architecture:** Supabase Auth 세션은 `@supabase/ssr` 쿠키 클라이언트로 유지한다. middleware가 로그인과 `/admin/*` 진입을 차단하고, 서버 페이지와 Server Action은 `requireUser()`/`requireAdmin()`으로 다시 검증하며, DB mutation은 `core.is_admin()` 기반 RLS와 self-change 방지 trigger가 최종적으로 차단한다.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase Auth/PostgreSQL RLS, Node test runner

**Spec:** 사용자 요청 STEP2와 `/Users/danymac/Projects/SuperSCM/design.md`

## Global Constraints

- service role key를 브라우저 코드에 넣지 않는다.
- anon에게 core/analytics 업무 데이터 읽기·쓰기를 허용하지 않는다.
- 관리자 mutation은 middleware나 메뉴 숨김이 아니라 Server Action과 RLS에서 다시 검증한다.
- 기존 analytics 계산 뷰와 계산식을 변경하지 않는다.
- 화면 문구와 주석은 한국어로 작성한다.

---

### Task 1: 보안 불변조건과 DB 마이그레이션

**Files:**
- Create: `lib/auth-policy.test.ts`
- Create: `supabase/migrations/20260828000100_step2_auth_rbac.sql`
- Modify: `sql/01-grants.sql`
- Modify: `sql/02-policies.sql`

**Interfaces:**
- Produces: `core.app_user`, `core.audit_log`, `core.is_admin()`, auth user trigger, 관리자 update/audit trigger, 역할별 RLS

- [ ] SQL 보안 불변조건 테스트를 작성하고 마이그레이션이 없어서 실패하는지 확인한다.
- [ ] 테이블·함수·trigger·GRANT·RLS를 한 마이그레이션에 구현한다.
- [ ] anon mutation과 `using (true)`가 없는지 테스트로 확인한다.

### Task 2: SSR 세션과 auth helper

**Files:**
- Modify: `lib/supabase/server.ts`
- Modify: `lib/supabase/client.ts`
- Create: `lib/auth.ts`
- Create: `lib/auth-policy.ts`
- Create: `middleware.ts`

**Interfaces:**
- Produces: `getRole()`, `requireUser()`, `requireAdmin()`, `safeNextPath()`, `canManageUser()`

- [ ] 안전한 next 경로와 self-change 차단 테스트를 작성해 실패를 확인한다.
- [ ] cookie session client와 auth helper를 구현한다.
- [ ] middleware에서 보호 경로 로그인 redirect와 `/admin/*` 403을 구현한다.

### Task 3: 로그인·로그아웃과 role 기반 shell

**Files:**
- Create: `app/(auth)/login/actions.ts`
- Create: `app/(auth)/login/login-form.tsx`
- Modify: `app/(auth)/login/page.tsx`
- Create: `app/auth/callback/route.ts`
- Create: `lib/auth-actions.ts`
- Modify: `app/(user)/layout.tsx`
- Modify: `app/(admin)/layout.tsx`
- Modify: `components/shell/sidebar.tsx`
- Modify: `components/shell/topbar.tsx`
- Modify: `lib/menu.ts`

**Interfaces:**
- Consumes: `requireUser()`, `requireAdmin()`
- Produces: 로그인 실패 표시, next 복귀, 로그아웃, role별 메뉴

- [ ] 이메일·비밀번호 로그인 Server Action과 안전한 next 복귀를 구현한다.
- [ ] shell에서 서버가 검증한 role만 Sidebar에 전달한다.
- [ ] ADMIN 메뉴는 ADMIN에게만 보이되 보안 검증은 서버에 유지한다.

### Task 4: 관리자 사용자 관리

**Files:**
- Create: `app/(admin)/admin/users/actions.ts`
- Create: `app/(admin)/admin/users/page.tsx`
- Create: `components/admin/user-management-table.tsx`
- Modify: `styles/components.css`

**Interfaces:**
- Consumes: `requireAdmin()`, `canManageUser()`, `core.app_user` RLS
- Produces: role 변경과 active 변경 Server Action

- [ ] `/admin/users` 목록 화면을 구현한다.
- [ ] action 시작부에서 `requireAdmin()`을 호출한다.
- [ ] 자기 role 제거와 자기 비활성화를 action과 DB trigger에서 모두 차단한다.
- [ ] DB update trigger가 변경 전후 값을 `core.audit_log`에 기록하도록 연결한다.

### Task 5: 통합 검증

**Files:**
- Modify: `error.md` only if a new error occurs

**Interfaces:**
- Verifies: route 보호, SQL 보안 불변조건, 타입, production build

- [ ] `npm test`를 실행한다.
- [ ] `npm run build`를 실행한다.
- [ ] SQL에서 anon 업무 권한과 전체 허용 정책이 제거되었는지 확인한다.
- [ ] 수동 Supabase migration 적용 및 최초 ADMIN 승격 절차를 보고한다.
