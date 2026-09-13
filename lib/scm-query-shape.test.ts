import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// 큰 뷰 조회의 질의 모양을 지킨다 — 정합성 라운드 M5 (2026-09-13)
//
// ★ 이것은 **구조적으로 닿을 수 없는 동작의 대리 증거**다. 원래 하고 싶었던 것은 가짜
//   Supabase 클라이언트를 끼워 "정말 count: 'exact' 를 요청했는가" 를 단언하는 것이었다.
//   그러나 그럴 수 없다 — 실측(2026-09-13):
//
//     · lib/scm.ts 를 node --test 로 정적 import 하면 ERR_UNSUPPORTED_DIR_IMPORT 로 죽는다
//       (`from './supabase'` 를 node ESM 이 디렉터리로 읽는다). 여기까지는 .ts 를 붙이면 풀린다.
//     · 그러나 그 뒤 lib/supabase/server.ts 가 'next/headers' 를 부르고, 그것은
//       ERR_MODULE_NOT_FOUND 로 **아예 해석되지 않는다**(Next 가 exports 조건으로만 노출하고
//       node 의 평 ESM resolver 는 그 조건을 만족시키지 못한다). 확장자로 풀리는 문제가 아니다.
//
//   즉 진짜 클라이언트를 통과하는 시험은 이 저장소에서 불가능하다. 그래서 본문을 읽어
//   질의 모양을 지킨다 — demand-profile.test.ts 가 화면 본문을 읽는 것과 같은 기법이다.
//
// ★ 이 시험이 막는 것: count: 'exact' 가 조용히 사라지는 것. 사라지면 total 이 null 이 되고
//   COUNT_UNAVAILABLE 로 떨어진다. 거짓을 말하지는 않지만 "전수를 안다" 는 능력을 잃는다.

const SOURCE = readFileSync(path.join(import.meta.dirname, 'scm.ts'), 'utf8');

/** 함수 하나의 본문만 떼어 온다 — 주석은 빼고 센다(설명 문장에 같은 글자가 나온다) */
function bodyOf(name: string): string {
  const start = SOURCE.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} 을 찾지 못했습니다`);
  const next = SOURCE.indexOf('\nexport ', start + 1);
  const body = SOURCE.slice(start, next === -1 ? undefined : next);
  return body
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    })
    .join('\n');
}

/** 1,000행 상한에 걸리는 큰 뷰를 읽는 조회 — 전수는 count 로만 알 수 있다 */
const COUNTED = [
  'getItemDemandProfiles',
  'getItemDemandProfileByItem',
  'getShipmentTrends',
  'getShipmentTrendByItem',
  'getBomRequirements',
];

/** 표에 그대로 흘러가는 목록 조회 — 가상화가 없으므로 상한을 명시해야 한다 */
const LIMITED = ['getItemDemandProfiles', 'getShipmentTrends', 'getBomRequirements'];

test('큰 뷰 조회 다섯은 모두 count 로 전수를 따로 받는다', () => {
  for (const name of COUNTED) {
    assert.ok(
      bodyOf(name).includes("count: 'exact'"),
      `${name} 이 count: 'exact' 없이 조회합니다 — total 을 알 수 없게 됩니다`,
    );
  }
});

test('목록 조회는 상한을 서버 기본값에 맡기지 않고 명시한다', () => {
  for (const name of LIMITED) {
    assert.ok(
      bodyOf(name).includes('.limit(TABLE_FETCH_LIMIT)'),
      `${name} 이 상한을 명시하지 않습니다 — 가상화가 없는 표에 전량이 흘러갈 수 있습니다`,
    );
  }
});

test('품목 지정 조회는 DB 에서 거른다 — 잘린 배열을 훑지 않는다', () => {
  // 이것이 무너지면 UNKNOWN_ITEM 이 다시 "존재하지 않는다" 를 거짓으로 주장하게 된다.
  for (const name of ['getItemDemandProfileByItem', 'getShipmentTrendByItem']) {
    assert.ok(bodyOf(name).includes(".eq('item_code', itemCode)"), `${name} 이 DB 에서 거르지 않습니다`);
  }
});
