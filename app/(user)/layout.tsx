import type { ReactNode } from 'react';
import Sidebar from '@/components/shell/sidebar';
import Topbar from '@/components/shell/topbar';
import { getPermissions, requireUser } from '@/lib/auth';
import { resolveBaseMonthDisplay } from '@/lib/kpi/model';
import { getCurrentPlanningCycle } from '@/lib/kpi/repository';
import { getPracticeCycleIds } from '@/lib/practice/repository';

// ★ Task 12 — 운영 기준월을 여기 한 곳에서 한 번만 조회해 Sidebar · Topbar에 같은 값을 내려준다.
//   기준월이 바뀌면(취합 주기 재오픈 등) 두 화면이 항상 같은 값을 보여준다(검증 체크리스트 1번).
// ★ fix round 1(리뷰 반영) — getCurrentPlanningCycle()의 error를 그냥 버리지 않는다. 조회 자체가
//   실패한 경우(RLS 오설정 · 일시 장애 등)를 "취합 주기가 없다"는 업무 상태와 섞으면 사용자가 실제
//   장애를 못 알아챈다 — resolveBaseMonthDisplay가 이 둘을 다른 사유 코드로 구분한다.
// ★ Task 15 fix round 1(C2-1) — 지금 열린 취합 주기가 실습용이면 기준월 옆에 '실습'을 함께 보여준다.
//   기준월은 전역 값이라 모든 화면에 나타나고 월말 KPI · 제출 마감 · 알림이 이 달로 계산되므로,
//   표시가 없으면 실습으로 연 달이 운영 기준월처럼 읽힌다.
export default async function UserLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireUser();
  const permissions = await getPermissions();
  const [{ cycle, error }, practiceCycleIds] = await Promise.all([getCurrentPlanningCycle(), getPracticeCycleIds()]);
  const baseMonth = resolveBaseMonthDisplay(cycle, error);
  const practiceCycle = cycle?.cycleId !== null && cycle?.cycleId !== undefined && practiceCycleIds.has(cycle.cycleId);
  return <div className="app-shell"><Sidebar role={profile.role} permissionCodes={permissions.list()} baseMonth={baseMonth} practiceCycle={practiceCycle} /><main className="main"><Topbar name={profile.name || profile.email} role={profile.role} baseMonth={baseMonth} practiceCycle={practiceCycle} /><div className="content">{children}</div></main></div>;
}
