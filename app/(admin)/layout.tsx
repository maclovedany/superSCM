import type { ReactNode } from 'react';
import Sidebar from '@/components/shell/sidebar';
import Topbar from '@/components/shell/topbar';
import { getPermissions, requireAdmin } from '@/lib/auth';
import { resolveBaseMonthDisplay } from '@/lib/kpi/model';
import { getCurrentPlanningCycle } from '@/lib/kpi/repository';

// ★ Task 12 — 관리자 화면도 같은 Sidebar · Topbar를 쓰므로 같은 출처(analytics.v_current_planning_cycle)를
//   내려준다. 관리자 메뉴 자체는 이 값과 무관하다.
// ★ fix round 1 — app/(user)/layout.tsx와 같은 이유로 error를 버리지 않고 resolveBaseMonthDisplay로
//   "취합 주기 없음"과 "조회 실패"를 구분한다.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireAdmin();
  const permissions = await getPermissions();
  const { cycle, error } = await getCurrentPlanningCycle();
  const baseMonth = resolveBaseMonthDisplay(cycle, error);
  return <div className="app-shell"><Sidebar role={profile.role} permissionCodes={permissions.list()} baseMonth={baseMonth} /><main className="main"><Topbar name={profile.name || profile.email} role={profile.role} baseMonth={baseMonth} /><div className="content">{children}</div></main></div>;
}
