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
// ★ Task 15 fix round 1(C2-1) — 기준월은 전역 값이라 모든 화면 · 모든 사용자에게 보이고, 월말 재고
//   KPI · 제출 마감 · 반복 알림이 이 달을 기준으로 계산된다. 실습으로 연 취합 주기라면 그 사실이
//   기준월 옆에 반드시 함께 보여야 한다 — 그러지 않으면 실습 달이 운영 기준월처럼 읽힌다.
export default function Topbar({ name, role, baseMonth, practiceCycle = false }: { name: string; role: AppRole; baseMonth: BaseMonthDisplay; practiceCycle?: boolean }) {
  const initials = name.trim().slice(0, 2).toUpperCase() || 'SC';
  const formatted = formatBaseMonthDotted(baseMonth.planMonth);
  return <header className="topbar"><div><div className="eyebrow">SCM INTELLIGENCE</div><h1>공급망 운영 콘솔</h1></div><div className="top-meta"><span className="local-badge">{role}</span><span>기준월 <b><BaseMonthValue formatted={formatted} reasonCode={baseMonth.reasonCode} /></b>{practiceCycle ? <> <span className="tag amber" title="실습용으로 연 취합 주기입니다. 이 기준월의 숫자는 실제 실적이 아닙니다.">실습</span></> : null}</span><button className="icon-button" type="button" aria-label="알림"><Bell size={16} /></button><button className="icon-button" type="button" aria-label="변경 이력"><History size={16} /></button><span className="avatar" title={name}>{initials}</span><form action={logoutAction}><button className="icon-button" type="submit" aria-label="로그아웃"><LogOut size={16} /></button></form></div></header>;
}
