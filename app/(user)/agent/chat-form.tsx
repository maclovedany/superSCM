'use client';

// STEP 16 ⑥ 대화 화면 — 6회차 슬라이드 63 · 74 (프롬프트 6)
//
// 클라이언트가 하는 일은 넷뿐입니다. 질문을 받고, 스트림을 열고, 진행 단계를 그리고,
// 검증이 끝난 답을 한 글자씩 찍습니다.
// ★ 여기서 SCM 계산을 다시 구현하지 않습니다. 숫자는 전부 서버가 만든 것입니다.
// ★ 타이핑은 화면 효과일 뿐입니다. Guardrail 을 통과한 문장만 여기에 들어옵니다 —
//   검증 전 텍스트는 애초에 서버에서 나오지 않습니다 (app/api/agent/stream).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import AnswerCard from './answer-card';
import type { AskResult } from './actions';
import type { AgentProgress } from '@/lib/agent/orchestrator';

/** 툴 이름을 사람 말로 — 진행 표시에만 씁니다 */
const TOOL_LABELS: Record<string, string> = {
  getDemandProfile: '수요 특성',
  getForecastAccuracy: '예측 정확도',
  getStockoutRisk: '재고 소진 위험',
  getLeadtimeStats: '납기 통계',
};

/** 한 번에 찍는 글자 수와 간격 — 사람이 읽을 수 있는 속도입니다 */
const TYPE_CHARS = 2;
const TYPE_INTERVAL_MS = 16;

type Step = { id: number; label: string; state: 'active' | 'ok' | 'fail' };

type Turn = {
  id: string;
  question: string;
  steps: Step[];
  /** thinking 진행 중 · typing 검증 통과한 본문을 찍는 중 · done 끝 */
  phase: 'thinking' | 'typing' | 'done';
  result: AskResult | null;
  typed: string;
};

function stepLabel(event: AgentProgress): string | null {
  switch (event.type) {
    case 'planning':
      return '질문을 이해하는 중';
    case 'tool_start':
      return `${TOOL_LABELS[event.name] ?? event.name} 조회 중`;
    case 'answering':
      return '답변을 정리하는 중';
    case 'verifying':
      return '수치를 검증하는 중';
    case 'regenerating':
      return '수치가 맞지 않아 다시 만드는 중';
    default:
      return null;
  }
}

/** 진행 이벤트 하나를 단계 목록에 반영합니다 */
function applyProgress(steps: Step[], event: AgentProgress): Step[] {
  if (event.type === 'tool_end') {
    const target = TOOL_LABELS[event.name] ?? event.name;
    let marked = false;
    return steps
      .slice()
      .reverse()
      .map((step) => {
        if (!marked && step.state === 'active' && step.label.startsWith(target)) {
          marked = true;
          return { ...step, label: `${target} 조회 ${event.ok ? '완료' : '실패'}`, state: event.ok ? 'ok' : 'fail' };
        }
        return step;
      })
      .reverse() as Step[];
  }

  const label = stepLabel(event);
  if (label === null) return steps;
  // 앞 단계는 지나간 것으로 확정하고 새 단계를 켭니다.
  const settled = steps.map((step) => (step.state === 'active' ? { ...step, state: 'ok' as const } : step));
  return settled.concat({ id: settled.length, label, state: 'active' });
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export default function ChatForm({ configured, missing }: { configured: boolean; missing: string[] }) {
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stickToBottom = useRef(true);

  // 사용자가 위로 올려 지난 답을 읽는 중이면 따라 내리지 않습니다.
  const onScroll = useCallback(() => {
    const log = logRef.current;
    if (!log) return;
    stickToBottom.current = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  }, []);

  useLayoutEffect(() => {
    const log = logRef.current;
    if (log && stickToBottom.current) log.scrollTop = log.scrollHeight;
  }, [turns]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const typingTurnId = turns.find((turn) => turn.phase === 'typing')?.id ?? null;

  // 검증을 통과한 본문을 한 글자씩. 여기서 문장을 고치지 않고 앞에서부터 잘라 보일 뿐입니다.
  useEffect(() => {
    if (typingTurnId === null) return;
    const full = turns.find((turn) => turn.id === typingTurnId)?.result?.answer?.answer ?? '';

    if (full === '' || prefersReducedMotion()) {
      setTurns((previous) =>
        previous.map((turn) => (turn.id === typingTurnId ? { ...turn, typed: full, phase: 'done' } : turn)),
      );
      return;
    }

    let shown = 0;
    const timer = setInterval(() => {
      shown = Math.min(full.length, shown + TYPE_CHARS);
      const finished = shown >= full.length;
      if (finished) clearInterval(timer);
      setTurns((previous) =>
        previous.map((turn) =>
          turn.id === typingTurnId
            ? { ...turn, typed: full.slice(0, shown), phase: finished ? 'done' : 'typing' }
            : turn,
        ),
      );
    }, TYPE_INTERVAL_MS);

    return () => clearInterval(timer);
    // full 은 typingTurnId 로 정해집니다 — 한 답변에 타이머 하나만 돕니다.
     
  }, [typingTurnId]);

  function updateTurn(id: string, change: (turn: Turn) => Turn) {
    setTurns((previous) => previous.map((turn) => (turn.id === id ? change(turn) : turn)));
  }

  function finish(id: string, result: AskResult) {
    if (result.conversationId) setConversationId(result.conversationId);
    updateTurn(id, (turn) => ({
      ...turn,
      result,
      steps: turn.steps.map((step) => (step.state === 'active' ? { ...step, state: 'ok' } : step)),
      // 답변이 있으면 찍기 시작하고, 없으면(오류·차단) 바로 끝냅니다.
      phase: result.answer ? 'typing' : 'done',
      typed: '',
    }));
  }

  async function send(text: string) {
    const asked = text.trim();
    if (asked === '' || pending) return;

    const id = `${Date.now()}-${turns.length}`;
    setQuestion('');
    setPending(true);
    stickToBottom.current = true;
    setTurns((previous) => previous.concat({ id, question: asked, steps: [], phase: 'thinking', result: null, typed: '' }));

    const controller = new AbortController();
    abortRef.current = controller;

    const failed = (message: string) =>
      finish(id, {
        conversationId,
        question: asked,
        answer: null,
        toolTrace: [],
        guardrail: null,
        configured: true,
        error: message,
        saveWarning: null,
      });

    try {
      const response = await fetch('/api/agent/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId, question: asked }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => null);
        failed(detail?.error ?? `답변을 받지 못했습니다 (HTTP ${response.status}).`);
        return;
      }

      // SSE 는 빈 줄로 이벤트를 나눕니다. 잘려 온 앞부분은 buffer 에 남겨 둡니다.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let done = false;

      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const line = part.split('\n').find((row) => row.startsWith('data: '));
          if (!line) continue;
          let payload: { type: string; event?: AgentProgress; result?: AskResult };
          try {
            payload = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (payload.type === 'progress' && payload.event) {
            const event = payload.event;
            updateTurn(id, (turn) => ({ ...turn, steps: applyProgress(turn.steps, event) }));
          } else if (payload.type === 'done' && payload.result) {
            finish(id, payload.result);
            done = true;
          }
        }
      }

      if (!done) failed('답변이 도중에 끊겼습니다. 다시 물어봐 주세요.');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        updateTurn(id, (turn) => ({
          ...turn,
          phase: 'done',
          steps: turn.steps.map((step) => (step.state === 'active' ? { ...step, state: 'fail', label: '중지했습니다' } : step)),
        }));
      } else {
        failed(error instanceof Error ? `답변을 받지 못했습니다: ${error.message}` : '답변을 받지 못했습니다.');
      }
    } finally {
      abortRef.current = null;
      setPending(false);
      inputRef.current?.focus();
    }
  }

  function resize(element: HTMLTextAreaElement) {
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
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
      <div className="chat-log" ref={logRef} onScroll={onScroll} aria-live="polite">
        {turns.length === 0 ? (
          <div className="chat-empty">
            <p><strong>궁금한 것을 물어보세요.</strong></p>
            <p>검증된 조회 함수만 사용해 답합니다. 답에는 근거와 데이터 기준시각이 함께 나옵니다.</p>
          </div>
        ) : null}

        {turns.map((turn) => (
          <div className="chat-turn" key={turn.id}>
            <div className="chat-row me">
              <div className="chat-bubble me">{turn.question}</div>
            </div>

            <div className="chat-row bot">
              <div className="chat-avatar" aria-hidden="true">AI</div>
              <div className="chat-bubble bot">
                {turn.steps.length > 0 && turn.phase !== 'done' ? (
                  <ul className="chat-steps">
                    {turn.steps.map((step) => (
                      <li key={step.id} className={`chat-step ${step.state}`}>
                        <span className="chat-step-mark" aria-hidden="true" />
                        {step.label}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {turn.phase === 'thinking' && turn.steps.length === 0 ? (
                  <span className="chat-dots" aria-label="생각 중"><i /><i /><i /></span>
                ) : null}

                {turn.result ? (
                  <AnswerCard
                    answer={turn.result.answer}
                    toolTrace={turn.result.toolTrace}
                    guardrail={turn.result.guardrail}
                    error={turn.result.error}
                    bodyText={turn.typed}
                    showDetails={turn.phase === 'done'}
                  />
                ) : null}

                {turn.result?.saveWarning && turn.phase === 'done' ? (
                  <p className="muted chat-save-warning">대화 기록을 남기지 못했습니다: {turn.result.saveWarning}</p>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>

      <form
        className="chat-input"
        onSubmit={(event) => {
          event.preventDefault();
          void send(question);
        }}
      >
        <textarea
          ref={inputRef}
          className="chat-textarea"
          rows={1}
          value={question}
          onChange={(event) => {
            setQuestion(event.target.value);
            resize(event.target);
          }}
          onKeyDown={(event) => {
            // 한글 조합 중의 Enter 는 글자를 확정하는 키입니다. 여기서 보내면 안 됩니다.
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void send(question);
          }}
          placeholder="예: ITEM012 언제 재고가 떨어지나요?  (Shift+Enter 줄바꿈)"
          maxLength={500}
        />
        {pending ? (
          <button type="button" className="button" onClick={() => abortRef.current?.abort()}>
            중지
          </button>
        ) : (
          <button type="submit" className="button primary" disabled={question.trim() === ''}>
            보내기
          </button>
        )}
      </form>
    </div>
  );
}
