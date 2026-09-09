import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import type { AppRole } from './menu';
import { createSupabaseServerClient } from './supabase/server';

export type AppUser = {
  userId: string;
  email: string;
  name: string;
  department: string | null;
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
  const { data, error } = await supabase.schema('core').from('app_user').select('user_id, email, name, department, role, active, last_login_at').eq('user_id', user.id).maybeSingle();
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
