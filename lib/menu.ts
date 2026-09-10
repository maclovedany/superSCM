import type { LucideIcon } from 'lucide-react';
import { BarChart3, Boxes, Database, Gauge, LineChart, Settings2, Users, Workflow, Bot } from 'lucide-react';

export type MenuItem = { href: string; label: string; description: string; icon: LucideIcon };

export const USER_MENU: MenuItem[] = [
  { href: '/dashboard', label: '전체 현황', description: '월간 발주계획 요약', icon: Gauge },
  { href: '/analysis/demand-profile', label: '수요 패턴', description: '출고 실적 기반 수요 성격 분류', icon: BarChart3 },
  { href: '/analysis/model-comparison', label: 'OL 예측 정확도', description: '영업 OL · SCM OL 의 WAPE 와 Bias', icon: LineChart },
  { href: '/analysis/leadtime', label: '리드타임 격차', description: '실데이터 대기 — 공급처별 Lead time 필요', icon: LineChart },
  { href: '/analysis/stockout', label: '재고 소진 위험', description: '실데이터 대기 — 월말 재고 스냅샷 필요', icon: Boxes },
  { href: '/agent', label: 'AI 비서', description: '검증된 조회 함수로만 답하는 Agent', icon: Bot },
];

export const ADMIN_MENU: MenuItem[] = [
  { href: '/admin/master', label: '마스터', description: '해외법인 · 공급처 · 출항일 · 품목 정책', icon: Boxes },
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
