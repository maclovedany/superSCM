// 관리자 계정 관리 — 조회 · RPC 래퍼 · Auth Admin API 래퍼.
//
// ★ 여기서 권한 · 검증을 판정하지 않는다. core.admin_upsert_app_user_profile 등 DB 명령
//   함수가 ADMIN 여부와 입력값을 스스로 다시 확인한다(lib/master.ts와 같은 방식). 이 파일은
//   RPC 호출 결과를 { data, error } 로 그대로 돌려준다.
// ★ core.app_user를 analytics 뷰가 아니라 직접 읽는다. RLS 정책(app_user_select_self_or_admin,
//   STEP 2)이 이미 "본인 또는 관리자"만 허용하므로 이 화면(ADMIN 전용)에는 이 편이 더 정확하다
//   — analytics.v_user_access는 department·role처럼 민감하지 않은 열만 모든 로그인 사용자에게
//   열려 있어(권한 화면 용도), 계정 관리처럼 전체 계정을 나열하는 화면에는 맞지 않는다.
// ★ Auth 사용자 생성·삭제는 secret key를 쓰는 service-role 클라이언트로만 한다
//   (lib/supabase/admin.ts) — 일반 로그인 세션 클라이언트에는 Admin API 권한이 없다.

import 'server-only';

import { createSupabaseAdminClient } from './supabase/admin';
import { createSupabaseServerClient } from './supabase';
import { normalizeManagedAppUser, type ManagedAppUser } from './user-admin-model';

export type UserAdminResult<T> = { data: T | null; error: string | null };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function listManagedUsers(): Promise<{ rows: ManagedAppUser[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('core')
      .from('app_user')
      .select('user_id, email, name, department, job_role, role, active, created_at, updated_at, last_login_at')
      .order('created_at');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeManagedAppUser(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '계정 목록을 조회하지 못했습니다.') };
  }
}

/**
 * 생성 직후 확정, 또는 기존 계정 편집 — core.admin_upsert_app_user_profile.
 *
 * ★ fix round 1 · I2: `created: true`는 "방금 Auth 계정을 만든 직후 확정 호출"임을 DB 함수에
 *   명시한다. auth.users 트리거가 항상 먼저 기본 프로필을 넣어 두므로, 이 신호가 없으면
 *   생성도 편집(USER_PROFILE_UPDATED)으로만 감사 로그에 남는다.
 */
export async function upsertUserProfile(input: {
  userId: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'USER';
  jobRole: string | null;
  department: string | null;
  active: boolean;
  reason: string;
  created?: boolean;
}): Promise<UserAdminResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.schema('core').rpc('admin_upsert_app_user_profile', {
      p_user_id: input.userId,
      p_email: input.email,
      p_name: input.name,
      p_role: input.role,
      p_job_role: input.jobRole,
      p_department: input.department,
      p_active: input.active,
      p_reason: input.reason,
      p_created: input.created ?? false,
    });
    if (error) return { data: null, error: error.message };
    return { data: null, error: null };
  } catch (error) {
    return { data: null, error: errorMessage(error, '계정 정보를 저장하지 못했습니다.') };
  }
}

export async function setUserActive(input: { userId: string; active: boolean; reason: string }): Promise<UserAdminResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.schema('core').rpc('admin_set_app_user_active', {
      p_user_id: input.userId,
      p_active: input.active,
      p_reason: input.reason,
    });
    if (error) return { data: null, error: error.message };
    return { data: null, error: null };
  } catch (error) {
    return { data: null, error: errorMessage(error, '활성 상태를 변경하지 못했습니다.') };
  }
}

export async function deleteUserProfile(input: { userId: string; reason: string }): Promise<UserAdminResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.schema('core').rpc('admin_delete_app_user_profile', {
      p_user_id: input.userId,
      p_reason: input.reason,
    });
    if (error) return { data: null, error: error.message };
    return { data: null, error: null };
  } catch (error) {
    return { data: null, error: errorMessage(error, '계정을 삭제하지 못했습니다.') };
  }
}

/**
 * Supabase Auth 사용자를 만든다(service-role). 성공하면 새 user_id를 돌려준다.
 * ★ core.handle_new_auth_user() 트리거가 role=USER · active=true인 기본 프로필을 즉시 심는다 —
 *   호출한 쪽이 이어서 upsertUserProfile()로 최종 값을 확정해야 한다.
 */
export async function createAuthUser(input: { email: string; password: string; name: string; department: string | null }): Promise<UserAdminResult<string>> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { name: input.name, department: input.department },
    });
    if (error || !data.user) return { data: null, error: error?.message ?? 'Auth 계정을 만들지 못했습니다.' };
    return { data: data.user.id, error: null };
  } catch (error) {
    return { data: null, error: errorMessage(error, 'Auth 계정을 만들지 못했습니다.') };
  }
}

/** 롤백 또는 완전 삭제 마무리 — Auth 사용자를 지운다(service-role). */
export async function deleteAuthUser(userId: string): Promise<UserAdminResult<null>> {
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return { data: null, error: error.message };
    return { data: null, error: null };
  } catch (error) {
    return { data: null, error: errorMessage(error, 'Auth 계정을 삭제하지 못했습니다.') };
  }
}

/**
 * fix round 1 · I5 — 완전 삭제 중 프로필은 지웠지만 Auth 계정 삭제가 실패했을 때 그 흔적을
 * 감사 로그에 남긴다. 이 시점엔 core.app_user 행이 이미 없어 화면 목록에서 사라지므로, 이
 * 로그가 남은 Auth 계정을 나중에 찾아 정리할 유일한 단서다.
 */
export async function recordAuthDeleteFailure(input: { userId: string; email: string; error: string }): Promise<UserAdminResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.schema('core').rpc('admin_record_auth_delete_failure', {
      p_user_id: input.userId,
      p_email: input.email,
      p_error: input.error,
    });
    if (error) return { data: null, error: error.message };
    return { data: null, error: null };
  } catch (error) {
    return { data: null, error: errorMessage(error, 'Auth 삭제 실패 기록을 남기지 못했습니다.') };
  }
}
