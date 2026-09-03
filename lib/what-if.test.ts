import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// What-If 시뮬레이션의 순수 함수 — renew.prd 25장
//
// 조회 파일(lib/what-if.ts)은 Supabase 클라이언트를 부르므로 여기서 import 하지 않습니다.
// 검사 대상은 lib/what-if-model.ts 뿐입니다. 상대 import 에 .ts 를 붙이는 이유는 error.md #17 입니다.

import {
  DELAY_ABSORBED_MESSAGE,
  PARAM_KEYS,
  PARAM_LABEL,
  SCENARIO_PRESETS,
  dayDelta,
  decodeParams,
  delayAbsorbed,
  delta,
  encodeParams,
  isEmptyParams,
  monthOf,
  normalizePoint,
  normalizeSide,
  normalizeSummary,
  parseParams,
  presetOf,
} from './what-if-model.ts';
import { extractWhatIfIntent, resolveItemId } from './agent/what-if-intent.ts';
import { findTool } from './agent/tools.ts';

// ── parseParams — 허용 키 ─────────────────────────────────────

test('parseParams 는 허용된 키만 받는다', () => {
  const { params, ignored } = parseParams({
    demand_pct: 20,
    lead_time_days: 60,
    lead_time_pct: 100,
    open_po_delay_days: 20,
    service_level: 0.95,
    supplier_unavailable: true,
    extra_order_qty: 500,
    extra_order_period: '2026-11',
    promotion_pct: 30,
    promotion_period: '2026-12',
  });

  assert.deepEqual(params, {
    demand_pct: 20,
    lead_time_days: 60,
    lead_time_pct: 100,
    open_po_delay_days: 20,
    service_level: 0.95,
    supplier_unavailable: true,
    extra_order_qty: 500,
    extra_order_period: '2026-11',
    promotion_pct: 30,
    promotion_period: '2026-12',
  });
  assert.deepEqual(ignored, []);
});

test('parseParams 는 문자열로 온 숫자도 받는다 (폼은 전부 문자열입니다)', () => {
  const { params, ignored } = parseParams({ demand_pct: '-20', lead_time_days: '60' });
  assert.equal(params.demand_pct, -20);
  assert.equal(params.lead_time_days, 60);
  assert.deepEqual(ignored, []);
});

test('parseParams 는 빈 칸을 "주지 않은 것" 으로 본다', () => {
  const { params, ignored } = parseParams({ demand_pct: '', lead_time_days: null, promotion_pct: undefined });
  assert.deepEqual(params, {});
  assert.deepEqual(ignored, []);
  assert.equal(isEmptyParams(params), true);
});

// ── parseParams — 범위 ────────────────────────────────────────

test('parseParams 는 범위를 벗어난 값을 적용하지 않고 무시 목록에 담는다', () => {
  const { params, ignored } = parseParams({
    demand_pct: -200, // < -100 (음수 수요)
    lead_time_days: -1, // < 0
    service_level: 0.2, // < 0.5
    open_po_delay_days: 99999, // > 3650
  });
  assert.deepEqual(params, {});
  assert.deepEqual(ignored.sort(), [
    'demand_pct',
    'lead_time_days',
    'open_po_delay_days',
    'service_level',
  ]);
});

test('parseParams 는 서비스 수준 95 를 0.95 로 고친다', () => {
  assert.equal(parseParams({ service_level: 95 }).params.service_level, 0.95);
  assert.equal(parseParams({ service_level: 0.9 }).params.service_level, 0.9);
});

test('parseParams 는 기간을 YYYY-MM 으로만 받는다', () => {
  assert.equal(parseParams({ promotion_period: '2026-12' }).params.promotion_period, '2026-12');
  assert.equal(parseParams({ promotion_period: '2026-12-01' }).params.promotion_period, '2026-12');
  assert.deepEqual(parseParams({ promotion_period: '2026-13' }).ignored, ['promotion_period']);
  assert.deepEqual(parseParams({ promotion_period: '이번 달' }).ignored, ['promotion_period']);
});

test('parseParams 는 체크 해제(false)를 파라미터로 넣지 않는다', () => {
  assert.deepEqual(parseParams({ supplier_unavailable: 'false' }).params, {});
  assert.deepEqual(parseParams({ supplier_unavailable: 'on' }).params, { supplier_unavailable: true });
});

// ── parseParams — 무시 키 수집 ────────────────────────────────

test('parseParams 는 모르는 키를 조용히 버리지 않는다', () => {
  const { params, ignored } = parseParams({ demandpct: 20, itemId: 'ITEM003', demand_pct: 20 });
  assert.deepEqual(params, { demand_pct: 20 });
  assert.deepEqual(ignored.sort(), ['demandpct', 'itemId']);
});

test('parseParams 는 객체가 아니면 빈 파라미터를 돌려준다', () => {
  for (const input of [null, undefined, 3, 'demand_pct=20', [1, 2]]) {
    assert.deepEqual(parseParams(input), { params: {}, ignored: [] });
  }
});

// ── URL 왕복 ──────────────────────────────────────────────────

test('encodeParams · decodeParams 는 왕복한다', () => {
  const params = { demand_pct: 20, lead_time_days: 60, supplier_unavailable: true as const };
  const encoded = encodeParams(params);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/, 'URL 에 그대로 실을 수 있어야 합니다');
  assert.deepEqual(decodeParams(encoded).params, params);
});

test('decodeParams 는 망가진 값에 죽지 않는다', () => {
  for (const bad of [null, undefined, '', '!!!not-base64!!!', encodeParams({} as never)]) {
    assert.deepEqual(decodeParams(bad as string).params, {});
  }
});

// ── 프리셋 7종 — renew.prd 25.1 ───────────────────────────────

test('프리셋은 renew.prd 25.1 의 7종이다', () => {
  assert.equal(SCENARIO_PRESETS.length, 7);
  assert.deepEqual(
    SCENARIO_PRESETS.map((preset) => preset.key),
    [
      'demand-up',
      'lead-time',
      'open-po-delay',
      'service-level',
      'supplier-unavailable',
      'extra-order',
      'promotion',
    ],
  );
});

test('프리셋의 params 는 모두 parseParams 를 그대로 통과한다', () => {
  for (const preset of SCENARIO_PRESETS) {
    const { params, ignored } = parseParams(preset.params);
    assert.deepEqual(ignored, [], `${preset.key} 에 받을 수 없는 값이 있습니다`);
    assert.deepEqual(params, preset.params, `${preset.key} 가 그대로 통과하지 않습니다`);
    assert.equal(isEmptyParams(params), false, `${preset.key} 가 Base 와 같습니다`);
    assert.ok(preset.label.length > 0 && preset.description.length > 0);
  }
});

test('presetOf 는 없는 키에 null 을 돌려준다', () => {
  assert.equal(presetOf('demand-up')?.params.demand_pct, 20);
  assert.equal(presetOf('없는-키'), null);
  assert.equal(presetOf(null), null);
});

// ── 키 이름이 세 곳에서 같은가 ────────────────────────────────
//
// 화면 · AI · DB 가 같은 키를 써야 시나리오가 실제로 적용됩니다. 이름이 갈리면
// 오류는 나지 않고 시나리오만 조용히 Base 와 같아집니다 — 가장 알아채기 어려운 실패입니다.

test('PARAM_KEYS 가 sql/24-what-if.sql 이 아는 키와 같다', () => {
  const sql = readFileSync('sql/24-what-if.sql', 'utf-8');
  // simulate_scenario_summary 의 "알 수 없는 키" 목록 (not in (...)) 을 읽습니다.
  const block = /k\.key not in \(([^)]+)\)/.exec(sql);
  assert.ok(block, 'sql/24 에서 허용 키 목록을 찾지 못했습니다');

  const known = Array.from(block[1].matchAll(/'([a-z_]+)'/g)).map((hit) => hit[1]);
  assert.deepEqual(known.slice().sort(), PARAM_KEYS.slice().sort());
});

test('PARAM_KEYS 가 simulateScenario 툴의 파라미터와 같다', () => {
  const tool = findTool('simulateScenario');
  assert.ok(tool, 'simulateScenario 툴이 등록되어 있지 않습니다');
  assert.equal(tool.enabled, true, 'STEP 18 에서 켜져 있어야 합니다');

  const keys = Object.keys(tool.parameters.properties).filter((key) => key !== 'itemId');
  assert.deepEqual(keys.slice().sort(), PARAM_KEYS.slice().sort());
});

test('PARAM_KEYS 는 모두 라벨을 가진다', () => {
  for (const key of PARAM_KEYS) {
    assert.equal(typeof PARAM_LABEL[key], 'string');
    assert.ok(PARAM_LABEL[key].length > 0, `${key} 의 라벨이 비어 있습니다`);
  }
});

// ── 결과 읽기 ─────────────────────────────────────────────────

test('normalizeSide 는 없는 값을 0 이 아니라 null 로 둔다', () => {
  const side = normalizeSide({ risk: 'CRITICAL', reason: 'NO_LEADTIME', safety_stock: null });
  assert.equal(side.risk, 'CRITICAL');
  assert.equal(side.reason, 'NO_LEADTIME');
  assert.equal(side.safetyStock, null);
  assert.equal(side.orderQty, null);
});

test('normalizeSide 는 모르는 상태를 산출 불가로 본다', () => {
  assert.equal(normalizeSide({}).risk, 'CALCULATION_UNAVAILABLE');
  assert.equal(normalizeSide(null).risk, 'CALCULATION_UNAVAILABLE');
});

test('normalizeSummary 는 ignored 를 파라미터에서 떼어 낸다', () => {
  const summary = normalizeSummary({
    item_id: 'ITEM003',
    item_name: '산화철 분말',
    supplier_id: 'SUP006',
    found: true,
    base: { risk: 'WARNING', stockout_date: '2026-09-19', safety_stock: 348 },
    scenario: { risk: 'CRITICAL', stockout_date: '2026-09-16', safety_stock: 517 },
    params_applied: { demand_pct: 20, lead_time_days: 60, ignored: ['typo_key'] },
    data_snapshot_at: '2026-09-03T16:46:58.515548+09:00',
  });

  assert.ok(summary);
  assert.equal(summary.itemId, 'ITEM003');
  assert.equal(summary.found, true);
  assert.deepEqual(summary.paramsApplied, { demand_pct: 20, lead_time_days: 60 });
  assert.deepEqual(summary.ignored, ['typo_key']);
  assert.equal(summary.base.safetyStock, 348);
  assert.equal(summary.scenario.risk, 'CRITICAL');
});

test('normalizeSummary 는 found 가 false 인 응답을 그대로 전한다', () => {
  const summary = normalizeSummary({ item_id: 'NOPE', found: false, base: { found: false } });
  assert.equal(summary?.found, false);
});

test('normalizePoint 는 기간별 두 열 세트를 읽는다', () => {
  const point = normalizePoint({
    period: '2026-09-01',
    base_closing: -287.17,
    scenario_closing: -432.4,
    base_receipt: 157,
    scenario_receipt: 0,
    base_demand: 726.17,
    scenario_demand: 871.4,
    base_opening: 439,
    scenario_opening: 439,
  });
  assert.equal(monthOf(point.period), '2026-09');
  assert.equal(point.baseClosing, -287.17);
  assert.equal(point.scenarioReceipt, 0);
  assert.equal(point.baseOpening, 439);
});

// ── 차이 ──────────────────────────────────────────────────────

test('delta · dayDelta 는 한쪽이라도 없으면 null 이다', () => {
  assert.equal(delta(100, 140), 40);
  assert.equal(delta(null, 140), null);
  assert.equal(delta(100, null), null);

  assert.equal(dayDelta('2026-09-19', '2026-09-16'), -3);
  assert.equal(dayDelta(null, '2026-09-16'), null);
  assert.equal(dayDelta('2026-09-19', null), null);
  assert.equal(dayDelta('언젠가', '2026-09-16'), null);
});

// ── 입고 지연이 흡수됐는가 (수정 라운드 1) ───────────────────
//
// 재고 전개는 도착 예정일이 이미 지난 입고를 첫 기간으로 당겨 붙입니다. 그래서 지연이
// 달을 넘기지 못하면 두 열이 완전히 같아지고, 화면은 "지연 적용됨" 배지와 ± 0 만 보입니다.
// 그 상태를 잡아내지 못하면 사용자가 기능이 고장 났다고 읽습니다.

const point = (baseReceipt: number, scenarioReceipt: number) => ({
  period: '2026-09-01',
  baseClosing: null,
  scenarioClosing: null,
  baseReceipt,
  scenarioReceipt,
  baseDemand: null,
  scenarioDemand: null,
  baseOpening: null,
  scenarioOpening: null,
});

test('delayAbsorbed 는 도착 달이 바뀌었으면 아무 말도 하지 않는다', () => {
  assert.equal(delayAbsorbed({ open_po_delay_days: 90 }, [point(157, 0), point(0, 157)]), null);
});

test('delayAbsorbed 는 입고가 있는데 하나도 안 움직이면 ETA_ALREADY_DUE', () => {
  assert.equal(
    delayAbsorbed({ open_po_delay_days: 20 }, [point(157, 157), point(0, 0)]),
    'ETA_ALREADY_DUE',
  );
});

test('delayAbsorbed 는 진행 중 선적이 없으면 NO_INBOUND — 다른 문장을 씁니다', () => {
  assert.equal(delayAbsorbed({ open_po_delay_days: 20 }, [point(0, 0)]), 'NO_INBOUND');
  assert.notEqual(
    DELAY_ABSORBED_MESSAGE.NO_INBOUND,
    DELAY_ABSORBED_MESSAGE.ETA_ALREADY_DUE,
  );
});

test('delayAbsorbed 는 지연을 넣지 않았으면 판정하지 않는다', () => {
  assert.equal(delayAbsorbed({}, [point(157, 157)]), null);
  assert.equal(delayAbsorbed({ demand_pct: 20 }, [point(157, 157)]), null);
  assert.equal(delayAbsorbed({ open_po_delay_days: 0 }, [point(157, 157)]), null);
  // 기간이 없으면 할 말이 없습니다 (예측이 없는 품목)
  assert.equal(delayAbsorbed({ open_po_delay_days: 90 }, []), null);
});

test('delayAbsorbed 는 공급처 사용 불가에 오작동하지 않는다', () => {
  // 입고가 0 으로 사라지므로 두 열이 달라집니다 — 흡수가 아닙니다.
  assert.equal(
    delayAbsorbed({ open_po_delay_days: 90, supplier_unavailable: true }, [point(157, 0)]),
    null,
  );
});

test('입고 지연 프리셋은 달을 넘길 수 있는 값으로 시작한다', () => {
  // 20일(renew.prd 25.1 의 예)이면 하네스 데이터 19개 품목 중 1개만 움직입니다.
  // 90일이면 18개가 움직입니다 — 기본값이 아무 일도 안 하면 기능이 고장 나 보입니다.
  const preset = presetOf('open-po-delay');
  assert.ok(preset);
  assert.ok(
    (preset.params.open_po_delay_days ?? 0) >= 60,
    '기본값이 한 달을 넘기지 못하면 대부분의 품목에서 전개가 그대로입니다',
  );
  assert.match(preset.description, /지연이 달을 넘겨야/);
});

// ── 자연어 → 품목 ────────────────────────────────────────────

test('resolveItemId 는 코드와 이름을 찾고, 애매하면 고르지 않는다', () => {
  const items = [
    { itemId: 'ITEM003', itemName: '산화철 분말' },
    { itemId: 'ITEM009', itemName: '산화철 분말 (고순도)' },
    { itemId: 'ITEM015', itemName: '알루미나' },
  ];

  assert.equal(resolveItemId('ITEM003', items), 'ITEM003');
  assert.equal(resolveItemId('item-003', items), 'ITEM003');
  assert.equal(resolveItemId('알루미나', items), 'ITEM015');
  // 정확히 일치하는 이름이 있으면 그것을 씁니다
  assert.equal(resolveItemId('산화철 분말', items), 'ITEM003');
  // 부분 일치가 둘이면 고르지 않습니다 — 엉뚱한 품목을 말없이 보여 주지 않습니다
  assert.equal(resolveItemId('산화철', items), null);
  assert.equal(resolveItemId(null, items), null);
  assert.equal(resolveItemId('없는품목', items), null);
});

// ── 자연어 → 파라미터: 범위를 벗어난 값을 조용히 버리지 않는다 ──
//
// ★ 수동 폼(app/(user)/what-if/actions.ts 의 runScenario)은 범위 밖 값에 오류를 냅니다.
//   자연어 경로가 같은 값을 말없이 버리면, 사용자는 자기가 말한 가정이 반영된 줄 압니다.
//   두 경로가 같은 규칙을 쓰는지 여기서 고정합니다.

const INTENT_ENV = {
  OPENAI_BASE_URL: 'https://llm.example.com/v1',
  OPENAI_API_KEY: 'sk-test',
  OPENAI_MODEL: 'gpt-test',
};

/** 모델이 이 JSON 을 돌려준 것처럼 꾸민 fetch. 네트워크를 부르지 않습니다 */
function intentFetch(payload: unknown) {
  return (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
    text: async () => '',
  })) as unknown as typeof fetch;
}

test('extractWhatIfIntent 는 범위 밖 값을 ignored 로 넘겨 화면이 말하게 한다', async () => {
  const { intent, error } = await extractWhatIfIntent('수요가 20% 늘고 서비스 수준을 3으로 올리면?', {
    fetchImpl: intentFetch({
      item: null,
      // service_level 은 0.5~0.9999 비율입니다. 3 은 100 으로 나눠도(0.03) 범위 밖입니다.
      params: { demand_pct: 20, service_level: 3 },
    }),
    env: INTENT_ENV,
    items: [],
  });

  assert.equal(error, null);
  assert.ok(intent);
  // 받은 값은 그대로 살아 있고
  assert.deepEqual(intent.params, { demand_pct: 20 });
  // 버린 값은 이름이 남습니다 — 액션이 이걸 보고 오류를 냅니다
  assert.deepEqual(intent.ignored, ['service_level']);
});

test('extractWhatIfIntent 는 값이 전부 범위 밖이면 "찾지 못했다" 고 하지 않는다', async () => {
  const { intent, error } = await extractWhatIfIntent('리드타임을 만 년으로 늘리면?', {
    fetchImpl: intentFetch({ item: null, params: { lead_time_days: 3_650_000 } }),
    env: INTENT_ENV,
    items: [],
  });

  assert.equal(intent, null);
  // 가정을 못 찾은 것이 아니라 받을 수 없는 값이었습니다. 무엇이 빠졌는지 이름을 말합니다.
  assert.match(error ?? '', /받을 수 없습니다/);
  assert.match(error ?? '', /lead_time_days/);
  assert.doesNotMatch(error ?? '', /찾지 못했습니다/);
});

test('extractWhatIfIntent 는 정말로 가정이 없으면 그렇게 말한다', async () => {
  const { intent, error } = await extractWhatIfIntent('안녕하세요', {
    fetchImpl: intentFetch({ item: null, params: {} }),
    env: INTENT_ENV,
    items: [],
  });

  assert.equal(intent, null);
  assert.match(error ?? '', /찾지 못했습니다/);
});
