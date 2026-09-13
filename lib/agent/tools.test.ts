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
import { collectToolNumbers } from './guardrail.ts';
import type { BomRequirement, ItemDemandProfile, ShipmentTrend } from '../scm-model.ts';

test('4-Tool MVP — 지금 데이터로 만들 수 있는 툴만 등록한다', () => {
  assert.deepEqual(AGENT_TOOL_NAMES, [
    'getShipmentTrend',
    'getDemandProfile',
    'getOlAccuracy',
    'getBomRequirement',
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
  assert.equal(findTool('getShipmentTrend')?.name, 'getShipmentTrend');
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

test('숫자로 온 itemCode 는 인자로 받지 않는다 (품목코드는 문자열)', async () => {
  // run() 은 DB 를 부르므로 여기서는 인자 검사 경로만 확인합니다.
  // 숫자 인자는 argText 가 null 로 만들어 "전체 목록" 으로 처리되며, 임의 품목을 지어내지 않습니다.
  const tool = findTool('getDemandProfile');
  assert.ok(tool);
  assert.equal(tool!.parameters.properties.itemCode.type, 'string');
});

test('재고 · 리드타임 툴은 등록되어 있지 않다 — 실데이터에 그 입력이 없습니다', () => {
  // 남겨 두면 모델이 폐기된 더미 숫자를 사실처럼 답합니다.
  for (const gone of ['getStockoutRisk', 'getLeadtimeStats', 'getForecastAccuracy']) {
    assert.equal(findTool(gone), null, `${gone} 이(가) 아직 등록되어 있습니다`);
  }
});

test('BOM 툴은 기종 이름을 반드시 받는다 — 비우면 전체를 훑지 않습니다', () => {
  const tool = findTool('getBomRequirement');
  assert.ok(tool);
  assert.deepEqual(tool!.parameters.required, ['modelBase']);
});

// ── run() 시험 — 정합성 라운드 (2026-09-13) ──────────────────────────────────
//
// 여기 위의 9개 테스트 중 run() 을 부르는 것이 **하나도 없었습니다**. 주석이 "run() 은 DB 를
// 부르므로 여기서는 인자 검사 경로만 확인합니다" 라고 못박아 두었고, 그래서 비서가 실재하는
// 품목을 "없습니다" 라고 단언하던 결함과 없는 총계를 사실로 말하던 결함이 한 번도 잡히지
// 않았습니다. ScmQueries 주입구로 그 구멍을 닫습니다 — DB 없이 run() 을 그대로 돌립니다.
//
// 아래 수치는 2026-09-13 배포 DB 실측입니다.
//   v_shipment_trend 10,198행 · 589K39896 은 출고량 7.0 으로 5,084위(상위 1,000 밖)
//   v_item_demand_profile 10,198행 · 796L51508 은 품목코드순 4,979위(상위 1,000 밖)
//   v_bom_requirement_x MDL227 3,285행(기종 23개 중 1,000행을 넘는 둘 중 하나)

function trend(itemCode: string, totalQty: number | null): ShipmentTrend {
  return {
    itemCode, description: `${itemCode} 부품`, family: null, itemType: 'PART',
    dataAsOf: '2026-08', nMonths: 12, firstYm: '2025-09', lastYm: '2026-08',
    monthsSinceLast: 0, totalQty, latestQty: totalQty,
    avg3m: null, avg6m: null, avg12m: null, trend3mVs12m: null, reasonCode: null,
  };
}

function profile(itemCode: string): ItemDemandProfile {
  return {
    itemCode, description: `${itemCode} 부품`, family: null, itemType: 'PART',
    dataAsOf: '2026-08', firstYm: '2025-09', lastYm: '2026-08',
    nPeriods: 12, nNonzero: 3, meanNonzeroQty: 2.5, adi: 4, zeroDemandRate: 0.75,
    cvSquared: 0.3, demandType: 'INTERMITTENT', reasonCode: null,
  };
}

function bom(index: number): BomRequirement {
  return {
    modelBase: 'MDL227', modelKey: null, partRole: 'BOM', itemCode: `P${index}`,
    description: `부품 ${index}`, qty: 1, bomGroup: null, nModels: 1,
    commonFlag: null, commonNote: null,
  };
}

/** PostgREST 가 잘라서 돌려준 모양 — 전수 10,198 중 1,000행. 찾는 품목은 여기 없습니다 */
const TRUNCATED_TRENDS = Array.from({ length: 1000 }, (_, i) => trend(`TOP${i}`, 10_000 - i));
const TRUNCATED_PROFILES = Array.from({ length: 1000 }, (_, i) => profile(`AAA${i}`));

test('출고 추이 — 상위 1,000건 밖의 품목도 실제 값을 돌려준다 (거르기를 DB 가 한다)', async () => {
  const tool = findTool('getShipmentTrend');
  assert.ok(tool);
  let listReads = 0;

  const result = await tool!.run({ itemCode: '589K39896' }, {
    getShipmentTrends: async () => {
      listReads += 1;
      return { rows: TRUNCATED_TRENDS, total: 10_198, error: null };
    },
    getShipmentTrendByItem: async (itemCode) => ({
      rows: itemCode === '589K39896' ? [trend('589K39896', 7.0)] : [],
      error: null,
    }),
  });

  // 거르기를 다시 클라이언트로 올리면(잘린 배열 filter) 여기서 UNKNOWN_ITEM 이 됩니다.
  assert.equal(result.ok, true, `UNKNOWN_ITEM 이면 안 됩니다: ${result.reason ?? ''}`);
  assert.equal(result.numbers['row0.totalQty'], 7);
  assert.equal(listReads, 0, '품목을 지정하면 무바운드 목록을 아예 읽지 않아야 합니다');
});

test('출고 추이 — DB 에 정말 없는 품목에만 UNKNOWN_ITEM 을 붙인다', async () => {
  const tool = findTool('getShipmentTrend');
  const result = await tool!.run({ itemCode: '없는코드' }, {
    getShipmentTrendByItem: async () => ({ rows: [], error: null }),
  });

  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /UNKNOWN_ITEM/);
});

test('수요 패턴 — 상위 1,000건 밖의 품목도 실제 행을 돌려준다', async () => {
  const tool = findTool('getDemandProfile');
  let listReads = 0;

  const result = await tool!.run({ itemCode: '796L51508' }, {
    getItemDemandProfiles: async () => {
      listReads += 1;
      return { rows: TRUNCATED_PROFILES, total: 10_198, error: null };
    },
    getItemDemandProfileByItem: async (itemCode) => ({
      rows: itemCode === '796L51508' ? [profile('796L51508')] : [],
      error: null,
    }),
  });

  assert.equal(result.ok, true, `UNKNOWN_ITEM 이면 안 됩니다: ${result.reason ?? ''}`);
  const data = result.data as { rows: { itemCode: string }[] };
  assert.equal(data.rows[0].itemCode, '796L51508');
  assert.equal(listReads, 0);
});

test('목록 조회의 total 은 전수이지 받아 온 행 수가 아니다', async () => {
  const tool = findTool('getShipmentTrend');
  const result = await tool!.run({}, {
    getShipmentTrends: async () => ({ rows: TRUNCATED_TRENDS, total: 10_198, error: null }),
  });

  assert.equal(result.numbers.total, 10_198);
  assert.equal(result.numbers.listed, 10, '나열은 LIST_LIMIT 건입니다');
  // total 을 rows.length 로 되돌리면 1,000 이 됩니다 — 그것이 예전의 거짓말이었습니다.
  assert.notEqual(result.numbers.total, TRUNCATED_TRENDS.length);
});

test('전수를 모르면 total 을 1,000 으로 채우지 않고 사유와 함께 뺀다', async () => {
  const tool = findTool('getShipmentTrend');
  const result = await tool!.run({}, {
    getShipmentTrends: async () => ({ rows: TRUNCATED_TRENDS, total: null, error: null }),
  });

  assert.equal(result.numbers.total, null, '모르는 수는 0 도 1,000 도 아니라 null 입니다');
  const data = result.data as Record<string, unknown>;
  assert.equal(data.total, undefined, '모르면 total 을 내보내지 않습니다');
  assert.equal(data.totalReasonCode, 'COUNT_UNAVAILABLE');
  // Guardrail 이 허용하는 수치 목록에 1,000 이 들어가면 모델이 그것을 인용할 수 있습니다.
  assert.ok(!collectToolNumbers([result]).includes(1000), '잘린 행 수가 인용 가능한 값이 되면 안 됩니다');
});

test('BOM — 1,000행을 넘는 기종의 total 은 잘린 행 수가 아니다', async () => {
  const tool = findTool('getBomRequirement');
  const result = await tool!.run({ modelBase: 'MDL227' }, {
    getBomRequirements: async () => ({
      rows: Array.from({ length: 1000 }, (_, i) => bom(i)),
      total: 3285,
      error: null,
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.numbers.total, 3285);
  assert.equal(result.numbers.listed, 30, '나열은 LIST_LIMIT * 3 건입니다');
});
