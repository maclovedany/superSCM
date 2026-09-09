// STEP 16 ⑥ 답변 카드 — 6회차 슬라이드 63
//
// 업무 사용자가 먼저 봐야 할 것은 판단 · 근거 · 기준시각입니다. Tool Trace 는 접어 두고
// 검토자만 펼칩니다. 여기서는 계산하지 않습니다 — 값을 그리기만 합니다.

import Badge from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import type { AgentAnswer } from '@/lib/agent/schema';
import type { GuardrailTrace, ToolTraceEntry } from '@/lib/agent/orchestrator';

function valueLabel(value: string | number | null, unit: string | null) {
  if (value === null) return <EmptyValue />;
  const text = typeof value === 'number' ? value.toLocaleString('ko-KR') : value;
  return <>{text}{unit ? <span className="muted"> {unit}</span> : null}</>;
}

export default function AnswerCard({
  answer,
  toolTrace,
  guardrail,
  error,
}: {
  answer: AgentAnswer | null;
  toolTrace: ToolTraceEntry[];
  guardrail: GuardrailTrace | null;
  error: string | null;
}) {
  if (error && !answer) {
    return (
      <div className="chat-answer">
        <p className="text-danger">{error}</p>
      </div>
    );
  }
  if (!answer) return null;

  return (
    <div className="chat-answer">
      <div className="chat-answer-head">
        <Badge status={answer.risk} />
        {answer.verdict ? <strong>{answer.verdict}</strong> : null}
      </div>

      <p className="chat-answer-body">{answer.answer}</p>

      {answer.cannot_answer ? (
        <p className="chat-reason">
          산출 불가 사유 <EmptyValue reasonCode={answer.cannot_answer_reason ?? 'CALCULATION_UNAVAILABLE'} />
        </p>
      ) : null}

      {answer.evidence.length > 0 ? (
        <ul className="chat-evidence">
          {answer.evidence.map((item, index) => (
            <li key={`${item.label}-${index}`}>
              <span className="chat-evidence-label">{item.label}</span>
              <span className="chat-evidence-value">{valueLabel(item.value, item.unit)}</span>
              {item.source_tool ? <span className="chat-evidence-tool">{item.source_tool}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {answer.recommended_action ? (
        <p className="chat-action">권고 · {answer.recommended_action}</p>
      ) : null}

      <p className="chat-foot">
        데이터 기준시각 {answer.data_as_of ? answer.data_as_of : <EmptyValue reasonCode="NO_DATA_AS_OF" />}
        {guardrail ? (
          <span className="muted">
            {' · '}수치 검사 {guardrail.checked}건{guardrail.regenerated ? ' · 재생성 1회' : ''}
          </span>
        ) : null}
      </p>

      {toolTrace.length > 0 ? (
        <details className="chat-trace">
          <summary>툴 호출 {toolTrace.length}건</summary>
          <ul>
            {toolTrace.map((entry, index) => (
              <li key={`${entry.name}-${index}`}>
                <code>{entry.name}</code>
                <span className="muted"> {JSON.stringify(entry.args)} · {entry.ms}ms</span>
                {entry.ok ? <span className="tag green">성공</span> : <span className="tag gray">{entry.reason ?? '실패'}</span>}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
