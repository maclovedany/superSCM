// lib/api/atp-bridge.ts 가 lib/atp.ts 와 **같은 것을 읽는지** 대조합니다.
//
// ★ 왜 필요한가
//   /api/v1/atp 는 lib/atp.ts 의 getAtp · checkOrderFeasibility 를 부르지 못합니다.
//   그 두 함수는 세션 쿠키 클라이언트를 내부에서 만들어 secret 키를 넘길 수 없고,
//   lib/atp.ts 는 STEP 17 이 작업 중이라 손대지 않기로 되어 있습니다.
//   그래서 같은 뷰·RPC 를 직접 읽습니다. 조회 조건이 갈라지면 영업 화면과 API 가
//   다른 ATP 를 말하게 되므로, 여기서 뷰 이름 · 정렬 · 상한 · RPC 인자를 대조합니다.
//
//   숫자를 만드는 것은 sql/23 의 뷰와 함수이고, 컬럼 → 필드 변환은 두 파일 모두
//   lib/atp-model.ts 의 normalizeAtp · normalizeFeasibility 를 씁니다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ATP = readFileSync(join(process.cwd(), 'lib', 'atp.ts'), 'utf-8');
const BRIDGE = readFileSync(join(process.cwd(), 'lib', 'api', 'atp-bridge.ts'), 'utf-8');

/**
 * 조회 체인을 **메서드 호출의 순서 있는 목록**으로 뽑습니다.
 *
 *   .schema('analytics').from('v_atp').select('*').eq('item_id', x).order('bucket_ord').limit(8)
 *     → ["schema('analytics')", "from('v_atp')", "select('*')", "eq('item_id')",
 *        "order('bucket_ord')", "limit(8)"]
 *
 * ★ 아는 메서드 이름만 훑으면 안 됩니다. 한쪽에 `.gt(...)` 같은 **모르는 메서드**가
 *   새로 붙어도 그냥 통과해 버립니다. 그래서 `.schema(` 부터 그 문장이 끝나는 `;` 까지를
 *   통째로 잘라 **거기 있는 모든 메서드 호출**을 순서대로 담습니다.
 */
function queryChain(source: string, startMarker: string): string[] {
  const from = source.indexOf(startMarker);
  assert.ok(from >= 0, `${startMarker} 를 찾지 못했습니다`);

  const chainStart = source.indexOf('.schema(', from);
  assert.ok(chainStart > from, `${startMarker} 뒤에 .schema( 가 없습니다`);

  const chainEnd = source.indexOf(';', chainStart);
  assert.ok(chainEnd > chainStart);

  const chain = source.slice(chainStart, chainEnd);

  // 메서드 이름 + 첫 리터럴 인자(있으면). 값이 바뀌어도 잡히게 인자를 함께 담습니다.
  return Array.from(chain.matchAll(/\.([a-zA-Z_$][\w$]*)\(\s*('[^']*'|"[^"]*"|[0-9]+)?/g)).map(
    (match) => `${match[1]}(${match[2] ?? ''})`,
  );
}

/** rpc 호출 본문에서 인자 이름을 순서대로 뽑습니다 */
function rpcArgs(source: string, startMarker: string, endMarker: string): string[] {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start);
  return Array.from(source.slice(start, end).matchAll(/\b(p_[a-z_]+):/g)).map((match) => match[1]);
}

test('ATP 조회 체인이 순서까지 같다', () => {
  // lib/atp.ts   : getAtp 본문
  // atp-bridge.ts: atpQuote 의 v_atp 조회
  const mine = queryChain(ATP, 'export async function getAtp');
  const theirs = queryChain(BRIDGE, 'const { data, error } = await gate.client');

  assert.deepEqual(
    theirs,
    mine,
    'atp-bridge 의 조회 체인이 lib/atp.ts 와 다릅니다. ' +
      '한쪽에만 필터가 생기면 영업 화면과 API 가 다른 ATP 를 말합니다.',
  );

  // 실제로 기대하는 모양인지도 못박아 둡니다 (양쪽이 함께 틀리는 것을 막습니다)
  assert.deepEqual(mine, [
    "schema('analytics')",
    "from('v_atp')",
    "select('*')",
    "eq('item_id')",
    "order('bucket_ord')",
    'limit(8)',
  ]);
});

test('같은 RPC 를 같은 인자로 부른다 — core.check_order_feasibility', () => {
  const mine = queryChain(ATP, 'export async function checkOrderFeasibility');
  const theirs = queryChain(BRIDGE, 'const { data: raw, error: rpcError }');

  assert.deepEqual(theirs, mine, 'RPC 호출 체인이 다릅니다');
  assert.deepEqual(mine, ["schema('core')", "rpc('check_order_feasibility')"]);

  // 인자 이름과 순서 — 같은 본문 조각 안에서만 봅니다 (파일 전체를 훑으면 다른 함수가 섞입니다)
  const mineArgs = rpcArgs(ATP, 'export async function checkOrderFeasibility', 'if (error) return');
  const theirsArgs = rpcArgs(BRIDGE, 'const { data: raw, error: rpcError }', 'if (rpcError)');

  assert.deepEqual(theirsArgs, mineArgs, '인자 이름 · 순서가 다릅니다');
  assert.deepEqual(mineArgs, ['p_item_id', 'p_qty', 'p_target_date']);
});

test('품목코드 정규화 규칙이 같다', () => {
  const rule = /replace\(\/\[\\s\\-_\]\/g, ''\)\.toUpperCase\(\)/;
  assert.match(ATP, rule, 'lib/atp.ts 의 normalizeItemId 규칙이 바뀌었습니다');
  assert.match(BRIDGE, rule, 'atp-bridge 의 정규화 규칙이 lib/atp.ts 와 다릅니다');
});

test('정규화 함수는 베끼지 않고 lib/atp-model.ts 것을 그대로 쓴다', () => {
  assert.ok(
    BRIDGE.includes("from '../atp-model'"),
    'atp-bridge 가 lib/atp-model.ts 의 정규화 함수를 쓰지 않습니다',
  );
  assert.ok(BRIDGE.includes('normalizeAtp'));
  assert.ok(BRIDGE.includes('normalizeFeasibility'));
});
