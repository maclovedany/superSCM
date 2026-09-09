// STEP 16 ⑧ 진행 상황 스트림 — 6회차 슬라이드 63
//
// 서버 액션은 답이 다 만들어진 뒤에야 한 번 돌아옵니다. 그동안 화면은 아무것도 모릅니다.
// 이 라우트는 같은 runAgent 를 부르면서 **단계가 바뀔 때마다** SSE 한 줄을 흘려보냅니다.
//
// ★ 흘려보내는 것은 단계 이름뿐입니다. 답변 문장은 Guardrail 을 통과한 뒤 마지막 done
//   이벤트에 한 번 실려 나갑니다 — 검증되지 않은 수치를 사람이 보는 일은 없습니다.
// ★ API key 와 원본 데이터는 여기서도 클라이언트로 가지 않습니다.

import { AuthorizationError, requireSignedIn } from '@/lib/auth';
import { runAgent, type AgentProgress } from '@/lib/agent/orchestrator';
import { saveTurn } from '@/lib/agent/conversation';
import type { AskResult } from '@/app/(user)/agent/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type StreamEvent = { type: 'progress'; event: AgentProgress } | { type: 'done'; result: AskResult };

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(request: Request) {
  let user;
  try {
    user = await requireSignedIn();
  } catch (error) {
    if (error instanceof AuthorizationError) return errorResponse(error.message, error.status);
    return errorResponse('로그인 상태를 확인하지 못했습니다.', 500);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse('요청을 읽지 못했습니다.', 400);
  }

  const question = String(body.question ?? '').trim();
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : null;

  if (question === '') return errorResponse('질문을 입력해주세요.', 400);
  if (question.length > 500) return errorResponse('질문이 너무 깁니다. 500자 안으로 줄여 주세요.', 400);

  const { authUser, profile } = user;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (payload: StreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          open = false; // 사용자가 화면을 떠났습니다.
        }
      };

      try {
        const result = await runAgent({
          question,
          user: { userId: authUser.id, email: profile.email, role: profile.role },
          onProgress: (event) => send({ type: 'progress', event }),
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

        send({
          type: 'done',
          result: {
            conversationId: saved.conversationId ?? conversationId,
            question,
            answer: result.answer,
            toolTrace: result.toolTrace,
            guardrail: result.guardrail,
            configured: result.configured,
            error: result.error,
            saveWarning: saved.error,
          },
        });
      } catch (error) {
        send({
          type: 'done',
          result: {
            conversationId,
            question,
            answer: null,
            toolTrace: [],
            guardrail: null,
            configured: true,
            error: error instanceof Error ? `질문을 처리하지 못했습니다: ${error.message}` : '질문을 처리하지 못했습니다.',
            saveWarning: null,
          },
        });
      } finally {
        if (open) controller.close();
        open = false;
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      // no-transform · x-accel-buffering 이 없으면 중간 프록시가 모아 두었다가 한 번에 보냅니다.
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
