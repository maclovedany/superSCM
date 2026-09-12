// Task 15 fix round 2 — 이 화면만 실습 데이터와 무관하다. core.model_config는 STEP 6 마이그레이션이
// 적용될 때 바로 채워지는 registry(등록된 SQL Baseline 모델 5개)라서 실습 여부를 가릴 필요가 없다.

import PageHeader from '@/components/shell/page-header';
import DataTable, { type Column } from '@/components/ui/data-table';
import ForecastPipelineNote from '@/components/admin/forecast-pipeline-note';
import { requireAdmin } from '@/lib/auth';
import { getForecastModelConfigs } from '@/lib/scm';
import type { ForecastModelConfig } from '@/lib/scm-model';

export const dynamic = 'force-dynamic';

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

const columns: Column<ForecastModelConfig>[] = [
  { key: 'modelId', label: '모델 ID', render: (row) => <code>{row.modelId}</code> },
  { key: 'modelName', label: '이름' },
  { key: 'family', label: '계열', align: 'center', render: (row) => <span className="tag gray">{row.family}</span> },
  { key: 'engine', label: '엔진', align: 'center', render: (row) => <span className="tag blue">{row.engine}</span> },
  { key: 'version', label: '버전', align: 'center' },
  { key: 'enabled', label: '사용', align: 'center', render: (row) => row.enabled ? <span className="tag green">사용</span> : <span className="tag gray">중지</span> },
  { key: 'isDefault', label: '기준 모델', align: 'center', render: (row) => row.isDefault ? <span className="tag amber">기준</span> : null },
  {
    key: 'applicableDemandType', label: '적용 수요 유형',
    render: (row) => row.applicableDemandType.length === 0 ? <span className="muted">—</span> : row.applicableDemandType.join(' · '),
  },
  {
    key: 'parameters', label: '파라미터',
    render: (row) => Object.keys(row.parameters).length === 0 ? <span className="muted">—</span> : <code>{JSON.stringify(row.parameters)}</code>,
  },
  { key: 'description', label: '설명', render: (row) => row.description ?? <span className="muted">—</span> },
  { key: 'updatedAt', label: '갱신일', render: (row) => formatDateTime(row.updatedAt) },
];

export default async function ForecastModelsPage() {
  await requireAdmin();
  const { rows, error } = await getForecastModelConfigs();

  return (
    <section className="analysis-page">
      <PageHeader eyebrow="ADMIN" title="Forecast Models" description="예측 모델 registry 입니다." />
      <div className="analysis-content">
        <ForecastPipelineNote variant="registry" />

        {error ? (
          <div className="card">
            <p className="text-danger">조회에 실패했습니다.</p>
            <p className="muted">{error}</p>
          </div>
        ) : (
          <div className="section card">
            <div className="card-title">
              <div>
                <h3>모델 registry</h3>
                <span>core.model_config를 그대로 보여줍니다. INTERMITTENT · LUMPY 수요 유형은 STEP 8
                  Croston 계열 엔진이 registry에 연결될 때까지 적용 모델이 없습니다.</span>
              </div>
            </div>
            <DataTable columns={columns} rows={rows} rowKey={(row) => row.modelId} empty="등록된 예측 모델이 없습니다." />
          </div>
        )}
      </div>
    </section>
  );
}
