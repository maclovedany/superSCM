// STEP 16 ⑦ 대화 저장 — 6회차 슬라이드 64 · 75 (프롬프트 7)
//
// ★ 이 파일만 Supabase 를 부릅니다. lib/agent 의 나머지 파일에는 DB 질의가 없습니다.
//
// ★ 저장 실패가 답변을 없애지 않습니다. 감사 기록은 중요하지만 부가 기능이고, 사용자는
//   이미 만들어진 답을 봐야 합니다. 그래서 이 파일의 함수는 예외를 던지지 않고
//   { conversationId, error } 를 돌려줍니다. 화면은 error 를 조용히 무시할 수 있습니다.

import { createSupabaseServerClient } from '../supabase/server.ts';
import type { AgentAnswer } from './schema.ts';
import type { GuardrailTrace, ToolTraceEntry } from './orchestrator.ts';

export type StoredMessage = {
  messageId: string;
  question: string;
  answer: AgentAnswer | null;
  toolTrace: ToolTraceEntry[];
  guardrail: GuardrailTrace | null;
  error: string | null;
  createdAt: string;
};

/** 대화 제목 — 첫 질문의 앞부분입니다. 목록에서 알아볼 수 있으면 충분합니다 */
function titleOf(question: string): string {
  const text = question.trim().replace(/\s+/g, ' ');
  return text.length <= 40 ? text : `${text.slice(0, 40)}…`;
}

/** 새 대화를 만들거나 기존 대화를 이어 씁니다 */
async function ensureConversation(
  userId: string,
  question: string,
  conversationId: string | null,
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createSupabaseServerClient();
  if (conversationId) {
    const { error } = await supabase
      .schema('core')
      .from('agent_conversation')
      .update({ last_message_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);
    if (error) return { id: null, error: error.message };
    return { id: conversationId, error: null };
  }
  const { data, error } = await supabase
    .schema('core')
    .from('agent_conversation')
    .insert({ user_id: userId, title: titleOf(question) })
    .select('conversation_id')
    .maybeSingle();
  if (error || !data) return { id: null, error: error?.message ?? '대화를 만들지 못했습니다.' };
  return { id: String((data as Record<string, unknown>).conversation_id), error: null };
}

export async function saveTurn(input: {
  userId: string;
  conversationId: string | null;
  question: string;
  answer: AgentAnswer | null;
  toolTrace: ToolTraceEntry[];
  guardrail: GuardrailTrace | null;
  usage: unknown;
  error: string | null;
}): Promise<{ conversationId: string | null; error: string | null }> {
  try {
    const conversation = await ensureConversation(input.userId, input.question, input.conversationId);
    if (!conversation.id) return { conversationId: null, error: conversation.error };

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .schema('core')
      .from('agent_message')
      .insert({
        conversation_id: conversation.id,
        user_id: input.userId,
        question: input.question,
        answer: input.answer,
        tool_trace: input.toolTrace,
        guardrail: input.guardrail,
        token_usage: input.usage,
        error: input.error,
      });
    return { conversationId: conversation.id, error: error?.message ?? null };
  } catch (error) {
    return {
      conversationId: null,
      error: error instanceof Error ? error.message : '대화를 저장하지 못했습니다.',
    };
  }
}

/** 한 대화의 문답을 시간 순서로 읽습니다. RLS 가 본인 것만 돌려줍니다 */
export async function listMessages(
  conversationId: string,
): Promise<{ rows: StoredMessage[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('core')
      .from('agent_message')
      .select('message_id, question, answer, tool_trace, guardrail, error, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(50);
    if (error) return { rows: [], error: error.message };
    const rows = (data ?? []).map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        messageId: String(row.message_id),
        question: String(row.question ?? ''),
        answer: (row.answer ?? null) as AgentAnswer | null,
        toolTrace: Array.isArray(row.tool_trace) ? (row.tool_trace as ToolTraceEntry[]) : [],
        guardrail: (row.guardrail ?? null) as GuardrailTrace | null,
        error: row.error ? String(row.error) : null,
        createdAt: String(row.created_at ?? ''),
      };
    });
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : '대화를 읽지 못했습니다.' };
  }
}
