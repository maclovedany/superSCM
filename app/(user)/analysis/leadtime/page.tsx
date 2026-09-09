import AnalysisFrame from '@/components/analysis/analysis-frame';
import NoRealDataNotice from '@/components/analysis/no-realdata-notice';

export const dynamic = 'force-dynamic';

export default function LeadtimePage() {
  return (
    <AnalysisFrame
      title="리드타임 격차"
      description="계획 리드타임과 실제 소요일을 비교합니다. 실데이터에는 아직 공급처별 리드타임이 없습니다."
    >
      <NoRealDataNotice
        what="리드타임 격차"
        missing={['공급처별 Lead time 마스터', '입고 실적의 공급처 구분', 'Flexibility rule (공급처별)']}
        unlocks={['발주 시점 역산', '계획 대비 실적 격차 (P80)', '공급처별 발주 변경 범위 적용']}
      />
    </AnalysisFrame>
  );
}
