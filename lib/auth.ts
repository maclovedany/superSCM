// 권한 검증 — renew.prd 4장 · 32장
//
// 화면 숨김만으로는 부족합니다. 서버에서 검증합니다.
// 모든 서버 컴포넌트와 Server Action 은 첫 줄에서 이 함수를 부릅니다.
//
// 3중 방어 중 두 번째 층입니다.
//   1  Frontend   lib/menu.ts 가 역할별 메뉴만 그린다
//   2  Backend    이 파일 — 레이아웃 · 액션에서 검증
//   3  Database   sql/03-auth.sql · 04-rls.sql 의 RLS

import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from './supabase/server';
import { isSalesActor } from './agent/redact';
import type { Role } from './menu';

export type SessionUser = {
  userId: string;
  email: string;
  name: string | null;
  department: string | null;
  role: Role;
  active: boolean;
};

/**
 * 세션 상태.
 *
 * "로그인하지 않음" 과 "로그인했으나 쓸 수 없는 계정" 을 구분합니다.
 * 구분하지 않으면 프로필이 없는 계정이 /login 과 /dashboard 를 무한히 오갑니다.
 */
export type SessionResult =
  | { status: 'OK'; user: SessionUser }
  | { status: 'NO_SESSION' }
  | { status: 'NO_PROFILE' }
  | { status: 'INACTIVE' }
  | { status: 'ERROR'; detail: string };

/**
 * ★ react `cache()` — 한 요청 안에서는 한 번만 Auth 서버와 DB 에 묻습니다.
 *   레이아웃(requireUser)과 화면(requireUser · getSessionUser)이 각자 부르면 요청마다
 *   Auth 검증 2회 + app_user 조회 2회 = 왕복 4번(약 300~400ms)이 더 붙었습니다.
 *   캐시는 요청 단위라 사용자끼리 섞이지 않고, 다음 요청은 다시 검증합니다.
 */
export const getSession = cache(async function getSession(): Promise<SessionResult> {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    return { status: 'ERROR', detail: error instanceof Error ? error.message : 'Supabase 설정 오류' };
  }

  // getUser 는 매번 Auth 서버에 토큰을 검증합니다.
  // getSession 은 쿠키를 그대로 믿으므로 권한 판정에 쓰지 않습니다.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: 'NO_SESSION' };

  const { data, error } = await supabase
    .schema('core')
    .from('app_user')
    .select('user_id, email, name, department, role, active')
    .eq('user_id', user.id)
    .maybeSingle();

  // 테이블이 없거나 RLS 로 막힌 경우입니다. sql/03-auth.sql 미실행이 가장 흔합니다.
  if (error) return { status: 'ERROR', detail: error.message };
  if (!data) return { status: 'NO_PROFILE' };

  const row = data as {
    user_id: string;
    email: string;
    name: string | null;
    department: string | null;
    role: string;
    active: boolean;
  };

  if (!row.active) return { status: 'INACTIVE' };

  return {
    status: 'OK',
    user: {
      userId: row.user_id,
      email: row.email,
      name: row.name,
      department: row.department,
      role: row.role === 'ADMIN' ? 'ADMIN' : 'USER',
      active: row.active,
    },
  };
});

/** 쓸 수 있는 계정이 아니면 null 을 돌려줍니다. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const result = await getSession();
  return result.status === 'OK' ? result.user : null;
}

/**
 * 쓸 수 있는 계정이 아니면 /login 으로 보냅니다.
 *
 * 왜 그렇게 됐는지를 쿼리로 넘겨 로그인 화면이 안내합니다.
 * "로그인은 됐는데 화면이 안 열린다" 를 말없이 두지 않기 위해서입니다.
 */
export async function requireUser(): Promise<SessionUser> {
  const result = await getSession();

  switch (result.status) {
    case 'OK':
      return result.user;
    case 'NO_PROFILE':
      redirect('/login?reason=no_profile');
    // eslint-disable-next-line no-fallthrough
    case 'INACTIVE':
      redirect('/login?reason=inactive');
    // eslint-disable-next-line no-fallthrough
    case 'ERROR':
      redirect(`/login?reason=error&detail=${encodeURIComponent(result.detail)}`);
    // eslint-disable-next-line no-fallthrough
    default:
      redirect('/login');
  }
}

/**
 * 영업 사용자인가 — renew.prd 4.5 (정보 접근 범위) · 27장.
 *
 * 지금 Role 은 ADMIN · USER 둘뿐입니다 (renew.prd 4.1 "향후 확장").
 * 영업 구분은 `core.app_user.department` 로 합니다.
 *
 *   ★ 규칙 — department 가 '영업' 으로 시작하거나 대문자로 'SALES' 를 포함하면 영업 사용자.
 *     예) '영업1팀' · '영업기획' · 'Sales Planning' · 'SALES'  → 영업
 *         '구매팀' · 'SCM' · 'Supply Chain'                     → 영업 아님
 *
 *   같은 규칙이 DB 에도 있습니다 — `core.is_sales()` (sql/23-atp-sales.sql §1).
 *   두 곳을 함께 고치세요. 한쪽만 바꾸면 화면과 DB 의 판정이 갈립니다.
 *
 * ★ 관리자는 영업 부서여도 영업으로 보지 않습니다. renew.prd 4.2 가 ADMIN 을
 *   "모든 USER 기능" 으로 정의하므로, 관리자에게서 화면·메뉴·필드를 빼앗으면
 *   그 정의가 깨집니다. 판정을 이 함수 한 곳에 두어, 부르는 쪽(화면·메뉴·액션)이
 *   역할 검사를 각자 반복하다 한 곳에서 빠뜨리는 일을 막습니다.
 *   툴 집합을 고르는 lib/agent/orchestrator.ts 도 같은 결론을 냅니다.
 *
 * ★ 판정 자체는 `lib/agent/redact.ts` 의 `isSalesDepartment` 한 곳에 있습니다.
 *   여기 다시 적으면 규칙이 두 벌이 됩니다. 그 파일은 순수 함수만 두어
 *   `node --test` 가 Supabase 없이 실행할 수 있고(error.md #17), 툴 결과 가리기가
 *   같은 판정을 씁니다.
 */
export function isSalesUser(
  user: Pick<SessionUser, 'department' | 'role'> | null | undefined,
): boolean {
  return isSalesActor(user ?? null);
}

/**
 * 관리자가 아니면 null 을 돌려줍니다.
 *
 * 화면은 이 값으로 403 을 그리고, Server Action 은 예외를 던집니다.
 * 액션에서는 requireAdminOrThrow 를 쓰세요.
 */
export async function requireAdmin(): Promise<SessionUser | null> {
  const user = await requireUser();
  return user.role === 'ADMIN' ? user : null;
}

/** Server Action 용. 관리자가 아니면 실행을 중단합니다. */
export async function requireAdminOrThrow(): Promise<SessionUser> {
  const user = await requireAdmin();
  if (!user) throw new Error('관리자 권한이 필요합니다.');
  return user;
}
