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
