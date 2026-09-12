import type { AppRole } from './menu';
import { PermissionSet, requiredPermissionsForPath } from './permission.ts';

export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  return value;
}

export type ManageUserDecision = { allowed: true } | { allowed: false; reason: 'SELF_DEMOTION' | 'SELF_DEACTIVATION' | 'SELF_DELETE' };

export function canManageUser({ actorId, targetId, nextRole, nextActive }: { actorId: string; targetId: string; nextRole: AppRole; nextActive: boolean }): ManageUserDecision {
  if (actorId === targetId && nextRole !== 'ADMIN') return { allowed: false, reason: 'SELF_DEMOTION' };
  if (actorId === targetId && !nextActive) return { allowed: false, reason: 'SELF_DEACTIVATION' };
  return { allowed: true };
}

/** 관리자 계정 관리 화면의 "비활성화" 빠른 버튼 전용 — role 변경이 없으므로 canManageUser보다 가볍다. */
export function canSetActive({ actorId, targetId, nextActive }: { actorId: string; targetId: string; nextActive: boolean }): ManageUserDecision {
  if (actorId === targetId && !nextActive) return { allowed: false, reason: 'SELF_DEACTIVATION' };
  return { allowed: true };
}

/** 완전 삭제는 자기 자신을 대상으로 할 수 없다 — 관리자 전원이 스스로를 지워 잠기는 사고를 막는다. */
export function canDeleteUser({ actorId, targetId }: { actorId: string; targetId: string }): ManageUserDecision {
  if (actorId === targetId) return { allowed: false, reason: 'SELF_DELETE' };
  return { allowed: true };
}

export type RouteAccessDecision = { kind: 'ALLOW' } | { kind: 'LOGIN_REQUIRED' } | { kind: 'FORBIDDEN' };

export function routeAccessDecision({ pathname, authenticated, active, role, permissionCodes = [] }: { pathname: string; authenticated: boolean; active: boolean; role: AppRole | null; permissionCodes?: readonly string[] }): RouteAccessDecision {
  if (!authenticated) return { kind: 'LOGIN_REQUIRED' };
  if (!active) return { kind: 'FORBIDDEN' };
  if (pathname.startsWith('/admin/') && role !== 'ADMIN') return { kind: 'FORBIDDEN' };
  const required = requiredPermissionsForPath(pathname);
  if (required && !new PermissionSet(permissionCodes).hasAny(...required)) return { kind: 'FORBIDDEN' };
  return { kind: 'ALLOW' };
}
