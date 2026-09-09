import assert from 'node:assert/strict';
import test from 'node:test';
import { ANSWER_RESPONSE_FORMAT, chatCompletion, readLlmConfig } from './llm.ts';

const ENV = { OPENAI_API_KEY: 'k', OPENAI_MODEL: 'test-model', OPENAI_BASE_URL: 'https://example.test/v1' };

function fakeFetch(responses: { ok: boolean; status: number; body?: unknown; text?: string }[]) {
  const sent: Record<string, unknown>[] = [];
  const impl = (async (_url: unknown, init: unknown) => {
    sent.push(JSON.parse((init as { body: string }).body) as Record<string, unknown>);
    const next = responses.shift();
    if (!next) throw new Error('예상보다 많이 호출했습니다');
    return {
      ok: next.ok,
      status: next.status,
      json: async () => next.body ?? {},
      text: async () => next.text ?? '',
    };
  }) as unknown as typeof fetch;
  return { impl, sent };
}

test('환경변수가 없으면 configured 가 false 이고 모델을 부르지 않는다', async () => {
  const { impl, sent } = fakeFetch([]);
  const result = await chatCompletion({ messages: [{ role: 'user', content: 'x' }], fetchImpl: impl, env: {} });
  assert.equal(sent.length, 0);
  assert.match(result.error ?? '', /OPENAI_API_KEY/);
  assert.equal(readLlmConfig({}).configured, false);
});

test('tool_calls 와 usage 를 읽는다', async () => {
  const { impl } = fakeFetch([
    {
      ok: true,
      status: 200,
      body: {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ id: 'call_1', function: { name: 'getStockoutRisk', arguments: '{"itemId":"ITEM012"}' } }],
            },
          },
        ],
        usage: { total_tokens: 42 },
      },
    },
  ]);
  const result = await chatCompletion({ messages: [{ role: 'user', content: 'x' }], fetchImpl: impl, env: ENV });
  assert.equal(result.error, null);
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].name, 'getStockoutRisk');
  assert.equal(result.usage?.totalTokens, 42);
});

test('json_schema 를 거절하는 서버에는 json_object 로 한 번만 낮춘다', async () => {
  const { impl, sent } = fakeFetch([
    { ok: false, status: 400, text: 'response_format json_schema is not supported' },
    { ok: true, status: 200, body: { choices: [{ message: { content: '{"answer":"ok"}' } }] } },
  ]);
  const result = await chatCompletion({
    messages: [{ role: 'user', content: 'x' }],
    responseFormat: ANSWER_RESPONSE_FORMAT,
    fetchImpl: impl,
    env: ENV,
  });
  assert.equal(result.error, null);
  assert.equal(result.fellBackToJsonObject, true);
  assert.equal((sent[0].response_format as { type: string }).type, 'json_schema');
  assert.equal((sent[1].response_format as { type: string }).type, 'json_object');
});

test('HTTP 오류를 예외가 아니라 error 로 돌려준다', async () => {
  const { impl } = fakeFetch([{ ok: false, status: 401, text: 'invalid api key' }]);
  const result = await chatCompletion({ messages: [{ role: 'user', content: 'x' }], fetchImpl: impl, env: ENV });
  assert.equal(result.status, 401);
  assert.match(result.error ?? '', /HTTP 401/);
  assert.equal(result.message.content, null);
});

test('네트워크 예외도 error 로 돌아온다 — 페이지를 터뜨리지 않는다', async () => {
  const impl = (async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
  const result = await chatCompletion({ messages: [{ role: 'user', content: 'x' }], fetchImpl: impl, env: ENV });
  assert.match(result.error ?? '', /ECONNREFUSED/);
});

test('temperature 를 거절하는 모델에는 빼고 다시 건다', async () => {
  const { impl, sent } = fakeFetch([
    { ok: false, status: 400, text: "Unsupported value: 'temperature' does not support 0 with this model." },
    { ok: true, status: 200, body: { choices: [{ message: { content: '{"answer":"ok"}' } }] } },
  ]);
  const result = await chatCompletion({
    messages: [{ role: 'user', content: 'x' }],
    fetchImpl: impl,
    env: { ...ENV, OPENAI_MODEL: 'temperature-picky-model' },
  });
  assert.equal(result.error, null);
  assert.equal(sent[0].temperature, 0);
  assert.equal(sent[1].temperature, undefined);
});
