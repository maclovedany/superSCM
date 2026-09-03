// External API 인증 — renew.prd 9.3 · 31.1
//
// Route Handler 에는 로그인 세션이 없습니다. 그래서 인증을 DB 함수가 합니다.
//
//   Authorization: Bearer <원문>
//     → sha256                       (원문은 여기서 끝. 더 이상 들고 다니지 않습니다)
//     → core.api_key_authenticate    (활성 · 미폐기 · 미만료 판정 + last_used_at 갱신)
//     → { keyId, integrationName, scope, keyHash }
//
// ★ 원문을 로그 · 감사로그 · DB 어디에도 남기지 않습니다. 해시만 다음 단계로 넘깁니다.

import { createSupabaseServerClient } from '../supabase/server';
import {
  apiError,
  hasScope,
  hashKey,
  parseBearer,
  type ApiErrorBody,
  type ApiIdentity,
} from './auth-model.ts';

export {
  API_SCOPES,
  API_SCOPE_LABEL,
  apiError,
  hasScope,
  hashKey,
  isApiScope,
  keyPrefix,
  page,
  parseBearer,
  readPaging,
  type ApiErrorBody,
  type ApiIdentity,
  type ApiScope,
} from './auth-model.ts';

export type AuthFailure = { ok: false; status: number; body: ApiErrorBody };
export type AuthSuccess = { ok: true; identity: ApiIdentity };

/**
 * 요청을 인증합니다.
 *
 * 실패하면 401 입니다. "왜" 는 DB 함수가 준 문구를 그대로 씁니다
 * (폐기됨 · 만료됨 · 확인 불가). 호출자가 자기 키를 들고 있으므로 알려도 됩니다.
 */
export async function authenticate(request: Request): Promise<AuthSuccess | AuthFailure> {
  const plaintext = parseBearer(request.headers.get('authorization'));

  if (!plaintext) {
    return {
      ok: false,
      status: 401,
      body: apiError('UNAUTHORIZED', 'Authorization: Bearer <API 키> 헤더가 필요합니다.'),
    };
  }

  const keyHash = hashKey(plaintext);

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('core')
      .rpc('api_key_authenticate', { p_hash: keyHash });

    if (error) {
      return { ok: false, status: 401, body: apiError('UNAUTHORIZED', '인증에 실패했습니다.') };
    }

    const row = (Array.isArray(data) ? data[0] : data) as
      | { key_id?: string | null; integration_name?: string | null; scope?: string[] | null; ok?: boolean; message?: string }
      | null;

    // ★ ok 가 true 인 경우에만 통과합니다. undefined · null 은 거부입니다 (error.md #20 과 같은 판단).
    if (!row || row.ok !== true || !row.key_id) {
      return {
        ok: false,
        status: 401,
        body: apiError('UNAUTHORIZED', row?.message ?? 'API 키를 확인할 수 없습니다.'),
      };
    }

    return {
      ok: true,
      identity: {
        keyId: row.key_id,
        integrationName: row.integration_name ?? '',
        scope: Array.isArray(row.scope) ? row.scope : [],
        keyHash,
      },
    };
  } catch {
    return { ok: false, status: 401, body: apiError('UNAUTHORIZED', '인증에 실패했습니다.') };
  }
}

/** scope 가 없으면 403 입니다. 401(누구인지 모름)과 구분합니다 */
export function requireScope(
  identity: ApiIdentity,
  required: string,
): { ok: true } | AuthFailure {
  if (hasScope(identity, required)) return { ok: true };
  return {
    ok: false,
    status: 403,
    body: apiError('FORBIDDEN', `이 키에는 ${required} 권한이 없습니다.`),
  };
}

/** 호출 기록. 실패해도 본 응답을 막지 않습니다 (lib/audit.ts 와 같은 판단) */
export async function writeApiLog(entry: {
  keyHash: string | null;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  received?: number | null;
  accepted?: number | null;
  rejected?: number | null;
  batchId?: string | null;
  ip?: string | null;
  idempotencyKey?: string | null;
  response?: unknown;
}): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.schema('core').rpc('api_log_write', {
      p: {
        // ★ 해시입니다. 원문이 아닙니다. DB 함수가 key_id 로 바꿔 담고 해시는 버립니다.
        key_hash: entry.keyHash,
        method: entry.method,
        path: entry.path,
        status: entry.status,
        duration_ms: entry.durationMs,
        received: entry.received ?? null,
        accepted: entry.accepted ?? null,
        rejected: entry.rejected ?? null,
        batch_id: entry.batchId ?? null,
        ip: entry.ip ?? null,
        idempotency_key: entry.idempotencyKey ?? null,
        response: entry.response ?? null,
      },
    });
  } catch (error) {
    console.error('[api] 호출 기록 실패:', error);
  }
}

/** 프록시를 지나온 요청의 원 IP. 없으면 null 로 둡니다 (지어내지 않습니다) */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip');
}
