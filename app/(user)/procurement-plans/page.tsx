// 발주계획 목록 — Task 9b
//
// ★ 계산은 core.build_procurement_plan이 하고, 이 화면은 analytics.v_procurement_plan에 저장된 버전 목록만 보여준다.
// ★ Task 15 — 실습용 데이터로 계산된 계획은 행에 '실습용' 태그를 붙인다. 계획 단위로 가리는 이유는,
//   실습 계획이 하나라도 있다고 해서 실데이터로만 만든 다른 계획까지 경고를 달면 거짓 경고가 되기
//   때문이다(거짓 경고는 진짜 경고를 무디게 만든다).

import Link from 'next/link';
import PageHeader from '@/components/shell/page-header';
import Panel from '@/components/ui/panel';
import DataTable, { type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import { BuildPlanForm } from '@/components/procurement/plan-actions';
import { getPermissions, requireAnyPermission } from '@/lib/auth';
import { WORK_ROUTE_PERMISSIONS } from '@/lib/permission';
import { PLAN_STATUS_LABELS, planReasonLabel, planStatusTone, type ProcurementPlan } from '@/lib/procurement/model';
import { getForecastRunOptions, getProcurementPlans } from '@/lib/procurement/repository';
import { getPracticePlanIds } from '@/lib/practice/repository';

export const dynamic = 'force-dynamic';

function planColumns(practicePlanIds: Set<string>): Column<ProcurementPlan>[] {
  return [
    {
      key: 'planMonth', label: '기준월 · 버전',
      render: (plan) => (
        <>
          <Link href={`/procurement-plans/${plan.planId}`}><b>{plan.planMonth.slice(0, 7)}</b> · v{plan.version}</Link>
          {plan.isLatestApproved ? <><br /><span className="tag green">최신 승인본</span></> : null}
          {practicePlanIds.has(plan.planId)
            ? <><br /><span className="tag amber" title="실습용 데이터로 계산된 계획입니다. 실제 실적이 아닙니다.">실습용</span></>
            : null}
        </>
      ),
    },
    {
      key: 'status', label: '상태', align: 'center',
      render: (plan) => <span className={`tag ${planStatusTone(plan.status)}`}>{PLAN_STATUS_LABELS[plan.status]}</span>,
    },
    {
      key: 'sourceStatus', label: 'Forecast 원천', align: 'center',
      render: (plan) => plan.sourceStatus === 'VERIFIED'
        ? <span className="tag green">검증됨</span>
        : <span title={planReasonLabel(plan.sourceStatus) ?? ''}><EmptyValue reasonCode={plan.sourceStatus ?? 'FORECAST_SOURCE_UNVERIFIED'} /></span>,
    },
    { key: 'nItems', label: '품목', align: 'right', render: (plan) => String(plan.nItems) },
    {
      key: 'nUnavailableLines', label: '계산 불가 라인', align: 'right',
      render: (plan) => plan.nUnavailableLines === 0 ? <span className="muted">0</span> : <span className="text-danger">{plan.nUnavailableLines} / {plan.nLines}</span>,
    },
    {
      key: 'confirmable', label: '확정 가능', align: 'center',
      render: (plan) => plan.status === 'DRAFT' || plan.status === 'REJECTED'
        ? (plan.confirmable ? <span className="tag green">가능</span> : <span className="tag red">차단</span>)
        : <span className="muted">—</span>,
    },
    { key: 'builtAt', label: '계산', render: (plan) => <>{plan.builtByName ?? '미상'}<br /><span className="muted">{plan.builtAt ?? ''}</span></> },
  ];
}

export default async function ProcurementPlansPage() {
  await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/procurement-plans']);
  const permissions = await getPermissions();
  const canBuild = permissions.has('PLAN_CONFIRM');

  const [{ rows: plans, error: planError }, runs, practicePlanIds] = await Promise.all([
    getProcurementPlans(),
    canBuild ? getForecastRunOptions() : Promise.resolve({ rows: [], error: null }),
    getPracticePlanIds(),
  ]);

  return (
    <section className="analysis-page">
      <PageHeader
        eyebrow="WORK"
        title="발주계획"
        description="Champion Forecast · 부서 합의 수요 · 승인 추가 수요 · 가용재고 · 품목 정책으로 최종 발주량을 계산하고, 품목담당자 확정과 SCM팀장 승인을 거쳐 최종본을 만듭니다."
      />
      <div className="analysis-content">
        {canBuild ? (
          <Panel title="발주계획 계산" description="기준월을 고르면 1~6개월차 라인을 계산해 새 버전으로 저장합니다.">
            {runs.error ? <p className="text-danger">Forecast Run을 조회하지 못했습니다: {runs.error}</p> : null}
            <BuildPlanForm runs={runs.rows} />
          </Panel>
        ) : null}

        <Panel title="계획 버전" description="승인본은 바뀌지 않습니다. 다시 계산하면 같은 기준월에 새 버전이 생깁니다.">
          {planError ? (
            <>
              <p className="text-danger">조회에 실패했습니다.</p>
              <p className="muted">{planError}</p>
            </>
          ) : (
            <DataTable columns={planColumns(practicePlanIds)} rows={plans} rowKey={(plan) => plan.planId} empty="아직 계산한 발주계획이 없습니다." />
          )}
        </Panel>
      </div>
    </section>
  );
}
