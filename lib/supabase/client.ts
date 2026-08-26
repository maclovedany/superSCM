// 브라우저(클라이언트 컴포넌트)에서 쓰는 Supabase 클라이언트입니다.

import { createClient } from '@supabase/supabase-js';
import { requireSupabaseEnv } from './env';

export function createSupabaseBrowserClient() {
  const { url, publishableKey } = requireSupabaseEnv();
  return createClient(url, publishableKey);
}
