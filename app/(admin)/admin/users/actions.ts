'use server';

// 사용자 역할·활성 변경
//
// 액션의 첫 줄에서 권한을 검증합니다. 화면이 이미 막혀 있어도 다시 확인합니다.
// 액션은 URL 만 알면 호출할 수 있기 때문입니다.

import { revalidatePath } from 'next/cache';
import { requireAdminOrThrow } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type UserActionState = { error: string | null; message: string | null };

export async function updateUser(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  let actor;
  try {
    actor = await requireAdminOrThrow();
  } catch {
    return { error: '관리자 권한이 필요합니다.', message: null };
  }

  const userId = String(formData.get('userId') ?? '');
  const role = String(formData.get('role') ?? '');
  const active = formData.get('active') === 'true';

  if (!userId) return { error: '대상 사용자를 찾을 수 없습니다.', message: null };
  if (role !== 'ADMIN' && role !== 'USER') {
    return { error: '역할은 ADMIN 또는 USER 만 가능합니다.', message: null };
  }

  // 자기 자신의 관리자 권한을 스스로 내리면 관리자가 0명이 될 수 있습니다.
  if (userId === actor.userId && (role !== 'ADMIN' || !active)) {
    return { error: '자기 계정의 관리자 권한과 활성 상태는 스스로 바꿀 수 없습니다.', message: null };
  }

  const supabase = await createSupabaseServerClient();

  const { data: before } = await supabase
    .schema('core')
    .from('app_user')
    .select('email, role, active')
    .eq('user_id', userId)
    .maybeSingle();

  const { error } = await supabase
    .schema('core')
    .from('app_user')
    .update({ role, active })
    .eq('user_id', userId);

  if (error) {
    // RLS 가 거부하면 여기로 옵니다. 서버 검증을 뚫어도 DB 가 막습니다.
    return { error: `변경에 실패했습니다: ${error.message}`, message: null };
  }

  await writeAuditLog(actor, {
    action: 'USER_UPDATE',
    targetType: 'core.app_user',
    targetId: userId,
    before: before ?? null,
    after: { role, active },
  });

  revalidatePath('/admin/users');
  const email = (before as { email?: string } | null)?.email ?? userId;
  return { error: null, message: `${email} 을(를) ${role} · ${active ? '활성' : '비활성'} 로 변경했습니다.` };
}
