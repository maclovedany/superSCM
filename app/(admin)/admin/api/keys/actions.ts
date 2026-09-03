'use server';

// API Key 발급 · 폐기 — renew.prd 9.3 · 31.1
//
// ★ 원문은 createApiKey 가 만들어 화면으로 한 번 돌려줍니다.
//   감사 로그에는 keyId · 이름 · scope 만 남기고 **원문과 해시는 넣지 않습니다.**

import { revalidatePath } from 'next/cache';
import { requireAdminOrThrow } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createApiKey, revokeApiKey } from '@/lib/api/keys';
import { isApiScope, type ApiScope } from '@/lib/api/scopes';
import type { CreateKeyState, RevokeKeyState } from './state';

export async function createKeyAction(
  _prev: CreateKeyState,
  formData: FormData,
): Promise<CreateKeyState> {
  let actor;
  try {
    actor = await requireAdminOrThrow();
  } catch {
    return { error: '관리자 권한이 필요합니다.', message: null, plaintext: null, keyId: null };
  }

  const integrationName = String(formData.get('integrationName') ?? '').trim();
  if (!integrationName) {
    return { error: '연동 이름을 입력해주세요.', message: null, plaintext: null, keyId: null };
  }

  const scope = formData
    .getAll('scope')
    .map((value) => String(value))
    .filter(isApiScope) as ApiScope[];

  if (scope.length === 0) {
    return { error: '권한을 하나 이상 선택해주세요.', message: null, plaintext: null, keyId: null };
  }

  const rawExpires = String(formData.get('expiresAt') ?? '').trim();
  if (rawExpires && !/^\d{4}-\d{2}-\d{2}$/.test(rawExpires)) {
    return { error: '만료일은 YYYY-MM-DD 형식입니다.', message: null, plaintext: null, keyId: null };
  }
  // 만료일은 그날이 끝날 때까지 유효합니다.
  const expiresAt = rawExpires ? `${rawExpires}T23:59:59Z` : null;

  const { plaintext, keyId, error } = await createApiKey(integrationName, scope, expiresAt);

  if (error || !plaintext || !keyId) {
    return {
      error: error ?? '키를 발급하지 못했습니다.',
      message: null,
      plaintext: null,
      keyId: null,
    };
  }

  // ★ 원문을 넣지 않습니다. 어떤 키를 누가 언제 만들었는지만 남깁니다.
  await writeAuditLog(actor, {
    action: 'API_KEY_CREATE',
    targetType: 'core.api_key',
    targetId: keyId,
    after: { integrationName, scope, expiresAt },
  });

  revalidatePath('/admin/api/keys');

  return {
    error: null,
    message: `${integrationName} 키를 발급했습니다.`,
    plaintext,
    keyId,
  };
}

export async function revokeKeyAction(
  _prev: RevokeKeyState,
  formData: FormData,
): Promise<RevokeKeyState> {
  let actor;
  try {
    actor = await requireAdminOrThrow();
  } catch {
    return { error: '관리자 권한이 필요합니다.', message: null };
  }

  const keyId = String(formData.get('keyId') ?? '').trim();
  if (!keyId) return { error: '대상 키를 찾을 수 없습니다.', message: null };

  const { ok, message, error } = await revokeApiKey(keyId);

  if (error) return { error: `폐기하지 못했습니다: ${error}`, message: null };
  if (!ok) return { error: message || '폐기하지 못했습니다.', message: null };

  await writeAuditLog(actor, {
    action: 'API_KEY_REVOKE',
    targetType: 'core.api_key',
    targetId: keyId,
    after: { revoked: true },
  });

  revalidatePath('/admin/api/keys');
  return { error: null, message };
}
