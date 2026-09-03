'use server';

// 로그인 · 로그아웃 Server Action
//
// 쿠키 쓰기는 Server Action 에서만 가능합니다 (lib/supabase/server.ts 주석 참조).

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from './supabase/server';

export type LoginState = { error: string | null };

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/dashboard');

  if (!email || !password) {
    return { error: '이메일과 비밀번호를 모두 입력해주세요.' };
  }

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return { error: 'Supabase 환경변수가 설정되지 않았습니다. .env.local 을 확인해주세요.' };
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Supabase 원문은 영어이므로 화면 문구로 바꿉니다.
    const message =
      error.message === 'Invalid login credentials'
        ? '이메일 또는 비밀번호가 올바르지 않습니다.'
        : error.message === 'Email not confirmed'
          ? '이메일 인증이 완료되지 않은 계정입니다. 관리자에게 문의해주세요.'
          : `로그인에 실패했습니다: ${error.message}`;
    return { error: message };
  }

  // 비활성 계정은 세션을 끊습니다.
  const { data: row } = await supabase
    .schema('core')
    .from('app_user')
    .select('active')
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (row && (row as { active: boolean }).active === false) {
    await supabase.auth.signOut();
    return { error: '비활성 처리된 계정입니다. 관리자에게 문의해주세요.' };
  }

  await supabase
    .schema('core')
    .from('app_user')
    .update({ last_login_at: new Date().toISOString() })
    .eq('user_id', data.user.id);

  revalidatePath('/', 'layout');
  redirect(next.startsWith('/') ? next : '/dashboard');
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
