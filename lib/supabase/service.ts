// ★ 서버 전용 Supabase 클라이언트 (secret 키) — renew.prd 9.2 · 31.1
//
// 이 import 가 첫 줄인 이유
//   `server-only` 는 클라이언트 번들에 들어가는 순간 **빌드를 실패시키는** 표식입니다.
//   이 파일이 실수로 'use client' 컴포넌트에 딸려 들어가면 npm run build 가 멈춥니다.
//   런타임에 발견하는 것보다 빌드에서 막는 편이 낫습니다.
import 'server-only';

import { createServerClient, type CookieOptions } from '@supabase/ssr';
// 타입만 가져옵니다. `import type` 은 컴파일 때 사라지므로 next/headers 가 딸려오지 않습니다.
import type { createSupabaseServerClient } from './server';

// ── AGENTS.md "secret 키(sb_secret_…)를 클라이언트 코드에 넣지 않습니다" 와 충돌하지 않습니다 ──
//
//   그 규칙은 **브라우저로 나가는 코드**에 secret 키를 넣지 말라는 것입니다.
//   이 파일은 세 겹으로 서버에 묶여 있습니다.
//     ① `import 'server-only'`  — 클라이언트 번들에 들어가면 빌드가 실패합니다
//     ② 환경변수 이름에 NEXT_PUBLIC_ 접두어가 없습니다 — Next.js 가 브라우저 번들에
//        치환해 넣지 않습니다. 접두어를 붙이면 그 순간 규칙 위반입니다
//     ③ 이 함수를 부르는 곳은 Route Handler(app/api/v1/**)뿐이고, 전부 서버에서 실행됩니다
//
// ── secret 키는 RLS 를 통째로 우회합니다 ──
//
//   그래서 이 클라이언트는 **호출자를 이미 확인한 뒤에만** 써야 합니다.
//   /api/v1 에서는 lib/api/handler.ts 의 passGates() 가 먼저 지납니다.
//     ① IP 호출 제한  ② API 키 해시 인증  ③ scope 검사  ④ 키별 호출 제한
//   그 넷을 통과하지 못하면 핸들러가 응답을 만들어 곧바로 돌려주므로,
//   work() 안으로 들어오지 못합니다. 즉 이 클라이언트에 닿을 수 없습니다.
//   근거는 보고서 "수정 라운드 2 · secret 키가 인증 뒤에만 쓰이는 근거" 에 적었습니다.
//
//   ★ 서버 컴포넌트(화면)에서는 쓰지 마세요. 화면은 로그인 세션으로 RLS 를 지나야 합니다.
//     lib/supabase/server.ts 의 createSupabaseServerClient() 를 그대로 쓰십시오.

/**
 * lib/supabase/server.ts 가 만드는 것과 **같은 타입**입니다.
 *
 * `ReturnType<typeof createServerClient>` 로 쓰면 안 됩니다 — 제네릭이 제약값으로 채워져
 * 스키마 이름이 `never` 가 되고, `.schema('analytics')` 가 타입 오류로 막힙니다.
 * 실제 호출에서 추론된 타입을 그대로 빌려옵니다.
 */
export type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * secret 키로 접속하는 서버 전용 클라이언트.
 *
 * 키가 없으면 **null 입니다. throw 하지 않습니다.**
 * throw 하면 "설정을 안 했다" 가 500 으로 나가 연동 쪽이 원인을 알 수 없습니다.
 * 부르는 쪽이 null 을 보고 503 과 사유를 돌려줍니다.
 */
export function createSupabaseServiceClient(): SupabaseServerClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) return null;

  // 쿠키를 읽지도 쓰지도 않습니다. 세션이 없어야 secret 키의 권한 그대로 나갑니다.
  // (쿠키에 남의 세션이 있으면 그 세션으로 덮여 권한이 달라집니다.)
  return createServerClient(url, secretKey, {
    cookies: {
      getAll() {
        return [];
      },
      setAll(_cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        // 아무 것도 하지 않습니다.
      },
    },
  });
}
