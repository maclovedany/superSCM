// 발주계획 요약 — Task 9b
//
// ★ 합계 · 차단 사유 수는 DB 뷰(v_procurement_plan · v_procurement_plan_kpi · v_procurement_plan_blocker)가 계산한 값을
//   그대로 보여준다. 여기서 더하거나 세지 않는다.

import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import EmptyValue from '@/components/ui/empty-value';
import {
  PLAN_STATUS_LABELS,
  planReasonLabel,
  planStatusTone,
  type PlanConfirmBlocker,
  type ProcurementPlan,
  type ProcurementPlanKpi,
} from '@/lib/procurement/model';

function formatNumber(value: number | null): string | null {
  return value === null ? null : value.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

function Kpi({ label, value, reasonCode, foot }: { label: string; value: number | null; reasonCode: string | null; foot: string }) {
  return (
    <KpiCard
      label={label}
      value={formatNumber(value) ?? <EmptyValue reasonCode={reasonCode ?? 'CALCULATION_UNAVAILABLE'} />}
      foot={foot}
    />
  );
}

export default function PlanSummary({
  plan,
  firstMonthKpi,
  blockers,
}: {
  plan: ProcurementPlan;
  firstMonthKpi: ProcurementPlanKpi | null;
  blockers: PlanConfirmBlocker[];
}) {
  const kpiReason = firstMonthKpi?.kpiReasonCode ?? (firstMonthKpi ? null : 'PLAN_HAS_NO_LINES');
  return (
    <>
      {plan.isFinal ? null : (
        <div className="insight-banner">
          <span className="insight-mark">!</span>
          <div>
            <strong>최종 발주계획이 아닙니다</strong>
            <p>SCM 품목담당자가 확정하고 SCM팀장이 승인한 계획만 최종 발주량으로 씁니다. 현재 상태: {PLAN_STATUS_LABELS[plan.status]}</p>
          </div>
        </div>
      )}

      <div className="grid grid-4 section">
        <KpiCard
          label="상태"
          value={<span className={`tag ${planStatusTone(plan.status)}`}>{PLAN_STATUS_LABELS[plan.status]}</span>}
          foot={`${plan.planMonth.slice(0, 7)} · 버전 ${plan.version}${plan.isLatestApproved ? ' · 최신 승인본' : ''}`}
        />
        <Kpi label="1개월차 최종 발주량 합" value={firstMonthKpi?.totalFinalOrderQty ?? null} reasonCode={kpiReason} foot="MOQ 올림 반영" />
        <Kpi label="1개월차 예상 월말재고 합" value={firstMonthKpi?.totalProjectedMonthEndQty ?? null} reasonCode={kpiReason} foot="계획 기대값" />
        <Kpi label="1개월차 예상 재고금액 합" value={firstMonthKpi?.totalProjectedInventoryValue ?? null} reasonCode={kpiReason} foot="예상 월말재고 × 단가" />
      </div>

      <Panel title="계산 근거" description="계획 생성 시점에 스냅샷한 값입니다. 이후 데이터가 바뀌어도 이 계획은 바뀌지 않습니다.">
        <dl className="order-summary-grid">
          <div><dt>Forecast Run</dt><dd>{plan.forecastRunId ?? <EmptyValue reasonCode="FORECAST_SOURCE_UNVERIFIED" />}</dd></div>
          <div><dt>학습 기간</dt><dd>{plan.forecastTrainStart && plan.forecastTrainEnd ? `${plan.forecastTrainStart} ~ ${plan.forecastTrainEnd}` : <EmptyValue reasonCode="FORECAST_SOURCE_UNVERIFIED" />}</dd></div>
          <div>
            <dt>원천 판정</dt>
            <dd>
              {plan.sourceStatus === 'VERIFIED'
                ? <span className="tag green">검증된 적재 배치</span>
                : <span title={planReasonLabel(plan.sourceStatus) ?? ''}><span className="tag red">{plan.sourceStatus}</span></span>}
            </dd>
          </div>
          <div><dt>품목 · 라인</dt><dd>{plan.nItems}개 · {plan.nLines}개 (계산 불가 {plan.nUnavailableLines}개)</dd></div>
          <div><dt>계산</dt><dd>{plan.builtByName ?? '미상'} · {plan.builtAt ?? '미상'}</dd></div>
          <div><dt>확정</dt><dd>{plan.confirmedByName ? `${plan.confirmedByName} · ${plan.confirmedAt}` : <span className="muted">미확정</span>}</dd></div>
          <div><dt>승인 · 반려</dt><dd>{plan.deciderName ? `${plan.deciderName} · ${plan.decidedAt}` : <span className="muted">없음</span>}</dd></div>
          <div><dt>의견</dt><dd>{plan.decisionComment ?? <span className="muted">없음</span>}</dd></div>
        </dl>
        {plan.sourceStatus !== 'VERIFIED' && plan.sourceStatus ? <p className="text-danger">{planReasonLabel(plan.sourceStatus)} — 모든 라인이 계산 불가입니다.</p> : null}
      </Panel>

      {blockers.length > 0 ? (
        <Panel title="확정 차단 사유" description="이 사유가 모두 없어져야 확정할 수 있습니다. 근거를 고친 뒤 새 버전을 계산하세요.">
          <ul className="order-history">
            {blockers.map((blocker) => (
              <li key={blocker.reasonCode}>
                <div className="order-history-head">
                  <span className="tag red">{blocker.reasonCode}</span>
                  <b>{planReasonLabel(blocker.reasonCode)}</b>
                </div>
                <p>품목 {blocker.itemCount}개 · 라인 {blocker.lineCount}개</p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}
