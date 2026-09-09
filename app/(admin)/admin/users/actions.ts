'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { canManageUser } from '@/lib/auth-policy';
import type { AppRole } from '@/lib/menu';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type UserUpdateState = { error: string | null; success: string | null };

export async function updateUserAction(_: UserUpdateState, formData: FormData): Promise<UserUpdateState> {
  const { profile: actor } = await requireAdmin();
  const targetId = String(formData.get('userId') ?? '');
  const nextRole = String(formData.get('role') ?? '') as AppRole;
  const nextActive = String(formData.get('active')) === 'true';
  if (!targetId || (nextRole !== 'ADMIN' && nextRole !== 'USER')) return { error: '변경 요청이 올바르지 않습니다.', success: null };
  const decision = canManageUser({ actorId: actor.userId, targetId, nextRole, nextActive });
  if (!decision.allowed) return { error: decision.reason === 'SELF_DEMOTION' ? '자신의 관리자 권한은 제거할 수 없습니다.' : '자신의 계정은 비활성화할 수 없습니다.', success: null };
  const supabase = await createSupabaseServerClient();
  const { data: target, error: targetError } = await supabase.schema('core').from('app_user').select('user_id').eq('user_id', targetId).maybeSingle();
  if (targetError || !target) return { error: '대상 사용자를 찾을 수 없습니다.', success: null };
  const { error } = await supabase.schema('core').from('app_user').update({ role: nextRole, active: nextActive }).eq('user_id', targetId);
  if (error) return { error: error.message, success: null };
  revalidatePath('/admin/users');
  return { error: null, success: '사용자 권한을 변경했습니다.' };
}
