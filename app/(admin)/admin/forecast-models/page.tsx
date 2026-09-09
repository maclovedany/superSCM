import PageHeader from '@/components/shell/page-header';
import ForecastModelManagement from '@/components/admin/forecast-model-management';
import Panel from '@/components/ui/panel';
import { getForecastModels } from '@/lib/scm';

export const dynamic = 'force-dynamic';

export default async function ForecastModelsPage() {
  const { rows, error } = await getForecastModels();
  return <section className="analysis-page"><PageHeader eyebrow="ADMIN" title="Forecast Models" description="SQL Baseline 모델의 적용 범위와 실행 상태를 관리합니다." /><Panel title="Model Registry" description="변경 사항은 다음 Forecast Run부터 적용됩니다.">{error ? <><p className="text-danger">모델 목록을 조회하지 못했습니다.</p><p className="muted">{error}</p></> : <ForecastModelManagement rows={rows} />}</Panel></section>;
}
