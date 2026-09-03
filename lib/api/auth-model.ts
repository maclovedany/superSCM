// External API 인증의 순수 부분 — renew.prd 9.3 · 31.1
//
// DB 를 부르는 부분은 lib/api/auth.ts 에 있습니다. 여기에는 Supabase 가 들어오지 않으므로
// node --test 가 그대로 실행할 수 있습니다 (error.md #17 — 상대 import 에 .ts 를 붙입니다).
//
// ★ 원문 키는 이 파일 밖으로 나가지 않습니다.
//   요청 헤더에서 꺼내 sha256 으로 바꾸고, 그 다음부터는 해시만 들고 다닙니다.
//   원문을 로그 · 감사로그 · DB 어디에도 남기지 않습니다.

import { createHash } from 'node:crypto';

// scope 목록은 lib/api/scopes.ts 에 있습니다 — 클라이언트 컴포넌트(키 발급 폼)가
// 그 목록만 필요로 하는데, 이 파일은 node:crypto 를 import 하기 때문입니다.
// 여기서 다시 내보내 서버 코드는 한 곳만 보면 되게 합니다.
export {
  API_SCOPES,
  API_SCOPE_LABEL,
  isApiScope,
  type ApiScope,
} from './scopes.ts';

/** 인증에 성공한 호출자 */
export type ApiIdentity = {
  keyId: string;
  integrationName: string;
  scope: string[];
  /** 뒤이어 부르는 DB 함수에 넘길 값. 원문이 아니라 해시입니다 */
  keyHash: string;
};

/** 오류 응답 본문 — 지시서의 `{ error: { code, message } }` */
export type ApiErrorBody = { error: { code: string; message: string } };

export function apiError(code: string, message: string): ApiErrorBody {
  return { error: { code, message } };
}

/**
 * `Authorization: Bearer <키>` 에서 키 원문을 꺼냅니다.
 *
 * 형식이 조금이라도 다르면 null 입니다. 관대하게 받으면 "Bearer" 를 빠뜨린 요청이
 * 통과하는 등 인증 경로가 여러 갈래로 늘어납니다.
 */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer[ ]+(\S+)$/.exec(header.trim());
  if (!match) return null;
  const token = match[1];
  return token.length > 0 ? token : null;
}

/** 원문 → sha256 hex 64자. DB 에는 이 값만 들어갑니다 */
export function hashKey(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

/** 관리자 화면에 보여줄 식별용 접두어. 32바이트 난수를 되돌릴 수 없는 길이입니다 */
export function keyPrefix(plaintext: string): string {
  return plaintext.slice(0, 8);
}

/**
 * scope 판정.
 *
 * ★ 없는 값 · null · 빈 배열은 전부 거부입니다. NULL 이 통과하는 갈래를 두지 않습니다
 *   (error.md #20 과 같은 이유 — 여기서는 TypeScript 쪽입니다).
 */
export function hasScope(identity: ApiIdentity | null | undefined, required: string): boolean {
  if (!identity) return false;
  if (!Array.isArray(identity.scope)) return false;
  return identity.scope.indexOf(required) >= 0;
}

/** 페이징 — 기본 100 · 최대 1000 (renew.prd 9.2) */
export function readPaging(searchParams: URLSearchParams): { limit: number; offset: number } {
  const rawLimit = Number(searchParams.get('limit'));
  const rawOffset = Number(searchParams.get('offset'));

  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 1000) : 100;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;

  return { limit, offset };
}

/** 목록 한 페이지를 잘라냅니다. 계산이 아니라 잘라내기입니다 */
export function page<T>(rows: T[], limit: number, offset: number) {
  return {
    total: rows.length,
    limit,
    offset,
    data: rows.slice(offset, offset + limit),
  };
}
