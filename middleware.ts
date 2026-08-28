import { createServerClient, type SetAllCookies } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseEnv } from '@/lib/supabase/env';
import { routeAccessDecision } from '@/lib/auth-policy';

const protectedPrefixes = ['/dashboard', '/analysis', '/admin', '/workflow'];

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const protectedRoute = protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (!protectedRoute) return NextResponse.next();

  const env = getSupabaseEnv();
  if (!env) return new NextResponse('Supabase 환경변수가 필요합니다.', { status: 503 });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    loginUrl.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  const { data: profile } = await supabase.schema('core').from('app_user').select('role, active').eq('user_id', user.id).maybeSingle();
  const access = routeAccessDecision({ pathname, authenticated: true, active: profile?.active === true, role: profile?.role === 'ADMIN' ? 'ADMIN' : profile?.role === 'USER' ? 'USER' : null });
  if (access.kind === 'FORBIDDEN') return new NextResponse('이 경로에 접근할 권한이 없습니다.', { status: 403 });

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
