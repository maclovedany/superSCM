import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_TOOL_ROUNDS, runAgent, systemPrompt } from './orchestrator.ts';
import { registerTool, type ToolResult } from './tools.ts';

// 실제 DB 를 부르지 않는 가짜 툴을 하나 등록합니다.
// node --test 는 파일마다 별도 프로세스로 돌기 때문에 다른 테스트 파일에 새지 않습니다.
let stubCalls = 0;
registerTool({
  name: 'stubStockout',
  description: '테스트용 — 소진 위험 값을 그대로 돌려줍니다',
  parameters: { type: 'object', additionalProperties: false, required: [], properties: {} },
  roles: ['USER', 'ADMIN'],
  async run(): Promise<ToolResult> {
    stubCalls += 1;
    return {
      ok: true,
      data: { itemId: 'ITEM012', stockoutDays: 18.04 },
      numbers: { stockout_days: 18.04, available_qty: 650 },
      dataAsOf: '2026-09-09',
    };
  },
});

registerTool({
  name: 'stubAdminOnly',
  description: '테스트용 — ADMIN 만 부를 수 있는 툴',
  parameters: { type: 'object', additionalProperties: false, required: [], properties: {} },
  roles: ['ADMIN'],
  async run(): Promise<ToolResult> {
    return { ok: true, data: { secret: true }, numbers: { secret_value: 1 }, dataAsOf: null };
  },
});

const USER = { userId: 'u1', email: 'user@example.com', role: 'USER' as const };
const ENV_KEYS = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_BASE_URL'] as const;

/**
 * 환경변수를 잠깐 채우고 되돌립니다.
 *
 * ★ await 를 빼면 안 됩니다. run() 이 끝나기 전에 finally 가 돌아 환경변수가 사라지고,
 *   runAgent 는 "AI 가 설정되지 않았습니다" 로 끝납니다 (처음에 그렇게 틀렸습니다).
 */
async function withEnv<T>(run: () => Promise<T>): Promise<T> {
  const saved = ENV_KEYS.map((key) => [key, process.env[key]] as const);
  process.env.OPENAI_API_KEY = 'k';
  process.env.OPENAI_MODEL = 'test-model';
  process.env.OPENAI_BASE_URL = 'https://example.test/v1';
  try {
    return await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function toolCallMessage(name: string) {
  return { content: null, tool_calls: [{ id: `call_${name}`, function: { name, arguments: '{}' } }] };
}

function answerMessage(answer: Record<string, unknown>) {
  return { content: JSON.stringify(answer) };
}

const GOOD_ANSWER = {
  answer: 'ITEM012 는 약 18.04일 뒤 소진 예상입니다.',
  verdict: '리드타임 안에 결품 가능',
  evidence: [{ label: '소진예상일수', value: 18.04, unit: '일', source_tool: 'stubStockout' }],
  risk: 'CRITICAL',
  recommended_action: '발주 검토',
  data_as_of: '2026-09-09',
  cannot_answer: false,
  cannot_answer_reason: null,
};

function fakeModel(messages: Record<string, unknown>[]) {
  const sent: Record<string, unknown>[] = [];
  const impl = (async (_url: unknown, init: unknown) => {
    sent.push(JSON.parse((init as { body: string }).body) as Record<string, unknown>);
    const next = messages.shift();
    if (!next) throw new Error('예상보다 많이 호출했습니다');
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: next }], usage: { total_tokens: 10 } }),
      text: async () => '',
    };
  }) as unknown as typeof fetch;
  return { impl, sent };
}

test('시스템 프롬프트가 네 툴과 금지 규칙을 담는다', () => {
  const prompt = systemPrompt('USER');
  for (const name of ['getDemandProfile', 'getForecastAccuracy', 'getStockoutRisk', 'getLeadtimeStats']) {
    assert.match(prompt, new RegExp(name));
  }
  assert.match(prompt, /숫자를 스스로 계산하지 마세요/);
  assert.match(prompt, /USER/);
});

test('user → assistant tool_call → tool 결과 → assistant 답변 순서로 돈다', async () => {
  await withEnv(async () => {
    const { impl, sent } = fakeModel([toolCallMessage('stubStockout'), answerMessage(GOOD_ANSWER)]);
    const before = stubCalls;
    const result = await runAgent({ question: 'ITEM012 언제 떨어져?', user: USER, fetchImpl: impl });

    assert.equal(result.error, null);
    assert.equal(stubCalls, before + 1, '툴이 실제로 실행되어야 합니다');
    assert.equal(result.answer?.risk, 'CRITICAL');
    assert.equal(result.toolTrace.length, 1);
    assert.equal(result.toolTrace[0].ok, true);

    // 두 번째 요청에 실린 메시지 순서를 봅니다.
    const messages = sent[1].messages as { role: string; tool_call_id?: string }[];
    assert.deepEqual(messages.map((m) => m.role), ['system', 'user', 'assistant', 'tool']);
    assert.equal(messages[3].tool_call_id, 'call_stubStockout', 'tool_call_id 가 짝을 이뤄야 합니다');
  });
});

test('USER 는 ADMIN 전용 툴을 실행하지 못한다 — 이름을 알아도 서버가 거절한다', async () => {
  await withEnv(async () => {
    const { impl, sent } = fakeModel([
      toolCallMessage('stubAdminOnly'),
      answerMessage({ ...GOOD_ANSWER, answer: '권한이 없어 확인하지 못했습니다.', evidence: [] }),
    ]);
    const result = await runAgent({ question: '관리자 정보 알려줘', user: USER, fetchImpl: impl });

    assert.equal(result.toolTrace[0].ok, false);
    assert.match(result.toolTrace[0].reason ?? '', /호출할 수 없는 툴/);
    // 1차 방어 — 애초에 목록에도 없습니다.
    const tools = sent[0].tools as { function: { name: string } }[];
    assert.ok(!tools.some((tool) => tool.function.name === 'stubAdminOnly'));
  });
});

test('툴 결과에 없는 숫자가 있으면 한 번 재생성하고, 고쳐 오면 통과시킨다', async () => {
  await withEnv(async () => {
    const { impl } = fakeModel([
      toolCallMessage('stubStockout'),
      answerMessage({ ...GOOD_ANSWER, answer: '가용 수량은 700개입니다.' }), // 700 은 툴에 없음
      answerMessage({ ...GOOD_ANSWER, answer: '가용 수량은 650개입니다.' }),
    ]);
    const result = await runAgent({ question: '가용 수량은?', user: USER, fetchImpl: impl });

    assert.equal(result.answer?.cannot_answer, false);
    assert.equal(result.guardrail?.regenerated, true);
    assert.equal(result.guardrail?.ok, true);
  });
});

test('두 번 다 지어낸 숫자면 답변을 버리고 산출 불가로 끝낸다', async () => {
  await withEnv(async () => {
    const { impl } = fakeModel([
      toolCallMessage('stubStockout'),
      answerMessage({ ...GOOD_ANSWER, answer: '가용 수량은 700개입니다.' }),
      answerMessage({ ...GOOD_ANSWER, answer: '가용 수량은 800개입니다.' }),
    ]);
    const result = await runAgent({ question: '가용 수량은?', user: USER, fetchImpl: impl });

    assert.equal(result.answer?.cannot_answer, true);
    assert.equal(result.guardrail?.ok, false);
    assert.ok((result.guardrail?.offending ?? []).includes('800'));
  });
});

test('툴만 계속 부르면 상한에서 멈추고 산출 불가로 끝낸다', async () => {
  await withEnv(async () => {
    const rounds = Array.from({ length: MAX_TOOL_ROUNDS }, () => toolCallMessage('stubStockout'));
    const { impl, sent } = fakeModel(rounds);
    const result = await runAgent({ question: '계속', user: USER, fetchImpl: impl });

    assert.equal(sent.length, MAX_TOOL_ROUNDS);
    assert.equal(result.toolTrace.length, MAX_TOOL_ROUNDS);
    assert.equal(result.answer?.cannot_answer, true);
  });
});

test('환경변수가 없으면 configured 가 false 이고 모델을 부르지 않는다', async () => {
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const { impl, sent } = fakeModel([]);
    const result = await runAgent({ question: '질문', user: USER, fetchImpl: impl });
    assert.equal(result.configured, false);
    assert.equal(sent.length, 0);
    assert.match(result.error ?? '', /OPENAI_API_KEY/);
  } finally {
    if (saved === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved;
  }
});

test('빈 질문은 모델을 부르지 않는다', async () => {
  await withEnv(async () => {
    const { impl, sent } = fakeModel([]);
    const result = await runAgent({ question: '   ', user: USER, fetchImpl: impl });
    assert.equal(sent.length, 0);
    assert.match(result.error ?? '', /질문을 입력/);
  });
});
