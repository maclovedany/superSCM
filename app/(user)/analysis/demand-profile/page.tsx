import AnalysisFrame from '@/components/analysis/analysis-frame';
import DemandProfileTable from '@/components/analysis/demand-profile-table';
import KpiCard from '@/components/ui/kpi-card';
import { getItemDemandKpi, getItemDemandProfiles } from '@/lib/scm';

export const dynamic = 'force-dynamic';

const TITLE = '수요 패턴';
const DESCRIPTION = '출고 실적으로 품목의 수요 성격을 분류합니다. 관측 6개월 미만은 유형을 추정하지 않습니다.';

export default async function DemandProfilePage() {
  const [{ rows, error }, { rows: kpiRows }] = await Promise.all([getItemDemandProfiles(), getItemDemandKpi()]);

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

  const croston = kpiRows.reduce((sum, row) => sum + row.nCrostonCandidate, 0);
  const unknown = kpiRows.reduce((sum, row) => sum + row.nUnknown, 0);
  const dataAsOf = rows.find((row) => row.dataAsOf)?.dataAsOf ?? '—';

  return (
    <AnalysisFrame title={TITLE} description={DESCRIPTION}>
      <div className="grid grid-4">
        <KpiCard label="분석 품목" value={rows.length.toLocaleString('ko-KR')} foot="출고 실적이 있는 품목" />
        <KpiCard label="Croston 후보" value={croston.toLocaleString('ko-KR')} foot="INTERMITTENT · LUMPY" status="WARNING" />
        <KpiCard label="유형 판정 불가" value={unknown.toLocaleString('ko-KR')} foot="관측 기간 부족" status="CALCULATION_UNAVAILABLE" />
        <KpiCard label="데이터 기준월" value={dataAsOf} foot="출고 실적 최종월" status="SAFE" />
      </div>
      <DemandProfileTable rows={rows} />
    </AnalysisFrame>
  );
}
