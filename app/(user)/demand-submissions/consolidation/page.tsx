import Panel from '@/components/ui/panel';
import PageHeader from '@/components/shell/page-header';
import { ApprovedDemandDetailTable, ApprovedDemandMonthlyTable } from '@/components/demand/approved-demand-table';
import { EventDemandRequestForm, SupplyMeetingResultForm } from '@/components/demand/approved-demand-forms';
import { getPermissions, requireAnyPermission } from '@/lib/auth';
import { WORK_ROUTE_PERMISSIONS } from '@/lib/permission';
import { getApprovedDemandDetail, getApprovedDemandMonthly } from '@/lib/demand/repository';

export const dynamic = 'force-dynamic';

export default async function DemandConsolidationPage() {
  // Task 8 fix round 1 — 이 화면은 /demand-submissions의 부모 권한이 아니라 자기 경로 전용 항목을
  // 쓴다. SCM팀장(EVENT_ORDER_APPROVE)은 이벤트 승인 전 문맥 확인을 위해 읽기 전용으로 들어올 수
  // 있지만, 쓰기 폼은 아래 permissions.has(...) 조건이 계속 가린다.
  await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/demand-submissions/consolidation']);
  const permissions = await getPermissions();

  const [{ rows: monthlyRows, error: monthlyError }, { rows: detailRows, error: detailError }] = await Promise.all([
    getApprovedDemandMonthly(),
    getApprovedDemandDetail(),
  ]);

  return (
    <section className="analysis-page">
      <PageHeader
        eyebrow="WORK"
        title="확정 수요 구성"
        description="수주 확정·수급회의 승인·이벤트 승인 세 가지 확정 근거만 발주 수요에 반영합니다. 영업 확률과 미승인 건은 참고용으로만 표시됩니다."
      />
      <div className="analysis-content">
        {permissions.has('SUPPLY_MEETING_INPUT') ? (
          <Panel title="수급회의 결과 입력" description="SCM 품목담당자가 회의 결과를 대신 입력합니다. 팀장 승인 절차 없이 승인 여부 자체가 최종 판단입니다.">
            <SupplyMeetingResultForm />
          </Panel>
        ) : null}

        {permissions.has('DEMAND_CONSOLIDATE') ? (
          <Panel title="이벤트 추가 수요 등록" description="이벤트성 대량 거래는 일반 조정 범위를 벗어날 수 있어 SCM팀장 승인을 받아야 발주 수요에 반영됩니다.">
            <EventDemandRequestForm />
          </Panel>
        ) : null}

        <Panel title="확정 수요 월간 합계" description="발주 계산에 그대로 들어가는 값입니다(analytics.v_approved_demand_monthly).">
          {monthlyError ? (
            <>
              <p className="text-danger">조회에 실패했습니다.</p>
              <p className="muted">{monthlyError}</p>
            </>
          ) : (
            <ApprovedDemandMonthlyTable rows={monthlyRows} />
          )}
        </Panel>

        <Panel title="원천별 상세" description="반영되지 않은 행도 제외 사유와 함께 보여줍니다. 합계는 위 표를 그대로 씁니다(여기서 다시 더하지 않습니다).">
          {detailError ? (
            <>
              <p className="text-danger">조회에 실패했습니다.</p>
              <p className="muted">{detailError}</p>
            </>
          ) : (
            <ApprovedDemandDetailTable rows={detailRows} />
          )}
        </Panel>
      </div>
    </section>
  );
}
