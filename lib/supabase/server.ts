// 서버 컴포넌트에서 쓰는 Supabase 클라이언트입니다.
//
// 조회 함수(lib/scm.ts)가 이 클라이언트를 씁니다.
// 세션을 쓰지 않는 읽기 전용 조회라 세션 유지 설정을 꺼둡니다.

import { createClient } from '@supabase/supabase-js';
import { requireSupabaseEnv } from './env';

export async function createSupabaseServerClient() {
  const { url, publishableKey } = requireSupabaseEnv();
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
