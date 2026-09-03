'use client';

// 수동 제외 추가 폼 — renew.prd 12.3
//
// 규칙이 잡지 못한 한 건을 사람이 직접 뺍니다. 사유를 고르게 하는 이유는
// 나중에 목록에서 "왜 이 날이 빠졌는지" 를 한 눈에 보기 위해서입니다.

import { useActionState } from 'react';
import { Scissors, TriangleAlert } from 'lucide-react';
import { addOutlierExclusion } from './actions';
import { EMPTY_OUTLIER_EXCLUSION_ACTION } from './state';
import { OUTLIER_REASONS, OUTLIER_REASON_LABEL } from '@/lib/admin-ops-model';

export default function ExclusionForm() {
  const [state, action, pending] = useActionState(
    addOutlierExclusion,
    EMPTY_OUTLIER_EXCLUSION_ACTION,
  );

  return (
    <form action={action} style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <div style={{ display: 'flex', gap: 'var(--s-3)', flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 10rem' }}>
          <label className="t-label" htmlFor="itemId">
            품목 코드
          </label>
          <input id="itemId" name="itemId" placeholder="예: ITEM003" required />
        </div>

        <div className="field" style={{ flex: '1 1 10rem' }}>
          <label className="t-label" htmlFor="useDate">
            날짜
          </label>
          <input id="useDate" name="useDate" type="date" required />
        </div>

        <div className="field" style={{ flex: '1 1 10rem' }}>
          <label className="t-label" htmlFor="reasonCode">
            사유
          </label>
          <select id="reasonCode" name="reasonCode" className="select" defaultValue="MANUAL">
            {OUTLIER_REASONS.map((code) => (
              <option key={code} value={code}>
                {OUTLIER_REASON_LABEL[code]}
              </option>
            ))}
          </select>
        </div>

        <div className="field" style={{ flex: '2 1 16rem' }}>
          <label className="t-label" htmlFor="note">
            메모 (선택)
          </label>
          <input id="note" name="note" placeholder="예: 창고 이전으로 한 번에 출고" />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" className="btn primary" disabled={pending}>
          <Scissors size={15} aria-hidden />
          {pending ? '빼는 중…' : '학습에서 빼기'}
        </button>
        <span className="t-sm text-3">
          다음 예측 실행부터 반영됩니다. 이미 저장된 예측 결과는 바뀌지 않습니다.
        </span>
      </div>

      {state.error && (
        <p className="login-error" role="alert">
          <TriangleAlert size={14} aria-hidden />
          {state.error}
        </p>
      )}
      {state.message && (
        <div className="insight">
          <div className="insight-head">완료</div>
          <div className="insight-body">{state.message}</div>
        </div>
      )}
    </form>
  );
}
