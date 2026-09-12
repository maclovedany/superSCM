import { Bell, History, LogOut } from 'lucide-react';
import type { AppRole } from '@/lib/menu';
import { logoutAction } from '@/lib/auth-actions';
import { formatBaseMonthDotted, type BaseMonthDisplay } from '@/lib/kpi/model';
import BaseMonthValue from '@/components/ui/base-month-value';

// ★ Task 12 — 하드코딩된 "2026.09"를 analytics.v_current_planning_cycle(진행 중인 취합 주기)로
//   교체한다. 활성 주기가 없으면 숫자를 지어내지 않고 사유 코드를 보여준다(AGENTS.md 5번).
//   레거시 프로토타입(components/procurement-app.tsx)은 이 변경 대상이 아니다.
// ★ fix round 1(리뷰 반영) — baseMonth는 layout.tsx가 resolveBaseMonthDisplay로 이미 "조회 실패"와
//   "취합 주기 없음"을 구분해 만든 값이다. BaseMonthValue가 그 구분을 그대로 화면에 반영한다.
export default function Topbar({ name, role, baseMonth }: { name: string; role: AppRole; baseMonth: BaseMonthDisplay }) {
  const initials = name.trim().slice(0, 2).toUpperCase() || 'SC';
  const formatted = formatBaseMonthDotted(baseMonth.planMonth);
  return <header className="topbar"><div><div className="eyebrow">SCM INTELLIGENCE</div><h1>공급망 운영 콘솔</h1></div><div className="top-meta"><span className="local-badge">{role}</span><span>기준월 <b><BaseMonthValue formatted={formatted} reasonCode={baseMonth.reasonCode} /></b></span><button className="icon-button" type="button" aria-label="알림"><Bell size={16} /></button><button className="icon-button" type="button" aria-label="변경 이력"><History size={16} /></button><span className="avatar" title={name}>{initials}</span><form action={logoutAction}><button className="icon-button" type="submit" aria-label="로그아웃"><LogOut size={16} /></button></form></div></header>;
}
