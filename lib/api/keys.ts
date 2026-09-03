// API Key 발급 · 폐기 · 조회 — renew.prd 9.3 · 31.1
//
// ★ "원문은 생성 시 한 번만 노출한다. 이후 해시만 보관한다."
//
//   원문은 이 파일의 createApiKey 가 만들어 **한 번** 돌려주고, 그것으로 끝입니다.
//   DB 에는 sha256 해시와 앞 8자만 들어갑니다.
//   감사로그에도 원문을 넣지 않습니다 (호출부가 keyId · 이름 · scope 만 남깁니다).

import { randomBytes } from 'node:crypto';
import { createSupabaseServerClient } from '../supabase/server';
import { hashKey, keyPrefix } from './auth-model.ts';
import type { ApiScope } from './scopes.ts';

/** 화면이 쓰는 키 한 줄 — analytics.v_api_key */
export type ApiKeyRow = {
  keyId: string;
  integrationName: string;
  keyPrefix: string;
  scope: string[];
  active: boolean;
  createdEmail: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  /** ACTIVE · EXPIRED · REVOKED · INACTIVE */
  status: string;
  callCount: number;
};

/** 호출 기록 한 줄 — analytics.v_api_log */
export type ApiLogRow = {
  id: number;
  keyId: string | null;
  integrationName: string | null;
  method: string | null;
  path: string | null;
  status: number | null;
  durationMs: number | null;
  received: number | null;
  accepted: number | null;
  rejected: number | null;
  batchId: string | null;
  ip: string | null;
  idempotencyKey: string | null;
  at: string | null;
};

export type ApiKpi = {
  callsToday: number;
  clientErrorToday: number;
  serverErrorToday: number;
  acceptedToday: number;
  rejectedToday: number;
  callsTotal: number;
  activeKeys: number;
  /** 인증되지 않은 호출. core.api_log 에 행이 없고 카운터로만 셉니다 */
  anonToday: number;
};

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function failure(error: unknown): string {
  return error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.';
}

/**
 * 새 키를 만듭니다.
 *
 * 원문 = 'sk_scm_' + 32바이트 난수(base64url).
 * 접두어 'sk_scm_' 은 사람이 "이건 SuperSCM 키다" 를 알아보게 하고,
 * 유출된 문자열을 소스코드 스캐너가 잡을 수 있게 합니다.
 *
 * ★ 돌려준 plaintext 는 호출한 화면이 한 번 보여준 뒤 버려야 합니다.
 *   다시 만들 수 없습니다 — DB 에는 해시만 있습니다.
 */
export async function createApiKey(
  integrationName: string,
  scope: ApiScope[],
  expiresAt: string | null,
): Promise<{ plaintext: string | null; keyId: string | null; error: string | null }> {
  try {
    const plaintext = `sk_scm_${randomBytes(32).toString('base64url')}`;

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('api_key_create', {
      p_integration_name: integrationName,
      p_scope: scope,
      p_expires_at: expiresAt,
      p_hash: hashKey(plaintext),
      p_prefix: keyPrefix(plaintext),
    });

    if (error) return { plaintext: null, keyId: null, error: error.message };

    const row = (Array.isArray(data) ? data[0] : data) as
      | { key_id?: string | null; message?: string }
      | null;

    if (!row?.key_id) {
      return { plaintext: null, keyId: null, error: row?.message ?? '키를 발급하지 못했습니다.' };
    }

    return { plaintext, keyId: row.key_id, error: null };
  } catch (error) {
    return { plaintext: null, keyId: null, error: failure(error) };
  }
}

export async function revokeApiKey(
  keyId: string,
): Promise<{ ok: boolean; message: string; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('api_key_revoke', { p_key_id: keyId });

    if (error) return { ok: false, message: '', error: error.message };

    const row = (Array.isArray(data) ? data[0] : data) as
      | { ok?: boolean; message?: string }
      | null;

    return { ok: row?.ok === true, message: row?.message ?? '', error: null };
  } catch (error) {
    return { ok: false, message: '', error: failure(error) };
  }
}

export async function listApiKeys(): Promise<{ rows: ApiKeyRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_api_key')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => {
      const row = item as Record<string, unknown>;
      return {
        keyId: String(row.key_id ?? ''),
        integrationName: String(row.integration_name ?? ''),
        keyPrefix: String(row.key_prefix ?? ''),
        scope: Array.isArray(row.scope) ? row.scope.map((s) => String(s)) : [],
        active: row.active === true,
        createdEmail: text(row.created_email),
        createdAt: text(row.created_at),
        expiresAt: text(row.expires_at),
        lastUsedAt: text(row.last_used_at),
        revokedAt: text(row.revoked_at),
        status: String(row.status ?? 'ACTIVE'),
        callCount: num(row.call_count) ?? 0,
      };
    });
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

export async function getApiLogs(limit = 200): Promise<{ rows: ApiLogRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_api_log')
      .select('*')
      // PostgREST 기본 상한이 1,000행입니다. 목록 조회는 상한을 명시합니다 (공통규칙 11).
      .order('at', { ascending: false })
      .limit(limit);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => {
      const row = item as Record<string, unknown>;
      return {
        id: num(row.id) ?? 0,
        keyId: text(row.key_id),
        integrationName: text(row.integration_name),
        method: text(row.method),
        path: text(row.path),
        status: num(row.status),
        durationMs: num(row.duration_ms),
        received: num(row.received),
        accepted: num(row.accepted),
        rejected: num(row.rejected),
        batchId: text(row.batch_id),
        ip: text(row.ip),
        idempotencyKey: text(row.idempotency_key),
        at: text(row.at),
      };
    });
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

export async function getApiKpi(): Promise<{ data: ApiKpi | null; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_api_kpi')
      .select('*')
      .maybeSingle();

    if (error) return { data: null, error: error.message };
    if (!data) return { data: null, error: null };

    const row = data as Record<string, unknown>;
    return {
      data: {
        callsToday: num(row.calls_today) ?? 0,
        clientErrorToday: num(row.client_error_today) ?? 0,
        serverErrorToday: num(row.server_error_today) ?? 0,
        acceptedToday: num(row.accepted_today) ?? 0,
        rejectedToday: num(row.rejected_today) ?? 0,
        callsTotal: num(row.calls_total) ?? 0,
        activeKeys: num(row.active_keys) ?? 0,
        anonToday: num(row.anon_today) ?? 0,
      },
      error: null,
    };
  } catch (error) {
    return { data: null, error: failure(error) };
  }
}
