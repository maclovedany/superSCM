// Phase 2 권한 조회 — analytics 뷰만 읽습니다.

import { createSupabaseServerClient } from './supabase';
import { jobRoleLabel, departmentLabel } from './permission';

export type UserAccess = {
  userId: string;
  email: string;
  name: string;
  department: string | null;
  departmentLabel: string;
  jobRole: string | null;
  jobRoleLabel: string;
  role: 'ADMIN' | 'USER';
  active: boolean;
  permissionCount: number;
  reasonCode: string | null;
};

export type PermissionMatrixRow = {
  jobRole: string;
  jobRoleLabel: string;
  domain: string;
  permissionCode: string;
  description: string;
};

export async function getUserAccess(): Promise<{ rows: UserAccess[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('analytics').from('v_user_access').select('*').order('email');
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((raw) => {
        const row = raw as Record<string, unknown>;
        const department = row.department ? String(row.department) : null;
        const jobRole = row.job_role ? String(row.job_role) : null;
        return {
          userId: String(row.user_id),
          email: String(row.email ?? ''),
          name: String(row.name ?? ''),
          department,
          departmentLabel: departmentLabel(department),
          jobRole,
          jobRoleLabel: jobRoleLabel(jobRole),
          role: row.role === 'ADMIN' ? 'ADMIN' : 'USER',
          active: row.active === true,
          permissionCount: Number(row.n_permissions ?? 0),
          reasonCode: row.reason_code ? String(row.reason_code) : null,
        };
      }),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : '계정 권한을 조회하지 못했습니다.' };
  }
}

export async function getPermissionMatrix(): Promise<{ rows: PermissionMatrixRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_permission_matrix')
      .select('*')
      .order('job_role')
      .order('domain')
      .order('permission_code');
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((raw) => {
        const row = raw as Record<string, unknown>;
        const jobRole = String(row.job_role ?? '');
        return {
          jobRole,
          jobRoleLabel: jobRoleLabel(jobRole),
          domain: String(row.domain ?? ''),
          permissionCode: String(row.permission_code ?? ''),
          description: String(row.description ?? ''),
        };
      }),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : '권한 표를 조회하지 못했습니다.' };
  }
}
