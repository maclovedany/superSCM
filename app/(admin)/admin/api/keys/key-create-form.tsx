'use client';

// 키 발급 폼 — renew.prd 9.3
//
// ★ 발급 직후 원문이 이 컴포넌트의 상태에만 잠깐 머뭅니다.
//   새로고침하면 사라지고 다시 만들 수 없습니다. 그 사실을 화면에 적어 둡니다.

import { useActionState } from 'react';
import { KeyRound } from 'lucide-react';
import { createKeyAction } from './actions';
import { EMPTY_CREATE_KEY } from './state';
import { API_SCOPES, API_SCOPE_LABEL } from '@/lib/api/scopes';

export default function KeyCreateForm() {
  const [state, action, pending] = useActionState(createKeyAction, EMPTY_CREATE_KEY);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <form action={action} style={{ display: 'grid', gap: 'var(--s-4)' }}>
        <label className="field">
          <span className="t-label">연동 이름</span>
          <input
            name="integrationName"
            placeholder="예: 생산법인 ERP"
            maxLength={80}
            required
            disabled={pending}
          />
        </label>

        <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
          <span className="t-label">권한 (scope)</span>
          <div className="scope-picker">
            {API_SCOPES.map((scope) => (
              <label key={scope} className="scope-option">
                <input type="checkbox" name="scope" value={scope} disabled={pending} />
                <code>{scope}</code>
                <span>{API_SCOPE_LABEL[scope]}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="t-label">만료일 (비워두면 만료 없음)</span>
          <input type="date" name="expiresAt" disabled={pending} />
        </label>

        <div>
          <button type="submit" className="btn primary" disabled={pending}>
            <KeyRound size={14} aria-hidden />
            {pending ? '발급하는 중…' : '키 발급'}
          </button>
        </div>

        {state.error && (
          <p className="t-sm" style={{ color: 'var(--crit-fg)' }}>
            {state.error}
          </p>
        )}
      </form>

      {state.plaintext && (
        <div className="api-secret" role="status">
          <p className="api-secret-title">
            이 창을 닫으면 다시 볼 수 없습니다. 지금 복사해 두세요.
          </p>
          <code className="code-block">{state.plaintext}</code>
          <p className="api-secret-note">
            서버에는 이 값의 해시만 저장됩니다. 잃어버리면 새 키를 발급하고 이 키를 폐기해야 합니다.
            발급된 키 ID 는 <span className="t-code">{state.keyId}</span> 입니다.
          </p>
        </div>
      )}
    </div>
  );
}
