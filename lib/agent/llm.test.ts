import test from 'node:test';
import assert from 'node:assert/strict';
import { chatCompletion, readLlmConfig, DEFAULT_BASE_URL, ANSWER_RESPONSE_FORMAT } from './llm.ts';
import { parseAgentAnswer, cannotAnswer } from './schema.ts';

// LLM 래퍼 — renew.prd 31.4 · 33
//
// 네트워크를 부르지 않습니다. fetch 를 주입해 응답 파싱만 봅니다.
// 여기서 지키는 것은 둘입니다.
//   ① 환경변수가 없으면 조용히 configured=false — 나머지 화면은 그대로 돕니다
//   ② 어떤 실패도 예외로 새어 나가지 않는다 — 전부 { error } 로 돌아옵니다

const ENV = {
  OPENAI_BASE_URL: 'https://llm.example.com/v1',
  OPENAI_API_KEY: 'sk-test',
  OPENAI_MODEL: 'gpt-test',
};

/** 한 번 호출에 하나씩 돌려주는 가짜 fetch. 보낸 본문을 모아 둡니다 */
function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const impl = (async (url: unknown, init: unknown) => {
    const request = init as { body: string };
    calls.push({ url: String(url), body: JSON.parse(request.body) as Record<string, unknown> });
    const next = responses.shift();
    if (!next) throw new Error('예상보다 많이 호출했습니다');
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body),
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function chatResponse(message: Record<string, unknown>) {
  return {
    status: 200,
    body: {
      choices: [{ message }],
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
    },
  };
}

test('환경변수가 없으면 configured 는 false 이고 무엇이 없는지 알려준다', () => {
  const config = readLlmConfig({});
  assert.equal(config.configured, false);
  assert.deepEqual(config.missing, ['OPENAI_API_KEY', 'OPENAI_MODEL']);
  assert.equal(config.baseUrl, DEFAULT_BASE_URL);
});

test('키만 있고 모델이 없으면 아직 설정된 것이 아니다', () => {
  const config = readLlmConfig({ OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: '  ' });
  assert.equal(config.configured, false);
  assert.deepEqual(config.missing, ['OPENAI_MODEL']);
});

test('base URL 은 기본값이 있고 끝의 슬래시를 뗀다 — 사내 vLLM 으로 바꿔 끼울 자리다', () => {
  const config = readLlmConfig({ ...ENV, OPENAI_BASE_URL: 'http://vllm.internal:8000/v1/' });
  assert.equal(config.configured, true);
  assert.equal(config.baseUrl, 'http://vllm.internal:8000/v1');
  assert.equal(readLlmConfig(ENV).model, 'gpt-test');
});

test('설정이 없으면 호출하지 않고 { error } 로 돌아온다', async () => {
  const { impl, calls } = fakeFetch([]);
  const result = await chatCompletion({
    messages: [{ role: 'user', content: '안녕' }],
    fetchImpl: impl,
    env: {},
  });
  assert.equal(calls.length, 0);
  assert.match(result.error ?? '', /AI 가 설정되지 않았습니다/);
  assert.equal(result.message.content, null);
});

test('응답의 본문 · 사용량을 읽는다', async () => {
  const { impl, calls } = fakeFetch([chatResponse({ content: '{"answer":"안녕하세요"}' })]);
  const result = await chatCompletion({
    messages: [{ role: 'user', content: '안녕' }],
    fetchImpl: impl,
    env: ENV,
  });

  assert.equal(result.error, null);
  assert.equal(result.message.content, '{"answer":"안녕하세요"}');
  assert.deepEqual(result.usage, { promptTokens: 120, completionTokens: 30, totalTokens: 150 });
  assert.equal(calls[0].url, 'https://llm.example.com/v1/chat/completions');
  assert.equal(calls[0].body.model, 'gpt-test');
});

test('tool_calls 를 읽는다', async () => {
  const { impl } = fakeFetch([
    chatResponse({
      content: null,
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'calcOrderQuantity', arguments: '{"itemId":"ITEM012"}' },
        },
      ],
    }),
  ]);

  const result = await chatCompletion({
    messages: [{ role: 'user', content: 'ITEM012 몇 개 발주해야 해?' }],
    tools: [
      {
        type: 'function',
        function: { name: 'calcOrderQuantity', description: '발주 추천', parameters: {} },
      },
    ],
    fetchImpl: impl,
    env: ENV,
  });

  assert.equal(result.error, null);
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].name, 'calcOrderQuantity');
  assert.equal(result.toolCalls[0].arguments, '{"itemId":"ITEM012"}');
});

test('tools 를 주면 tool_choice 를 auto 로 보낸다', async () => {
  const { impl, calls } = fakeFetch([chatResponse({ content: '{}' })]);
  await chatCompletion({
    messages: [{ role: 'user', content: '질문' }],
    tools: [{ type: 'function', function: { name: 'getAlerts', description: '알림', parameters: {} } }],
    fetchImpl: impl,
    env: ENV,
  });
  assert.equal(calls[0].body.tool_choice, 'auto');
});

test('json_schema 를 거절(400)하면 json_object 로 한 번만 낮춰 다시 건다', async () => {
  // 사내 vLLM · Ollama 가 Structured Outputs 를 모를 때의 길입니다.
  const { impl, calls } = fakeFetch([
    { status: 400, body: { error: { message: 'response_format json_schema not supported' } } },
    chatResponse({ content: '{"answer":"재시도 성공","cannot_answer":false}' }),
  ]);

  const result = await chatCompletion({
    messages: [{ role: 'user', content: '질문' }],
    responseFormat: ANSWER_RESPONSE_FORMAT,
    fetchImpl: impl,
    env: ENV,
  });

  assert.equal(result.error, null);
  assert.equal(result.fellBackToJsonObject, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body.response_format, ANSWER_RESPONSE_FORMAT);
  assert.deepEqual(calls[1].body.response_format, { type: 'json_object' });
});

test('400 이 아닌 오류는 낮추지 않고 그대로 알린다', async () => {
  const { impl, calls } = fakeFetch([{ status: 500, body: { error: { message: 'upstream down' } } }]);
  const result = await chatCompletion({
    messages: [{ role: 'user', content: '질문' }],
    responseFormat: ANSWER_RESPONSE_FORMAT,
    fetchImpl: impl,
    env: ENV,
  });
  assert.equal(calls.length, 1);
  assert.equal(result.status, 500);
  assert.match(result.error ?? '', /HTTP 500/);
});

test('fetch 가 던져도 예외가 새어 나가지 않는다 — renew.prd 31.4', async () => {
  const impl = (async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;

  const result = await chatCompletion({
    messages: [{ role: 'user', content: '질문' }],
    fetchImpl: impl,
    env: ENV,
  });
  assert.match(result.error ?? '', /ECONNREFUSED/);
  assert.equal(result.toolCalls.length, 0);
});

test('제한 시간을 넘기면 사람이 읽을 수 있는 안내로 바꾼다', async () => {
  const impl = (async () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  }) as unknown as typeof fetch;

  const result = await chatCompletion({
    messages: [{ role: 'user', content: '질문' }],
    fetchImpl: impl,
    env: ENV,
  });
  assert.match(result.error ?? '', /제한 시간/);
});

test('choices 가 없는 응답을 지어내지 않는다', async () => {
  const { impl } = fakeFetch([{ status: 200, body: { id: 'x' } }]);
  const result = await chatCompletion({
    messages: [{ role: 'user', content: '질문' }],
    fetchImpl: impl,
    env: ENV,
  });
  assert.equal(result.message.content, null);
  assert.match(result.error ?? '', /choices/);
});

// ── 응답 파싱 (lib/agent/schema.ts) ───────────────────────────

test('구조화 응답을 AgentAnswer 로 읽는다', () => {
  const answer = parseAgentAnswer(
    JSON.stringify({
      answer: 'ITEM012 는 700대 발주가 필요합니다.',
      verdict: '발주 필요',
      evidence: [
        { label: '적용수요', value: 1620, unit: '대', source_tool: 'calcOrderQuantity', reason: null },
      ],
      data_as_of: '2026-09-01T00:00:00Z',
      risk: 'WARNING',
      recommended_action: '700대를 발주하세요.',
      cannot_answer: false,
      cannot_answer_reason: null,
    }),
  );

  assert.notEqual(answer, null);
  assert.equal(answer?.risk, 'WARNING');
  assert.equal(answer?.evidence[0].source_tool, 'calcOrderQuantity');
  assert.equal(answer?.evidence[0].value, 1620);
  assert.equal(answer?.cannot_answer, false);
});

test('코드펜스로 감싼 JSON 도 읽는다 — 호환 서버가 자주 그렇게 보낸다', () => {
  const answer = parseAgentAnswer('```json\n{"answer":"안녕하세요","cannot_answer":false}\n```');
  assert.equal(answer?.answer, '안녕하세요');
});

test('모르는 risk 값은 지어내지 않고 null 로 둔다', () => {
  const answer = parseAgentAnswer('{"answer":"본문","risk":"DANGER"}');
  assert.equal(answer?.risk, null);
});

test('JSON 이 아니거나 본문이 없으면 null 이다 — 오케스트레이터가 산출 불가로 바꾼다', () => {
  assert.equal(parseAgentAnswer('답변드리자면 700대입니다'), null);
  assert.equal(parseAgentAnswer('{"verdict":"발주 필요"}'), null);
  assert.equal(parseAgentAnswer(null), null);
  assert.equal(parseAgentAnswer('[]'), null);
});

test('cannot_answer 만 있어도 답변으로 읽는다', () => {
  const answer = parseAgentAnswer('{"cannot_answer":true,"cannot_answer_reason":"입고 예정 정보가 없습니다"}');
  assert.equal(answer?.cannot_answer, true);
  assert.equal(answer?.cannot_answer_reason, '입고 예정 정보가 없습니다');
});

test('산출 불가 응답은 회색 상태와 사유를 함께 낸다 — design.md §8.2', () => {
  const answer = cannotAnswer('입고 예정 정보가 없습니다', '2026-09-01');
  assert.equal(answer.cannot_answer, true);
  assert.equal(answer.risk, 'CALCULATION_UNAVAILABLE');
  assert.equal(answer.data_as_of, '2026-09-01');
  assert.deepEqual(answer.evidence, []);
});
