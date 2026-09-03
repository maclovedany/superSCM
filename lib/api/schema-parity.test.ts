// sql/26-api.sql 의 표가 lib/import/schema.ts 의 TABLE_SPECS 와 같은지 대조합니다.
//
// ★ 왜 필요한가 (리뷰 Critical 1)
//   API 적재의 대상 테이블 · 기간 컬럼 · 키 컬럼은 호출자가 정하지 않고
//   `core.api_target_for_data_type(data_type)` 가 정합니다. 그 표는 SQL 안에 있으므로
//   TypeScript 의 TABLE_SPECS 와 갈라질 수 있습니다. 갈라지면 API 가 엉뚱한 테이블에
//   쓰거나 upsert 키가 달라집니다. 이 테스트가 두 표를 실제로 대조합니다.
//
// ★ scope 표도 같이 봅니다 — lib/api/openapi.ts 의 INBOUND_ROUTES 와
//   `core.api_scope_for_data_type` 이 어긋나면, 앱이 통과시킨 요청을 DB 가 막습니다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TABLE_SPECS, DATA_TYPES } from '../import/schema.ts';
import { INBOUND_ROUTES } from './openapi.ts';

const SQL = readFileSync(join(process.cwd(), 'sql', '26-api.sql'), 'utf-8');

/** `('DEMAND', 'raw.usage_history', 'use_date', array['item_id','use_date'])` 를 읽습니다 */
function parseTargetTable(): Record<string, { target: string; period: string | null; keys: string[] }> {
  const start = SQL.indexOf('create or replace function core.api_target_for_data_type');
  assert.ok(start >= 0, 'sql/26 에 core.api_target_for_data_type 이 없습니다');
  const body = SQL.slice(start, SQL.indexOf('$$;', start));

  const out: Record<string, { target: string; period: string | null; keys: string[] }> = {};
  const rowRe =
    /\(\s*'([A-Z_]+)'\s*,\s*'([a-z_.]+)'\s*,\s*(null|'[a-z_]+')\s*,\s*array\[([^\]]*)\]\s*\)/g;

  for (const match of Array.from(body.matchAll(rowRe))) {
    const period = match[3] === 'null' ? null : match[3].replace(/'/g, '');
    const keys = match[4]
      .split(',')
      .map((part) => part.trim().replace(/'/g, ''))
      .filter((part) => part.length > 0);
    out[match[1]] = { target: match[2], period, keys };
  }
  return out;
}

/** `when 'DEMAND' then 'demand:write'` 를 읽습니다 */
function parseScopeTable(): Record<string, string> {
  const start = SQL.indexOf('create or replace function core.api_scope_for_data_type');
  assert.ok(start >= 0, 'sql/26 에 core.api_scope_for_data_type 이 없습니다');
  const body = SQL.slice(start, SQL.indexOf('$$;', start));

  const out: Record<string, string> = {};
  for (const match of Array.from(body.matchAll(/when\s+'([A-Z_]+)'\s+then\s+'([a-z_:]+)'/g))) {
    out[match[1]] = match[2];
  }
  return out;
}

test('SQL 의 적재 대상 표가 TABLE_SPECS 의 8종을 모두 담는다', () => {
  const sqlTable = parseTargetTable();
  assert.deepEqual(Object.keys(sqlTable).sort(), DATA_TYPES.slice().sort());
});

test('target_table · period_field · key_fields 가 TABLE_SPECS 와 같다', () => {
  const sqlTable = parseTargetTable();

  for (const dataType of DATA_TYPES) {
    const spec = TABLE_SPECS[dataType];
    const row = sqlTable[dataType];
    assert.ok(row, `${dataType} 이 SQL 표에 없습니다`);

    assert.equal(row.target, `raw.${spec.targetTable}`, `${dataType} 의 target_table`);
    assert.equal(row.period, spec.periodField, `${dataType} 의 period_field`);
    assert.deepEqual(row.keys, spec.keyFields, `${dataType} 의 key_fields`);
  }
});

test('SQL 의 scope 표가 라우트 표와 같다', () => {
  const sqlScope = parseScopeTable();

  for (const route of INBOUND_ROUTES) {
    assert.equal(
      sqlScope[route.dataType],
      route.scope,
      `${route.path} (${route.dataType}) 의 scope 가 SQL 과 다릅니다`,
    );
  }

  // 반대 방향 — SQL 에만 있는 데이터 종류가 없어야 합니다
  assert.deepEqual(Object.keys(sqlScope).sort(), DATA_TYPES.slice().sort());
});

test('적재 대상은 전부 raw 스키마다', () => {
  for (const row of Object.values(parseTargetTable())) {
    assert.ok(row.target.startsWith('raw.'), `${row.target} 이 raw 가 아닙니다`);
  }
});
