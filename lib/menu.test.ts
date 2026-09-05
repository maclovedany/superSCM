// 메뉴 — 관리자 구역 묶음 (사이드바의 "관리자 메뉴" 머리말)
import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_MENU, USER_MENU, menuFor, startsAdminGroup } from './menu.ts';

test('관리자 메뉴의 모든 구역은 admin 표시가 있고, 사용자 메뉴에는 없다', () => {
  assert.ok(ADMIN_MENU.length > 0);
  assert.ok(ADMIN_MENU.every((s) => s.admin === true));
  assert.ok(USER_MENU.every((s) => !s.admin));
});

test('ADMIN 역할: 사용자 구역이 먼저, 관리자 구역이 뒤에 한 묶음으로 이어진다', () => {
  const sections = menuFor('ADMIN');
  const firstAdmin = sections.findIndex((s) => s.admin);
  assert.equal(firstAdmin, USER_MENU.length);
  assert.ok(sections.slice(firstAdmin).every((s) => s.admin));
  // 머리말은 첫 관리자 구역 앞에 정확히 한 번
  const starts = sections.map((_, i) => startsAdminGroup(sections, i));
  assert.deepEqual(starts.filter(Boolean).length, 1);
  assert.equal(starts[firstAdmin], true);
});

test('USER 역할: 관리자 머리말이 붙는 자리가 없다', () => {
  const sections = menuFor('USER');
  assert.ok(sections.every((_, i) => !startsAdminGroup(sections, i)));
});

test('영업 담당자(ADMIN)라도 관리자 묶음은 그대로 뒤에 온다', () => {
  const sections = menuFor('ADMIN', true);
  const firstAdmin = sections.findIndex((s) => s.admin);
  assert.ok(firstAdmin > 0);
  assert.equal(startsAdminGroup(sections, firstAdmin), true);
});
