'use client';

// 알림 확인 버튼 — renew.prd 24.2 "acknowledged_by"
//
// 행마다 하나씩 섭니다. 이미 확인한 알림은 버튼 대신 확인자와 시각을 보여줍니다.

import { useActionState } from 'react';
import { Check } from 'lucide-react';
import { acknowledgeAlert } from './actions';
import { EMPTY_ALERT_ACTION } from './state';

export default function AcknowledgeForm({ alertId }: { alertId: number }) {
  const [state, action, pending] = useActionState(acknowledgeAlert, EMPTY_ALERT_ACTION);

  return (
    <form action={action}>
      <input type="hidden" name="alertId" value={alertId} />
      <button type="submit" className="btn secondary" disabled={pending}>
        <Check size={13} aria-hidden />
        {pending ? '확인하는 중…' : '확인'}
      </button>
      {state.error && (
        <span className="t-sm" style={{ color: 'var(--crit-fg)' }} role="alert">
          {state.error}
        </span>
      )}
      {state.message && <span className="t-sm text-3">{state.message}</span>}
    </form>
  );
}
