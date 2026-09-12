import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// supabase/migrations/20260912000100_stage1_pg_cron_jobs.sql은 pg_cron·pg_net·vault 확장에
// 의존해 로컬 스크래치 PostgreSQL에서 그대로 실행할 수 없습니다(확장 미설치). 이 파일은 기존
// lib/notifications/cron.test.ts의 SQL 계약 검증 방식을 따라, 그 SQL의 구조적 계약(확장 가드,
// 세 작업 이름과 10분 주기, 이름 기준 재등록으로 인한 재실행 안전성, Vault 참조)을 확인합니다.
// 확장이 설치된 환경에서의 실제 스케줄링·HTTP 호출 동작은 수동 검증이 필요합니다
// (cron-edge-report.md 참고) — 컨트롤러가 실제 Supabase 프로젝트에 적용한 뒤 §6 확인 쿼리로
// 확인합니다.

function readMigration(): string {
  return readFileSync(
    new URL('../../supabase/migrations/20260912000100_stage1_pg_cron_jobs.sql', import.meta.url),
    'utf8',
  );
}

test('pg_cron·pg_net 확장은 재실행에 안전하게 가드된다', () => {
  const sql = readMigration();
  assert.match(sql, /create extension if not exists pg_cron;/);
  assert.match(sql, /create extension if not exists pg_net;/);
});

test('세 작업 모두 10분 주기로 이름 기준 재등록(unschedule-then-schedule)된다', () => {
  const sql = readMigration();
  for (const jobName of ['stage1-notify', 'stage1-expire-allocations', 'stage1-demand-reminders']) {
    const guardPattern = new RegExp(
      `if exists \\(select 1 from cron\\.job where jobname = '${jobName}'\\) then[\\s\\S]{0,80}perform cron\\.unschedule\\('${jobName}'\\)`,
    );
    assert.match(sql, guardPattern, `${jobName}에 unschedule-if-exists 가드가 없습니다`);
    const schedulePattern = new RegExp(`cron\\.schedule\\(\\s*'${jobName}',\\s*'\\*/10 \\* \\* \\* \\*'`);
    assert.match(sql, schedulePattern, `${jobName}이 10분 주기로 등록되지 않았습니다`);
  }
});

test('stage1-notify는 Vault 시크릿으로 만든 URL과 Bearer 인증 헤더로 net.http_post를 호출한다', () => {
  const sql = readMigration();
  assert.match(sql, /net\.http_post\(/);
  assert.match(sql, /vault\.decrypted_secrets where name = 'stage1_notify_url'/);
  assert.match(sql, /vault\.decrypted_secrets where name = 'stage1_notify_secret'/);
  assert.match(sql, /'Authorization',\s*'Bearer '\s*\|\|/);
});

test('평문 시크릿 값을 커밋하지 않고 vault.create_secret 안내만 주석으로 남긴다', () => {
  const sql = readMigration();
  assert.match(sql, /-- select vault\.create_secret\(/);
  assert.doesNotMatch(sql, /^select vault\.create_secret\(/m);
});

test('나머지 두 작업은 HTTP 없이 core 함수를 직접 호출한다', () => {
  const sql = readMigration();
  assert.match(sql, /\$cron\$\s*select core\.expire_temporary_allocations\(\);\s*\$cron\$/);
  assert.match(sql, /\$cron\$\s*select core\.raise_demand_submission_reminders\(\);\s*\$cron\$/);
});

test('적용 후 확인 쿼리에 cron.job·cron.job_run_details·net._http_response 점검이 모두 있다', () => {
  const sql = readMigration();
  assert.match(sql, /from cron\.job\s*$/m);
  assert.match(sql, /from cron\.job_run_details/);
  assert.match(sql, /from net\._http_response/);
});

// fix round 1 · I3 — §6의 확인 쿼리는 마이그레이션 실행 중 자동으로 함께 돌면 안 됩니다.
// vault 확장이 없거나 권한이 없으면 세 작업이 이미 등록된 뒤에 마이그레이션 자체가 실패해
// 반쪽 상태로 남을 수 있기 때문입니다. §6 구간 전체가 주석인지 줄 단위로 확인합니다.
test('§6 확인 쿼리는 실행문이 아니라 전부 주석이다(vault 조회 실패가 마이그레이션을 중단시키지 않는다)', () => {
  const sql = readMigration();
  const section6 = sql.slice(sql.indexOf('-- ══ 6. 적용 후 확인 쿼리'));
  const codeLines = section6
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of codeLines) {
    assert.match(line, /^--/, `§6에 주석이 아닌 줄이 있습니다: ${line}`);
  }
  // 그 안에 실제로 select문들이 있는지도 확인합니다(그냥 다 지워버린 게 아님).
  assert.match(section6, /-- select jobname, schedule, active/);
  assert.match(section6, /-- select name, created_at/);
  assert.match(section6, /-- select job_run\.jobid/);
  assert.match(section6, /-- select id, status_code/);
});

// fix round 1 · I4 — 이전 버전은 "url이 null이면 조용히 넘어가고 net._http_response에도
// 안 남는다"고 잘못 적었습니다. 실제로는 net.http_request_queue.url이 NOT NULL이라 그
// 자리에서 시끄럽게 실패하고 cron.job_run_details.return_message에 남습니다.
test('vault 시크릿 미설정 시 실패 모드 설명이 실제 동작(not-null 위반, job_run_details에 기록)과 일치한다', () => {
  const sql = readMigration();
  assert.match(sql, /NOT NULL[\s\S]{0,200}시끄럽게 실패/);
  assert.match(sql, /not-null 제약 위반[\s\S]{0,200}return_message/);
  assert.doesNotMatch(sql, /조용히 null을 넘/);
  assert.doesNotMatch(sql, /기록되지 않고/);
});

// fix round 1 · C1 — 401을 곧바로 "비밀값 불일치"로 안내하면 JWT 게이트가 원인일 때 엉뚱한
// 곳을 고치게 됩니다. verify_jwt를 먼저 의심하라는 안내가 있어야 합니다.
test('401 디버깅 안내는 비밀값 불일치보다 verify_jwt 게이트를 먼저 의심하게 한다', () => {
  const sql = readMigration();
  assert.match(sql, /401이면\s*\*\*먼저[\s\S]{0,120}verify_jwt[\s\S]{0,80}의심하세요/);
  // "먼저" 안내 뒤에야 시크릿 불일치 확인으로 넘어가야 한다(순서가 반대면 안 됨).
  const verifyJwtIndex = sql.indexOf('verify_jwt가 false로 배포됐는지부터 의심하세요');
  const secretMismatchIndex = sql.indexOf('stage1_notify_secret과 Edge Function의 CRON_SECRET이 같은 값인지');
  assert.ok(verifyJwtIndex > 0, 'verify_jwt 우선 안내 문구를 찾지 못했습니다');
  assert.ok(secretMismatchIndex > verifyJwtIndex, '비밀값 불일치 확인 안내가 verify_jwt 안내보다 먼저 나옵니다');
});

// fix round 1 · C1 — supabase/config.toml에 verify_jwt = false가 없으면 notify 함수는 기본값
// true로 배포되어, pg_net이 보내는 CRON_SECRET Bearer 토큰이 Supabase Auth JWT로 검증되지
// 않는다는 이유로 함수 코드 실행 전에 401로 막힌다.
test('supabase/config.toml은 notify 함수의 verify_jwt를 false로 명시한다', () => {
  const toml = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(toml, /\[functions\.notify\][\s\S]{0,400}verify_jwt\s*=\s*false/);
});
