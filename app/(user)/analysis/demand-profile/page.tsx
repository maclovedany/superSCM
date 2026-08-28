import AnalysisFrame from '@/components/analysis/analysis-frame';
import DemandProfileTable from '@/components/analysis/demand-profile-table';
import { getDemandProfiles } from '@/lib/scm';

export const dynamic = 'force-dynamic';

export default async function DemandProfilePage() {
  const { rows, error } = await getDemandProfiles();
  if (error) return <AnalysisFrame title="SKU Demand Profile" description="학습 기간 수요 특성을 분석합니다."><div className="card"><p className="text-danger">조회에 실패했습니다.</p><p className="muted">{error}</p></div></AnalysisFrame>;
  return <AnalysisFrame title="SKU Demand Profile" description="학습 구간만 사용한 SKU 수요 패턴입니다. 검증 Actual은 포함하지 않습니다.">
    <DemandProfileTable rows={rows} />
  </AnalysisFrame>;
}
