'use server';

// 관리자 계정 관리 서버 액션 — refactor_260911.md "Admin account management".
//
// ★ 메뉴 노출과 무관하게 첫 줄에서 requireAdmin()을 다시 확인한다(레이아웃의 확인은 1차
//   방어일 뿐이다). 실제 쓰기는 core.admin_upsert_app_user_profile 등 security definer 함수가
//   ADMIN 여부와 자기 자신 여부를 다시 확인하고, 이곳과 같은 사유(reason)를 core.audit_log에
//   before/after와 함께 남긴다(lib/master-actions.ts와 같은 방식).
// ★ 생성·삭제는 Auth 사용자(auth.users)와 core.app_user 두 곳을 건드린다 — 하나만 성공한
//   상태가 남지 않도록 이 파일이 순서와 롤백을 책임진다(lib/user-admin.ts는 각 단계의
//   { data, error }만 돌려준다).

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { canDeleteUser, canManageUser, canSetActive } from '@/lib/auth-policy';
import {
  validateActiveInput,
  validateCreateUserInput,
  validateDeleteInput,
  validateProfileEditInput,
} from '@/lib/user-admin-model';
import {
  createAuthUser,
  deleteAuthUser,
  deleteUserProfile,
  setUserActive,
  upsertUserProfile,
} from '@/lib/user-admin';

export type UserAdminActionState = { error: string | null; success: string | null };
export const initialUserAdminActionState: UserAdminActionState = { error: null, success: null };

function revalidateUsersScreen() {
  revalidatePath('/admin/users');
}

export async function createUserAction(_prev: UserAdminActionState, formData: FormData): Promise<UserAdminActionState> {
  await requireAdmin();
  const validation = validateCreateUserInput({
    email: formData.get('email'),
    name: formData.get('name'),
    role: formData.get('role'),
    jobRole: formData.get('jobRole'),
    department: formData.get('department'),
    password: formData.get('password'),
  });
  if (!validation.ok) return { error: validation.message, success: null };
  const { value } = validation;

  const created = await createAuthUser({ email: value.email, password: value.password, name: value.name, department: value.department });
  if (created.error || !created.data) return { error: created.error ?? 'Auth 계정을 만들지 못했습니다.', success: null };
  const newUserId = created.data;

  // core.handle_new_auth_user() 트리거가 방금 role=USER · active=true인 기본 프로필을 이미
  // 넣었다. 여기서 관리자가 고른 최종 값으로 확정한다 — 이 호출이 실패하면 Auth 계정만 남은
  // "이름 없는 유령 계정"이 되므로 되돌린다.
  const profile = await upsertUserProfile({
    userId: newUserId,
    email: value.email,
    name: value.name,
    role: value.role,
    jobRole: value.jobRole,
    department: value.department,
    active: true,
    reason: '신규 계정 생성',
  });
  if (profile.error) {
    const rollback = await deleteAuthUser(newUserId);
    return {
      error: rollback.error
        ? `계정 정보를 저장하지 못해 되돌리려 했지만 Auth 계정 삭제도 실패했습니다: ${profile.error} / ${rollback.error}`
        : `계정 정보를 저장하지 못해 Auth 계정 생성을 되돌렸습니다: ${profile.error}`,
      success: null,
    };
  }

  revalidateUsersScreen();
  return { error: null, success: `계정 ${value.email}을 만들었습니다.` };
}

export async function updateProfileAction(_prev: UserAdminActionState, formData: FormData): Promise<UserAdminActionState> {
  const { profile: actor } = await requireAdmin();
  const validation = validateProfileEditInput({
    userId: formData.get('userId'),
    email: formData.get('email'),
    name: formData.get('name'),
    role: formData.get('role'),
    jobRole: formData.get('jobRole'),
    department: formData.get('department'),
    active: formData.get('active'),
    reason: formData.get('reason'),
  });
  if (!validation.ok) return { error: validation.message, success: null };
  const { value } = validation;

  const decision = canManageUser({ actorId: actor.userId, targetId: value.userId, nextRole: value.role, nextActive: value.active });
  if (!decision.allowed) {
    return { error: decision.reason === 'SELF_DEMOTION' ? '자신의 관리자 권한은 제거할 수 없습니다.' : '자신의 계정은 비활성화할 수 없습니다.', success: null };
  }

  const result = await upsertUserProfile(value);
  if (result.error) return { error: result.error, success: null };

  revalidateUsersScreen();
  return { error: null, success: '계정 정보를 저장했습니다.' };
}

export async function setActiveAction(_prev: UserAdminActionState, formData: FormData): Promise<UserAdminActionState> {
  const { profile: actor } = await requireAdmin();
  const validation = validateActiveInput({
    userId: formData.get('userId'),
    active: formData.get('active'),
    reason: formData.get('reason'),
  });
  if (!validation.ok) return { error: validation.message, success: null };
  const { value } = validation;

  const decision = canSetActive({ actorId: actor.userId, targetId: value.userId, nextActive: value.active });
  if (!decision.allowed) return { error: '자신의 계정은 비활성화할 수 없습니다.', success: null };

  const result = await setUserActive(value);
  if (result.error) return { error: result.error, success: null };

  revalidateUsersScreen();
  return { error: null, success: value.active ? '계정을 다시 활성화했습니다.' : '계정을 비활성화했습니다.' };
}

export async function deleteUserAction(_prev: UserAdminActionState, formData: FormData): Promise<UserAdminActionState> {
  const { profile: actor } = await requireAdmin();
  const validation = validateDeleteInput({ userId: formData.get('userId'), reason: formData.get('reason') });
  if (!validation.ok) return { error: validation.message, success: null };
  const { value } = validation;

  const decision = canDeleteUser({ actorId: actor.userId, targetId: value.userId });
  if (!decision.allowed) return { error: '자신의 계정은 삭제할 수 없습니다.', success: null };

  // 먼저 core.app_user를 지운다 — 업무 이력 참조가 있으면 여기서 거절되고 Auth 계정은
  // 그대로 남는다(core.admin_delete_app_user_profile 주석 참고).
  const profileResult = await deleteUserProfile(value);
  if (profileResult.error) return { error: profileResult.error, success: null };

  const authResult = await deleteAuthUser(value.userId);
  if (authResult.error) {
    // 프로필은 이미 지워졌다(위에서 성공) — 여기서부터는 되돌릴 것이 없다. 성공으로 포장하지
    // 않고 운영자가 마저 처리해야 한다는 것을 분명히 알린다(form-error로 표시된다).
    revalidateUsersScreen();
    return {
      error: `계정 프로필은 삭제했지만 Auth 계정 삭제에는 실패했습니다. Supabase 대시보드(Authentication)에서 직접 삭제하세요: ${authResult.error}`,
      success: null,
    };
  }

  revalidateUsersScreen();
  return { error: null, success: '계정을 완전히 삭제했습니다.' };
}
