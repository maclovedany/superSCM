import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allTools,
  findTool,
  registerTool,
  replaceTool,
  toOpenAiTools,
  toolsFor,
  type AgentTool,
} from './tools.ts';

// 툴 레지스트리 — renew.prd 26.2
//
// 이 파일은 툴을 실행하지 않습니다. 실행하려면 Supabase 가 필요하기 때문입니다.
// 대신 목록 · 스키마 · 역할처럼 "틀리면 조용히 잘못 도는" 것들을 봅니다.
//
// tools.ts 가 lib 조회 함수를 run() 안에서 동적으로 부르기 때문에 이 파일이
// 네트워크도 DB 도 없이 그대로 실행됩니다.

/** renew.prd 26.2 의 SCM 담당자용 Tool 목록 그대로입니다 */
const PRD_TOOLS = [
  'getDemandForecast',
  'getForecastAccuracy',
  'getInventoryProjection',
  'getStockoutRisk',
  'getLeadtimeStats',
  'getSafetyStock',
  'calcOrderQuantity',
  'getOpenPO',
  'getAlerts',
  'simulateScenario',
];

// 다른 테스트가 레지스트리를 건드리기 전의 모습입니다.
const INITIAL = allTools().map((tool) => tool.name);

test('renew.prd 26.2 의 툴 10종이 그대로 등록되어 있다', () => {
  assert.deepEqual(INITIAL, PRD_TOOLS);
});

test('툴 이름은 유일하다', () => {
  assert.equal(new Set(INITIAL).size, INITIAL.length);
});

test('parameters 는 JSON Schema 의 object 이고 required 는 properties 안에만 있다', () => {
  for (const tool of allTools()) {
    const schema = tool.parameters;
    assert.equal(schema.type, 'object', `${tool.name} 의 parameters.type`);
    assert.equal(schema.additionalProperties, false, `${tool.name} 의 additionalProperties`);
    assert.equal(typeof schema.properties, 'object', `${tool.name} 의 properties`);
    assert.ok(Array.isArray(schema.required), `${tool.name} 의 required`);
    for (const key of schema.required) {
      assert.ok(key in schema.properties, `${tool.name} 의 required 에 없는 속성: ${key}`);
    }
    for (const [key, spec] of Object.entries(schema.properties)) {
      assert.equal(typeof spec.type, 'string', `${tool.name}.${key} 에 type 이 없습니다`);
      assert.equal(typeof spec.description, 'string', `${tool.name}.${key} 에 설명이 없습니다`);
    }
  }
});

test('설명은 한국어로 적혀 있다 — 모델이 이 문장만 보고 툴을 고른다', () => {
  for (const tool of allTools()) {
    assert.ok(tool.description.length > 10, `${tool.name} 의 설명이 너무 짧습니다`);
    assert.match(tool.description, /[가-힣]/, `${tool.name} 의 설명에 한국어가 없습니다`);
  }
});

test('roles 는 비어 있지 않고 ADMIN · USER 만 쓴다', () => {
  for (const tool of allTools()) {
    assert.ok(tool.roles.length > 0, `${tool.name} 에 역할이 없습니다`);
    for (const role of tool.roles) {
      assert.ok(role === 'ADMIN' || role === 'USER', `${tool.name} 의 알 수 없는 역할: ${role}`);
    }
  }
});

test('USER 가 부를 수 있는 툴은 ADMIN 도 전부 부를 수 있다', () => {
  // renew.prd 4.2 — "ADMIN 은 모든 USER 기능" 을 갖습니다.
  const admin = new Set(toolsFor('ADMIN').map((tool) => tool.name));
  for (const tool of toolsFor('USER')) {
    assert.ok(admin.has(tool.name), `ADMIN 이 부를 수 없는 USER 툴: ${tool.name}`);
  }
});

// STEP 18 에서 켰습니다. 켜기 전에는 "등록만 되어 있고 목록에 없다" 를 봤습니다.
test('simulateScenario 는 STEP 18 에서 켜져 두 역할 모두에게 보인다', () => {
  const tool = findTool('simulateScenario');
  assert.notEqual(tool, null);
  assert.equal(tool?.enabled, true);
  for (const role of ['ADMIN', 'USER'] as const) {
    assert.equal(
      toolsFor(role).some((item) => item.name === 'simulateScenario'),
      true,
      `${role} 목록에 simulateScenario 가 없습니다`,
    );
  }
  // 영업 묶음에는 넣지 않습니다 — 리드타임 통계와 발주 수량이 결과에 들어갑니다 (renew.prd 4.5).
  for (const role of ['ADMIN', 'USER'] as const) {
    assert.equal(
      toolsFor(role, 'SALES').some((item) => item.name === 'simulateScenario'),
      false,
      `${role} 의 영업 묶음에 simulateScenario 가 나옵니다`,
    );
  }
});

test('simulateScenario 는 바꿀 가정이 없으면 예외를 던지지 않고 사유를 돌려준다', async () => {
  // 원래 이 자리는 "숨긴 툴을 부르면 사유를 돌려준다" 였습니다. STEP 18 이 툴을 켜면서
  // 숨긴 툴이 없어졌지만, 지키려던 것(부를 수 없는 상황에서 던지지 않고 사유를 낸다)은
  // 그대로입니다. 인자 검증 두 갈래로 옮겨 왔습니다.
  // 두 갈래 모두 Supabase 를 부르기 전에 막히므로 이 파일에서 실행할 수 있습니다.
  const tool = findTool('simulateScenario');
  assert.notEqual(tool, null);
  const result = await tool!.run({ itemId: 'ITEM012' }, { role: 'USER', userId: 'u', email: 'e' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.numbers, {});
  assert.equal(result.dataAsOf, null);
  assert.match(result.reason ?? '', /가정/);
});

test('simulateScenario 는 품목코드가 없으면 예외를 던지지 않고 사유를 돌려준다', async () => {
  const tool = findTool('simulateScenario');
  const result = await tool!.run({ demand_pct: 20 }, { role: 'USER', userId: 'u', email: 'e' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.numbers, {});
  assert.equal(result.dataAsOf, null);
  assert.match(result.reason ?? '', /품목코드/);
});

test('역할 목록은 enabled 인 툴만 담는다', () => {
  assert.deepEqual(toolsFor('USER').map((tool) => tool.name), PRD_TOOLS);

  // ★ STEP 18 이 simulateScenario 를 켜면서 **꺼진 툴이 하나도 남지 않았습니다.**
  //   그래서 개수만 세면 toolsFor 가 enabled 를 아예 보지 않아도 이 시험이 통과합니다.
  //   지키려던 것은 "켜진 것만 담는다" 이므로, 하나를 잠깐 끄고 사라지는지 봅니다.
  //   replaceTool 은 레지스트리를 실제로 바꾸므로 finally 에서 원래 객체로 되돌립니다 —
  //   뒤 시험들이 이 파일의 순서에 기대고 있습니다.
  const original = findTool('getAlerts');
  assert.notEqual(original, null);
  try {
    replaceTool({ ...original!, enabled: false });
    const names = toolsFor('USER').map((tool) => tool.name);
    assert.equal(names.includes('getAlerts'), false, '꺼진 툴이 역할 목록에 나옵니다');
    assert.deepEqual(names, PRD_TOOLS.filter((name) => name !== 'getAlerts'));
  } finally {
    replaceTool(original!);
  }

  assert.deepEqual(toolsFor('USER').map((tool) => tool.name), PRD_TOOLS, '되돌리지 못했습니다');
});

test('toOpenAiTools 는 function 형식으로 바꾼다', () => {
  // 개수를 숫자로 박지 않습니다. 이 시험이 지키려는 것은 "몇 개인가" 가 아니라
  // "받은 것을 하나도 빠뜨리거나 더하지 않고 모양만 바꾼다" 입니다.
  const source = toolsFor('USER');
  // 입력이 비면 아래 비교가 전부 공허하게 통과합니다. 이 시험이 테스트 실행 순서나
  // 앞 시험의 레지스트리 조작에 기대지 않도록 여기서 못박습니다.
  assert.ok(source.length > 0, '변환할 툴이 하나도 없습니다');

  const converted = toOpenAiTools(source);
  assert.equal(converted.length, source.length);
  assert.deepEqual(
    converted.map((item) => item.function.name),
    source.map((tool) => tool.name),
  );
  for (const item of converted) {
    assert.equal(item.type, 'function');
    assert.equal(typeof item.function.name, 'string');
    assert.match(item.function.description, /[가-힣]/);
    assert.equal(item.function.parameters.type, 'object');
  }
});

test('findTool 은 모르는 이름에 null 을 돌려준다', () => {
  assert.equal(findTool('getSomethingNobodyRegistered'), null);
});

test('같은 이름을 다시 등록하면 거절한다 — 어느 쪽이 도는지 알 수 없게 두지 않는다', () => {
  const clone: AgentTool = {
    name: 'getAlerts',
    description: '중복 등록 시험',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    roles: ['ADMIN'],
    enabled: true,
    run: async () => ({ ok: true, data: null, numbers: {}, dataAsOf: null }),
  };
  assert.throws(() => registerTool(clone), /이미 등록된 툴/);
});

test('등록되지 않은 툴은 갈아 끼울 수 없다', () => {
  const stub: AgentTool = {
    name: 'getSomethingNobodyRegistered',
    description: '등록된 적 없는 툴',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    roles: ['USER'],
    enabled: true,
    run: async () => ({ ok: true, data: null, numbers: {}, dataAsOf: null }),
  };
  assert.throws(() => replaceTool(stub), /등록되지 않은 툴/);
});

// ★ 레지스트리를 실제로 바꾸는 시험이라 여기부터 뒤에 둡니다 (STEP 17 · 18 의 확장 경로).
//
// ★★ __harnessOnlyTool 은 등록한 뒤 **해제하지 않습니다.** tools.ts 에 unregister 가 없고,
//    확장점(registerTool)을 시험하려고 API 를 늘리고 싶지 않기 때문입니다. 대신 이 시험은
//    마지막에 그 툴을 enabled: false 로 갈아 끼워 **어느 역할 목록에도 나오지 않는 상태**로
//    남깁니다. 그래서 뒤 시험들에 새지 않습니다.
//
//    ★ 뒤에 시험을 더할 때 주의할 것 하나 — 이 줄 이후로 `allTools()` 는 11종입니다.
//      (STEP 17 의 영업 툴까지 얹히면 17종입니다.) `allTools()` 의 **정확한 목록이나 개수**를
//      비교하려면 파일 맨 위에서 찍어 둔 `INITIAL` 스냅샷을 쓰세요. 그러지 않으면 이 시험이
//      함정이 됩니다. 역할 목록(toolsFor)은 꺼진 툴을 거르므로 그대로 써도 됩니다.
test('registerTool 로 툴을 더하고 replaceTool 로 갈아 끼울 수 있다', async () => {
  const added: AgentTool = {
    name: '__harnessOnlyTool',
    description: '확장점을 확인하는 시험용 툴입니다',
    parameters: {
      type: 'object',
      properties: { itemId: { type: 'string', description: '품목코드' } },
      required: ['itemId'],
      additionalProperties: false,
    },
    roles: ['ADMIN', 'USER'],
    enabled: true,
    run: async () => ({ ok: true, data: null, numbers: { atp: 100 }, dataAsOf: null }),
  };

  registerTool(added);
  assert.equal(allTools().length, INITIAL.length + 1);
  assert.equal(findTool('__harnessOnlyTool')?.description, added.description);
  assert.ok(toolsFor('USER').some((tool) => tool.name === '__harnessOnlyTool'));

  // 이 파일이 끝날 때까지 남는 상태입니다 — 등록돼 있지만 꺼져 있어 역할 목록에 안 나옵니다.
  replaceTool({ ...added, description: '갈아 끼운 설명', enabled: false });
  assert.equal(allTools().length, INITIAL.length + 1);
  assert.equal(findTool('__harnessOnlyTool')?.description, '갈아 끼운 설명');
  for (const role of ['ADMIN', 'USER'] as const) {
    assert.equal(
      toolsFor(role).some((tool) => tool.name === '__harnessOnlyTool'),
      false,
      `${role} 목록에 시험용 툴이 남았습니다`,
    );
  }
});

// ── STEP 17 · 영업 툴 6종 (renew.prd 27장 · 4.5) ───────────────
//
// lib/agent/tools-sales.ts 를 **동적으로** 부릅니다. 파일 맨 위에서 static import 하면
// 위의 INITIAL 스냅샷이 찍히기 전에 영업 툴이 등록되어, 'renew.prd 26.2 의 툴 10종' 시험이
// 무엇을 재는지 흐려집니다. 여기서 부르면 "얹기 전과 얹은 뒤" 를 둘 다 볼 수 있습니다.

/** renew.prd 27 · 지시서의 영업 툴 목록 그대로입니다 */
const SALES_TOOLS_EXPECTED = [
  'checkOrderFeasibility',
  'getATP',
  'getEarliestDelivery',
  'getAlternativeItems',
  'createSoftAllocation',
  'getSupplyStatus',
];

test('영업 툴 6종이 레지스트리에 얹힌다', async () => {
  const { SALES_TOOL_NAMES, registerSalesTools } = await import('./tools-sales.ts');

  assert.deepEqual(SALES_TOOL_NAMES, SALES_TOOLS_EXPECTED);
  for (const name of SALES_TOOLS_EXPECTED) {
    const tool = findTool(name);
    assert.notEqual(tool, null, `등록되지 않은 영업 툴: ${name}`);
    assert.equal(tool?.group, 'SALES', `${name} 의 묶음`);
    assert.equal(tool?.enabled, true, `${name} 이 꺼져 있습니다`);
    assert.match(tool?.description ?? '', /[가-힣]/, `${name} 의 설명에 한국어가 없습니다`);
  }

  // 두 번 불러도 던지지 않습니다 — 모듈이 두 지정자로 평가되면 앱 부팅이 막힙니다.
  assert.doesNotThrow(() => registerSalesTools());
});

test('★ 영업 사용자의 툴 집합은 정확히 6종이다 (renew.prd 4.5)', async () => {
  await import('./tools-sales.ts');

  const sales = toolsFor('USER', 'SALES').map((tool) => tool.name);
  assert.deepEqual(sales, SALES_TOOLS_EXPECTED);
  assert.equal(sales.length, 6);
});

test('★ SCM 툴 목록에 영업 툴이 섞이지 않는다 — 그 반대도 마찬가지', async () => {
  await import('./tools-sales.ts');

  const scm = toolsFor('USER').map((tool) => tool.name);
  for (const name of SALES_TOOLS_EXPECTED) {
    assert.equal(scm.includes(name), false, `SCM 목록에 영업 툴이 있습니다: ${name}`);
  }

  const sales = toolsFor('USER', 'SALES').map((tool) => tool.name);
  for (const name of ['calcOrderQuantity', 'getForecastAccuracy', 'getLeadtimeStats']) {
    assert.equal(sales.includes(name), false, `영업 목록에 SCM 툴이 있습니다: ${name}`);
  }
});

test('영업 툴도 parameters 가 JSON Schema 이고 required 가 properties 안에만 있다', async () => {
  const { SALES_TOOLS } = await import('./tools-sales.ts');

  for (const tool of SALES_TOOLS) {
    const schema = tool.parameters;
    assert.equal(schema.type, 'object', `${tool.name} 의 parameters.type`);
    assert.equal(schema.additionalProperties, false, `${tool.name} 의 additionalProperties`);
    for (const key of schema.required) {
      assert.ok(key in schema.properties, `${tool.name} 의 required 에 없는 속성: ${key}`);
    }
    for (const [key, spec] of Object.entries(schema.properties)) {
      assert.equal(typeof spec.type, 'string', `${tool.name}.${key} 에 type 이 없습니다`);
      assert.equal(typeof spec.description, 'string', `${tool.name}.${key} 에 설명이 없습니다`);
    }
    assert.ok(tool.roles.includes('ADMIN') && tool.roles.includes('USER'), `${tool.name} 의 roles`);
  }
});

test('영업 툴은 인자가 없으면 사유를 돌려준다 — 예외를 던지지 않는다', async () => {
  // 인자 검사만 봅니다. Supabase 가 필요한 지점까지 가지 않습니다.
  const { SALES_TOOLS } = await import('./tools-sales.ts');
  const ctx = { role: 'USER' as const, userId: 'u', email: 'e', department: '영업1팀' };

  for (const tool of SALES_TOOLS) {
    const result = await tool.run({}, ctx);
    assert.equal(result.ok, false, `${tool.name} 이 빈 인자로 성공했습니다`);
    assert.deepEqual(result.numbers, {}, `${tool.name} 의 numbers`);
    assert.match(result.reason ?? '', /필요합니다/, `${tool.name} 의 사유`);
  }
});
