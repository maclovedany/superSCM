// 발주계획 상세 — Task 9b
//
// ★ 수량 · 합계 · 차단 사유는 모두 analytics 뷰에 저장된 값이다. 확정 · 승인 버튼은 권한과 상태로 보이기만 가르고,
//   실제 허용 여부는 DB 함수가 다시 판정한다.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import PageHeader from '@/components/shell/page-header';
import Panel from '@/components/ui/panel';
import PlanSummary from '@/components/procurement/plan-summary';
import PlanLineTable from '@/components/procurement/plan-line-table';
import { ConfirmPlanForm, PlanDecisionForm } from '@/components/procurement/plan-actions';
import { getPermissions, requireAnyPermission } from '@/lib/auth';
import { WORK_ROUTE_PERMISSIONS } from '@/lib/permission';
import { PLAN_EVENT_LABELS, validatePlanId } from '@/lib/procurement/model';
import {
  getProcurementPlan,
  getProcurementPlanBlockers,
  getProcurementPlanEvents,
  getProcurementPlanKpis,
  getProcurementPlanLines,
} from '@/lib/procurement/repository';

export const dynamic = 'force-dynamic';

function QueryError({ message }: { message: string }) {
  return (
    <>
      <p className="text-danger">조회에 실패했습니다.</p>
      <p className="muted">{message}</p>
    </>
  );
}

export default async function ProcurementPlanDetailPage({ params }: { params: Promise<{ planId: string }> }) {
  const { profile } = await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/procurement-plans']);
  const { planId } = await params;
  if (!validatePlanId(planId).ok) notFound();

  const [permissions, { plan, error: planError }] = await Promise.all([getPermissions(), getProcurementPlan(planId)]);
  if (planError) {
    return (
      <section className="analysis-page">
        <PageHeader eyebrow="WORK" title="발주계획 상세" description="계산 단계별 수량과 확정 · 승인 상태를 확인합니다." />
        <div className="analysis-content"><div className="card"><QueryError message={planError} /></div></div>
      </section>
    );
  }
  if (!plan) notFound();

  const [lines, kpis, blockers, events] = await Promise.all([
    getProcurementPlanLines(planId),
    getProcurementPlanKpis(planId),
    getProcurementPlanBlockers(planId),
    getProcurementPlanEvents(planId),
  ]);

  const canConfirm = permissions.has('PLAN_CONFIRM') && (plan.status === 'DRAFT' || plan.status === 'REJECTED');
  const canDecide = permissions.has('PLAN_APPROVE') && plan.status === 'PENDING_APPROVAL' && plan.approvalId !== null
    && plan.confirmedBy !== profile.userId;

  return (
    <section className="analysis-page">
      <PageHeader
        eyebrow="WORK"
        title={`발주계획 ${plan.planMonth.slice(0, 7)} · v${plan.version}`}
        description="계산 단계별 수량과 입력 스냅샷, 확정 · 승인 상태를 확인합니다."
        action={<Link className="button" href="/procurement-plans">목록</Link>}
      />
      <div className="analysis-content">
        {kpis.error || blockers.error
          ? <div className="card"><QueryError message={kpis.error ?? blockers.error ?? ''} /></div>
          : <PlanSummary plan={plan} firstMonthKpi={kpis.rows.find((kpi) => kpi.monthNo === 1) ?? null} blockers={blockers.rows} />}

        {canConfirm ? (
          <Panel title="확정" description="확정하면 SCM팀장에게 승인을 요청합니다. 승인 전까지는 최종본이 아닙니다.">
            <ConfirmPlanForm planId={plan.planId} />
          </Panel>
        ) : null}

        {canDecide && plan.approvalId ? (
          <Panel title="SCM팀장 승인" description="승인하면 이 계획이 최종 발주계획이 되고 더 이상 바뀌지 않습니다. 반려하면 미확정으로 돌아갑니다.">
            <PlanDecisionForm planId={plan.planId} approvalId={plan.approvalId} />
          </Panel>
        ) : null}

        <Panel title="라인" description="품목 × 1~6개월차. 1개월차 시작재고는 계산 시점 가용재고, 이후는 전월 예상 월말재고입니다.">
          {lines.error ? <QueryError message={lines.error} /> : <PlanLineTable lines={lines.rows} />}
        </Panel>

        <Panel title="이력" description="계산 · 대체 · 확정 차단 · 확정 · 승인 · 반려 이력입니다.">
          {events.error ? <QueryError message={events.error} /> : events.rows.length === 0 ? (
            <p className="muted">이력이 없습니다.</p>
          ) : (
            <ul className="order-history">
              {events.rows.map((event) => (
                <li key={event.eventId}>
                  <div className="order-history-head">
                    <span className="tag gray">{PLAN_EVENT_LABELS[event.eventType] ?? event.eventType}</span>
                    <b>{event.actorName ?? '미상'}</b>
                    <span className="muted">{event.at}</span>
                  </div>
                  {event.comment ? <p>{event.comment}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </section>
  );
}
