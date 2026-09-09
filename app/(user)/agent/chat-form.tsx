'use client';

// STEP 16 ⑥ 질문 입력 — 6회차 슬라이드 63 · 74 (프롬프트 6)
//
// 클라이언트에서 하는 일은 셋뿐입니다. 질문을 받고, 서버 액션을 부르고, 돌아온 답을 그립니다.
// ★ 여기서 SCM 계산을 다시 구현하지 않습니다. 숫자는 전부 서버가 만든 것입니다.

import { useState, useTransition } from 'react';
import AnswerCard from './answer-card';
import { askAgent, type AskResult } from './actions';

const EXAMPLES = [
  'ITEM012 수요가 규칙적인가요?',
  '지금 재고가 위험한 품목을 알려줘',
  '예측 정확도가 가장 나쁜 품목은?',
  '납기가 계획보다 늦는 공급처가 있나요?',
];

export default function ChatForm({ configured, missing }: { configured: boolean; missing: string[] }) {
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<AskResult[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send(text: string) {
    const asked = text.trim();
    if (asked === '' || pending) return;
    setQuestion('');
    startTransition(async () => {
      const result = await askAgent(conversationId, asked);
      if (result.conversationId) setConversationId(result.conversationId);
      setTurns((previous) => previous.concat(result));
    });
  }

  if (!configured) {
    return (
      <div className="card">
        <p><strong>AI 가 설정되지 않았습니다.</strong></p>
        <p className="muted">
          서버 환경변수 {missing.join(' · ')} 를 채우면 이 화면이 열립니다.
          설정이 없어도 나머지 화면은 그대로 동작합니다.
        </p>
      </div>
    );
  }

  return (
    <div className="chat">
      <div className="chat-log">
        {turns.length === 0 ? (
          <div className="chat-empty">
            <p>궁금한 것을 물어보세요. 답에는 근거와 데이터 기준시각이 함께 나옵니다.</p>
            <div className="chat-examples">
              {EXAMPLES.map((example) => (
                <button key={example} type="button" className="button ghost" onClick={() => send(example)} disabled={pending}>
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {turns.map((turn, index) => (
          <div className="chat-turn" key={`${turn.question}-${index}`}>
            <p className="chat-question">{turn.question}</p>
            <AnswerCard
              answer={turn.answer}
              toolTrace={turn.toolTrace}
              guardrail={turn.guardrail}
              error={turn.error}
            />
            {turn.saveWarning ? (
              <p className="muted chat-save-warning">대화 기록을 남기지 못했습니다: {turn.saveWarning}</p>
            ) : null}
          </div>
        ))}

        {pending ? <p className="chat-pending">응답 중입니다…</p> : null}
      </div>

      <form
        className="chat-input"
        onSubmit={(event) => {
          event.preventDefault();
          send(question);
        }}
      >
        <input
          className="form-input"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="예: ITEM012 언제 재고가 떨어지나요?"
          maxLength={500}
          disabled={pending}
        />
        <button type="submit" className="button primary" disabled={pending || question.trim() === ''}>
          {pending ? '전송 중' : '보내기'}
        </button>
      </form>
    </div>
  );
}
