import type { AppRole } from './menu';

export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  return value;
}

export type ManageUserDecision = { allowed: true } | { allowed: false; reason: 'SELF_DEMOTION' | 'SELF_DEACTIVATION' };

export function canManageUser({ actorId, targetId, nextRole, nextActive }: { actorId: string; targetId: string; nextRole: AppRole; nextActive: boolean }): ManageUserDecision {
  if (actorId === targetId && nextRole !== 'ADMIN') return { allowed: false, reason: 'SELF_DEMOTION' };
  if (actorId === targetId && !nextActive) return { allowed: false, reason: 'SELF_DEACTIVATION' };
  return { allowed: true };
}

export type RouteAccessDecision = { kind: 'ALLOW' } | { kind: 'LOGIN_REQUIRED' } | { kind: 'FORBIDDEN' };

export function routeAccessDecision({ pathname, authenticated, active, role }: { pathname: string; authenticated: boolean; active: boolean; role: AppRole | null }): RouteAccessDecision {
  if (!authenticated) return { kind: 'LOGIN_REQUIRED' };
  if (!active) return { kind: 'FORBIDDEN' };
  if (pathname.startsWith('/admin/') && role !== 'ADMIN') return { kind: 'FORBIDDEN' };
  return { kind: 'ALLOW' };
}
