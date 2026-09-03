'use client';

// 정책값 한 줄의 편집 폼 — renew.prd 32장
//
// 값을 비울 수 없습니다. REVIEW_PERIOD_DAYS 나 SAFETY_BUFFER_DAYS 가 없으면
// 뷰의 비교식이 null 이 되어 판정 대역이 통째로 사라집니다 (sql/15 의 pol CTE 주석).

import { useActionState } from 'react';
import { Check } from 'lucide-react';
import { savePolicyConfig } from './actions';
import { EMPTY_POLICY_CONFIG_ACTION } from './state';
import type { Policy } from '@/lib/policy';

export default function PolicyConfigForm({ policy }: { policy: Policy }) {
  const [state, action, pending] = useActionState(savePolicyConfig, EMPTY_POLICY_CONFIG_ACTION);

  return (
    <form action={action} className="row-form">
      <input type="hidden" name="key" value={policy.key} />

      <div className="row-form-line">
        <input
          name="valueNum"
          type="number"
          min={0}
          step="any"
          className="select qty"
          defaultValue={policy.valueNum ?? ''}
          aria-label={`${policy.key} 값`}
          required
        />
        {policy.unit && <span className="t-label">{policy.unit}</span>}
        <button type="submit" className="btn secondary icon" aria-label="저장" disabled={pending}>
          <Check size={14} aria-hidden />
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
