import PageHeader from '@/components/shell/page-header';
import InsightBanner from '@/components/ui/insight-banner';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import BaseMonthValue from '@/components/ui/base-month-value';
import PracticeDataBanner from '@/components/ui/practice-banner';
import ShipmentRollupChart from '@/components/charts/shipment-rollup-chart';
import { getShipmentMonthlyRollup } from '@/lib/analytics/repository';
import { formatBaseMonthDotted } from '@/lib/kpi/model';
import { getDashboardSummary } from '@/lib/kpi/repository';
import { showsPracticeBanner } from '@/lib/practice/model';
import { getPracticeDataStatus } from '@/lib/practice/repository';

export const dynamic = 'force-dynamic';

// ★ Task 12 — 운영 기준월은 하드코딩("2026.09")이 아니라 analytics.v_current_planning_cycle에서
//   읽는다(topbar · sidebar와 같은 출처, layout.tsx가 함께 내려준다 — 여기서는 다시 조회한다).
//   수요 제출 · 승인 대기 · 배정 부족 · 발주계획 상태는 저장된 뷰 값을 그대로 보여줄 뿐 이 화면은
//   집계하지 않는다(컨트롤러 판정 4). Forecast WAPE·Bias는 별도 분석 화면(OL 예측 정확도)의 몫이라
//   여기 KPI 카드에 합치지 않는다(컨트롤러 판정 6).
// ★ fix round 1(리뷰 반영) — summary.planningCycleReasonCode는 getDashboardSummary가
//   resolveBaseMonthDisplay로 이미 "조회 실패"(PLANNING_CYCLE_LOOKUP_FAILED)와 "취합 주기 없음"
//   (PLANNING_CYCLE_NOT_OPEN)을 구분해 둔 값이다. BaseMonthValue가 그 구분을 그대로 반영한다 —
//   이전에는 baseMonth가 null이면 항상 PLANNING_CYCLE_NOT_OPEN으로 표시해, 조회가 실제로
//   실패했을 때도 "SCM이 아직 안 열었나 보다"로 보였다.
export default async function DashboardPage() {
  const [summary, { status: practiceStatus }, { rows: rollupRows, error: rollupError }] = await Promise.all([
    getDashboardSummary(),
    getPracticeDataStatus(),
    getShipmentMonthlyRollup(),
  ]);
  const baseMonth = formatBaseMonthDotted(summary.baseMonth);
  // ★ Task 15 — 대시보드는 재고 · 발주계획 · 월말 재고 요약을 한 화면에 모으므로, 그중 하나라도
  //   실습 데이터의 영향을 받으면 배너를 띄운다.
  const showPractice = showsPracticeBanner(practiceStatus, 'DASHBOARD');

  return (
    <section className="analysis-page">
      <PageHeader eyebrow="OVERVIEW" title="전체 현황" description="출고 실적 기반 분석 화면으로 이동합니다." />
      {showPractice && practiceStatus !== null ? <PracticeDataBanner status={practiceStatus} /> : null}
      <div className="grid grid-3">
        <KpiCard label="분석 화면" value="2" foot="수요 패턴 · OL 예측 정확도" />
        <KpiCard
          label="운영 기준월"
          value={<BaseMonthValue formatted={baseMonth} reasonCode={summary.planningCycleReasonCode} />}
          foot={summary.planningCycleStatus ? `취합 주기 ${summary.planningCycleStatus}` : '진행 중인 취합 주기 없음'}
        />
        <KpiCard label="데이터 상태" value="LIVE" foot="Supabase analytics" status="SAFE" />
      </div>
      <div className="grid grid-4">
        <KpiCard
          label="수요 제출"
          value={baseMonth === null ? <BaseMonthValue formatted={null} reasonCode={summary.planningCycleReasonCode} /> : `${summary.demandSubmittedCount} / ${summary.demandTotalCount}`}
          foot="제출 완료(부서) / 전체 부서"
        />
        <KpiCard label="승인 대기" value={summary.pendingApprovalCount} foot="내가 처리할 수 있는 PENDING 승인" />
        <KpiCard label="배정 부족" value={summary.allocationShortageItemCount} foot="부족수량이 남은 품목 수" status={summary.allocationShortageItemCount > 0 ? 'WARNING' : 'SAFE'} />
        <KpiCard
          label="발주계획 상태"
          value={summary.procurementPlanStatus ?? '미생성'}
          foot={
            summary.procurementPlanStatus === null
              ? '이 기준월 발주계획이 아직 없음'
              : summary.procurementPlanIsFinal
                ? '승인 완료 · 최종본'
                : summary.procurementPlanConfirmable
                  ? '확정 가능'
                  : '미확정'
          }
        />
      </div>
      {/* ★ 출고 월별 추이는 raw.fact_shipment 기반 실데이터다(실습 품목 11개는 이 뷰에 없다).
          조회 실패와 빈 결과를 구분한다(AGENTS.md 3번) — 차트는 값이 없으면 빈 축 대신 문장을 보인다. */}
      <Panel title="출고 월별 추이" description="품목 구분별 누적 출고량과 전체 합계 — analytics.v_shipment_monthly_rollup">
        {rollupError ? (
          <p className="text-danger">출고 월별 집계를 불러오지 못했습니다: {rollupError}</p>
        ) : (
          <ShipmentRollupChart rows={rollupRows} />
        )}
      </Panel>

      <Panel title="SCM Intelligence" description="공급망 운영 콘솔">
        <InsightBanner title="분석 결과를 먼저 확인하세요">
          수요 패턴과 OL 예측 정확도는 왼쪽 USER 메뉴에서 확인할 수 있습니다. 월말 재고 성과는{' '}
          <b>분석 → 월말 재고 성과</b> 화면에서 확인할 수 있습니다.
          {summary.error ? <><br /><span className="text-danger">일부 요약을 불러오지 못했습니다: {summary.error}</span></> : null}
        </InsightBanner>
      </Panel>
    </section>
  );
}

