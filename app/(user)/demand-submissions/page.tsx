import Link from 'next/link';
import Panel from '@/components/ui/panel';
import PageHeader from '@/components/shell/page-header';
import SubmissionStatusTable from '@/components/demand/submission-status-table';
import { ClosePlanningCycleForm, OpenPlanningCycleForm, StartSubmissionForm } from '@/components/demand/submission-form';
import { getPermissions, requireAnyPermission } from '@/lib/auth';
import { WORK_ROUTE_PERMISSIONS } from '@/lib/permission';
import { getActivePlanningCycles, getDemandSubmissions } from '@/lib/demand/repository';

export const dynamic = 'force-dynamic';

export default async function DemandSubmissionsPage() {
  const { profile } = await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/demand-submissions']);
  const permissions = await getPermissions();
  const isConsolidator = permissions.has('PLAN_CONFIRM') || permissions.has('DEMAND_CONSOLIDATE') || profile.role === 'ADMIN';
  const canOpenCycle = permissions.has('PLAN_CONFIRM') || profile.role === 'ADMIN';
  const canSeeApprovedDemand = permissions.has('PLAN_CONFIRM') || permissions.has('DEMAND_CONSOLIDATE')
    || permissions.has('SUPPLY_MEETING_INPUT') || profile.role === 'ADMIN';

  const [{ rows: cycles, error: cycleError }, { rows: submissions, error: submissionError }] = await Promise.all([
    getActivePlanningCycles(),
    getDemandSubmissions(),
  ]);

  return (
    <section className="analysis-page">
      <PageHeader
        eyebrow="WORK"
        title="수요 제출"
        description="부서별 월간 수요를 제출·회수·수정하고, SCM팀은 취합 현황과 합의를 확인합니다."
      />
      <div className="analysis-content">
        {cycleError ? (
          <div className="card"><p className="text-danger">취합 주기를 조회하지 못했습니다.</p><p className="muted">{cycleError}</p></div>
        ) : null}

        {canOpenCycle ? (
          <Panel title="취합 주기 열기" description="대상월을 정해 부서 제출을 받습니다. 이미 열린 달은 다시 열 수 없습니다.">
            <OpenPlanningCycleForm />
          </Panel>
        ) : null}

        {canOpenCycle && cycles.length > 0 ? (
          <Panel title="열린 취합 주기" description="더 이상 받지 않을 달은 닫습니다. 닫은 뒤에도 이력은 남고, 같은 달을 다시 열 수 있습니다.">
            <ul className="order-history">
              {cycles.map((cycle) => (
                <li key={cycle.cycleId} className="order-history-head">
                  <span>{cycle.planMonth.slice(0, 7)} · 마감 {cycle.submissionDeadline}</span>
                  <ClosePlanningCycleForm cycleId={cycle.cycleId} planMonth={cycle.planMonth.slice(0, 7)} />
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {canSeeApprovedDemand ? (
          <Panel
            title="확정 수요 구성"
            description="수주 확정·수급회의 승인·이벤트 승인만 발주 수요에 반영합니다. 부서 제출 수량 자체는 여기서 집계하지 않습니다."
            action={<Link href="/demand-submissions/consolidation" className="button">확정 수요 구성 열기</Link>}
          >
            <p className="muted">
              부서 제출은 합의(AGREED)까지가 이 화면의 범위입니다. 발주 계산에 실제로 들어가는 확정 수요는
              별도 화면에서 원천별로 확인합니다.
            </p>
          </Panel>
        ) : null}

        {permissions.has('DEMAND_SUBMIT') ? (
          <Panel title="이번 달 수요 작성" description="열린 취합 주기 중 대상월을 골라 작성을 시작하거나 이어서 작성합니다.">
            <StartSubmissionForm cycles={cycles} />
          </Panel>
        ) : null}

        <Panel
          title={isConsolidator ? 'SCM 취합 현황' : '내 부서 제출 이력'}
          description="제출 여부·오류 건수·마지막 수정자와 시각을 한 화면에서 확인합니다."
        >
          {submissionError ? (
            <>
              <p className="text-danger">조회에 실패했습니다.</p>
              <p className="muted">{submissionError}</p>
            </>
          ) : (
            <SubmissionStatusTable rows={submissions} />
          )}
        </Panel>
      </div>
    </section>
  );
}
