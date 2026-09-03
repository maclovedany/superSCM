import test from 'node:test';
import assert from 'node:assert/strict';
import { groupFor, runAgent, systemPrompt, MAX_TOOL_ROUNDS } from './orchestrator.ts';
import { registerTool, type AgentTool } from './tools.ts';

// 오케스트레이터 — renew.prd 26장
//
// 진짜 모델도 DB 도 부르지 않습니다. 가짜 fetch 로 "모델이 이렇게 답했을 때" 를 만들고,
// 툴 루프와 Guardrail 이 그때 어떻게 움직이는지만 봅니다.
//
// 여기서 지키는 것 넷.
//   ① 툴을 부르면 그 결과가 다음 호출의 재료가 된다
//   ② 답변의 수치가 툴 값과 다르면 1회 재생성을 요청한다
//   ③ 재생성해도 다르면 답변을 버리고 "산출할 수 없음" 을 낸다
//   ④ 역할이 부를 수 없는 툴은 실행하지 않는다

process.env.OPENAI_BASE_URL = 'https://llm.example.com/v1';
process.env.OPENAI_API_KEY = 'sk-test';
process.env.OPENAI_MODEL = 'gpt-test';

const USER = { userId: 'u-1', email: 'user@example.com', role: 'USER' as const };

/** 시험용 툴. 진짜 툴은 Supabase 를 부르므로 여기서는 값을 직접 돌려주는 툴을 씁니다 */
const stub: AgentTool = {
  name: 'stubOrderQuantity',
  description: '시험용 — 발주 수량을 돌려줍니다',
  parameters: {
    type: 'object',
    properties: { itemId: { type: 'string', description: '품목코드' } },
    required: ['itemId'],
    additionalProperties: false,
  },
  roles: ['ADMIN', 'USER'],
  enabled: true,
  run: async (args) => ({
    ok: true,
    data: { itemId: args.itemId },
    numbers: { final_recommended_qty: 700, safety_stock: 400 },
    dataAsOf: '2026-09-01T00:00:00Z',
  }),
};

/** ADMIN 만 부를 수 있는 툴 — 역할 필터가 서버에서 도는지 보려는 것입니다 */
const adminOnly: AgentTool = {
  name: 'stubAdminOnly',
  description: '시험용 — 관리자 전용',
  parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  roles: ['ADMIN'],
  enabled: true,
  run: async () => ({ ok: true, data: null, numbers: { secret: 42 }, dataAsOf: null }),
};

registerTool(stub);
registerTool(adminOnly);

/** 미리 정해 둔 응답을 차례로 돌려주는 가짜 모델 */
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

function answerMessage(body: Record<string, unknown>) {
  return { content: JSON.stringify(body) };
}

function toolCallMessage(name: string, args: Record<string, unknown>) {
  return {
    content: null,
    tool_calls: [
      { id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } },
    ],
  };
}

test('시스템 프롬프트가 규칙과 역할을 담는다', () => {
  const prompt = systemPrompt('USER');
  assert.match(prompt, /숫자를 스스로 계산하지 마세요/);
  assert.match(prompt, /cannot_answer/);
  assert.match(prompt, /현재 사용자 역할: USER/);
});

test('질문이 비어 있으면 모델을 부르지 않는다', async () => {
  const { impl, sent } = fakeModel([]);
  const result = await runAgent({ question: '   ', user: USER, fetchImpl: impl });
  assert.equal(sent.length, 0);
  assert.match(result.error ?? '', /질문을 입력해주세요/);
});

test('툴을 부르고 그 값으로 답한다 — 툴 호출 기록이 남는다', async () => {
  const { impl, sent } = fakeModel([
    toolCallMessage('stubOrderQuantity', { itemId: 'ITEM012' }),
    answerMessage({
      answer: '최종 700개를 발주하세요. 안전재고는 400개입니다.',
      verdict: '발주 필요',
      evidence: [
        { label: '추천 수량', value: 700, unit: '개', source_tool: 'stubOrderQuantity', reason: null },
      ],
      data_as_of: null,
      risk: 'WARNING',
      recommended_action: '700개를 발주하세요.',
      cannot_answer: false,
      cannot_answer_reason: null,
    }),
  ]);

  const result = await runAgent({
    question: 'ITEM012 얼마나 발주해야 해?',
    user: USER,
    fetchImpl: impl,
  });

  assert.equal(result.error, null);
  assert.equal(result.answer?.verdict, '발주 필요');
  assert.equal(result.guardrail?.ok, true);
  assert.equal(result.guardrail?.regenerated, false);
  assert.deepEqual(
    result.toolTrace.map((entry) => [entry.name, entry.ok]),
    [['stubOrderQuantity', true]],
  );
  // 모델이 비워 둔 기준시각은 툴이 준 값으로 채웁니다.
  assert.equal(result.answer?.data_as_of, '2026-09-01T00:00:00Z');
  // 두 번째 호출에는 툴 결과가 재료로 실려 갑니다.
  const second = sent[1].messages as { role: string; content: string }[];
  assert.equal(second[second.length - 1].role, 'tool');
  assert.match(second[second.length - 1].content, /final_recommended_qty/);
});

test('툴 결과에 없는 수치를 쓰면 1회 재생성을 요청한다 ★', async () => {
  const { impl, sent } = fakeModel([
    toolCallMessage('stubOrderQuantity', { itemId: 'ITEM012' }),
    answerMessage({ answer: '900개를 발주하세요.', cannot_answer: false }),
    answerMessage({ answer: '700개를 발주하세요.', cannot_answer: false }),
  ]);

  const result = await runAgent({ question: 'ITEM012 얼마나?', user: USER, fetchImpl: impl });

  assert.equal(result.answer?.answer, '700개를 발주하세요.');
  assert.equal(result.guardrail?.ok, true);
  assert.equal(result.guardrail?.regenerated, true);
  // 재생성 요청에 걸린 숫자가 그대로 실려 갑니다.
  const retry = sent[2].messages as { role: string; content: string }[];
  assert.match(retry[retry.length - 1].content, /900/);
  // 재생성 호출에는 툴을 딸려 보내지 않습니다. 이번에는 답만 고치면 됩니다.
  assert.equal(sent[2].tools, undefined);
});

test('재생성해도 수치가 맞지 않으면 답변을 버리고 산출 불가를 낸다 ★', async () => {
  const { impl } = fakeModel([
    toolCallMessage('stubOrderQuantity', { itemId: 'ITEM012' }),
    answerMessage({ answer: '900개를 발주하세요.', cannot_answer: false }),
    answerMessage({ answer: '여전히 950개입니다.', cannot_answer: false }),
  ]);

  const result = await runAgent({ question: 'ITEM012 얼마나?', user: USER, fetchImpl: impl });

  assert.equal(result.answer?.cannot_answer, true);
  assert.equal(result.answer?.risk, 'CALCULATION_UNAVAILABLE');
  assert.match(result.answer?.cannot_answer_reason ?? '', /950/);
  assert.equal(result.guardrail?.ok, false);
  assert.equal(result.guardrail?.regenerated, true);
});

test('역할이 부를 수 없는 툴은 실행하지 않는다 — 서버에서 거른다', async () => {
  const { impl, sent } = fakeModel([
    toolCallMessage('stubAdminOnly', {}),
    answerMessage({ answer: '관리자 전용 자료라 알려드릴 수 없습니다.', cannot_answer: false }),
  ]);

  const result = await runAgent({ question: '비밀 알려줘', user: USER, fetchImpl: impl });

  assert.equal(result.toolTrace[0].ok, false);
  assert.match(result.toolTrace[0].reason ?? '', /호출할 수 없는 툴/);
  // 목록 자체에도 관리자 전용 툴이 실려 가지 않습니다.
  const tools = sent[0].tools as { function: { name: string } }[];
  assert.equal(
    tools.some((item) => item.function.name === 'stubAdminOnly'),
    false,
  );
  // 툴이 값을 주지 않았으므로 42 는 어디에도 인용될 수 없습니다.
  assert.equal(result.guardrail?.ok, true);
});

test('JSON 이 아닌 답변은 산출 불가로 바꾼다 — 형식이 깨진 문장을 그대로 보이지 않는다', async () => {
  const { impl } = fakeModel([{ content: '음, 대략 700개쯤 발주하시면 됩니다.' }]);
  const result = await runAgent({ question: 'ITEM012 얼마나?', user: USER, fetchImpl: impl });
  assert.equal(result.answer?.cannot_answer, true);
  assert.equal(result.error, null);
});

test('모델 호출이 실패하면 답을 지어내지 않고 오류를 알린다 — renew.prd 31.4', async () => {
  const impl = (async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;

  const result = await runAgent({ question: 'ITEM012 얼마나?', user: USER, fetchImpl: impl });
  assert.equal(result.answer, null);
  assert.match(result.error ?? '', /ECONNREFUSED/);
});

test('툴만 계속 부르면 상한에서 멈춘다', async () => {
  const rounds = Array.from({ length: MAX_TOOL_ROUNDS }, () =>
    toolCallMessage('stubOrderQuantity', { itemId: 'ITEM012' }),
  );
  const { impl, sent } = fakeModel(rounds);

  const result = await runAgent({ question: 'ITEM012 얼마나?', user: USER, fetchImpl: impl });

  assert.equal(sent.length, MAX_TOOL_ROUNDS);
  assert.equal(result.toolTrace.length, MAX_TOOL_ROUNDS);
  assert.equal(result.answer?.cannot_answer, true);
});

test('AI 가 설정되지 않았으면 configured 가 false 이고 모델을 부르지 않는다', async () => {
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const { impl, sent } = fakeModel([]);
    const result = await runAgent({ question: '질문', user: USER, fetchImpl: impl });
    assert.equal(result.configured, false);
    assert.equal(sent.length, 0);
    assert.match(result.error ?? '', /OPENAI_API_KEY/);
  } finally {
    process.env.OPENAI_API_KEY = saved;
  }
});

// ── 수정 라운드 1 ──────────────────────────────────────────────

test('이전 문답을 함께 넘기면 시스템 프롬프트 뒤에 그대로 실린다', async () => {
  const { impl, sent } = fakeModel([answerMessage({ answer: '앞서 말씀드린 대로입니다.', cannot_answer: false })]);

  await runAgent({
    question: '그럼 언제 발주해?',
    user: USER,
    history: [
      { role: 'user', content: 'ITEM012 얼마나 발주해야 해?' },
      { role: 'assistant', content: '700개입니다.' },
    ],
    fetchImpl: impl,
  });

  const messages = sent[0].messages as { role: string; content: string }[];
  assert.deepEqual(
    messages.map((message) => message.role),
    ['system', 'user', 'assistant', 'user'],
  );
  assert.equal(messages[1].content, 'ITEM012 얼마나 발주해야 해?');
  assert.equal(messages[3].content, '그럼 언제 발주해?');
});

test('json_schema 를 거절한 서버에서는 남은 라운드도 json_object 로 간다', async () => {
  // 사내 vLLM 을 흉내냅니다. json_schema 가 오면 400, json_object 면 정상.
  const replies: Record<string, unknown>[] = [
    toolCallMessage('stubOrderQuantity', { itemId: 'ITEM012' }),
    answerMessage({ answer: '700개를 발주하세요.', cannot_answer: false }),
  ];
  const formats: (string | undefined)[] = [];

  const impl = (async (_url: unknown, init: unknown) => {
    const body = JSON.parse((init as { body: string }).body) as {
      response_format?: { type: string };
    };
    formats.push(body.response_format?.type);

    if (body.response_format?.type === 'json_schema') {
      return {
        ok: false,
        status: 400,
        json: async () => ({}),
        text: async () => 'response_format json_schema not supported',
      };
    }
    const next = replies.shift();
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: next }] }),
      text: async () => '',
    };
  }) as unknown as typeof fetch;

  const result = await runAgent({ question: 'ITEM012 얼마나?', user: USER, fetchImpl: impl });

  assert.equal(result.answer?.answer, '700개를 발주하세요.');
  // 400 은 첫 라운드에서 한 번만 맞습니다. 두 번째 라운드는 곧바로 json_object 로 갑니다.
  assert.deepEqual(formats, ['json_schema', 'json_object', 'json_object']);
});

// ── STEP 17 · 영업 (renew.prd 27장 · 4.5) ──────────────────────
//
// 여기서 지키는 것 셋.
//   ⑤ 영업 사용자에게는 SCM 툴이 목록에도 없고, 이름을 알고 불러도 실행되지 않는다
//   ⑥ 관리자는 부서가 영업이어도 SCM 툴을 그대로 쓴다
//   ⑦ 툴이 단가를 돌려줘도 영업 사용자의 답변 재료에서는 사라진다

const SALES_USER = {
  userId: 'u-2',
  email: 'sales@example.com',
  role: 'USER' as const,
  department: '영업1팀',
};

const ADMIN_IN_SALES = {
  userId: 'u-3',
  email: 'admin@example.com',
  role: 'ADMIN' as const,
  department: '영업1팀',
};

/** 단가를 돌려주는 시험용 영업 툴 — 가리기가 실제로 도는지 보려는 것입니다 */
const salesStub: AgentTool = {
  name: 'stubSalesAtp',
  description: '시험용 — ATP 와 단가를 함께 돌려줍니다',
  parameters: {
    type: 'object',
    properties: { itemId: { type: 'string', description: '품목코드' } },
    required: ['itemId'],
    additionalProperties: false,
  },
  roles: ['ADMIN', 'USER'],
  group: 'SALES',
  enabled: true,
  run: async () => ({
    ok: true,
    data: { itemId: 'ITEM012', atpQty: 620, unitPrice: 12500, supplierName: '인도 법인' },
    numbers: { atp_qty: 620, unit_price: 12500 },
    dataAsOf: '2026-09-01T00:00:00Z',
    dates: ['2026-10-10'],
  }),
};

/** 같은 값을 돌려주지만 SCM 묶음인 툴 — 가리기가 SCM 에는 걸리지 않는지 보려는 것입니다 */
const scmPriceStub: AgentTool = {
  ...salesStub,
  name: 'stubScmPrice',
  description: '시험용 — SCM 묶음에서 단가를 돌려줍니다',
  group: 'SCM',
};

registerTool(salesStub);
registerTool(scmPriceStub);

/** 이번 호출에서 모델에게 보인 툴 이름 */
function offeredTools(body: Record<string, unknown>): string[] {
  const tools = (body.tools ?? []) as { function: { name: string } }[];
  return tools.map((tool) => tool.function.name);
}

test('영업 사용자에게는 영업 툴만 보인다 (renew.prd 4.5)', async () => {
  const { impl, sent } = fakeModel([
    answerMessage({ answer: '무엇을 도와드릴까요?', cannot_answer: false }),
  ]);

  await runAgent({ question: '재고 알려줘', user: SALES_USER, fetchImpl: impl });

  const offered = offeredTools(sent[0]);
  assert.ok(offered.includes('stubSalesAtp'), '영업 툴이 목록에 없습니다');
  assert.equal(offered.includes('stubOrderQuantity'), false, 'SCM 툴이 목록에 있습니다');
});

test('★ 영업 사용자가 이름을 알고 SCM 툴을 불러도 실행되지 않는다', async () => {
  const { impl, sent } = fakeModel([
    toolCallMessage('stubOrderQuantity', { itemId: 'ITEM012' }),
    answerMessage({ answer: '영업 화면에서는 제공하지 않습니다.', cannot_answer: false }),
  ]);

  const result = await runAgent({ question: '발주 수량 알려줘', user: SALES_USER, fetchImpl: impl });

  assert.equal(result.toolTrace[0].ok, false);
  assert.match(result.toolTrace[0].reason ?? '', /호출할 수 없는 툴/);

  // 툴 결과 문자열에 SCM 수치가 실리지 않았는지 봅니다.
  const toolMessage = (sent[1].messages as { role: string; content: string }[]).find(
    (message) => message.role === 'tool',
  );
  assert.equal(toolMessage?.content.includes('700'), false, 'SCM 수치가 모델에게 갔습니다');
});

test('관리자는 부서가 영업이어도 SCM 툴을 그대로 쓴다 (renew.prd 4.2)', async () => {
  const { impl, sent } = fakeModel([
    answerMessage({ answer: '무엇을 도와드릴까요?', cannot_answer: false }),
  ]);

  await runAgent({ question: '발주 수량 알려줘', user: ADMIN_IN_SALES, fetchImpl: impl });

  const offered = offeredTools(sent[0]);
  assert.ok(offered.includes('stubOrderQuantity'), '관리자에게 SCM 툴이 없습니다');
  assert.equal(offered.includes('stubSalesAtp'), false, '관리자에게 영업 툴이 섞였습니다');
});

test('★ 영업 사용자에게는 툴이 돌려준 단가가 답변 재료에서 사라진다', async () => {
  const { impl, sent } = fakeModel([
    toolCallMessage('stubSalesAtp', { itemId: 'ITEM012' }),
    // 모델이 단가를 인용하려 합니다. 가리기가 돌았다면 Guardrail 이 이것을 막습니다.
    answerMessage({
      answer: '즉시 620개 약속 가능합니다. 단가는 12,500원입니다.',
      cannot_answer: false,
    }),
    // 재생성 요청에 대한 두 번째 답
    answerMessage({ answer: '즉시 620개 약속 가능합니다.', cannot_answer: false }),
  ]);

  const result = await runAgent({ question: '620개 되나?', user: SALES_USER, fetchImpl: impl });

  // 모델에게 간 툴 결과에 단가가 없어야 합니다.
  const toolMessage = (sent[1].messages as { role: string; content: string }[]).find(
    (message) => message.role === 'tool',
  );
  assert.equal(toolMessage?.content.includes('12500'), false, '단가가 모델에게 갔습니다');
  assert.ok(toolMessage?.content.includes('620'), 'ATP 까지 사라졌습니다');

  // Guardrail 이 단가를 잡아 재생성을 요청했고, 두 번째 답이 통과했습니다.
  assert.equal(result.guardrail?.regenerated, true);
  assert.equal(result.answer?.answer, '즉시 620개 약속 가능합니다.');
});

test('SCM 사용자에게는 같은 툴 결과에서 아무것도 사라지지 않는다', async () => {
  // ③이 ②만큼 중요합니다. 가리기가 SCM 에도 걸리면 화면과 AI 의 숫자가 갈라집니다
  // (renew.prd 32). 같은 값을 돌려주는 SCM 묶음 툴로 확인합니다.
  const { impl, sent } = fakeModel([
    toolCallMessage('stubScmPrice', { itemId: 'ITEM012' }),
    answerMessage({
      answer: '즉시 620개이고 단가는 12,500원입니다.',
      cannot_answer: false,
    }),
  ]);

  const result = await runAgent({ question: '단가 알려줘', user: USER, fetchImpl: impl });

  assert.equal(result.toolTrace[0].ok, true);

  const toolMessage = (sent[1].messages as { role: string; content: string }[]).find(
    (message) => message.role === 'tool',
  );
  assert.ok(toolMessage?.content.includes('12500'), 'SCM 사용자에게서 단가가 사라졌습니다');
  assert.ok(toolMessage?.content.includes('인도 법인'), 'SCM 사용자에게서 공급처가 사라졌습니다');

  // 단가가 numbers 에 남아 있으므로 Guardrail 이 통과시킵니다 — 재생성이 없습니다.
  assert.equal(result.guardrail?.regenerated, false);
  assert.equal(result.answer?.answer, '즉시 620개이고 단가는 12,500원입니다.');
});

test('영업용 시스템 프롬프트가 renew.prd 27.5 의 문체를 담는다', () => {
  const prompt = systemPrompt('USER', 'SALES');
  assert.match(prompt, /영업 담당자/);
  assert.match(prompt, /즉시 출하 가능/);
  assert.match(prompt, /다섯 번 중 한 번은 지연/);
  assert.match(prompt, /예약 번호와 유효기간을 반드시/);
  assert.match(prompt, /단가 · 발주 금액 · 공급처 · 리드타임 통계 · 예측 정확도는 답변에 쓰지 않습니다/);
});

test('groupFor 는 관리자와 부서 없는 사용자를 SCM 으로 본다', () => {
  assert.equal(groupFor(SALES_USER), 'SALES');
  assert.equal(groupFor(ADMIN_IN_SALES), 'SCM');
  assert.equal(groupFor(USER), 'SCM');
  assert.equal(groupFor({ ...USER, department: null }), 'SCM');
  assert.equal(groupFor({ ...USER, department: '구매팀' }), 'SCM');
});

test('★ 툴이 내지 않은 날짜를 답하면 재생성을 요청한다 (리뷰 Important 4)', async () => {
  // 영업 답변은 거의 전부가 날짜입니다. 수량만 검사하고 날짜를 두면 모델이
  // "2026-12-25 에 가능합니다" 를 마음대로 지어낼 수 있습니다.
  const { impl, sent } = fakeModel([
    toolCallMessage('stubSalesAtp', { itemId: 'ITEM012' }),
    answerMessage({ answer: '620개를 2026-12-25 에 드릴 수 있습니다.', cannot_answer: false }),
    answerMessage({ answer: '620개를 2026-10-10 에 드릴 수 있습니다.', cannot_answer: false }),
  ]);

  const result = await runAgent({ question: '언제 되나?', user: SALES_USER, fetchImpl: impl });

  assert.equal(result.guardrail?.regenerated, true);

  // 재생성 요청 문장이 걸린 날짜를 그대로 지목합니다.
  const retry = (sent[2].messages as { role: string; content: string }[]).at(-1);
  assert.match(retry?.content ?? '', /다음 날짜는 툴 결과에 없습니다/);
  assert.match(retry?.content ?? '', /2026-12-25/);

  // 두 번째 답은 툴이 낸 날짜만 쓰므로 통과합니다.
  assert.equal(result.answer?.answer, '620개를 2026-10-10 에 드릴 수 있습니다.');
  assert.equal(result.guardrail?.ok, true);
});

test('툴이 dates 를 내지 않으면 날짜 검사가 꺼진다 — SCM 경로는 그대로', async () => {
  // stubOrderQuantity(SCM)는 dates 를 내지 않습니다. STEP 16 이 만든 경로의 동작을
  // 바꾸지 않기 위한 단계적 적용입니다.
  const { impl } = fakeModel([
    toolCallMessage('stubOrderQuantity', { itemId: 'ITEM012' }),
    answerMessage({ answer: '700개를 발주하세요. 결품 예상일은 2099-01-01 입니다.', cannot_answer: false }),
  ]);

  const result = await runAgent({ question: '얼마나 발주해?', user: USER, fetchImpl: impl });

  assert.equal(result.guardrail?.regenerated, false);
  assert.equal(result.guardrail?.ok, true);
});
