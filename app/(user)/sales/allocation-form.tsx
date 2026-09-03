'use client';

// 가예약 [확정] · [해제] — renew.prd 27.6
//
// 표의 행마다 하나씩 섭니다. 이미 확정되었거나 해제된 예약에는 버튼을 두지 않습니다 —
// 누를 수 없는 버튼을 누르게 만들면 더 나쁩니다 (design.md §6.4 의 KPI 카드와 같은 판단).

import { useActionState } from 'react';
import { Check, TriangleAlert, X } from 'lucide-react';
import { confirmAllocation, releaseAllocation } from './actions';
import { EMPTY_ALLOCATION_ACTION } from './state';

export default function AllocationForm({
  allocationId,
  kind,
}: {
  allocationId: number;
  /** confirm 은 수주 확정, release 는 해제입니다 */
  kind: 'confirm' | 'release';
}) {
  const [state, action, pending] = useActionState(
    kind === 'confirm' ? confirmAllocation : releaseAllocation,
    EMPTY_ALLOCATION_ACTION,
  );

  const label = kind === 'confirm' ? '확정' : '해제';
  const busy = kind === 'confirm' ? '확정하는 중…' : '해제하는 중…';

  return (
    <form action={action} style={{ display: 'inline-flex', gap: 'var(--s-2)', alignItems: 'center' }}>
      <input type="hidden" name="allocationId" value={allocationId} />
      <button
        type="submit"
        className={kind === 'confirm' ? 'btn secondary' : 'btn ghost'}
        disabled={pending}
      >
        {kind === 'confirm' ? <Check size={13} aria-hidden /> : <X size={13} aria-hidden />}
        {pending ? busy : label}
      </button>

      {state.error && (
        <span className="t-sm hl-crit" role="alert">
          <TriangleAlert size={12} aria-hidden /> {state.error}
        </span>
      )}
      {state.message && <span className="t-sm text-3">{state.message}</span>}
    </form>
  );
}
