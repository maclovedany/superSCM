import assert from 'node:assert/strict';
import test from 'node:test';
import { JOB_ROLES, PERMISSIONS, PermissionSet, departmentLabel, isJobRole, jobRoleLabel } from './permission.ts';

test('직책 코드는 여섯 가지뿐이고 모르는 값은 미지정이다', () => {
  assert.equal(JOB_ROLES.length, 6);
  assert.equal(isJobRole('SCM_LEAD'), true);
  assert.equal(isJobRole('CEO'), false);
  assert.equal(isJobRole(null), false);
  assert.equal(jobRoleLabel('SCM_LEAD'), 'SCM팀장');
  assert.equal(jobRoleLabel('CEO'), '미지정');
  assert.equal(jobRoleLabel(null), '미지정');
});

test('부서 라벨도 모르는 값을 미지정으로 떨어뜨린다', () => {
  assert.equal(departmentLabel('SCM'), 'SCM팀');
  assert.equal(departmentLabel('경영지원'), '미지정');
  assert.equal(departmentLabel(null), '미지정');
});

test('권한 집합은 가진 것만 참이다', () => {
  const set = new PermissionSet(['PLAN_CONFIRM', 'ITEM_POLICY_EDIT']);
  assert.equal(set.has('PLAN_CONFIRM'), true);
  assert.equal(set.has('PLAN_APPROVE'), false, '확정과 승인은 다른 권한입니다');
  assert.equal(set.size, 2);
});

test('hasAny 는 하나라도 있으면 참이다 — 메뉴 노출에 씁니다', () => {
  const set = new PermissionSet(['ALLOC_VIEW']);
  assert.equal(set.hasAny('ALLOC_VIEW', 'ALLOC_MANUAL'), true);
  assert.equal(set.hasAny('PLAN_APPROVE', 'PLAN_CONFIRM'), false);
});

test('권한이 하나도 없는 집합은 아무것도 통과시키지 않는다 — fail-closed', () => {
  // 직책이 없는 신규 계정이 이 상태입니다. 기본값이 "전부 허용" 이면 안 됩니다.
  const none = new PermissionSet([]);
  for (const code of PERMISSIONS) {
    assert.equal(none.has(code), false, `${code} 가 열려 있습니다`);
  }
});

test('권한 코드 목록에 중복이 없다', () => {
  assert.equal(new Set(PERMISSIONS).size, PERMISSIONS.length);
});
