'use client';

import { useActionState } from 'react';
import { Undo2 } from 'lucide-react';
import { removeOutlierExclusion } from './actions';
import { EMPTY_OUTLIER_EXCLUSION_ACTION } from './state';

export default function ExclusionRemoveForm({
  itemId,
  useDate,
  reasonCode,
}: {
  itemId: string;
  useDate: string;
  reasonCode: string;
}) {
  const [state, action, pending] = useActionState(
    removeOutlierExclusion,
    EMPTY_OUTLIER_EXCLUSION_ACTION,
  );

  return (
    <form action={action} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="useDate" value={useDate} />
      <input type="hidden" name="reasonCode" value={reasonCode} />

      <button
        type="submit"
        className="btn ghost"
        aria-label={`${itemId} ${useDate} 제외 되돌리기`}
        disabled={pending}
      >
        <Undo2 size={13} aria-hidden />
        되돌리기
      </button>

      {state.error && (
        <span className="t-sm" style={{ color: 'var(--crit-fg)' }}>
          {state.error}
        </span>
      )}
    </form>
  );
}
