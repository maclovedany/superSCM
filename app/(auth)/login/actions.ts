'use server';

import { redirect } from 'next/navigation';
import { safeNextPath } from '@/lib/auth-policy';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type LoginState = { error: string | null };

export async function loginAction(_: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = safeNextPath(String(formData.get('next') ?? '/dashboard'));
  if (!email || !password) return { error: '이메일과 비밀번호를 입력해주세요.' };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: '이메일 또는 비밀번호가 올바르지 않습니다.' };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: '로그인 세션을 확인할 수 없습니다.' };
  const { data: profile } = await supabase.schema('core').from('app_user').select('active').eq('user_id', user.id).maybeSingle();
  if (!profile || profile.active !== true) {
    await supabase.auth.signOut();
    return { error: '비활성화되었거나 등록되지 않은 계정입니다.' };
  }
  await supabase.schema('core').rpc('mark_login');
  redirect(next);
}
