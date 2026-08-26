import { NextResponse } from 'next/server';
import { getSupabaseEnv } from '@/lib/supabase/env';

export async function GET() {
  const env = getSupabaseEnv();
  if (!env) {
    return NextResponse.json({ configured: false, message: 'Supabase environment variables are missing.' }, { status: 503 });
  }

  return NextResponse.json({ configured: true, message: 'Supabase environment is configured.' });
}
