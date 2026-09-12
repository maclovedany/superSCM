import type { ReactNode } from 'react';
import Sidebar from '@/components/shell/sidebar';
import Topbar from '@/components/shell/topbar';
import { getPermissions, requireAdmin } from '@/lib/auth';
import { resolveBaseMonthDisplay } from '@/lib/kpi/model';
import { getCurrentPlanningCycle } from '@/lib/kpi/repository';
import { getPracticeCycleIds } from '@/lib/practice/repository';

// ★ Task 12 — 관리자 화면도 같은 Sidebar · Topbar를 쓰므로 같은 출처(analytics.v_current_planning_cycle)를
//   내려준다. 관리자 메뉴 자체는 이 값과 무관하다.
// ★ fix round 1 — app/(user)/layout.tsx와 같은 이유로 error를 버리지 않고 resolveBaseMonthDisplay로
//   "취합 주기 없음"과 "조회 실패"를 구분한다.
// ★ Task 15 fix round 1(C2-1) — 실습 취합 주기면 기준월 옆에 '실습'을 함께 보여준다(사용자 화면과 동일).
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireAdmin();
  const permissions = await getPermissions();
  const [{ cycle, error }, practiceCycleIds] = await Promise.all([getCurrentPlanningCycle(), getPracticeCycleIds()]);
  const baseMonth = resolveBaseMonthDisplay(cycle, error);
  const practiceCycle = cycle?.cycleId !== null && cycle?.cycleId !== undefined && practiceCycleIds.has(cycle.cycleId);
  return <div className="app-shell"><Sidebar role={profile.role} permissionCodes={permissions.list()} baseMonth={baseMonth} practiceCycle={practiceCycle} /><main className="main"><Topbar name={profile.name || profile.email} role={profile.role} baseMonth={baseMonth} practiceCycle={practiceCycle} /><div className="content">{children}</div></main></div>;
}
