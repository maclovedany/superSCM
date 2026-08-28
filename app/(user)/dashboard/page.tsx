import PageHeader from '@/components/shell/page-header';
import InsightBanner from '@/components/ui/insight-banner';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';

export default function DashboardPage() {
  return <section className="analysis-page"><PageHeader eyebrow="OVERVIEW" title="전체 현황" description="월간 발주계획과 공급망 분석 화면으로 이동합니다." /><div className="grid grid-3"><KpiCard label="분석 화면" value="2" foot="Lead Time · Stockout Risk" /><KpiCard label="운영 기준월" value="2026.09" foot="월간 발주계획" /><KpiCard label="데이터 상태" value="LIVE" foot="Supabase analytics" status="SAFE" /></div><Panel title="SCM Intelligence" description="공급망 운영 콘솔"><InsightBanner title="분석 결과를 먼저 확인하세요">리드타임 격차와 재고 소진 위험은 왼쪽 USER 메뉴에서 확인할 수 있습니다.</InsightBanner></Panel></section>;
}

