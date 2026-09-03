'use client';

import { useActionState } from 'react';
import { FlaskConical, TriangleAlert } from 'lucide-react';
import { runBacktest } from './actions';
import { EMPTY_BACKTEST } from './state';

export default function BacktestForm() {
  const [state, action, pending] = useActionState(runBacktest, EMPTY_BACKTEST);

  return (
    <form action={action} style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <div className="field">
        <label className="t-label" htmlFor="note">
          메모 (선택)
        </label>
        <input id="note" name="note" placeholder="예: 파라미터 조정 후 재채점" />
      </div>

      <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" className="btn primary lg" disabled={pending}>
          <FlaskConical size={15} aria-hidden />
          {pending ? '채점하는 중…' : '백테스트 실행'}
        </button>
        <span className="t-sm text-3">가장 최근 예측 실행을 검증 구간 실적과 대조합니다</span>
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
