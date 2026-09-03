'use client';

import { useActionState } from 'react';
import { Check } from 'lucide-react';
import { toggleOutlierRule } from './actions';
import { EMPTY_OUTLIER_RULE_ACTION } from './state';

export default function RuleToggleForm({
  ruleId,
  active,
}: {
  ruleId: number;
  active: boolean;
}) {
  const [state, action, pending] = useActionState(toggleOutlierRule, EMPTY_OUTLIER_RULE_ACTION);

  return (
    <form action={action} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
      <input type="hidden" name="ruleId" value={ruleId} />

      <select
        name="active"
        defaultValue={String(active)}
        className="select"
        aria-label={`${ruleId}번 규칙 사용 여부`}
      >
        <option value="true">사용</option>
        <option value="false">중지</option>
      </select>

      <button type="submit" className="btn secondary icon" aria-label="저장" disabled={pending}>
        <Check size={14} aria-hidden />
      </button>

      {state.error && (
        <span className="t-sm" style={{ color: 'var(--crit-fg)' }}>
          {state.error}
        </span>
      )}
      {state.message && (
        <span className="t-sm" style={{ color: 'var(--safe-fg)' }}>
          저장됨
        </span>
      )}
    </form>
  );
}
