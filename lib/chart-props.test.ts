import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// 서버 컴포넌트(page.tsx)는 'use client' 차트에 함수를 props 로 넘길 수 없습니다.
//
//   Error: Functions cannot be passed directly to Client Components unless you
//   explicitly expose it by marking it with "use server".
//
// tsc 도 next build 도 이것을 잡지 못하고, 화면을 열어야 500 이 납니다 (error.md #33).
// 그래서 components/chart/ 의 클라이언트 파일에서 default export 의 props 타입에
// 함수(=>)가 있으면 여기서 실패시킵니다. 이동 주소는 문자열 템플릿(hrefTemplate) 이나
// 문자열 맵(hrefs) 으로 받으세요 — components/chart/_base/click.ts 의 fillHref.

const DIR = 'components/chart';

function clientChartFiles(): string[] {
  return readdirSync(DIR)
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => join(DIR, name))
    .filter((path) => readFileSync(path, 'utf-8').trimStart().startsWith("'use client'"));
}

/** `export default function X(` 부터 매개변수 목록이 닫히는 `) {` 까지 */
function propsBlock(source: string): string | null {
  const start = source.indexOf('export default function');
  if (start < 0) return null;
  const end = source.indexOf(') {', start);
  return end < 0 ? null : source.slice(start, end);
}

test("'use client' 차트의 props 에 함수가 없다 (서버 컴포넌트가 넘길 수 없습니다)", () => {
  const offenders: string[] = [];
  for (const path of clientChartFiles()) {
    const block = propsBlock(readFileSync(path, 'utf-8'));
    if (block === null) continue;
    for (const line of block.split('\n')) {
      if (/\)\s*=>\s*/.test(line)) offenders.push(`${path} → ${line.trim()}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    '클라이언트 차트가 함수 props 를 받습니다. 문자열 템플릿(hrefTemplate) 이나 맵(hrefs) 으로 바꾸세요.\n\n' +
      offenders.join('\n'),
  );
});

test('page.tsx 가 차트에 hrefFor 를 넘기지 않는다', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name === 'page.tsx' && /hrefFor=\{/.test(readFileSync(path, 'utf-8'))) offenders.push(path);
    }
  };
  walk('app');
  assert.deepEqual(offenders, [], 'hrefFor 함수 props 는 서버 → 클라이언트로 넘어가지 않습니다.\n' + offenders.join('\n'));
});
