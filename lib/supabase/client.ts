import { createBrowserClient } from '@supabase/ssr';
import { requireSupabaseEnv } from './env';

export function createSupabaseBrowserClient() {
  const { url, publishableKey } = requireSupabaseEnv();
  return createBrowserClient(url, publishableKey);
}
