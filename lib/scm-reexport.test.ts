import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// 프로덕션이 실제로 닿는 모듈을 시험하고 있는가 — 정합성 라운드 (2026-09-13)
//
// lib/scm-big-views.test.ts 는 `./scm-big-views.ts` 에서 다섯 함수를 **직접** import 해 시험한다.
// 그런데 프로덕션은 `lib/scm.ts` 를 거친다(lib/agent/tools.ts · demand-profile/page.tsx).
// 오늘은 scm.ts 가 재수출이라 같은 코드다. 그러나 누가 다섯 중 하나를 **scm.ts 안에서 다시
// 구현해 재수출을 가리면**, 동작 시험은 여전히 통과하면서 **프로덕션이 더는 쓰지 않는 모듈을
// 시험하게 된다.** 그 갈라짐을 여기서 막는다.
//
// ★ 이 시험이 못 잡는 것 (한계를 적어 둔다 — 한계를 모르는 시험은 있는 것보다 위험하다):
//   · **본문 판독일 뿐 동작이 아니다.** import 를 다른 형태로 다시 쓰면(예: 중간 배럴 파일을
//     하나 끼우거나 런타임에 export 를 덮어쓰면) 글자는 맞고 경로는 갈라질 수 있다.
//   · 다섯 이름을 **손으로 적어 둔다**(아래 FIVE). 새 큰 뷰 조회가 생겨도 **자동으로 잡지
//     못한다** — scm-big-views.test.ts 의 import 목록도 같은 성질이라, 새 자리를 늘릴 때는
//     두 곳 다 손으로 늘려야 한다.
//
// ★ 질의 모양(count: 'exact' · .limit · .eq)은 여기서 보지 않는다. scm-big-views.test.ts 가
//   가짜 클라이언트로 **동작 수준에서** 이미 단언한다(seen.select.options · seen.limit · seen.eq).
//   같은 사실을 두 곳에 적어 두면 한쪽만 낡는다 — 그래서 옛 scm-query-shape.test.ts 는 지웠다.

const LIB = import.meta.dirname;

/** 주석은 빼고 읽는다 — 설명 문장에 같은 글자가 나온다 */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    })
    .join('\n');
}

/** 1,000행 상한에 걸려 count 로 전수를 세는 다섯 조회 */
const FIVE = [
  'getItemDemandProfiles',
  'getItemDemandProfileByItem',
  'getShipmentTrends',
  'getShipmentTrendByItem',
  'getBomRequirements',
];

test('lib/scm.ts 는 다섯 조회를 scm-big-views 에서 재수출한다', () => {
  const scm = codeOf(path.join(LIB, 'scm.ts'));
  assert.ok(scm.includes("} from './scm-big-views'"), 'scm-big-views 재수출이 없습니다');
  for (const name of FIVE) {
    assert.ok(scm.includes(`  ${name},`), `${name} 이 재수출 목록에 없습니다`);
  }
});

test('lib/scm.ts 는 다섯 조회를 다시 구현하지 않는다', () => {
  // 재구현이 재수출을 가리면, 동작 시험이 프로덕션이 안 쓰는 모듈을 시험하게 된다.
  const scm = codeOf(path.join(LIB, 'scm.ts'));
  for (const name of FIVE) {
    assert.ok(
      !scm.includes(`export async function ${name}(`),
      `${name} 이 scm.ts 에서 다시 구현되어 재수출을 가립니다 — 동작 시험이 엉뚱한 모듈을 봅니다`,
    );
  }
});

test('다섯 조회의 구현은 scm-big-views.ts 에 있다', () => {
  const big = codeOf(path.join(LIB, 'scm-big-views.ts'));
  for (const name of FIVE) {
    assert.ok(big.includes(`export async function ${name}(`), `${name} 구현이 없습니다`);
  }
});

test('프로덕션 소비자는 lib/scm.ts 를 거쳐 그 구현에 닿는다', () => {
  const tools = codeOf(path.join(LIB, 'agent', 'tools.ts'));
  assert.ok(tools.includes("await import('../scm.ts')"), 'Agent 툴이 lib/scm.ts 를 거치지 않습니다');

  const page = codeOf(path.join(LIB, '..', 'app', '(user)', 'analysis', 'demand-profile', 'page.tsx'));
  assert.ok(page.includes("from '@/lib/scm'"), '수요 패턴 화면이 lib/scm.ts 를 거치지 않습니다');
});
