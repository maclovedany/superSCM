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
  { href: '/admin/workflow', label: '발주계획 관리', description: '레거시 업무 플로우', icon: Workflow },
  { href: '/admin/demand', label: '수요 관리', description: '수요 데이터 관리', icon: BarChart3 },
  { href: '/admin/data-management', label: '데이터 관리', description: '파일 적재와 이력 관리', icon: Database },
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
