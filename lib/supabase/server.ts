// 서버에서 쓰는 Supabase 클라이언트입니다.
//
// STEP 2 에서 세션 없는 읽기 전용 클라이언트를 쿠키 기반으로 바꿨습니다.
// 로그인 세션이 쿠키에 있어야 RLS 의 auth.uid() 가 동작합니다.
//
// 쿠키 쓰기는 Server Action 과 Route Handler 에서만 됩니다.
// 서버 컴포넌트에서는 조용히 무시하고, 갱신은 middleware.ts 가 맡습니다.

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requireSupabaseEnv } from './env';

export async function createSupabaseServerClient() {
  const { url, publishableKey } = requireSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // 서버 컴포넌트에서 호출된 경우입니다. middleware 가 세션을 갱신합니다.
        }
      },
    },
  });
}
