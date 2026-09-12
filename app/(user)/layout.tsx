import type { ReactNode } from 'react';
import Sidebar from '@/components/shell/sidebar';
import Topbar from '@/components/shell/topbar';
import { getPermissions, requireUser } from '@/lib/auth';
import { resolveBaseMonthDisplay } from '@/lib/kpi/model';
import { getCurrentPlanningCycle } from '@/lib/kpi/repository';

// ★ Task 12 — 운영 기준월을 여기 한 곳에서 한 번만 조회해 Sidebar · Topbar에 같은 값을 내려준다.
//   기준월이 바뀌면(취합 주기 재오픈 등) 두 화면이 항상 같은 값을 보여준다(검증 체크리스트 1번).
// ★ fix round 1(리뷰 반영) — getCurrentPlanningCycle()의 error를 그냥 버리지 않는다. 조회 자체가
//   실패한 경우(RLS 오설정 · 일시 장애 등)를 "취합 주기가 없다"는 업무 상태와 섞으면 사용자가 실제
//   장애를 못 알아챈다 — resolveBaseMonthDisplay가 이 둘을 다른 사유 코드로 구분한다.
export default async function UserLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireUser();
  const permissions = await getPermissions();
  const { cycle, error } = await getCurrentPlanningCycle();
  const baseMonth = resolveBaseMonthDisplay(cycle, error);
  return <div className="app-shell"><Sidebar role={profile.role} permissionCodes={permissions.list()} baseMonth={baseMonth} /><main className="main"><Topbar name={profile.name || profile.email} role={profile.role} baseMonth={baseMonth} /><div className="content">{children}</div></main></div>;
}
