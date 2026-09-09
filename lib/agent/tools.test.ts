import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  AGENT_TOOLS,
  AGENT_TOOL_NAMES,
  findTool,
  flatten,
  toOpenAiTools,
  toolsFor,
} from './tools.ts';

test('4-Tool MVP — 지금 데이터로 만들 수 있는 툴만 등록한다', () => {
  assert.deepEqual(AGENT_TOOL_NAMES, [
    'getDemandProfile',
    'getForecastAccuracy',
    'getStockoutRisk',
    'getLeadtimeStats',
  ]);
});

test('툴 이름은 중복되지 않고 설명과 인자 스키마가 있다', () => {
  assert.equal(new Set(AGENT_TOOL_NAMES).size, AGENT_TOOL_NAMES.length);
  for (const tool of AGENT_TOOLS) {
    assert.ok(tool.description.length > 20, `${tool.name} 설명이 너무 짧습니다`);
    assert.equal(tool.parameters.type, 'object');
    // 정의되지 않은 필드를 거절해야 합니다 (슬라이드 44)
    assert.equal(tool.parameters.additionalProperties, false, `${tool.name} additionalProperties`);
    assert.ok(tool.roles.length > 0);
  }
});

test('USER 와 ADMIN 모두 네 툴을 부를 수 있다', () => {
  for (const role of ['USER', 'ADMIN'] as const) {
    assert.deepEqual(toolsFor(role).map((tool) => tool.name), AGENT_TOOL_NAMES);
  }
});

test('OpenAI 형식으로 변환하면 이름 · 설명 · 인자만 나간다', () => {
  const converted = toOpenAiTools(toolsFor('USER'));
  assert.equal(converted.length, 4);
  for (const item of converted) {
    assert.equal(item.type, 'function');
    assert.deepEqual(Object.keys(item.function).sort(), ['description', 'name', 'parameters']);
  }
});

test('findTool 은 없는 이름에 null 을 준다 — 조작된 이름은 여기서 걸립니다', () => {
  assert.equal(findTool('dropAllTables'), null);
  assert.equal(findTool('getStockoutRisk')?.name, 'getStockoutRisk');
});

test('Agent 폴더는 Supabase 를 직접 조회하지 않는다 (대화 저장 파일 1곳 제외)', () => {
  for (const file of ['tools.ts', 'orchestrator.ts', 'llm.ts', 'guardrail.ts', 'schema.ts']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(!source.includes('createSupabaseServerClient'), `${file} 에 DB 조회가 있습니다`);
    assert.ok(!source.includes('.schema('), `${file} 에 DB 조회가 있습니다`);
  }
});

test('flatten 은 숫자와 글자 속 숫자를 함께 싣는다 — Guardrail 의 허용 사전', () => {
  const numbers: Record<string, number | null> = {};
  flatten(numbers, 'row', [{ wape: 0.124, model: 'MA_3M', name: '품목', qty: '1200' }]);
  assert.equal(numbers['row0.wape'], 0.124);
  assert.equal(numbers['row0.qty'], 1200);
  assert.equal(numbers['row0.model.txt0'], 3);
  assert.equal(numbers['row0.name'], undefined);
});

test('숫자로 온 itemId 는 인자로 받지 않는다 (품목코드는 문자열)', async () => {
  // run() 은 DB 를 부르므로 여기서는 인자 검사 경로만 확인합니다.
  // 숫자 인자는 argText 가 null 로 만들어 "전체 목록" 으로 처리되며, 임의 품목을 지어내지 않습니다.
  const tool = findTool('getDemandProfile');
  assert.ok(tool);
  assert.equal(tool!.parameters.properties.itemId.type, 'string');
});
