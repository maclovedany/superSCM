import AnalysisFrame from '@/components/analysis/analysis-frame';
import DemandProfileTable from '@/components/analysis/demand-profile-table';
import EmptyValue from '@/components/ui/empty-value';
import KpiCard from '@/components/ui/kpi-card';
import { demandProfileKpiCounts } from '@/lib/demand-profile';
import { getItemDemandKpi, getItemDemandProfiles } from '@/lib/scm';

export const dynamic = 'force-dynamic';

const TITLE = '수요 패턴';
const DESCRIPTION = '출고 실적으로 품목의 수요 성격을 분류합니다. 관측 6개월 미만은 유형을 추정하지 않습니다.';

export default async function DemandProfilePage() {
  const [{ rows, total, error }, { rows: kpiRows }] = await Promise.all([getItemDemandProfiles(), getItemDemandKpi()]);

  if (error) {
    return (
      <AnalysisFrame title={TITLE} description={DESCRIPTION}>
        <div className="card">
          <p className="text-danger">조회에 실패했습니다.</p>
          <p className="muted">{error}</p>
        </div>
      </AnalysisFrame>
    );
  }

  // ★ 세 카드는 모두 집계 뷰 analytics.v_item_demand_kpi 에서 옵니다 — 같은 줄의 수를 서로
  //   다른 것에서 세면 분모가 분자보다 작아집니다. 예전에는 "분석 품목" 만 받아 온 배열의
  //   길이(1,000행에서 잘린 값)였습니다. 합산은 lib/demand-profile.ts 가 합니다.
  const { itemCount, croston, unknown } = demandProfileKpiCounts(kpiRows);
  const dataAsOf = rows.find((row) => row.dataAsOf)?.dataAsOf ?? '—';

  const countOrEmpty = (value: number | null) =>
    value === null ? <EmptyValue reasonCode="COUNT_UNAVAILABLE" /> : value.toLocaleString('ko-KR');

  return (
    <AnalysisFrame title={TITLE} description={DESCRIPTION}>
      <div className="grid grid-4">
        <KpiCard label="분석 품목" value={countOrEmpty(itemCount)} foot="출고 실적이 있는 품목" />
        <KpiCard label="Croston 후보" value={countOrEmpty(croston)} foot="INTERMITTENT · LUMPY" status="WARNING" />
        <KpiCard label="유형 판정 불가" value={countOrEmpty(unknown)} foot="관측 기간 부족" status="CALCULATION_UNAVAILABLE" />
        <KpiCard label="데이터 기준월" value={dataAsOf} foot="출고 실적 최종월" status="SAFE" />
      </div>
      <DemandProfileTable rows={rows} total={total} />
    </AnalysisFrame>
  );
}
