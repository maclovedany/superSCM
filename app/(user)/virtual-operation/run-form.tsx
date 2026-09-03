'use client';

import { useActionState } from 'react';
import { PlayCircle, TriangleAlert } from 'lucide-react';
import { runVirtualOperation } from './actions';
import { EMPTY_SIMULATION } from './state';

export default function RunForm({ runIds = [] }: { runIds?: string[] }) {
  const [state, action, pending] = useActionState(runVirtualOperation, EMPTY_SIMULATION);

  return (
    <form action={action} style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <div className="field">
        <label className="t-label" htmlFor="forecastRunId">
          예측 실행 (선택)
        </label>
        <select id="forecastRunId" name="forecastRunId" className="select" defaultValue="">
          <option value="">가장 최근 성공한 검증 실행</option>
          {runIds.map((runId) => (
            <option key={runId} value={runId}>
              {runId}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="t-label" htmlFor="note">
          메모 (선택)
        </label>
        <input id="note" name="note" placeholder="예: 서비스 수준 상향 후 재시뮬레이션" />
      </div>

      <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" className="btn primary lg" disabled={pending}>
          <PlayCircle size={15} aria-hidden />
          {pending ? '시뮬레이션 중…' : '가상 운영 실행'}
        </button>
        <span className="t-sm text-3">
          검증 구간 시작으로 돌아가 매달 발주를 다시 내고, 실제 실적과 나란히 놓습니다.
          목록에는 <b>검증 실행</b>만 나옵니다 — 운영 실행의 예측은 검증 구간 뒤에 있어 비교가
          성립하지 않습니다.
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
