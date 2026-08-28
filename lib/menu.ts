import type { LucideIcon } from 'lucide-react';
import { BarChart3, Boxes, Database, Gauge, LineChart, Settings2, Users, Workflow, Bot } from 'lucide-react';

export type MenuItem = { href: string; label: string; description: string; icon: LucideIcon };

export const USER_MENU: MenuItem[] = [
  { href: '/dashboard', label: '전체 현황', description: '월간 발주계획 요약', icon: Gauge },
  { href: '/analysis/leadtime', label: '리드타임 격차', description: '계획과 실제 소요일 비교', icon: LineChart },
  { href: '/analysis/stockout', label: '재고 소진 위험', description: '품목별 재고 위험 확인', icon: Boxes },
  { href: '/analysis/demand-profile', label: '수요 패턴', description: 'SKU Demand Profile', icon: BarChart3 },
];

export const ADMIN_MENU: MenuItem[] = [
  { href: '/admin/users', label: '사용자 관리', description: '계정 권한과 활성 상태 관리', icon: Users },
  { href: '/admin/workflow', label: '발주계획 관리', description: '레거시 업무 플로우', icon: Workflow },
  { href: '/admin/demand', label: '수요 관리', description: '수요 데이터 관리', icon: BarChart3 },
  { href: '/admin/data-management', label: '데이터 관리', description: '파일 적재와 이력 관리', icon: Database },
  { href: '/admin/forecast-models', label: 'Forecast Models', description: '예측 모델 설정 관리', icon: Bot },
  { href: '/admin/forecast-runs', label: 'Forecast Runs', description: '예측 실행 이력 관리', icon: Bot },
  { href: '/admin/settings', label: '시스템 설정', description: '관리자 설정', icon: Settings2 },
];

export type AppRole = 'ADMIN' | 'USER';

export function menuForRole(role: AppRole): MenuItem[] {
  return role === 'ADMIN' ? [...USER_MENU, ...ADMIN_MENU] : USER_MENU;
}
