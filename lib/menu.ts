// 메뉴 정의 — 이 파일 한 곳에만 둡니다 (AGENTS.md 규칙 4).
//
// renew.prd 30장의 ADMIN / USER 메뉴 구조입니다.
// ready: false 는 아직 만들지 않은 화면입니다. 숨기지 않고 "예정" 으로 표시합니다.
// 화면이 완성되면 ready 를 true 로 바꿉니다.

import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
  Bell,
  Boxes,
  Database,
  FileClock,
  FlaskConical,
  GitCompare,
  Handshake,
  History,
  KeyRound,
  LayoutDashboard,
  LineChart,
  ListChecks,
  MessageSquare,
  PencilLine,
  PlayCircle,
  ScrollText,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Split,
  Timer,
  TrendingUp,
  Users,
  Waves,
  Factory,
} from 'lucide-react';

export type Role = 'ADMIN' | 'USER';

export type MenuItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** 실제로 동작하는 화면인지. false 면 "예정" 배지가 붙습니다 */
  ready: boolean;
};

export type MenuSection = {
  heading?: string;
  items: MenuItem[];
};

/** renew.prd 30.2 — 일반 사용자 */
export const USER_MENU: MenuSection[] = [
  {
    items: [
      { href: '/dashboard', label: '대시보드', icon: LayoutDashboard, ready: true },
    ],
  },
  {
    heading: '예측',
    items: [
      { href: '/analysis/demand-profile', label: '수요 패턴', icon: Waves, ready: true },
      { href: '/forecast', label: '수요 예측', icon: TrendingUp, ready: true },
      { href: '/model-comparison', label: '모델 비교', icon: GitCompare, ready: true },
      { href: '/machine-forecast', label: '기종 예측', icon: Factory, ready: true },
      { href: '/model-evaluation', label: '모델 평가', icon: FlaskConical, ready: true },
      { href: '/forecast-override', label: '예측 보정', icon: PencilLine, ready: true },
      { href: '/virtual-operation', label: '가상 운영 결과', icon: FlaskConical, ready: true },
    ],
  },
  {
    heading: '재고 · 공급',
    items: [
      { href: '/inventory-projection', label: '재고 전개', icon: Boxes, ready: true },
      { href: '/analysis/stockout', label: '재고 소진 위험', icon: Activity, ready: true },
      { href: '/analysis/leadtime', label: '리드타임 격차', icon: Timer, ready: true },
    ],
  },
  {
    heading: '발주',
    items: [
      { href: '/purchase-recommendation', label: '발주 추천', icon: ShoppingCart, ready: true },
      { href: '/decision-history', label: '결정 이력', icon: History, ready: true },
    ],
  },
  {
    heading: '지원',
    items: [
      { href: '/alerts', label: '알림 센터', icon: Bell, ready: true },
      { href: '/what-if', label: 'What-If', icon: Split, ready: true },
      { href: '/sales', label: '영업 수급 조회', icon: Handshake, ready: true },
      { href: '/agent', label: 'AI Agent', icon: MessageSquare, ready: true },
    ],
  },
];

/** renew.prd 30.1 — 관리자 */
export const ADMIN_MENU: MenuSection[] = [
  {
    heading: '사용자',
    items: [{ href: '/admin/users', label: '사용자 관리', icon: Users, ready: true }],
  },
  {
    heading: '예측 설정',
    items: [
      { href: '/admin/models', label: '예측 모델', icon: LineChart, ready: true },
      { href: '/admin/forecast-settings', label: '예측 기본 설정', icon: SlidersHorizontal, ready: true },
      { href: '/admin/forecast-runs', label: '예측 실행', icon: PlayCircle, ready: true },
      { href: '/admin/model-versions', label: '모델 버전', icon: FileClock, ready: true },
    ],
  },
  {
    heading: 'SCM 정책',
    items: [
      { href: '/admin/policies/leadtime', label: '리드타임', icon: Timer, ready: true },
      { href: '/admin/policies/service-level', label: '서비스 수준', icon: ShieldCheck, ready: true },
      { href: '/admin/policies/safety-stock', label: '안전재고', icon: Boxes, ready: true },
      { href: '/admin/policies/outlier', label: '이상치 규칙', icon: ListChecks, ready: true },
    ],
  },
  {
    heading: '데이터',
    items: [
      { href: '/admin/data/upload', label: '파일 업로드', icon: Database, ready: true },
      { href: '/admin/data/history', label: '적재 이력', icon: History, ready: true },
      { href: '/admin/data/errors', label: '검증 오류', icon: BarChart3, ready: true },
    ],
  },
  {
    heading: 'API · 로그',
    items: [
      { href: '/admin/api/keys', label: 'API Key', icon: KeyRound, ready: true },
      { href: '/admin/api/logs', label: 'API 로그', icon: ScrollText, ready: true },
      { href: '/admin/api/docs', label: 'API 문서', icon: FileClock, ready: true },
      { href: '/admin/logs', label: '시스템 로그', icon: ScrollText, ready: true },
    ],
  },
];

/**
 * 영업 담당자에게 감출 화면 — renew.prd 4.5 의 "✕" 항목만 담은 화면들입니다.
 *
 * 발주 추천 · 승인 · 예측 정확도 지표 · 공급처 상세와 리드타임 통계.
 * 영업 여부는 `core.app_user.department` 로 판정하며, 규칙은
 * `lib/agent/redact.ts` 의 `isSalesDepartment` 한 곳에 있습니다.
 */
const SALES_HIDDEN = new Set<string>([
  '/purchase-recommendation',
  '/decision-history',
  '/model-evaluation',
  '/model-comparison',
  '/analysis/leadtime',
]);

/**
 * 역할별 메뉴.
 *
 * renew.prd 4.2 — ADMIN 은 "모든 USER 기능" 을 포함합니다.
 * 따라서 관리자에게는 사용자 메뉴 뒤에 관리 메뉴를 이어 붙입니다.
 */
export function menuFor(role: Role, isSales = false): MenuSection[] {
  const sections = role === 'ADMIN' ? [...USER_MENU, ...ADMIN_MENU] : USER_MENU;
  if (!isSales) return sections;

  // 영업에게는 renew.prd 4.5 가 ✕ 로 표시한 화면을 아예 보여주지 않습니다.
  // 메뉴에서 감추는 것은 3중 방어의 첫 번째 층일 뿐입니다 — 화면(서버 컴포넌트)과
  // DB 가 각각 다시 막습니다. 메뉴만 감추면 URL 을 직접 치는 사람에게는 소용없습니다.
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !SALES_HIDDEN.has(item.href)),
    }))
    .filter((section) => section.items.length > 0);
}

/** 현재 경로에 해당하는 메뉴 항목을 찾습니다. 가장 긴 일치가 이깁니다. */
export function findActive(sections: MenuSection[], pathname: string): MenuItem | null {
  let best: MenuItem | null = null;
  for (const section of sections) {
    for (const item of section.items) {
      const hit = pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (hit && (best === null || item.href.length > best.href.length)) best = item;
    }
  }
  return best;
}
