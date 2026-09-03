'use client';

// 키 폐기 — renew.prd 9.3
//
// 되돌릴 수 없으므로 확인을 한 번 받습니다 (design.md §12).

import { useActionState } from 'react';
import { Ban } from 'lucide-react';
import { revokeKeyAction } from './actions';
import { EMPTY_REVOKE_KEY } from './state';

export default function KeyRevokeForm({
  keyId,
  integrationName,
  revoked,
}: {
  keyId: string;
  integrationName: string;
  revoked: boolean;
}) {
  const [state, action, pending] = useActionState(revokeKeyAction, EMPTY_REVOKE_KEY);

  if (revoked) {
    return <span className="t-sm text-3">폐기됨</span>;
  }

  return (
    <form
      action={action}
      onSubmit={(event) => {
        const ok = window.confirm(
          `'${integrationName}' 키를 폐기하시겠습니까? 이 키로는 즉시 호출할 수 없게 되며 되돌릴 수 없습니다.`,
        );
        if (!ok) event.preventDefault();
      }}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)' }}
    >
      <input type="hidden" name="keyId" value={keyId} />
      <button type="submit" className="btn danger" disabled={pending}>
        <Ban size={14} aria-hidden />
        폐기
      </button>
      {state.error && (
        <span className="t-sm" style={{ color: 'var(--crit-fg)' }}>
          {state.error}
        </span>
      )}
    </form>
  );
}
