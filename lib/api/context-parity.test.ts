// core.api_validation_context 가 lib/import/repository.ts 의 loadValidationContext 와
// **같은 곳**을 읽는지 대조합니다.
//
// ★ 왜 필요한가 (리뷰 Critical 2)
//   API 는 세션이 없어 뷰를 직접 select 할 수 없으므로, 같은 재료를 security definer
//   함수로 받습니다. 그 함수가 다른 뷰를 보기 시작하면 파일 업로드와 API 의 검증 재료가
//   갈라지고, 이 STEP 이 막으려던 "규칙이 두 벌" 이 됩니다.
//   두 파일에서 뷰 이름을 뽑아 집합으로 비교합니다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SQL = readFileSync(join(process.cwd(), 'sql', '26-api.sql'), 'utf-8');
const REPO = readFileSync(join(process.cwd(), 'lib', 'import', 'repository.ts'), 'utf-8');

/** loadValidationContext 와 loadSavedMapping 이 읽는 곳 */
const EXPECTED = ['v_item_master', 'v_leadtime_gap', 'v_raw_schema', 'column_mapping'];

test('loadValidationContext 가 읽는 곳이 네 군데 그대로다', () => {
  const start = REPO.indexOf('export async function loadValidationContext');
  assert.ok(start >= 0);
  const body = REPO.slice(start, REPO.indexOf('export async function saveMapping'));

  for (const source of EXPECTED) {
    assert.ok(
      body.includes(`'${source}'`),
      `lib/import/repository.ts 가 ${source} 를 더 이상 읽지 않습니다. ` +
        'sql/26 의 core.api_validation_context 도 함께 고치세요.',
    );
  }
});

test('core.api_validation_context 가 같은 네 곳을 읽는다', () => {
  const start = SQL.indexOf('create or replace function core.api_validation_context');
  assert.ok(start >= 0, 'sql/26 에 core.api_validation_context 이 없습니다');
  const body = SQL.slice(start, SQL.indexOf('$$;', start));

  for (const source of EXPECTED) {
    assert.ok(
      body.includes(source),
      `core.api_validation_context 가 ${source} 를 읽지 않습니다. ` +
        '파일 업로드와 API 의 검증 재료가 갈라집니다.',
    );
  }
});

test('core.api_validation_context 는 키 해시로 인증하고, 실패하면 0행이다', () => {
  const start = SQL.indexOf('create or replace function core.api_validation_context');
  const body = SQL.slice(start, SQL.indexOf('$$;', start));

  assert.ok(body.includes('core.api_key_id_for_hash(p_key_hash)'), '키 해시 검사가 없습니다');
  assert.match(
    body,
    /if v_key_id is null then\s*\n\s*return;/,
    '키를 확인하지 못했을 때 0행으로 끝나지 않습니다',
  );
});
