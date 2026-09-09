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
