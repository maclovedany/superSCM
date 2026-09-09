import AnalysisFrame from '@/components/analysis/analysis-frame';
import NoRealDataNotice from '@/components/analysis/no-realdata-notice';

export const dynamic = 'force-dynamic';

export default function StockoutPage() {
  return (
    <AnalysisFrame
      title="재고 소진 위험"
      description="가용재고와 사용량으로 소진 시점을 봅니다. 실데이터에는 아직 재고 스냅샷이 없습니다."
    >
      <NoRealDataNotice
        what="재고 소진 위험"
        missing={['월말 재고 스냅샷 (시계열)', '공급처별 Lead time', 'MOQ 마스터']}
        unlocks={['재고 소진 예측 (v_inventory_projection)', '안전재고 산출 (v_safety_stock)', '발주 권고 (v_purchase_recommendation)']}
      />
    </AnalysisFrame>
  );
}
