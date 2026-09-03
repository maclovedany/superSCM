// 대화 저장과 조회 — sql/22-agent.sql
//
// ★ lib/agent/ 안에서 Supabase 를 부르는 곳은 이 파일 하나입니다.
//   툴은 lib 조회 함수만 부르고(renew.prd 32), 오케스트레이터는 DB 를 모릅니다.
//
// 왜 analytics 뷰가 아니라 core 테이블을 읽는가
//   대화는 본인 것만 보여야 합니다. 이 프로젝트의 analytics 뷰는 security_invoker 가 아니라
//   소유자 권한으로 돌기 때문에 그 뷰를 거치면 밑에 걸어 둔 RLS 가 적용되지 않습니다.
//   그래서 RLS 가 실제로 거르는 core 테이블을 직접 읽습니다 — lib/auth.ts 가
//   core.app_user 를 직접 읽는 것과 같은 이유입니다.
//   집계(analytics.v_agent_usage)는 관리자용이고 개인 문장을 담지 않습니다.
//
// 쓰기는 core.save_agent_turn() 한 번입니다. 대화 머리와 메시지 두 줄을 한 트랜잭션으로
// 남기고, user_id 는 함수가 auth.uid() 로 직접 채웁니다 (화면이 보낸 값을 믿지 않습니다).

import { createSupabaseServerClient } from '../supabase/server';
import type { AgentAnswer } from './schema.ts';
import type { GuardrailTrace, ToolTraceEntry } from './orchestrator.ts';

export type ConversationSummary = {
  conversationId: string;
  title: string | null;
  startedAt: string | null;
  lastAt: string | null;
};

export type StoredMessage = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  answer: AgentAnswer | null;
  toolTrace: ToolTraceEntry[];
  guardrail: GuardrailTrace | null;
  createdAt: string | null;
};

/** 새 대화 식별자. 사용자가 볼 일이 없으므로 모양을 꾸미지 않습니다 */
export function newConversationId(): string {
  return `conv_${globalThis.crypto.randomUUID()}`;
}

/** 질문 첫 줄을 대화 제목으로 씁니다. 길면 자릅니다 */
export function titleOf(question: string): string {
  const line = question.trim().split('\n')[0] ?? '';
  return line.length > 60 ? `${line.slice(0, 60)}…` : line || '새 대화';
}

function failure(error: unknown): string {
  return error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.';
}

function asRole(value: unknown): 'user' | 'assistant' {
  return value === 'assistant' ? 'assistant' : 'user';
}

function asTrace(value: unknown): ToolTraceEntry[] {
  if (!Array.isArray(value)) return [];
  const rows: ToolTraceEntry[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    rows.push({
      name: String(row.name ?? ''),
      args: (row.args as Record<string, unknown>) ?? {},
      ok: row.ok === true,
      ms: Number(row.ms ?? 0),
      reason: row.reason === null || row.reason === undefined ? null : String(row.reason),
    });
  }
  return rows;
}

/** 최근 대화 목록 (기본 10건) — 본인 것만 보입니다 (RLS) */
export async function listConversations(
  limit = 10,
): Promise<{ rows: ConversationSummary[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('core')
      .from('agent_conversation')
      .select('conversation_id, title, started_at, last_at')
      .order('last_at', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => {
      const row = item as Record<string, unknown>;
      return {
        conversationId: String(row.conversation_id ?? ''),
        title: row.title === null || row.title === undefined ? null : String(row.title),
        startedAt: row.started_at === null || row.started_at === undefined ? null : String(row.started_at),
        lastAt: row.last_at === null || row.last_at === undefined ? null : String(row.last_at),
      };
    });
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/** 한 대화의 메시지. 시간 순서입니다 */
export async function getMessages(
  conversationId: string,
  limit = 100,
): Promise<{ rows: StoredMessage[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('core')
      .from('agent_message')
      .select('id, role, content, answer, tool_trace, guardrail, created_at')
      .eq('conversation_id', conversationId)
      .order('id')
      .limit(limit);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => {
      const row = item as Record<string, unknown>;
      return {
        id: Number(row.id ?? 0),
        role: asRole(row.role),
        content: String(row.content ?? ''),
        answer: (row.answer as AgentAnswer | null) ?? null,
        toolTrace: asTrace(row.tool_trace),
        guardrail: (row.guardrail as GuardrailTrace | null) ?? null,
        createdAt: row.created_at === null || row.created_at === undefined ? null : String(row.created_at),
      };
    });
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/**
 * 질문과 답변을 한 번에 저장합니다.
 *
 * 저장에 실패해도 답변은 이미 화면에 보여 줍니다. 기록이 남지 않았을 뿐이므로
 * 오류를 던지지 않고 { error } 로 돌려줍니다 (renew.prd 31.4).
 */
export async function saveTurn(input: {
  conversationId: string;
  question: string;
  answer: AgentAnswer | null;
  toolTrace: ToolTraceEntry[];
  usage: unknown;
  guardrail: GuardrailTrace | null;
}): Promise<{ conversationId: string | null; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('save_agent_turn', {
      p_conversation_id: input.conversationId,
      p_title: titleOf(input.question),
      p_question: input.question,
      p_answer: input.answer,
      p_tool_trace: input.toolTrace,
      p_usage: input.usage,
      p_guardrail: input.guardrail,
    });

    if (error) return { conversationId: null, error: error.message };

    // 함수는 (ok, message) 만 돌려줍니다. 대화 식별자는 부른 쪽이 이미 알고 있습니다
    // (sql/22-agent.sql §2 — 반환 컬럼과 테이블 컬럼의 이름이 겹치지 않게 두었습니다).
    const row = (Array.isArray(data) ? data[0] : data) as { ok?: boolean; message?: string } | null;

    if (row?.ok !== true) {
      return { conversationId: null, error: row?.message ?? '대화를 저장하지 못했습니다.' };
    }
    return { conversationId: input.conversationId, error: null };
  } catch (error) {
    return { conversationId: null, error: failure(error) };
  }
}
