'use client';

import { useActionState } from 'react';
import { Undo2 } from 'lucide-react';
import { undoBatch } from '../upload/actions';
import { EMPTY_COMMIT } from '../upload/state';

export default function RollbackForm({
  batchId,
  available,
}: {
  batchId: string;
  available: boolean;
}) {
  const [state, action, pending] = useActionState(undoBatch, EMPTY_COMMIT);

  if (!available) {
    return <span className="text-3 t-sm">—</span>;
  }

  return (
    <form action={action} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
      <input type="hidden" name="batchId" value={batchId} />
      <button type="submit" className="btn secondary" disabled={pending}>
        <Undo2 size={13} aria-hidden />
        {pending ? '되돌리는 중…' : '되돌리기'}
      </button>
      {state.error && <span className="t-sm" style={{ color: 'var(--crit-fg)' }}>{state.error}</span>}
      {state.message && <span className="t-sm" style={{ color: 'var(--safe-fg)' }}>{state.message}</span>}
    </form>
  );
}
