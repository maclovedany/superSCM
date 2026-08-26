export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return {
    url,
    publishableKey,
    configured: Boolean(url && publishableKey),
  };
}

export function requireSupabaseEnv() {
  const env = getSupabaseEnv();
  if (!env.url || !env.publishableKey) {
    throw new Error('Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.');
  }
  return { url: env.url, publishableKey: env.publishableKey };
}
