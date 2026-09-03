import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { applyFilter, filterHref, readFilter, type FilterSpec } from './filter.ts';

// ── 동작 ──────────────────────────────────────────────────────

type Row = { id: string; risk: string };
const rows: Row[] = [
  { id: 'A', risk: 'CRITICAL' },
  { id: 'B', risk: 'SAFE' },
  { id: 'C', risk: 'CRITICAL' },
];
const specs: FilterSpec<Row>[] = [
  { key: 'all', label: '전체', match: null },
  { key: 'critical', label: '위험', match: (row) => row.risk === 'CRITICAL' },
];

test('필터가 없으면 전체를 돌려준다', () => {
  assert.equal(applyFilter(rows, specs, null).length, 3);
  assert.equal(applyFilter(rows, specs, 'all').length, 3);
});

test('필터가 걸리면 목록이 좁혀진다', () => {
  assert.deepEqual(applyFilter(rows, specs, 'critical').map((r) => r.id), ['A', 'C']);
});

test('모르는 필터 키는 전체로 되돌린다', () => {
  // URL 을 손으로 고쳐 들어와도 화면이 비지 않아야 합니다
  assert.equal(applyFilter(rows, specs, 'nonsense').length, 3);
});

test('켜진 카드를 다시 누르면 필터가 풀린다', () => {
  assert.equal(filterHref('critical', false), '?filter=critical');
  assert.equal(filterHref('critical', true), '?');
});

test('searchParams 의 배열도 읽는다', () => {
  assert.equal(readFilter({ filter: 'critical' }), 'critical');
  assert.equal(readFilter({ filter: ['critical', 'safe'] }), 'critical');
  assert.equal(readFilter({}), null);
  assert.equal(readFilter(undefined), null);
});

// ── 원칙이 지켜지는지 (AGENTS.md 규칙 9 · design.md §6.4) ──────

const SKIP = new Set(['node_modules', '.next', '.git']);

function pages(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) pages(path, out);
    else if (entry === 'page.tsx') out.push(path);
  }
  return out;
}

test('KPI 카드가 있는 화면은 카드를 눌러 목록을 좁힐 수 있다', () => {
  const offenders: string[] = [];

  for (const path of pages('app')) {
    const source = readFileSync(path, 'utf-8');
    if (!source.includes('<KpiCard')) continue;
    // 목록이 없는 화면은 좁힐 대상이 없습니다.
    if (!source.includes('<DataTable')) continue;

    if (source.includes('filter={{')) continue;

    // 카드가 목록의 부분집합이 아닌 화면(설명용 지표)은 예외입니다.
    // 다만 이유를 파일에 적어야 넘어갑니다. 조용히 빠져나가지 못하게 합니다.
    //
    //   // kpi-filter: 없음 — <이유>
    if (/\/\/\s*kpi-filter:\s*없음\s*—\s*\S/.test(source)) continue;

    offenders.push(`${path} — KpiCard 와 DataTable 이 있는데 filter 가 없습니다`);
  }

  assert.deepEqual(
    offenders,
    [],
    'KPI 카드와 목록이 함께 있는 화면은 카드를 눌러 목록을 좁힐 수 있어야 합니다.\n' +
      'AGENTS.md 규칙 9 · design.md §6.4 를 보세요.\n' +
      '카드가 목록의 부분집합이 아니라면 파일에 이유를 적으세요:\n' +
      '  // kpi-filter: 없음 — <이유>\n\n' +
      offenders.join('\n'),
  );
});
