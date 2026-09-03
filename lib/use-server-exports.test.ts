import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// 'use server' 파일은 async 함수만 export 할 수 있습니다.
// 상수를 하나라도 export 하면 그 파일을 쓰는 화면이 통째로 죽습니다.
//
//   A "use server" file can only export async functions, found object.
//
// npm run build 는 이걸 잡지 못합니다. 동적 페이지는 요청 시점에야 평가되기 때문입니다.
// 그래서 여기서 정적으로 훑습니다. 상수와 타입은 옆에 state.ts 를 만들어 옮기세요.

const SKIP = new Set(['node_modules', '.next', '.git', 'outputs', 'supabase']);

function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) collect(path, out);
    else if (/\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}

function isUseServerFile(source: string): boolean {
  const head = source.trimStart().slice(0, 40);
  return head.startsWith("'use server'") || head.startsWith('"use server"');
}

test("'use server' 파일은 async 함수만 export 한다", () => {
  const offenders: string[] = [];

  for (const path of collect('app').concat(collect('lib'))) {
    const source = readFileSync(path, 'utf-8');
    if (!isUseServerFile(source)) continue;

    for (const line of source.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('export ')) continue;
      // 타입은 컴파일 때 사라지므로 괜찮습니다.
      if (/^export\s+(type|interface)\b/.test(trimmed)) continue;
      if (/^export\s+async\s+function\b/.test(trimmed)) continue;

      offenders.push(`${path} → ${trimmed}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `'use server' 파일이 async 함수가 아닌 것을 export 합니다.\n` +
      `상수와 타입은 같은 폴더의 state.ts 로 옮기세요.\n\n` +
      offenders.join('\n'),
  );
});
