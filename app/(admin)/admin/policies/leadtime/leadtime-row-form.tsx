'use client';

// 공급처 한 줄의 리드타임 확정 폼.
//
// 사유 없이 저장할 수 없습니다 (renew.prd 11.4). 빈 사유는 서버가 한 번 더 거릅니다.
// "해제" 를 누르면 확정값을 지우고 실적 P80 으로 되돌아갑니다.

import { useActionState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { saveLeadtimePlan } from './actions';
import { EMPTY_LEADTIME_ACTION } from './state';
import type { LeadtimePolicy } from '@/lib/inventory';

export default function LeadtimeRowForm({ policy }: { policy: LeadtimePolicy }) {
  const [state, action, pending] = useActionState(saveLeadtimePlan, EMPTY_LEADTIME_ACTION);

  return (
    <form action={action} className="row-form">
      <input type="hidden" name="supplierId" value={policy.supplierId} />

      <div className="row-form-line">
        <input
          name="plannedLeadTime"
          type="number"
          min={1}
          step={1}
          className="select qty"
          defaultValue={policy.plannedLeadTime ?? ''}
          placeholder="일수"
          aria-label={`${policy.supplierId} 계획 리드타임(일)`}
        />
        <input
          name="reason"
          className="select reason"
          placeholder="사유 (필수)"
          aria-label={`${policy.supplierId} 변경 사유`}
          required
        />
        <button
          type="submit"
          name="intent"
          value="SET"
          className="btn secondary icon"
          aria-label="확정"
          disabled={pending}
        >
          <Check size={14} aria-hidden />
        </button>
        <button
          type="submit"
          name="intent"
          value="RELEASE"
          className="btn ghost icon"
          aria-label="확정값 해제"
          disabled={pending || policy.plannedLeadTime === null}
          title="확정값을 지우고 실적 P80 으로 되돌립니다"
        >
          <RotateCcw size={14} aria-hidden />
        </button>
      </div>

      {state.error && (
        <span className="t-sm" style={{ color: 'var(--crit-fg)' }}>
          {state.error}
        </span>
      )}
      {state.message && (
        <span className="t-sm" style={{ color: 'var(--safe-fg)' }}>
          {state.message}
        </span>
      )}
    </form>
  );
}
