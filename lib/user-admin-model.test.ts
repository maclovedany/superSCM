import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  normalizeManagedAppUser,
  validateActiveInput,
  validateCreateUserInput,
  validateDeleteInput,
  validateProfileEditInput,
} from './user-admin-model.ts';

const migrationUrl = new URL('../supabase/migrations/20260912000300_stage1_user_admin.sql', import.meta.url);

test('관리자 계정 관리 마이그레이션이 있고 필요한 함수를 정의한다', () => {
  assert.equal(existsSync(migrationUrl), true, '20260912000300_stage1_user_admin.sql이 있어야 합니다.');
  const sql = readFileSync(migrationUrl, 'utf8');
  assert.match(sql, /function core\.admin_upsert_app_user_profile/i);
  assert.match(sql, /function core\.admin_set_app_user_active/i);
  assert.match(sql, /function core\.admin_delete_app_user_profile/i);
  assert.match(sql, /function core\.app_user_blocking_tables/i);
  // authenticated에 job_role · department 직접 쓰기 권한을 새로 열지 않는다 — 함수를 통해서만 바뀐다.
  assert.doesNotMatch(sql, /grant\s+update\s*\([^)]*job_role/i);
  assert.doesNotMatch(sql, /grant\s+update\s*\([^)]*department/i);
  assert.doesNotMatch(sql, /to\s+anon[\s\S]{0,120}(insert|update|delete)/i);
});

test('계정 행을 화면 모델로 옮긴다 — 알 수 없는 job_role/department는 null로 떨어진다', () => {
  const row = normalizeManagedAppUser({
    user_id: 'u1', email: 'a@example.com', name: '홍길동',
    department: 'SCM', job_role: 'SCM_LEAD', role: 'ADMIN', active: true,
    created_at: '2026-01-01T00:00:00Z', updated_at: null, last_login_at: null,
  });
  assert.equal(row.role, 'ADMIN');
  assert.equal(row.jobRole, 'SCM_LEAD');
  assert.equal(row.department, 'SCM');

  const unknown = normalizeManagedAppUser({ user_id: 'u2', email: 'b@example.com', job_role: 'NOT_A_ROLE', department: 'NOT_A_DEPT', role: 'USER', active: false });
  assert.equal(unknown.jobRole, null);
  assert.equal(unknown.department, null);
});

test('계정 생성 입력 검증 — 필수값과 형식', () => {
  const missingEmail = validateCreateUserInput({ email: '', name: '홍길동', role: 'USER', jobRole: '', department: '', password: 'password1' });
  assert.equal(missingEmail.ok, false);
  if (!missingEmail.ok) assert.equal(missingEmail.reasonCode, 'EMAIL_REQUIRED');

  const badEmail = validateCreateUserInput({ email: 'not-an-email', name: '홍길동', role: 'USER', jobRole: '', department: '', password: 'password1' });
  assert.equal(badEmail.ok, false);
  if (!badEmail.ok) assert.equal(badEmail.reasonCode, 'EMAIL_INVALID');

  const shortPassword = validateCreateUserInput({ email: 'a@example.com', name: '홍길동', role: 'USER', jobRole: '', department: '', password: 'short' });
  assert.equal(shortPassword.ok, false);
  if (!shortPassword.ok) assert.equal(shortPassword.reasonCode, 'PASSWORD_TOO_SHORT');

  const badJobRole = validateCreateUserInput({ email: 'a@example.com', name: '홍길동', role: 'USER', jobRole: 'NOT_A_ROLE', department: '', password: 'password1' });
  assert.equal(badJobRole.ok, false);
  if (!badJobRole.ok) assert.equal(badJobRole.reasonCode, 'JOB_ROLE_INVALID');

  const badDepartment = validateCreateUserInput({ email: 'a@example.com', name: '홍길동', role: 'USER', jobRole: '', department: 'NOT_A_DEPT', password: 'password1' });
  assert.equal(badDepartment.ok, false);
  if (!badDepartment.ok) assert.equal(badDepartment.reasonCode, 'DEPARTMENT_INVALID');

  const ok = validateCreateUserInput({ email: 'A@Example.com', name: ' 홍길동 ', role: 'ADMIN', jobRole: 'SCM_LEAD', department: 'SCM', password: 'password1' });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.email, 'a@example.com');
    assert.equal(ok.value.jobRole, 'SCM_LEAD');
    assert.equal(ok.value.department, 'SCM');
  }
});

test('계정 편집 입력 검증 — 사유가 없으면 거절된다', () => {
  const missingReason = validateProfileEditInput({
    userId: 'u1', email: 'a@example.com', name: '홍길동', role: 'USER', jobRole: '', department: '', active: 'true', reason: '',
  });
  assert.equal(missingReason.ok, false);
  if (!missingReason.ok) assert.equal(missingReason.reasonCode, 'REASON_REQUIRED');

  const ok = validateProfileEditInput({
    userId: 'u1', email: 'a@example.com', name: '홍길동', role: 'ADMIN', jobRole: 'SALES_REP', department: 'SALES', active: 'false', reason: '부서 이동',
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.active, false);
    assert.equal(ok.value.role, 'ADMIN');
  }
});

test('활성 전환 · 완전 삭제 입력 검증도 사유를 요구한다', () => {
  const active = validateActiveInput({ userId: 'u1', active: 'false', reason: '' });
  assert.equal(active.ok, false);
  if (!active.ok) assert.equal(active.reasonCode, 'REASON_REQUIRED');

  const del = validateDeleteInput({ userId: '', email: 'a@example.com', reason: '중복 계정' });
  assert.equal(del.ok, false);
  if (!del.ok) assert.equal(del.reasonCode, 'USER_ID_REQUIRED');

  const missingEmail = validateDeleteInput({ userId: 'u1', email: '', reason: '중복 계정' });
  assert.equal(missingEmail.ok, false);
  if (!missingEmail.ok) assert.equal(missingEmail.reasonCode, 'EMAIL_REQUIRED');

  const okDelete = validateDeleteInput({ userId: 'u1', email: 'a@example.com', reason: '중복 계정' });
  assert.equal(okDelete.ok, true);
});
