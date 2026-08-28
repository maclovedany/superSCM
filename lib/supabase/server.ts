import { createServerClient, type SetAllCookies } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requireSupabaseEnv } from './env';

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = requireSupabaseEnv();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component에서는 cookie 쓰기가 허용되지 않습니다.
          // middleware가 갱신된 세션 cookie를 응답에 반영합니다.
        }
      },
    },
  });
}
