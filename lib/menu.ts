import type { LucideIcon } from 'lucide-react';
import { BarChart3, Bell, Boxes, Database, Gauge, LineChart, Settings2, Users, Workflow, Bot } from 'lucide-react';

import { WORK_ROUTE_PERMISSIONS, type Permission, type PermissionSet } from './permission.ts';

export type MenuItem = {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** 이 중 하나라도 있으면 보입니다. 없으면 로그인만으로 보입니다 */
  anyOf?: readonly Permission[];
};

export const USER_MENU: MenuItem[] = [
  { href: '/dashboard', label: '전체 현황', description: '월간 발주계획 요약', icon: Gauge },
  { href: '/notifications', label: '알림', description: '승인·배정·제출 알림', icon: Bell },
  { href: '/procurement-plans', label: '발주계획', description: '발주량 계산 · 품목담당자 확정 · 팀장 승인', icon: Workflow, anyOf: WORK_ROUTE_PERMISSIONS['/procurement-plans'] },
  { href: '/procurement-plans/item-policies', label: '품목 정책', description: '목표 DoS · 배정 방식 · MOQ 변경 요청과 승인 대기 현황', icon: Boxes, anyOf: WORK_ROUTE_PERMISSIONS['/procurement-plans/item-policies'] },
  { href: '/procurement-plans/schedule', label: '발주 일정', description: '공급처 출항일 기준 발주 · 입고 일정, 실제 입고일 입력', icon: Workflow, anyOf: WORK_ROUTE_PERMISSIONS['/procurement-plans/schedule'] },
  { href: '/allocations', label: '배정', description: '배정 대기열 · 수동 확정배정 · 확정배정 취소', icon: Boxes, anyOf: WORK_ROUTE_PERMISSIONS['/allocations'] },
  { href: '/approvals', label: '승인함', description: '정책·배정·수요·발주계획 승인과 반려', icon: Workflow, anyOf: WORK_ROUTE_PERMISSIONS['/approvals'] },
  { href: '/orders', label: '주문', description: '영업 주문 등록 · 검토 요청(임시배정) · 수주 확정', icon: Workflow, anyOf: WORK_ROUTE_PERMISSIONS['/orders'] },
  { href: '/allocations/priorities', label: '배정 우선순위', description: '임시배정 · 대기 주문 순번과 우선순위 변경', icon: Workflow, anyOf: WORK_ROUTE_PERMISSIONS['/allocations/priorities'] },
  { href: '/inventory', label: '재고', description: '업무 범위별 가용재고 조회', icon: Boxes, anyOf: WORK_ROUTE_PERMISSIONS['/inventory'] },
  { href: '/urgent-orders', label: '긴급발주', description: '소모품 긴급발주 등록 · 상태 관리(SCM) · 현황 조회(서비스부)', icon: Boxes, anyOf: WORK_ROUTE_PERMISSIONS['/urgent-orders'] },
  { href: '/demand-submissions', label: '수요 제출', description: '부서별 월간 수요 제출', icon: BarChart3, anyOf: WORK_ROUTE_PERMISSIONS['/demand-submissions'] },
  { href: '/analysis/receipt-gap', label: '입고 차이', description: '계획 입고일과 실제 입고일의 차이 — 법인 · 품목 · 월별', icon: BarChart3, anyOf: WORK_ROUTE_PERMISSIONS['/analysis/receipt-gap'] },
  { href: '/analysis/inventory-performance', label: '월말 재고 성과', description: '승인된 목표재고 · 단가 대비 월말 재고수량 · 금액', icon: Boxes, anyOf: WORK_ROUTE_PERMISSIONS['/analysis/inventory-performance'] },
  { href: '/analysis/demand-profile', label: '수요 패턴', description: '출고 실적 기반 수요 성격 분류', icon: BarChart3 },
  { href: '/analysis/model-comparison', label: 'OL 예측 정확도', description: '영업 OL · SCM OL 의 WAPE 와 Bias', icon: LineChart },
  { href: '/analysis/leadtime', label: '리드타임 격차', description: '실데이터 대기 — 공급처별 Lead time 필요', icon: LineChart },
  { href: '/analysis/stockout', label: '재고 소진 위험', description: '실데이터 대기 — 월말 재고 스냅샷 필요', icon: Boxes },
  { href: '/agent', label: 'AI 비서', description: '검증된 조회 함수로만 답하는 Agent', icon: Bot },
];

export const ADMIN_MENU: MenuItem[] = [
  { href: '/admin/notification-history', label: '알림 발송 이력', description: '시스템·이메일 채널별 발송 결과', icon: Bell },
  { href: '/admin/master', label: '마스터', description: '해외법인 · 공급처 · 출항일 · 품목 정책', icon: Boxes },
  { href: '/admin/permissions', label: '권한', description: '부서 · 직책 · 업무 권한', icon: Users },
  { href: '/admin/users', label: '사용자 관리', description: '계정 권한과 활성 상태 관리', icon: Users },
  { href: '/admin/demand', label: '수요 관리', description: '수요 데이터 관리', icon: BarChart3 },
  { href: '/admin/data-management', label: '데이터 관리', description: '파일 적재와 이력 관리', icon: Database },
  { href: '/admin/practice-data', label: '실습용 데이터', description: '실습 데이터 현황 · 영향받는 화면 · 제거 방법', icon: Database },
  { href: '/admin/forecast-models', label: 'Forecast Models', description: '예측 모델 설정 관리', icon: Bot },
  { href: '/admin/forecast-runs', label: 'Forecast Runs', description: '예측 실행 이력 관리', icon: Bot },
  { href: '/admin/backtest-runs', label: 'Backtest Runs', description: '검증 실행 이력 관리', icon: Bot },
  { href: '/admin/champion-models', label: 'Champion Models', description: '대표 모델 수동 선정', icon: Bot },
  { href: '/admin/settings', label: '시스템 설정', description: '관리자 설정', icon: Settings2 },
];

export type AppRole = 'ADMIN' | 'USER';

export function menuForRole(role: AppRole): MenuItem[] {
  return role === 'ADMIN' ? [...USER_MENU, ...ADMIN_MENU] : USER_MENU;
}

/**
 * 역할과 업무 권한을 함께 적용한 메뉴.
 *
 * ★ anyOf 가 없는 항목은 로그인만으로 보입니다. 분석 화면처럼 누구나 봐도 되는 것들입니다.
 * ★ 이것은 1차 방어입니다. 숨긴 경로로 직접 들어오면 서버가 다시 거절합니다.
 */
export function menuFor(role: AppRole, permissions: PermissionSet): MenuItem[] {
  return menuForRole(role).filter((item) => !item.anyOf || permissions.hasAny(...item.anyOf));
}

export type MenuGroup = { label: string; items: MenuItem[] };

/**
 * 메뉴를 의미 그룹으로 묶기 위한 배치표입니다. 여기 없는 href 가 있거나(→ 랜덤한 곳에 안
 * 나타나고 사라짐), 여기 있는 href 가 USER_MENU/ADMIN_MENU 에 없으면(→ 존재하지 않는
 * 항목을 그리려 함) 둘 다 버그이므로 menuGroupsFor 가 즉시 던집니다(refactor_260911 menu-brief §변조 시험 M1).
 *
 * USER_MENU 19개, ADMIN_MENU 12개 — 실측(2026-09-13, `grep -c "href:" lib/menu.ts` = 32 - 타입
 * 선언의 "href: string;" 1줄 = 31).
 */
const MENU_GROUP_LAYOUT: readonly { label: string; hrefs: readonly string[] }[] = [
  // USER
  { label: '개요', hrefs: ['/dashboard', '/agent', '/notifications'] },
  { label: '수요', hrefs: ['/demand-submissions', '/analysis/demand-profile', '/analysis/model-comparison'] },
  {
    label: '구매 · 발주',
    hrefs: [
      '/procurement-plans',
      '/procurement-plans/item-policies',
      '/procurement-plans/schedule',
      '/analysis/receipt-gap',
      '/analysis/leadtime',
      '/urgent-orders',
    ],
  },
  { label: '영업 · 배정', hrefs: ['/orders', '/allocations', '/allocations/priorities'] },
  { label: '재고', hrefs: ['/inventory', '/analysis/inventory-performance', '/analysis/stockout'] },
  { label: '승인', hrefs: ['/approvals'] },
  // ADMIN — 브리프가 요구한 최소 4분할(마스터·권한 / 데이터 / 예측 엔진 / 시스템)
  { label: '마스터 · 권한', hrefs: ['/admin/master', '/admin/permissions', '/admin/users'] },
  { label: '데이터', hrefs: ['/admin/demand', '/admin/data-management', '/admin/practice-data'] },
  {
    label: '예측 엔진',
    hrefs: ['/admin/forecast-models', '/admin/forecast-runs', '/admin/backtest-runs', '/admin/champion-models'],
  },
  { label: '시스템', hrefs: ['/admin/notification-history', '/admin/settings'] },
];

function assertMenuGroupLayoutCoversAllItems(): void {
  const allHrefs = [...USER_MENU, ...ADMIN_MENU].map((item) => item.href);
  const layoutHrefs = MENU_GROUP_LAYOUT.flatMap((group) => group.hrefs);

  const missing = allHrefs.filter((href) => !layoutHrefs.includes(href));
  if (missing.length > 0) {
    throw new Error(`menuGroupsFor: 그룹에 배치되지 않은 메뉴 항목이 있습니다 — ${missing.join(', ')}`);
  }

  const unknown = layoutHrefs.filter((href) => !allHrefs.includes(href));
  if (unknown.length > 0) {
    throw new Error(`menuGroupsFor: 존재하지 않는 메뉴 항목을 그룹에 배치했습니다 — ${unknown.join(', ')}`);
  }

  const seen = new Set<string>();
  const duplicated = layoutHrefs.filter((href) => (seen.has(href) ? true : (seen.add(href), false)));
  if (duplicated.length > 0) {
    throw new Error(`menuGroupsFor: 같은 메뉴 항목이 두 그룹에 배치됐습니다 — ${duplicated.join(', ')}`);
  }
}

/**
 * 역할과 업무 권한을 반영한 메뉴를 의미 그룹으로 묶어 돌려줍니다.
 *
 * ★ menuFor()/menuForRole() 의 평면 배열은 그대로 둡니다 — auth-policy.test.ts,
 *   permission.test.ts, analysis-tabs.tsx 가 그 반환 형태에 의존합니다.
 * ★ 권한 필터는 그룹 안에서도 그대로 걸립니다(anyOf 없는 항목은 로그인만으로 보임).
 * ★ 필터 후 항목이 0개가 된 그룹은 제목째 숨깁니다 — 빈 그룹 제목은 "권한 없는 무언가가
 *   있다"는 정보 누출입니다(analysis-tabs.tsx:6-8 과 같은 원칙).
 *
 * ★ 배치표 검증(assertMenuGroupLayoutCoversAllItems)은 여기, 호출 시점에만 돕니다.
 *   lib/menu.ts를 import만 하는 다른 코드(auth-policy.test.ts 등)까지 깨뜨리지 않기
 *   위해서입니다 — 그룹화를 실제로 쓰는 경로에서만 실패해야 합니다.
 */
export function menuGroupsFor(role: AppRole, permissions: PermissionSet): MenuGroup[] {
  assertMenuGroupLayoutCoversAllItems();
  const visible = menuFor(role, permissions);
  const byHref = new Map(visible.map((item) => [item.href, item] as const));

  return MENU_GROUP_LAYOUT.map((group) => ({
    label: group.label,
    items: group.hrefs.map((href) => byHref.get(href)).filter((item): item is MenuItem => item !== undefined),
  })).filter((group) => group.items.length > 0);
}
