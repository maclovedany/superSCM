'use server';

// STEP 16 ⑥ 서버 액션 — 6회차 슬라이드 63 · 74 (프롬프트 6)
//
// 화면과 Agent 코어 사이의 유일한 통로입니다. 순서가 중요합니다.
//   ① 로그인 확인 (requireUser)  ② 질문 검증  ③ runAgent  ④ 대화 저장(실패해도 답변 유지)
//
// ★ API key 와 원본 데이터는 클라이언트로 내려보내지 않습니다. 화면에 가는 것은 답변과
//   근거, 그리고 접어 둘 Tool Trace 뿐입니다.

import { requireUser } from '@/lib/auth';
import { runAgent, type GuardrailTrace, type ToolTraceEntry } from '@/lib/agent/orchestrator';
import { saveTurn } from '@/lib/agent/conversation';
import type { AgentAnswer } from '@/lib/agent/schema';

export type AskResult = {
  conversationId: string | null;
  question: string;
  answer: AgentAnswer | null;
  toolTrace: ToolTraceEntry[];
  guardrail: GuardrailTrace | null;
  configured: boolean;
  error: string | null;
  /** 답변은 만들었지만 기록을 남기지 못한 경우. 화면 아래에 작게 알립니다 */
  saveWarning: string | null;
};

export async function askAgent(conversationId: string | null, rawQuestion: string): Promise<AskResult> {
  const { authUser, profile } = await requireUser();
  const question = String(rawQuestion ?? '').trim();

  const base: AskResult = {
    conversationId,
    question,
    answer: null,
    toolTrace: [],
    guardrail: null,
    configured: true,
    error: null,
    saveWarning: null,
  };

  if (question === '') return { ...base, error: '질문을 입력해주세요.' };
  if (question.length > 500) return { ...base, error: '질문이 너무 깁니다. 500자 안으로 줄여 주세요.' };

  const result = await runAgent({
    question,
    user: { userId: authUser.id, email: profile.email, role: profile.role },
  });

  // 답변을 만들지 못했어도 기록은 남깁니다 — 무엇을 물었고 왜 못 냈는지가 감사 기록입니다.
  const saved = await saveTurn({
    userId: authUser.id,
    conversationId,
    question,
    answer: result.answer,
    toolTrace: result.toolTrace,
    guardrail: result.guardrail,
    usage: result.usage,
    error: result.error,
  });

  return {
    conversationId: saved.conversationId ?? conversationId,
    question,
    answer: result.answer,
    toolTrace: result.toolTrace,
    guardrail: result.guardrail,
    configured: result.configured,
    error: result.error,
    saveWarning: saved.error,
  };
}
