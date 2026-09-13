// refactor_260911 menu-brief — 메뉴 그룹화(menuGroupsFor)의 계약을 단정합니다.
//
// ★ menuFor()/menuForRole() 의 평면 배열 계약은 auth-policy.test.ts · permission.test.ts가
//   이미 지킵니다. 여기서는 그 위에 얹은 그룹 배치(MENU_GROUP_LAYOUT)만 검증합니다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_MENU, USER_MENU, menuFor, menuGroupsFor } from './menu.ts';
import { PermissionSet } from './permission.ts';

const ALL_PERMISSION_CODES = Array.from(
  new Set([...USER_MENU, ...ADMIN_MENU].flatMap((item) => item.anyOf ?? [])),
);

test('USER 그룹의 합은 menuFor(USER)의 평면 길이와 정확히 같다 — 누락·중복 없음', () => {
  const flat = menuFor('USER', new PermissionSet(ALL_PERMISSION_CODES));
  const groups = menuGroupsFor('USER', new PermissionSet(ALL_PERMISSION_CODES));
  const grouped = groups.flatMap((group) => group.items);

  assert.equal(grouped.length, flat.length);
  assert.deepEqual(
    grouped.map((item) => item.href).sort(),
    flat.map((item) => item.href).sort(),
  );
});

test('ADMIN 그룹의 합은 menuFor(ADMIN)의 평면 길이와 정확히 같다 — 누락·중복 없음', () => {
  const flat = menuFor('ADMIN', new PermissionSet(ALL_PERMISSION_CODES));
  const groups = menuGroupsFor('ADMIN', new PermissionSet(ALL_PERMISSION_CODES));
  const grouped = groups.flatMap((group) => group.items);

  assert.equal(grouped.length, flat.length);
  assert.deepEqual(
    grouped.map((item) => item.href).sort(),
    flat.map((item) => item.href).sort(),
  );
});

test('USER 역할은 어느 그룹에도 /admin/ 항목이 없다', () => {
  const groups = menuGroupsFor('USER', new PermissionSet(ALL_PERMISSION_CODES));
  for (const group of groups) {
    assert.equal(
      group.items.some((item) => item.href.startsWith('/admin/')),
      false,
      `${group.label} 그룹에 /admin/ 항목이 있습니다.`,
    );
  }
});

test('ADMIN 메뉴는 마스터·권한 / 데이터 / 예측 엔진 / 시스템 네 그룹 이상으로 나뉜다', () => {
  const groups = menuGroupsFor('ADMIN', new PermissionSet(ALL_PERMISSION_CODES));
  const adminGroupLabels = groups
    .filter((group) => group.items.every((item) => item.href.startsWith('/admin/')))
    .map((group) => group.label);

  assert.ok(adminGroupLabels.length >= 4, `ADMIN 그룹이 ${adminGroupLabels.length}개뿐입니다: ${adminGroupLabels.join(', ')}`);
});

test('권한이 없는 사용자에게는 anyOf 항목이 걸린 그룹이 통째로 사라진다 — 빈 제목 노출 금지', () => {
  const groups = menuGroupsFor('USER', new PermissionSet([]));
  const groupLabels = groups.map((group) => group.label);

  // "승인" 그룹은 /approvals 하나뿐이고 anyOf 가 필요하다 — 권한이 없으면 그룹째 사라져야 한다.
  assert.equal(groupLabels.includes('승인'), false, '권한 없는 사용자에게 빈 "승인" 그룹 제목이 보입니다.');

  // 모든 그룹은 최소 1개 이상의 항목을 가진다 — 제목만 있고 항목이 없는 그룹은 없다.
  for (const group of groups) {
    assert.ok(group.items.length > 0, `${group.label} 그룹이 비어 있는데 표시되고 있습니다.`);
  }
});

test('권한이 없어도 anyOf 없는 항목(전체 현황 · AI 비서 · 알림 등)이 속한 그룹은 남는다', () => {
  const groups = menuGroupsFor('USER', new PermissionSet([]));
  const groupLabels = groups.map((group) => group.label);
  assert.ok(groupLabels.includes('개요'), '로그인만으로 보이는 "개요" 그룹이 사라졌습니다.');
});
