// 발주 일정 — Task 10b
//
// ★ 공급처 출항일 · 발주 · 입고일은 core.build_procurement_schedule이 계산해 저장한다. 이 화면은
//   analytics.v_procurement_schedule을 그대로 보여주고 다시 계산하지 않는다.
// ★ Task 15 fix round 1 (C2-2) — 수업에서 걷는 마지막 단계이고 발주일 · 입고일 · 발주량이 그대로
//   숫자로 나온다. 지금 보이는 행에 실습 품목이 섞여 있으면 배너를 띄운다.

import PageHeader from '@/components/shell/page-header';
import Panel from '@/components/ui/panel';
import ScheduleTable from '@/components/procurement/schedule-table';
import { BuildScheduleForm } from '@/components/procurement/schedule-actions';
import PracticeDataBanner from '@/components/ui/practice-banner';
import { getPermissions, requireAnyPermission } from '@/lib/auth';
import { WORK_ROUTE_PERMISSIONS } from '@/lib/permission';
import { getApprovedPlanOptions, getProcurementSchedules } from '@/lib/schedule/repository';
import { getPracticeDataStatus, getPracticeItemIds, getPracticePlanIds } from '@/lib/practice/repository';

export const dynamic = 'force-dynamic';

export default async function ProcurementSchedulePage() {
  await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/procurement-plans/schedule']);
  const permissions = await getPermissions();
  const canBuild = permissions.has('PLAN_CONFIRM');

  const [
    { rows: plans, error: plansError },
    { rows: schedules, error: scheduleError },
    practiceItemIds,
    practicePlanIds,
    { status: practiceStatus },
  ] = await Promise.all([
    canBuild ? getApprovedPlanOptions() : Promise.resolve({ rows: [], error: null }),
    getProcurementSchedules(),
    getPracticeItemIds(),
    getPracticePlanIds(),
    getPracticeDataStatus(),
  ]);

  const showPractice =
    practiceStatus !== null &&
    practiceStatus.hasPracticeData &&
    schedules.some(
      (row) =>
        (row.itemId !== null && practiceItemIds.has(row.itemId)) ||
        (row.planId !== null && practicePlanIds.has(row.planId)),
    );

  return (
    <section className="analysis-page">
      <PageHeader
        eyebrow="WORK"
        title="발주 일정"
        description="공급처별 출항일과 해외법인 출항 준비기간으로 발주일 · 입고일을 계산하고, 실제 입고일을 입력해 차이를 추적합니다."
      />
      <div className="analysis-content">
        {showPractice && practiceStatus !== null ? <PracticeDataBanner status={practiceStatus} /> : null}

        {canBuild ? (
          <Panel title="발주 일정 만들기" description="승인된 발주계획의 1개월차 · 최종 발주량이 있는 품목마다 일정을 만듭니다.">
            {plansError ? <p className="text-danger">승인된 발주계획을 조회하지 못했습니다: {plansError}</p> : null}
            <BuildScheduleForm plans={plans} />
          </Panel>
        ) : null}

        <Panel title="일정 목록" description="공급처 매핑 · 출항일 규칙 · 준비기간 · 달력 준비 상태가 없으면 사유와 함께 제외됩니다(조용히 빠지지 않습니다).">
          {scheduleError ? (
            <>
              <p className="text-danger">조회에 실패했습니다.</p>
              <p className="muted">{scheduleError}</p>
            </>
          ) : (
            <ScheduleTable rows={schedules} canRecord={canBuild} />
          )}
        </Panel>
      </div>
    </section>
  );
}
