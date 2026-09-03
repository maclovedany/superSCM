// 사용자 조회 — renew.prd 4.4
//
// 조회는 lib 에 모읍니다. 화면에서 supabase 를 직접 부르지 않습니다.

import { createSupabaseServerClient } from './supabase/server';
import type { Role } from './menu';

export type AppUser = {
  userId: string;
  email: string;
  name: string | null;
  department: string | null;
  role: Role;
  active: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
};

function normalize(row: Record<string, unknown>): AppUser {
  return {
    userId: String(row.user_id ?? ''),
    email: String(row.email ?? ''),
    name: (row.name as string | null) ?? null,
    department: (row.department as string | null) ?? null,
    role: row.role === 'ADMIN' ? 'ADMIN' : 'USER',
    active: row.active !== false,
    createdAt: (row.created_at as string | null) ?? null,
    lastLoginAt: (row.last_login_at as string | null) ?? null,
  };
}

export async function getAppUsers(): Promise<{ rows: AppUser[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('core')
      .from('app_user')
      .select('user_id, email, name, department, role, active, created_at, last_login_at')
      .order('role', { ascending: true })
      .order('email', { ascending: true });

    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalize(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}
