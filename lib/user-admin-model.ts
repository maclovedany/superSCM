// 관리자 계정 관리 — 화면 모델과 입력 검증. 순수 함수만 둔다.
//
// ★ 여기서 권한을 판정하지 않는다. DB 명령 함수(core.admin_upsert_app_user_profile 등)가
//   core.is_admin()과 자기 자신 여부를 다시 확인한다. 이 파일은 형식(빈 값 · 이메일 형식 ·
//   비밀번호 길이 · job_role/department가 STEP 19가 정의한 값인지)만 걸러낸다.
// ★ job_role · department 값은 lib/permission.ts(JOB_ROLES · DEPARTMENTS)를 그대로 쓴다.
//   여기서 새 값을 만들지 않는다 — 표가 두 벌이 되면 화면과 DB의 답이 갈라진다.

import { DEPARTMENTS, isJobRole, JOB_ROLES, type Department, type JobRole } from './permission.ts';

export type ManagedAppUser = {
  userId: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'USER';
  /** 업무 직책. null이면 업무 권한이 하나도 없다(analysis/permissions 화면과 같은 판정) */
  jobRole: JobRole | null;
  department: Department | null;
  active: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  lastLoginAt: string | null;
};

export function normalizeManagedAppUser(row: Record<string, unknown>): ManagedAppUser {
  const jobRole = row.job_role ? String(row.job_role) : null;
  const department = row.department ? String(row.department) : null;
  return {
    userId: String(row.user_id),
    email: String(row.email ?? ''),
    name: String(row.name ?? ''),
    role: row.role === 'ADMIN' ? 'ADMIN' : 'USER',
    jobRole: jobRole && isJobRole(jobRole) ? jobRole : null,
    department: department && (DEPARTMENTS as readonly string[]).includes(department) ? (department as Department) : null,
    active: row.active === true,
    createdAt: row.created_at ? String(row.created_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
    lastLoginAt: row.last_login_at ? String(row.last_login_at) : null,
  };
}

type Failure<Code extends string> = { ok: false; reasonCode: Code; message: string };
type Result<T, Code extends string> = { ok: true; value: T } | Failure<Code>;

function fail<Code extends string>(reasonCode: Code, message: string): Failure<Code> {
  return { ok: false, reasonCode, message };
}

function trimmed(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseRole(input: unknown): 'ADMIN' | 'USER' | null {
  return input === 'ADMIN' || input === 'USER' ? input : null;
}

function parseOptionalJobRole(input: unknown): { ok: true; value: JobRole | null } | { ok: false } {
  const raw = trimmed(input);
  if (raw === '') return { ok: true, value: null };
  return isJobRole(raw) ? { ok: true, value: raw } : { ok: false };
}

function parseOptionalDepartment(input: unknown): { ok: true; value: Department | null } | { ok: false } {
  const raw = trimmed(input);
  if (raw === '') return { ok: true, value: null };
  return (DEPARTMENTS as readonly string[]).includes(raw) ? { ok: true, value: raw as Department } : { ok: false };
}

function isActive(input: unknown): boolean {
  return input === true || input === 'true';
}

// ── 계정 생성 ────────────────────────────────────────────────

export type ValidatedCreateUserInput = {
  email: string;
  name: string;
  role: 'ADMIN' | 'USER';
  jobRole: JobRole | null;
  department: Department | null;
  password: string;
};

export type CreateUserReasonCode =
  | 'EMAIL_REQUIRED'
  | 'EMAIL_INVALID'
  | 'NAME_REQUIRED'
  | 'ROLE_INVALID'
  | 'JOB_ROLE_INVALID'
  | 'DEPARTMENT_INVALID'
  | 'PASSWORD_TOO_SHORT';

export function validateCreateUserInput(input: {
  email: unknown;
  name: unknown;
  role: unknown;
  jobRole: unknown;
  department: unknown;
  password: unknown;
}): Result<ValidatedCreateUserInput, CreateUserReasonCode> {
  const email = trimmed(input.email).toLowerCase();
  if (email === '') return fail('EMAIL_REQUIRED', '이메일을 입력하세요.');
  if (!EMAIL_PATTERN.test(email)) return fail('EMAIL_INVALID', '이메일 형식이 올바르지 않습니다.');

  const name = trimmed(input.name);
  if (name === '') return fail('NAME_REQUIRED', '이름을 입력하세요.');

  const role = parseRole(input.role);
  if (!role) return fail('ROLE_INVALID', '시스템 권한은 ADMIN 또는 USER여야 합니다.');

  const jobRole = parseOptionalJobRole(input.jobRole);
  if (!jobRole.ok) return fail('JOB_ROLE_INVALID', '알 수 없는 업무 직책입니다.');

  const department = parseOptionalDepartment(input.department);
  if (!department.ok) return fail('DEPARTMENT_INVALID', '알 수 없는 부서입니다.');

  const password = typeof input.password === 'string' ? input.password : '';
  if (password.length < 8) return fail('PASSWORD_TOO_SHORT', '초기 비밀번호는 8자 이상이어야 합니다.');

  return { ok: true, value: { email, name, role, jobRole: jobRole.value, department: department.value, password } };
}

// ── 계정 편집 ────────────────────────────────────────────────

export type ValidatedProfileEditInput = {
  userId: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'USER';
  jobRole: JobRole | null;
  department: Department | null;
  active: boolean;
  reason: string;
};

export type ProfileEditReasonCode =
  | 'USER_ID_REQUIRED'
  | 'EMAIL_REQUIRED'
  | 'NAME_REQUIRED'
  | 'ROLE_INVALID'
  | 'JOB_ROLE_INVALID'
  | 'DEPARTMENT_INVALID'
  | 'REASON_REQUIRED';

export function validateProfileEditInput(input: {
  userId: unknown;
  email: unknown;
  name: unknown;
  role: unknown;
  jobRole: unknown;
  department: unknown;
  active: unknown;
  reason: unknown;
}): Result<ValidatedProfileEditInput, ProfileEditReasonCode> {
  const userId = trimmed(input.userId);
  if (userId === '') return fail('USER_ID_REQUIRED', '대상 계정이 없습니다.');

  const email = trimmed(input.email).toLowerCase();
  if (email === '') return fail('EMAIL_REQUIRED', '이메일 정보가 없습니다.');

  const name = trimmed(input.name);
  if (name === '') return fail('NAME_REQUIRED', '이름을 입력하세요.');

  const role = parseRole(input.role);
  if (!role) return fail('ROLE_INVALID', '시스템 권한은 ADMIN 또는 USER여야 합니다.');

  const jobRole = parseOptionalJobRole(input.jobRole);
  if (!jobRole.ok) return fail('JOB_ROLE_INVALID', '알 수 없는 업무 직책입니다.');

  const department = parseOptionalDepartment(input.department);
  if (!department.ok) return fail('DEPARTMENT_INVALID', '알 수 없는 부서입니다.');

  const reason = trimmed(input.reason);
  if (reason === '') return fail('REASON_REQUIRED', '변경 사유를 입력하세요.');

  return { ok: true, value: { userId, email, name, role, jobRole: jobRole.value, department: department.value, active: isActive(input.active), reason } };
}

// ── 활성·비활성 전환 ─────────────────────────────────────────

export type ValidatedActiveInput = { userId: string; active: boolean; reason: string };
export type ActiveReasonCode = 'USER_ID_REQUIRED' | 'REASON_REQUIRED';

export function validateActiveInput(input: { userId: unknown; active: unknown; reason: unknown }): Result<ValidatedActiveInput, ActiveReasonCode> {
  const userId = trimmed(input.userId);
  if (userId === '') return fail('USER_ID_REQUIRED', '대상 계정이 없습니다.');
  const reason = trimmed(input.reason);
  if (reason === '') return fail('REASON_REQUIRED', '사유를 입력하세요.');
  return { ok: true, value: { userId, active: isActive(input.active), reason } };
}

// ── 완전 삭제 ────────────────────────────────────────────────

export type ValidatedDeleteInput = { userId: string; email: string; reason: string };
export type DeleteReasonCode = 'USER_ID_REQUIRED' | 'EMAIL_REQUIRED' | 'REASON_REQUIRED';

// fix round 1 · I5 — email은 core.app_user_blocking_tables/admin_delete_app_user_profile에
// 넘기지 않는다(그 함수들은 user_id만 안다). Auth 계정 삭제가 실패했을 때 감사 로그에 어떤
// 계정인지 남기려면(core.admin_record_auth_delete_failure) 여기서부터 들고 다녀야 한다 —
// 프로필이 이미 지워진 뒤라 그 시점엔 core.app_user를 다시 조회해 이메일을 얻을 수 없다.
export function validateDeleteInput(input: { userId: unknown; email: unknown; reason: unknown }): Result<ValidatedDeleteInput, DeleteReasonCode> {
  const userId = trimmed(input.userId);
  if (userId === '') return fail('USER_ID_REQUIRED', '대상 계정이 없습니다.');
  const email = trimmed(input.email).toLowerCase();
  if (email === '') return fail('EMAIL_REQUIRED', '대상 계정의 이메일 정보가 없습니다.');
  const reason = trimmed(input.reason);
  if (reason === '') return fail('REASON_REQUIRED', '삭제 사유를 입력하세요.');
  return { ok: true, value: { userId, email, reason } };
}

export { JOB_ROLES, DEPARTMENTS };
