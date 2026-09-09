import PageHeader from '@/components/shell/page-header';
import InsightBanner from '@/components/ui/insight-banner';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';

export default function DashboardPage() {
  return <section className="analysis-page"><PageHeader eyebrow="OVERVIEW" title="전체 현황" description="출고 실적 기반 분석 화면으로 이동합니다." /><div className="grid grid-3"><KpiCard label="분석 화면" value="2" foot="수요 패턴 · OL 예측 정확도" /><KpiCard label="운영 기준월" value="2026.09" foot="월간 발주계획" /><KpiCard label="데이터 상태" value="LIVE" foot="Supabase analytics" status="SAFE" /></div><Panel title="SCM Intelligence" description="공급망 운영 콘솔"><InsightBanner title="분석 결과를 먼저 확인하세요">수요 패턴과 OL 예측 정확도는 왼쪽 USER 메뉴에서 확인할 수 있습니다. 재고·리드타임은 실데이터에 아직 입력이 없습니다.</InsightBanner></Panel></section>;
}

