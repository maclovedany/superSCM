import PageHeader from '@/components/shell/page-header';
import InventoryPerformanceTable from '@/components/analysis/inventory-performance-table';
import EmptyValue from '@/components/ui/empty-value';
import KpiCard from '@/components/ui/kpi-card';
import PracticeDataBanner from '@/components/ui/practice-banner';
import { requireAnyPermission } from '@/lib/auth';
import { WORK_ROUTE_PERMISSIONS } from '@/lib/permission';
import { formatBaseMonthDotted } from '@/lib/kpi/model';
import { getCurrentPlanningCycle, getInventoryPerformance, getInventoryPerformanceKpi } from '@/lib/kpi/repository';
import { showsPracticeBanner } from '@/lib/practice/model';
import { getPracticeDataStatus } from '@/lib/practice/repository';

export const dynamic = 'force-dynamic';

// ★ Task 12 — Forecast WAPE·Bias(analysis/model-comparison)와는 별도 화면이다(컨트롤러 판정 6).
//   기준월은 analytics.v_current_planning_cycle(진행 중인 취합 주기)에서 읽는다 — 활성 주기가
//   없으면 조회 자체를 생략하고 PLANNING_CYCLE_NOT_OPEN을 보여준다(0건 조회를 오류로 착각하지
//   않도록 AGENTS.md 3번 — 조회 오류와 빈 결과를 구분한다).
// ★ Task 15 — 이 화면은 STOCK_VIEW_ALL(SCM팀)만 보고 전체 품목을 다루므로, 실습 재고가 있으면
//   그대로 이 합계에 들어간다. 그래서 품목별 교집합이 아니라 현황(affects_month_end_kpi)으로
//   판단해도 거짓 경고가 생기지 않는다.
export default async function InventoryPerformancePage() {
  await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/analysis/inventory-performance']);

  const { cycle, error: cycleError } = await getCurrentPlanningCycle();
  const baseMonth = cycle?.planMonth ?? null;
  const [{ rows, error: rowsError }, { kpi, error: kpiError }, { status: practiceStatus }] = await Promise.all([
    getInventoryPerformance(baseMonth),
    getInventoryPerformanceKpi(baseMonth),
    getPracticeDataStatus(),
  ]);
  const error = cycleError ?? rowsError ?? kpiError;
  const showPractice = showsPracticeBanner(practiceStatus, 'MONTH_END_KPI');

  return (
    <section className="analysis-page">
      <PageHeader
        title="월말 재고 성과"
        description="승인된 목표재고 · 단가 대비 월말 재고수량 · 금액을 봅니다. Forecast 정확도(OL 예측 정확도)와는 별도 지표입니다."
      />
      <div className="analysis-content">
        {showPractice && practiceStatus !== null ? <PracticeDataBanner status={practiceStatus} /> : null}
        {error ? (
          <div className="card">
            <p className="text-danger">조회에 실패했습니다.</p>
            <p className="muted">{error}</p>
          </div>
        ) : baseMonth === null ? (
          <div className="card">
            <p className="muted">
              진행 중인 취합 주기가 없습니다 — <EmptyValue reasonCode="PLANNING_CYCLE_NOT_OPEN" />
              . 발주계획 화면에서 이번 달 취합 주기를 먼저 여세요.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-3">
              <KpiCard label="기준월" value={formatBaseMonthDotted(baseMonth)} />
              <KpiCard
                label="월말 재고수량 합계"
                value={kpi === null || kpi.totalActualQty === null ? <EmptyValue reasonCode="MONTH_END_SNAPSHOT_MISSING" /> : `${kpi.totalActualQty.toLocaleString('ko-KR')} EA`}
                foot={kpi ? `스냅샷 있음 ${kpi.nQtyAvailable} · 없음 ${kpi.nMonthEndSnapshotMissing} · 미분류 ${kpi.nInventoryScopeUnclassified}` : undefined}
              />
              <KpiCard
                label="월말 재고금액 합계"
                value={kpi === null || kpi.totalActualValue === null ? <EmptyValue reasonCode="UNIT_PRICE_UNSET" /> : `${kpi.totalActualValue.toLocaleString('ko-KR')}원`}
                foot={kpi ? `금액 있음 ${kpi.nValueAvailable} · 단가 미승인 제외 ${kpi.nUnitPriceUnset}` : undefined}
              />
            </div>
            <div className="section card">
              <div className="card-title">
                <div>
                  <h3>품목별 월말 재고 성과</h3>
                  <span>실제 수량은 이 달 안에서 가장 최근인 NORMAL 분류 스냅샷만 씁니다.</span>
                </div>
                <span className="muted">{rows.length.toLocaleString('ko-KR')}품목</span>
              </div>
              <InventoryPerformanceTable rows={rows} />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
