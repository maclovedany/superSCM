import type { ReactNode } from 'react';
import Sidebar from '@/components/shell/sidebar';
import Topbar from '@/components/shell/topbar';
import { getPermissions, requireUser } from '@/lib/auth';
import { getCurrentPlanningCycle } from '@/lib/kpi/repository';

// ★ Task 12 — 운영 기준월을 여기 한 곳에서 한 번만 조회해 Sidebar · Topbar에 같은 값을 내려준다.
//   기준월이 바뀌면(취합 주기 재오픈 등) 두 화면이 항상 같은 값을 보여준다(검증 체크리스트 1번).
//   activeCycle이 없으면 baseMonth는 null이며 각 컴포넌트가 사유 코드를 보여준다.
export default async function UserLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireUser();
  const permissions = await getPermissions();
  const { cycle } = await getCurrentPlanningCycle();
  return <div className="app-shell"><Sidebar role={profile.role} permissionCodes={permissions.list()} cycle={cycle} /><main className="main"><Topbar name={profile.name || profile.email} role={profile.role} cycle={cycle} /><div className="content">{children}</div></main></div>;
}
