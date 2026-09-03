// ★ secret 키는 RLS 를 통째로 우회합니다.
//   그래서 "인증을 통과한 뒤에만 쓰인다" 를 주석이 아니라 테스트로 묶어 둡니다.
//
// 세 가지를 봅니다.
//   ① 서버 전용 표식 — lib/supabase/service.ts 가 `import 'server-only'` 로 시작하는가
//   ② 환경변수 이름에 NEXT_PUBLIC_ 접두어가 없는가 (붙으면 브라우저 번들로 새어 나갑니다)
//   ③ 이 클라이언트에 닿는 길이 전부 handleOutbound 의 work 콜백 안인가
//      — handleOutbound 는 passGates 를 통과하지 못하면 work 를 부르지 않습니다

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SERVICE = readFileSync(join(ROOT, 'lib', 'supabase', 'service.ts'), 'utf-8');
const HANDLER = readFileSync(join(ROOT, 'lib', 'api', 'handler.ts'), 'utf-8');

const SKIP = new Set(['node_modules', '.next', '.git']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(path);
  }
  return out;
}

const SOURCES = [...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components'))];

// ── ① 서버 전용 표식 ─────────────────────────────────────────

test("service.ts 의 첫 코드 줄은 import 'server-only' 다", () => {
  const firstCode = SERVICE.split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('//'));

  assert.equal(
    firstCode,
    "import 'server-only';",
    '클라이언트 번들로 새는 것을 빌드에서 막지 못합니다',
  );
});

// ── ② 접두어 ─────────────────────────────────────────────────

test('secret 키 환경변수에 NEXT_PUBLIC_ 접두어가 없다', () => {
  assert.ok(SERVICE.includes('process.env.SUPABASE_SECRET_KEY'));
  assert.ok(
    !SERVICE.includes('NEXT_PUBLIC_SUPABASE_SECRET'),
    'NEXT_PUBLIC_ 를 붙이면 Next.js 가 이 값을 브라우저 번들에 넣습니다',
  );
});

test('secret 키를 실제로 읽는 곳은 lib/supabase/service.ts 하나뿐이다', () => {
  // 이름을 문서에 적는 것(관리자 화면의 설정 안내)은 괜찮습니다.
  // 값을 꺼내 쓰는 곳(process.env)이 여러 군데면 어디로 새는지 추적할 수 없습니다.
  const offenders = SOURCES.filter(
    (path) =>
      !path.endsWith(join('lib', 'supabase', 'service.ts')) &&
      !path.endsWith('service-key-guard.test.ts') &&
      readFileSync(path, 'utf-8').includes('process.env.SUPABASE_SECRET_KEY'),
  );

  assert.deepEqual(offenders, [], 'secret 키를 여러 곳에서 읽으면 어디로 새는지 추적할 수 없습니다');
});

test('secret 키 값이 화면 파일에 박혀 있지 않다', () => {
  // 실제 키는 sb_secret_ 로 시작합니다. 예시(sb_secret_...)는 값이 아닙니다.
  const offenders = SOURCES.filter((path) =>
    /sb_secret_[A-Za-z0-9_-]{8,}/.test(readFileSync(path, 'utf-8')),
  );

  assert.deepEqual(offenders, [], '실제 secret 키가 소스에 들어 있습니다');
});

test('클라이언트 컴포넌트는 service.ts 를 쓰지 않는다', () => {
  const offenders = SOURCES.filter((path) => {
    const source = readFileSync(path, 'utf-8');
    return source.startsWith("'use client'") && source.includes('supabase/service');
  });

  assert.deepEqual(offenders, []);
});

// ── ③ 인증 뒤에만 쓰인다 ─────────────────────────────────────

test('service 클라이언트를 만드는 곳은 lib/api/outbound.ts 하나뿐이다', () => {
  const offenders = SOURCES.filter(
    (path) =>
      !path.endsWith(join('lib', 'supabase', 'service.ts')) &&
      !path.endsWith(join('lib', 'api', 'outbound.ts')) &&
      !path.endsWith('service-key-guard.test.ts') &&
      readFileSync(path, 'utf-8').includes('createSupabaseServiceClient'),
  );

  assert.deepEqual(
    offenders,
    [],
    'serviceClientOrFailure() 를 거치지 않으면 키가 없을 때 503 을 돌려주지 못합니다',
  );
});

test('handleOutbound 는 게이트를 통과하지 못하면 work 를 부르지 않는다', () => {
  const start = HANDLER.indexOf('export async function handleOutbound');
  assert.ok(start >= 0);
  const body = HANDLER.slice(start);

  const gateAt = body.indexOf('const gate = await passGates(');
  const guardAt = body.indexOf('if (!gate.ok)');
  const workAt = body.indexOf('await work(gate.identity)');

  assert.ok(gateAt >= 0, 'passGates 를 부르지 않습니다');
  assert.ok(guardAt > gateAt, '게이트 결과를 검사하지 않습니다');
  assert.ok(workAt > guardAt, 'work 가 게이트 검사보다 먼저 불립니다');
  assert.ok(
    body.slice(guardAt, workAt).includes('return gate.response'),
    '게이트에서 막혔을 때 곧바로 돌려주지 않습니다',
  );
});

test('passGates 는 인증 · scope · 호출 제한을 모두 지난다', () => {
  const start = HANDLER.indexOf('async function passGates');
  const body = HANDLER.slice(start, HANDLER.indexOf('/** POST'));

  const ipAt = body.indexOf('LIMIT_PER_IP');
  const authAt = body.indexOf('await authenticate(request)');
  const scopeAt = body.indexOf('requireScope(auth.identity, scope)');
  const keyAt = body.indexOf('LIMIT_PER_KEY');

  assert.ok(ipAt >= 0 && authAt > ipAt, '호출 제한이 인증보다 앞에 있어야 합니다');
  assert.ok(scopeAt > authAt, 'scope 검사가 인증 뒤에 있어야 합니다');
  assert.ok(keyAt > scopeAt, '키별 제한이 scope 뒤에 있어야 합니다');
});

test('GET 라우트는 전부 handleOutbound 를 거친다', () => {
  const routes = walk(join(ROOT, 'app', 'api', 'v1')).filter((path) => path.endsWith('route.ts'));
  assert.ok(routes.length >= 18, `라우트가 ${routes.length}개뿐입니다`);

  for (const path of routes) {
    const source = readFileSync(path, 'utf-8');
    if (!source.includes('export async function GET')) continue;
    // openapi.json 만 인증이 없습니다 — 문서에는 데이터가 없습니다.
    if (path.includes('openapi.json')) continue;

    assert.ok(
      source.includes('handleOutbound('),
      `${path} 가 handleOutbound 를 거치지 않습니다 — 인증 없이 데이터를 돌려줄 수 있습니다`,
    );
  }
});

test('키가 없을 때 503 과 사유를 돌려준다 (빈 배열이 아니라)', () => {
  const outbound = readFileSync(join(ROOT, 'lib', 'api', 'outbound.ts'), 'utf-8');
  const start = outbound.indexOf('export function serviceClientOrFailure');
  const body = outbound.slice(start, start + 700);

  assert.ok(body.includes('503'));
  assert.ok(body.includes('SERVICE_CREDENTIALS_MISSING'));
  assert.ok(body.includes('서버 자격증명'));
});
