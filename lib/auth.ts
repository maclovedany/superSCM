import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import type { AppRole } from './menu';
import { PermissionSet, type Permission } from './permission';
import { createSupabaseServerClient } from './supabase/server';

export type AppUser = {
  userId: string;
  email: string;
  name: string;
  department: string | null;
  /** 업무 직책. 권한은 이 값으로 결정됩니다 (role 과 다른 축) */
  jobRole: string | null;
  role: AppRole;
  active: boolean;
  lastLoginAt: string | null;
};

export type AuthenticatedUser = { authUser: User; profile: AppUser };

export class AuthorizationError extends Error {
  readonly status: 401 | 403;
  constructor(message: string, status: 401 | 403) {
    super(message);
    this.name = 'AuthorizationError';
    this.status = status;
  }
}
function normalizeProfile(row: Record<string, unknown>): AppUser {
  return {
    userId: String(row.user_id),
    email: String(row.email ?? ''),
    name: String(row.name ?? ''),
    department: row.department ? String(row.department) : null,
    jobRole: row.job_role ? String(row.job_role) : null,
    role: row.role === 'ADMIN' ? 'ADMIN' : 'USER',
    active: row.active === true,
    lastLoginAt: row.last_login_at ? String(row.last_login_at) : null,
  };
}

export async function getRole(): Promise<AppRole | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.schema('core').from('app_user').select('role, active').eq('user_id', user.id).maybeSingle();
  if (!data || data.active !== true) return null;
  return data.role === 'ADMIN' ? 'ADMIN' : 'USER';
}

async function readAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return null;
  const { data, error } = await supabase.schema('core').from('app_user').select('user_id, email, name, department, job_role, role, active, last_login_at').eq('user_id', user.id).maybeSingle();
  if (error || !data || data.active !== true) return null;
  return { authUser: user, profile: normalizeProfile(data) };
}

export async function requireUser(): Promise<AuthenticatedUser> {
  const current = await readAuthenticatedUser();
  if (!current) redirect('/login');
  return current;
}

export async function requireAdmin(): Promise<AuthenticatedUser> {
  const current = await readAuthenticatedUser();
  if (!current) throw new AuthorizationError('로그인이 필요합니다.', 401);
  if (current.profile.role !== 'ADMIN') throw new AuthorizationError('관리자 권한이 필요합니다.', 403);
  return current;
}

/**
 * 로그인만 확인합니다. requireUser 와 달리 redirect 하지 않고 던집니다.
 * API 라우트는 HTML 로 이동시킬 수 없고 상태 코드로 답해야 하기 때문입니다.
 */
export async function requireSignedIn(): Promise<AuthenticatedUser> {
  const current = await readAuthenticatedUser();
  if (!current) throw new AuthorizationError('로그인이 필요합니다.', 401);
  return current;
}


/**
 * 이 사용자의 업무 권한 집합.
 *
 * ★ 판정은 DB 의 core.my_permissions() 가 합니다. 여기서 직책 → 권한 표를 다시
 *   만들지 않습니다. 표가 두 벌이 되면 언젠가 화면과 DB 의 답이 갈라집니다.
 * ★ 조회에 실패하면 빈 집합입니다 — fail-closed. 오류를 "전부 허용" 으로 읽지 않습니다.
 */
export async function getPermissions(): Promise<PermissionSet> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('my_permissions');
    if (error || !Array.isArray(data)) return new PermissionSet([]);
    return new PermissionSet(
      data.map((row) => String((row as Record<string, unknown>).permission_code ?? '')).filter((code) => code !== ''),
    );
  } catch {
    return new PermissionSet([]);
  }
}

/**
 * 이 권한이 없으면 던집니다. 서버 액션과 라우트의 첫 줄에 둡니다.
 *
 * ★ 메뉴에서 숨기는 것만으로는 부족합니다. 경로를 직접 치고 들어오는 것을 여기서 막고,
 *   그래도 새면 RLS 가 마지막으로 막습니다. 세 겹입니다.
 */
export async function requirePermission(code: Permission): Promise<AuthenticatedUser> {
  const current = await readAuthenticatedUser();
  if (!current) throw new AuthorizationError('로그인이 필요합니다.', 401);
  const permissions = await getPermissions();
  if (!permissions.has(code)) {
    throw new AuthorizationError(`이 작업에는 ${code} 권한이 필요합니다.`, 403);
  }
  return current;
}
