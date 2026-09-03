// 라우트 가드 — renew.prd 4.4
//
// 하는 일 두 가지입니다.
//   1  세션 쿠키를 갱신한다 (서버 컴포넌트는 쿠키를 쓸 수 없습니다)
//   2  로그인하지 않은 요청을 /login 으로 보낸다
//
// 역할 검증(ADMIN)은 여기서 하지 않습니다. DB 조회가 매 요청에 붙기 때문입니다.
// 관리자 화면은 app/(admin)/layout.tsx 가 서버에서 막고, RLS 가 한 번 더 막습니다.

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** 로그인 없이 열 수 있는 경로 */
//
// ★ /api/v1 — External API (renew.prd 9). 세션이 아니라 API 키로 인증합니다.
//   여기서 빼면 키를 제대로 들고 온 요청도 /login 으로 리다이렉트되어,
//   외부 시스템은 200 과 로그인 HTML 을 받습니다. 인증은 각 Route Handler 가
//   lib/api/auth.ts 로 직접 합니다 — 이 목록에 있다고 열려 있는 것이 아닙니다.
const PUBLIC_PATHS = ['/login', '/api/health', '/api/cron', '/api/v1'];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // 환경변수가 없으면 인증을 판정할 수 없습니다.
  // 이때 통과시키면 "설정을 빠뜨렸는데 열려 있는" 상태가 되므로 로그인으로 보냅니다.
  if (!url || !key) {
    return isPublic(request.nextUrl.pathname)
      ? response
      : NextResponse.redirect(new URL('/login', request.url));
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const target = new URL('/login', request.url);
    // 로그인 후 원래 가려던 곳으로 돌려보냅니다.
    if (pathname !== '/') target.searchParams.set('next', pathname);
    return NextResponse.redirect(target);
  }

  // 로그인한 사용자가 /login 에 와도 여기서 되돌려보내지 않습니다.
  //
  // middleware 는 auth 세션만 압니다. core.app_user 행이 없거나 비활성이면
  // 레이아웃이 다시 /login 으로 보내므로, 여기서 /dashboard 로 튕기면
  // 두 경로를 무한히 오갑니다. 세션 정리는 로그인 화면이 안내합니다.

  return response;
}

export const config = {
  matcher: [
    // 정적 파일과 이미지 최적화 경로는 건너뜁니다.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
