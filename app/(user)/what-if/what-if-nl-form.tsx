'use client';

// 자연어로 묻기 — renew.prd 25.2 마지막 줄
//
// ★ LLM 은 파라미터만 만듭니다. 숫자는 SQL 이 계산합니다 (renew.prd 26.1).
//   AI 가 설정되지 않았거나 실패하면 사유만 보이고, 아래 수동 폼은 그대로 동작합니다
//   (renew.prd 31.4).

import { useActionState } from 'react';
import { Sparkles, TriangleAlert } from 'lucide-react';
import { askScenario } from './actions';
import { EMPTY_WHAT_IF } from './state';

const EXAMPLES = [
  'SUP006 리드타임이 두 배가 되면?',
  '수요가 20% 늘면 언제 결품인가요?',
  '배가 20일 늦게 도착하면 어떻게 되나요?',
];

export default function WhatIfNlForm({ itemId }: { itemId: string }) {
  const [state, action, pending] = useActionState(askScenario, EMPTY_WHAT_IF);

  return (
    <form action={action} style={{ display: 'grid', gap: 'var(--s-3)' }}>
      <input type="hidden" name="item" value={itemId} />

      <div className="field">
        <label className="t-label" htmlFor="wi-question">
          말로 물어보기 (선택)
        </label>
        <input
          id="wi-question"
          name="question"
          placeholder="예: 리드타임이 두 배가 되면?"
          autoComplete="off"
        />
        <span className="t-sm text-3">
          AI 는 가정을 파라미터로 옮기기만 합니다. 숫자는 시스템이 계산합니다
        </span>
      </div>

      <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" className="btn secondary" disabled={pending}>
          <Sparkles size={15} aria-hidden />
          {pending ? '읽는 중…' : '파라미터로 바꿔 실행'}
        </button>
        <span className="t-sm text-3">{EXAMPLES.join(' · ')}</span>
      </div>

      {state.error && (
        <p className="login-error" role="alert">
          <TriangleAlert size={14} aria-hidden />
          {state.error}
        </p>
      )}
      {state.notice && <p className="t-sm text-3">{state.notice}</p>}
    </form>
  );
}
