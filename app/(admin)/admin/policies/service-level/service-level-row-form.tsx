'use client';

// 등급 한 줄의 서비스 수준 적용 폼 — renew.prd 21.2
//
// 과거 값을 덮어쓰지 않고 오늘 자로 한 행을 더 쌓습니다.
// Z 를 비워 두면 서버가 core.z_table 에서 같은 서비스 수준의 행을 찾습니다.

import { useActionState } from 'react';
import { Check } from 'lucide-react';
import { saveServiceLevel } from './actions';
import { EMPTY_POLICY_ACTION } from './state';
import type { ServiceLevel } from '@/lib/recommendation-model';

export default function ServiceLevelRowForm({ row }: { row: ServiceLevel }) {
  const [state, action, pending] = useActionState(saveServiceLevel, EMPTY_POLICY_ACTION);

  return (
    <form action={action} className="row-form">
      <input type="hidden" name="itemGrade" value={row.itemGrade} />

      <div className="row-form-line">
        <input
          name="serviceLevel"
          type="number"
          min={0}
          max={1}
          step={0.005}
          className="select qty"
          defaultValue={row.serviceLevel ?? ''}
          placeholder="0.95"
          aria-label={`${row.itemGrade} 등급 서비스 수준`}
        />
        <input
          name="zValue"
          type="number"
          step={0.0001}
          className="select qty"
          defaultValue={row.zValue ?? ''}
          placeholder="Z (비우면 표에서)"
          aria-label={`${row.itemGrade} 등급 Z 값`}
        />
        <button
          type="submit"
          className="btn secondary icon"
          aria-label="오늘 자로 적용"
          title="오늘 자로 새 값을 적용합니다"
          disabled={pending}
        >
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
