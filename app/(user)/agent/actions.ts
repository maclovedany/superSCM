'use server';

// AI Agent 질문 처리 — renew.prd 26장
//
// 권한 규칙 (공통규칙 §3-4)
//   ask 는 로그인 사용자용입니다 → getSessionUser().
//   requireUser() 는 redirect() 를 던지므로(NEXT_REDIRECT) 액션의 try/catch 가 삼킵니다.
//
// 흐름
//   질문 → runAgent(툴 호출 · Guardrail) → 대화 저장 → revalidate → 그 대화로 이동
//
// ★ 저장에 실패해도 답변은 버리지 않습니다. 상태에 본문을 실어 화면이 그대로 보여 줍니다.
//   LLM 도 기록도 핵심 경로가 아닙니다 (renew.prd 31.4).

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getMessages, newConversationId, runAgent, saveTurn } from '@/lib/agent';
import { EMPTY_ASK, HISTORY_TURNS, type AskState } from './state';

export async function ask(_prev: AskState, formData: FormData): Promise<AskState> {
  const user = await getSessionUser();
  if (!user) return { error: '로그인이 필요합니다.', answer: null };

  const question = String(formData.get('question') ?? '').trim();
  if (!question) return { error: '질문을 입력해주세요.', answer: null };

  const given = String(formData.get('conversationId') ?? '').trim();
  const conversationId = given || newConversationId();

  let destination: string | null = null;
  let state: AskState = EMPTY_ASK;

  try {
    // 이어 가는 대화면 앞선 문답을 함께 넘깁니다. 이것이 없으면 "그럼 언제 발주해?" 같은
    // 후속 질문이 무엇에 대한 물음인지 알 수 없어 모델이 의도를 지어냅니다.
    // 최근 6줄(문답 3턴)만 넣습니다 — 대화가 길어질수록 토큰과 지연이 함께 늘어납니다.
    let history: { role: 'user' | 'assistant'; content: string }[] = [];
    if (given) {
      const previous = await getMessages(given, 100);
      history = previous.rows
        .map((row) => ({ role: row.role, content: row.content }))
        .slice(-HISTORY_TURNS);
    }

    const result = await runAgent({
      question,
      // 부서를 함께 넘깁니다. 오케스트레이터가 이 값으로 툴 집합을 고르고
      // (영업이면 6종만), 툴 결과에서 단가·정확도를 가립니다 (renew.prd 4.5 · STEP 17).
      user: {
        userId: user.userId,
        email: user.email,
        role: user.role,
        department: user.department,
      },
      history,
    });

    if (!result.configured) {
      return { error: result.error ?? 'AI 가 설정되지 않았습니다.', answer: null };
    }
    if (result.answer === null) {
      return { error: result.error ?? '답변을 만들지 못했습니다.', answer: null };
    }

    const saved = await saveTurn({
      conversationId,
      question,
      answer: result.answer,
      toolTrace: result.toolTrace,
      usage: result.usage,
      guardrail: result.guardrail,
    });

    if (saved.error) {
      // 답변은 살아 있습니다. 기록만 남지 않았음을 알리고 본문을 그대로 보여 줍니다.
      state = {
        error: `대화를 저장하지 못했습니다: ${saved.error}`,
        answer: result.answer.cannot_answer
          ? (result.answer.cannot_answer_reason ?? '산출할 수 없습니다.')
          : result.answer.answer,
      };
    } else {
      revalidatePath('/agent');
      destination = `/agent?c=${encodeURIComponent(conversationId)}`;
    }
  } catch (error) {
    return {
      error: error instanceof Error ? `질문을 처리하지 못했습니다: ${error.message}` : '질문을 처리하지 못했습니다.',
      answer: null,
    };
  }

  // redirect 는 예외를 던져 흐름을 끊습니다. try/catch 밖에서 부릅니다 (공통규칙 §3-4).
  if (destination) redirect(destination);
  return state;
}
