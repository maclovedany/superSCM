// AI Agent — renew.prd 26장
//
// 질문을 받아 툴을 부르고, 툴이 돌려준 값만으로 설명합니다.
// 화면은 LLM 을 직접 부르지 않습니다. 액션(ask)이 서버에서 부르고 결과를 저장합니다.
//
// ★ AI 가 설정되지 않았거나 죽어 있어도 이 화면만 안내를 보이고, 나머지 화면은
//   아무 영향도 받지 않습니다 (renew.prd 31.4).

import Link from 'next/link';
import { kstMinute } from '@/lib/time';
import { Clock, MessageSquare, Sparkles, Wrench } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import Panel from '@/components/ui/panel';
import Badge, { StatusBadge } from '@/components/ui/badge';
import InsightBanner from '@/components/ui/insight-banner';
import { EmptyState, ErrorState } from '@/components/ui/state';
import { isSalesUser, requireUser } from '@/lib/auth';
import { getMessages, listConversations, readLlmConfig, type StoredMessage } from '@/lib/agent';
import type { SearchParams } from '@/lib/filter';
import ChatForm from './chat-form';
import { SALES_EXAMPLE_QUESTIONS } from './state';

export const dynamic = 'force-dynamic';

function one(params: SearchParams, key: string): string | null {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** 근거 타일 하나 — design.md §6.11 의 레일 타일을 그대로 씁니다 */
function EvidenceTile({
  label,
  value,
  unit,
  sourceTool,
  reason,
}: {
  label: string;
  value: number | string | null;
  unit: string | null | undefined;
  sourceTool: string;
  reason: string | null | undefined;
}) {
  return (
    <div className="rail-tile">
      <span className="rail-tile-label">{label}</span>
      <span className="rail-tile-value">
        {value === null ? (
          // 숫자 자리에 숫자를 넣지 않습니다 (design.md §8.2).
          <span style={{ color: 'var(--text-3)' }}>—</span>
        ) : (
          <>
            {typeof value === 'number' ? value.toLocaleString('ko-KR') : value}
            {unit ? <span className="t-sm text-3"> {unit}</span> : null}
          </>
        )}
      </span>
      <span className="t-label text-3">{reason ?? sourceTool}</span>
    </div>
  );
}

/** 답변 한 건 */
function AnswerCard({ message }: { message: StoredMessage }) {
  const answer = message.answer;

  if (!answer) {
    return <p className="agent-answer">{message.content}</p>;
  }

  if (answer.cannot_answer) {
    return (
      <div className="agent-answer unknown">
        <p>산출할 수 없습니다.</p>
        <p className="t-sm">{answer.cannot_answer_reason ?? '근거가 되는 데이터가 없습니다.'}</p>
        {message.toolTrace.length > 0 && <ToolTrace message={message} />}
      </div>
    );
  }

  return (
    <div className="agent-answer">
      {answer.verdict && (
        <p style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
          {answer.risk && <StatusBadge status={answer.risk} />}
          <b>{answer.verdict}</b>
        </p>
      )}

      <p>{answer.answer}</p>

      {answer.evidence.length > 0 && (
        <div className="rail-tiles">
          {answer.evidence.map((item, index) => (
            <EvidenceTile
              key={`${item.label}-${index}`}
              label={item.label}
              value={item.value}
              unit={item.unit}
              sourceTool={item.source_tool}
              reason={item.reason}
            />
          ))}
        </div>
      )}

      {answer.recommended_action && (
        <p>
          <Badge tone="info">권고</Badge> {answer.recommended_action}
        </p>
      )}

      <div className="agent-meta">
        {answer.data_as_of && <span>데이터 기준 {answer.data_as_of}</span>}
        {message.guardrail && (
          <span>
            수치 검증 {message.guardrail.checked}건
            {message.guardrail.regenerated ? ' · 재생성 1회' : ''}
          </span>
        )}
      </div>

      {message.toolTrace.length > 0 && <ToolTrace message={message} />}
    </div>
  );
}

/** 접힌 툴 호출 목록 — 무엇을 근거로 답했는지 되짚을 수 있어야 합니다 (renew.prd 31.2) */
function ToolTrace({ message }: { message: StoredMessage }) {
  return (
    <details className="agent-tools">
      <summary>툴 호출 {message.toolTrace.length}건</summary>
      <ul>
        {message.toolTrace.map((entry, index) => (
          <li key={`${entry.name}-${index}`} className="agent-tool-row">
            <Wrench size={12} aria-hidden />
            <span className="t-code">{entry.name}</span>
            <span className="text-3">{entry.ms}ms</span>
            {!entry.ok && <Badge tone="unknown">{entry.reason ?? '결과 없음'}</Badge>}
          </li>
        ))}
      </ul>
    </details>
  );
}

export default async function AgentPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  // 영업 사용자에게는 예시 질문을 renew.prd 27.2 로 바꿉니다. 툴 집합은 화면이 아니라
  // 오케스트레이터가 서버에서 나눕니다 (AGENTS.md 규칙 8) — 여기서는 안내만 바꿉니다.
  const sales = isSalesUser(user);

  const params = await searchParams;
  const conversationId = one(params, 'c');
  const seed = one(params, 'q') ?? '';

  const config = readLlmConfig();

  const [conversations, thread] = await Promise.all([
    listConversations(10),
    conversationId ? getMessages(conversationId) : Promise.resolve({ rows: [], error: null }),
  ]);

  const header = (
    <PageHeader
      title="AI Agent"
      subtitle={
        sales
          ? '납기와 약속 가능 수량을 자연어로 묻습니다. 숫자는 화면과 같은 함수가 계산하고, AI 는 그 값을 고르고 설명하기만 합니다.'
          : '추천 근거를 자연어로 묻습니다. 숫자는 화면과 같은 함수가 계산하고, AI 는 그 값을 고르고 설명하기만 합니다.'
      }
      meta={
        <>
          <MetaChip>{sales ? 'PRD 27' : 'PRD 26'}</MetaChip>
          <MetaChip>{sales ? 'STEP 17' : 'STEP 16'}</MetaChip>
          <MetaChip>{config.configured ? config.model : '미설정'}</MetaChip>
        </>
      }
    />
  );

  // 질문과 답변이 번갈아 저장됩니다. 답변 줄에 앞선 질문을 붙여 한 묶음으로 그립니다.
  const turns: { question: string; answer: StoredMessage | null; key: string }[] = [];
  for (const message of thread.rows) {
    if (message.role === 'user') {
      turns.push({ question: message.content, answer: null, key: String(message.id) });
    } else if (turns.length > 0 && turns[turns.length - 1].answer === null) {
      turns[turns.length - 1].answer = message;
    } else {
      turns.push({ question: '', answer: message, key: String(message.id) });
    }
  }

  return (
    <>
      {header}

      {!config.configured && (
        <InsightBanner eyebrow="AI 미설정">
          AI 가 설정되지 않았습니다. 환경변수 <b>{config.missing.join(' · ')}</b> 를 채우면 질문할 수 있습니다.
          그때까지 대시보드 · 예측 · 발주 추천은 평소대로 동작합니다.
        </InsightBanner>
      )}

      <div className="grid grid-rail">
        <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
          <Panel title="질문">
            <ChatForm
              conversationId={conversationId}
              initialQuestion={seed}
              disabled={!config.configured}
              disabledNote={`환경변수 ${config.missing.join(' · ')} 가 없어 질문할 수 없습니다.`}
              {...(sales
                ? {
                    examples: SALES_EXAMPLE_QUESTIONS,
                    placeholder: '예: X700 지금 500대 추가 주문 받을 수 있어?',
                  }
                : {})}
            />
          </Panel>

          <Panel
            title="대화"
            actions={<span className="t-label">툴이 조회한 값만 인용합니다</span>}
          >
            {thread.error ? (
              <ErrorState detail={thread.error} />
            ) : turns.length === 0 ? (
              <EmptyState
                title="아직 물어본 것이 없습니다"
                desc="위의 예시 질문을 누르거나 직접 적어 보세요. 답변에는 근거와 데이터 기준시각이 함께 붙습니다."
              />
            ) : (
              <div className="agent-thread">
                {turns.map((turn) => (
                  <div key={turn.key} className="agent-turn">
                    {turn.question && <p className="agent-question">{turn.question}</p>}
                    {turn.answer && <AnswerCard message={turn.answer} />}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <Panel title="최근 대화">
          {conversations.error ? (
            <ErrorState detail={conversations.error} />
          ) : conversations.rows.length === 0 ? (
            <p className="t-sm text-3">
              아직 저장된 대화가 없습니다. 질문하면 여기에 쌓입니다.
            </p>
          ) : (
            <div className="agent-convo-list">
              {conversations.rows.map((item) => (
                <Link
                  key={item.conversationId}
                  href={`/agent?c=${encodeURIComponent(item.conversationId)}`}
                  className={`agent-convo-link${item.conversationId === conversationId ? ' active' : ''}`}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
                    <MessageSquare size={12} aria-hidden />
                    {item.title ?? '제목 없음'}
                  </span>
                  <span className="t-label text-3">
                    <Clock size={11} aria-hidden /> {kstMinute(item.lastAt) ?? '—'}
                  </span>
                </Link>
              ))}
            </div>
          )}

          <p className="t-sm text-3" style={{ marginTop: 'var(--s-4)' }}>
            <Sparkles size={12} aria-hidden /> 답변의 모든 수치는 툴 결과와 대조합니다. 대조되지 않는
            수치가 남으면 답변을 버리고 산출 불가로 알립니다.
          </p>
        </Panel>
      </div>
    </>
  );
}
