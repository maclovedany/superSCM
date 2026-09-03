'use client';

// 질문 입력 폼 — renew.prd 26.5
//
// 스트리밍을 넣지 않았습니다. 답이 오면 한 번에 보여 줍니다.
// 예시 질문 칩을 누르면 입력창이 채워집니다 — 무엇을 물어볼 수 있는지가 가장 큰 벽입니다.

import { useActionState, useEffect, useRef, useState } from 'react';
import { Send, Sparkles, TriangleAlert } from 'lucide-react';
import { ask } from './actions';
import { EMPTY_ASK, EXAMPLE_QUESTIONS } from './state';

export default function ChatForm({
  conversationId,
  initialQuestion = '',
  disabled = false,
  disabledNote,
  examples = EXAMPLE_QUESTIONS,
  placeholder = '예: ITEM012 왜 이만큼 발주해야 해?',
}: {
  /** 이어 갈 대화. 비어 있으면 새 대화가 시작됩니다 */
  conversationId: string | null;
  /** 우측 레일의 [이 품목에 대해 묻기] 가 ?q= 로 넘겨 준 질문 */
  initialQuestion?: string;
  /** AI 미설정 */
  disabled?: boolean;
  disabledNote?: string;
  /**
   * 예시 질문 칩.
   *
   * 영업 사용자에게는 renew.prd 27.2 의 질문을 보여 줍니다 — 기본값(26.5)은
   * 발주·정확도처럼 영업이 부를 수 없는 툴을 부르는 질문이라 그대로 두면
   * 누를 때마다 "산출할 수 없습니다" 가 나옵니다 (STEP 17).
   */
  examples?: readonly string[];
  placeholder?: string;
}) {
  const [state, action, pending] = useActionState(ask, EMPTY_ASK);
  const [question, setQuestion] = useState(initialQuestion);
  const wasPending = useRef(false);

  // 링크로 들어온 질문이 바뀌면 입력창을 다시 채웁니다.
  useEffect(() => {
    if (initialQuestion) setQuestion(initialQuestion);
  }, [initialQuestion]);

  // 보내고 나면 입력창을 비웁니다.
  //
  // 액션이 성공하면 같은 경로의 다른 대화(?c=…)로 이동할 뿐이라 이 컴포넌트는 다시 마운트되지
  // 않습니다. 비우지 않으면 방금 보낸 질문이 남아 두 번 보내기 쉽습니다.
  // 실패했을 때는 그대로 둡니다 — 사람이 다시 타이핑하게 만들지 않습니다.
  useEffect(() => {
    const finished = wasPending.current && !pending;
    wasPending.current = pending;
    if (finished && !state.error && !state.answer) setQuestion('');
  }, [pending, state]);

  return (
    <form action={action} style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <input type="hidden" name="conversationId" value={conversationId ?? ''} />

      <div className="agent-chips">
        {examples.map((example) => (
          <button
            key={example}
            type="button"
            className="agent-chip"
            onClick={() => setQuestion(example)}
            disabled={disabled || pending}
          >
            <Sparkles size={12} aria-hidden />
            {example}
          </button>
        ))}
      </div>

      <div className="field">
        <label className="t-label" htmlFor="question">
          질문
        </label>
        <textarea
          id="question"
          name="question"
          rows={3}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={placeholder}
          disabled={disabled || pending}
        />
      </div>

      <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" className="btn primary lg" disabled={disabled || pending || !question.trim()}>
          <Send size={15} aria-hidden />
          {pending ? '알아보는 중…' : '질문하기'}
        </button>
        <span className="t-sm text-3">
          {disabled
            ? (disabledNote ?? 'AI 가 설정되지 않았습니다.')
            : '툴이 조회한 값만 인용합니다. 툴에 없는 수치는 답변에 넣지 않습니다.'}
        </span>
      </div>

      {state.error && (
        <p className="login-error" role="alert">
          <TriangleAlert size={14} aria-hidden />
          {state.error}
        </p>
      )}

      {state.answer && (
        <div className="agent-answer">
          <p className="t-label">답변 (기록되지 않음)</p>
          <p>{state.answer}</p>
        </div>
      )}
    </form>
  );
}
