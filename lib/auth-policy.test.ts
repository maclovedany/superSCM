import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as menu from './menu.ts';

const migrationUrl = new URL('../supabase/migrations/20260828000100_step2_auth_rbac.sql', import.meta.url);
const authPolicyUrl = new URL('./auth-policy.ts', import.meta.url);

test('STEP2 migration defines the RBAC database boundary', () => {
  assert.equal(existsSync(migrationUrl), true, 'STEP2 RBAC 마이그레이션이 있어야 합니다.');
  const sql = readFileSync(migrationUrl, 'utf8');
  assert.match(sql, /create table[^;]+core\.app_user/is);
  assert.match(sql, /create table[^;]+core\.audit_log/is);
  assert.match(sql, /function core\.is_admin/is);
  assert.doesNotMatch(sql, /to\s+anon[\s\S]{0,120}(insert|update|delete)/i);
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)/i);
});

test('menuForRole exposes admin navigation only to ADMIN', () => {
  assert.equal(typeof menu.menuForRole, 'function', 'lib/menu.ts가 menuForRole을 제공해야 합니다.');
  const menuForRole = menu.menuForRole as (role: 'ADMIN' | 'USER') => typeof menu.USER_MENU;
  assert.equal(menuForRole('USER').some((item) => item.href.startsWith('/admin/')), false);
  assert.equal(menuForRole('ADMIN').some((item) => item.href === '/admin/users'), true);
});

test('auth policy accepts only local next paths', async () => {
  assert.equal(existsSync(authPolicyUrl), true, 'lib/auth-policy.ts가 있어야 합니다.');
  const { safeNextPath } = await import('./auth-policy.ts');
  assert.equal(safeNextPath('/analysis/stockout?month=2026-09'), '/analysis/stockout?month=2026-09');
  assert.equal(safeNextPath('https://evil.example/steal'), '/dashboard');
  assert.equal(safeNextPath('//evil.example/steal'), '/dashboard');
  assert.equal(safeNextPath(null), '/dashboard');
});

test('admin cannot demote or deactivate their own account', async () => {
  assert.equal(existsSync(authPolicyUrl), true, 'lib/auth-policy.ts가 있어야 합니다.');
  const { canManageUser } = await import('./auth-policy.ts');
  assert.deepEqual(canManageUser({ actorId: 'A', targetId: 'A', nextRole: 'USER', nextActive: true }), { allowed: false, reason: 'SELF_DEMOTION' });
  assert.deepEqual(canManageUser({ actorId: 'A', targetId: 'A', nextRole: 'ADMIN', nextActive: false }), { allowed: false, reason: 'SELF_DEACTIVATION' });
  assert.deepEqual(canManageUser({ actorId: 'A', targetId: 'B', nextRole: 'USER', nextActive: false }), { allowed: true });
});

test('route access denies USER admin routes with 403', async () => {
  const policy = await import('./auth-policy.ts');
  assert.equal(typeof policy.routeAccessDecision, 'function');
  assert.deepEqual(policy.routeAccessDecision({ pathname: '/admin/users', authenticated: true, active: true, role: 'USER' }), { kind: 'FORBIDDEN' });
  assert.deepEqual(policy.routeAccessDecision({ pathname: '/admin/users', authenticated: true, active: true, role: 'ADMIN' }), { kind: 'ALLOW' });
  assert.deepEqual(policy.routeAccessDecision({ pathname: '/analysis/leadtime', authenticated: false, active: false, role: null }), { kind: 'LOGIN_REQUIRED' });
});

test('업무 메뉴 직접 URL은 해당 anyOf 권한이 없으면 403이다', async () => {
  const { routeAccessDecision } = await import('./auth-policy.ts');
  // 세 번째 열은 이 경로와 무관한 권한입니다. /inventory는 Task 4부터 ATP_VIEW(영업)도
  // 허용 목록에 들어가므로 다른 경로의 "무관한 권한"인 ATP_VIEW를 쓰지 않습니다.
  const routes = [
    ['/procurement-plans', 'PLAN_CONFIRM', 'ATP_VIEW'],
    ['/allocations', 'ALLOC_MANUAL', 'ATP_VIEW'],
    ['/approvals', 'PLAN_APPROVE', 'ATP_VIEW'],
    ['/orders', 'ORDER_CREATE', 'ATP_VIEW'],
    ['/allocations/priorities', 'ALLOC_PRIORITY_EDIT', 'ATP_VIEW'],
    ['/inventory', 'STOCK_VIEW_PAPER', 'DEMAND_SUBMIT'],
    ['/demand-submissions', 'DEMAND_SUBMIT', 'ATP_VIEW'],
  ] as const;

  for (const [pathname, permissionCode, unrelatedPermissionCode] of routes) {
    assert.deepEqual(
      routeAccessDecision({ pathname, authenticated: true, active: true, role: 'USER', permissionCodes: [permissionCode] }),
      { kind: 'ALLOW' },
      `${pathname} 허용 권한이 거절됐습니다.`,
    );
    assert.deepEqual(
      routeAccessDecision({ pathname, authenticated: true, active: true, role: 'USER', permissionCodes: [] }),
      { kind: 'FORBIDDEN' },
      `${pathname}가 빈 권한으로 열렸습니다.`,
    );
    assert.deepEqual(
      routeAccessDecision({ pathname, authenticated: true, active: true, role: 'USER', permissionCodes: [unrelatedPermissionCode] }),
      { kind: 'FORBIDDEN' },
      `${pathname}가 관계없는 권한으로 열렸습니다.`,
    );
  }
});

test('영업담당자의 ATP_VIEW는 /inventory를 열지만 다른 재고 권한과는 다른 화면 문맥이다', async () => {
  const { routeAccessDecision } = await import('./auth-policy.ts');
  assert.deepEqual(
    routeAccessDecision({ pathname: '/inventory', authenticated: true, active: true, role: 'USER', permissionCodes: ['ATP_VIEW'] }),
    { kind: 'ALLOW' },
  );
});

test('배정 우선순위 직접 URL은 부모 배정 권한으로 열리지 않는다', async () => {
  const { routeAccessDecision } = await import('./auth-policy.ts');
  assert.deepEqual(
    routeAccessDecision({
      pathname: '/allocations/priorities/example',
      authenticated: true,
      active: true,
      role: 'USER',
      permissionCodes: ['ALLOC_MANUAL'],
    }),
    { kind: 'FORBIDDEN' },
  );
});

// Task 8 fix round 1 — core.v_approved_demand_source(20260911000800 §4)는 EVENT_ORDER_APPROVE(SCM팀장)에게
// 조회 권한을 이미 주는데, 화면 경로가 부모 /demand-submissions 권한만 썼다면 팀장은 그 데이터를 보는
// 화면에 아예 못 들어간다. 확정 수요 화면만 따로 여는 하위 경로 항목으로 고쳤다 — 부모 경로(부서 제출
// 목록·상세)는 그대로 막혀 있어야 한다.
test('SCM팀장(EVENT_ORDER_APPROVE)은 확정 수요 화면만 읽기로 들어가고 부서 제출 목록·상세는 막힌다', async () => {
  const { routeAccessDecision } = await import('./auth-policy.ts');
  assert.deepEqual(
    routeAccessDecision({
      pathname: '/demand-submissions/consolidation',
      authenticated: true,
      active: true,
      role: 'USER',
      permissionCodes: ['EVENT_ORDER_APPROVE'],
    }),
    { kind: 'ALLOW' },
    'SCM팀장은 확정 수요 화면에 들어갈 수 있어야 합니다.',
  );
  for (const pathname of ['/demand-submissions', '/demand-submissions/example-submission-id']) {
    assert.deepEqual(
      routeAccessDecision({ pathname, authenticated: true, active: true, role: 'USER', permissionCodes: ['EVENT_ORDER_APPROVE'] }),
      { kind: 'FORBIDDEN' },
      `SCM팀장이 ${pathname}에 들어가면 안 됩니다(부서 제출 목록·상세는 그대로 막혀 있어야 합니다).`,
    );
  }
});

test('SCM 품목담당자(PLAN_CONFIRM)와 부서(DEMAND_SUBMIT)는 확정 수요 화면 접근이 이번 수정으로 바뀌지 않는다', async () => {
  const { routeAccessDecision } = await import('./auth-policy.ts');
  for (const permissionCode of ['PLAN_CONFIRM', 'DEMAND_CONSOLIDATE', 'SUPPLY_MEETING_INPUT', 'DEMAND_SUBMIT']) {
    assert.deepEqual(
      routeAccessDecision({
        pathname: '/demand-submissions/consolidation',
        authenticated: true,
        active: true,
        role: 'USER',
        permissionCodes: [permissionCode],
      }),
      { kind: 'ALLOW' },
      `${permissionCode}는 계속 확정 수요 화면에 들어갈 수 있어야 합니다.`,
    );
    assert.deepEqual(
      routeAccessDecision({
        pathname: '/demand-submissions',
        authenticated: true,
        active: true,
        role: 'USER',
        permissionCodes: [permissionCode],
      }),
      { kind: 'ALLOW' },
      `${permissionCode}의 /demand-submissions 접근이 바뀌면 안 됩니다.`,
    );
  }
});

test('업무 메뉴 7개 경로는 최소 서버 진입 페이지를 제공한다', () => {
  const pages = [
    '../app/(user)/procurement-plans/page.tsx',
    '../app/(user)/allocations/page.tsx',
    '../app/(user)/approvals/page.tsx',
    '../app/(user)/orders/page.tsx',
    '../app/(user)/allocations/priorities/page.tsx',
    '../app/(user)/inventory/page.tsx',
    '../app/(user)/demand-submissions/page.tsx',
  ];

  for (const page of pages) {
    assert.equal(existsSync(new URL(page, import.meta.url)), true, `${page}가 없어 404가 발생합니다.`);
  }
});
