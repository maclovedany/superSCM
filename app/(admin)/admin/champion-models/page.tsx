// Task 15 fix round 2 — Champion은 Backtest 실행에 매달려 있으므로(core.champion_model_selection.
// backtest_run_id) 실습 여부도 그 Backtest 실행 id로 판단한다. b2ee554 이관 당시엔 비어 있던 표라
// NoRealDataNotice만 보여줬지만, STEP 7 core.run_backtest가 실제 선정 이력을 남긴 지금은 그 말이
// 사실이 아니다.

import PageHeader from '@/components/shell/page-header';
import DataTable, { type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import ForecastPipelineNote from '@/components/admin/forecast-pipeline-note';
import { requireAdmin } from '@/lib/auth';
import { getChampionModels } from '@/lib/scm';
import { getPracticeBacktestRunIds } from '@/lib/practice/repository';
import type { ChampionModel } from '@/lib/scm-model';

export const dynamic = 'force-dynamic';

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

// fix round 1 — Bias · RMSE · MAE도 WAPE · MAPE와 같은 규칙(null은 EmptyValue + 사유 코드)을 따른다.
// 다섯 지표 모두 core.run_backtest의 NO_VALID_CANDIDATE 경로에서 함께 null이 될 수 있다. 그래서
// 이 두 포맷 함수는 null을 받지 않는다 — 호출부(컬럼 render)가 먼저 null을 걸러낸다.
function formatMetric(value: number): string {
  return value.toLocaleString('ko-KR', { maximumFractionDigits: 3 });
}

function formatWape(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export default async function ChampionModelsPage() {
  await requireAdmin();
  const [{ rows, error }, practiceRunIds] = await Promise.all([getChampionModels(), getPracticeBacktestRunIds()]);

  const columns: Column<ChampionModel>[] = [
    {
      key: 'itemId', label: '품목',
      render: (row) => (
        <>
          <code>{row.itemId}</code>
          {practiceRunIds.has(row.backtestRunId) ? <> <span className="tag amber" title="실습용 데이터 묶음의 Backtest 실행이 선정했습니다. 실제 실적이 아닙니다.">실습용</span></> : null}
        </>
      ),
    },
    {
      key: 'championModelId', label: '선정 모델',
      render: (row) => row.championModelId === null
        ? <EmptyValue reasonCode="NO_VALID_CANDIDATE" />
        : <><b>{row.championModelId}</b> {row.selectionMethod === 'MANUAL' ? <span className="tag blue">수동</span> : <span className="tag gray">자동</span>}</>,
    },
    { key: 'wape', label: 'WAPE', align: 'right', render: (row) => row.wape === null ? <EmptyValue reasonCode="WAPE_UNAVAILABLE" /> : formatWape(row.wape) },
    { key: 'mape', label: 'MAPE', align: 'right', render: (row) => row.mape === null ? <EmptyValue reasonCode="MAPE_UNAVAILABLE" /> : formatWape(row.mape) },
    { key: 'bias', label: 'Bias', align: 'right', render: (row) => row.bias === null ? <EmptyValue reasonCode="BIAS_UNAVAILABLE" /> : formatMetric(row.bias) },
    { key: 'rmse', label: 'RMSE', align: 'right', render: (row) => row.rmse === null ? <EmptyValue reasonCode="RMSE_UNAVAILABLE" /> : formatMetric(row.rmse) },
    { key: 'mae', label: 'MAE', align: 'right', render: (row) => row.mae === null ? <EmptyValue reasonCode="MAE_UNAVAILABLE" /> : formatMetric(row.mae) },
    { key: 'selectionReason', label: '선정 근거', render: (row) => row.selectionReason ?? <span className="muted">—</span> },
    { key: 'selectedAt', label: '선정일', render: (row) => formatDateTime(row.selectedAt) },
  ];

  return (
    <section className="analysis-page">
      <PageHeader eyebrow="ADMIN" title="Champion Models" description="품목별 대표 모델을 고르고 이력을 남깁니다." />
      <div className="analysis-content">
        <ForecastPipelineNote />

        {error ? (
          <div className="card">
            <p className="text-danger">조회에 실패했습니다.</p>
            <p className="muted">{error}</p>
          </div>
        ) : (
          <div className="section card">
            <div className="card-title">
              <div>
                <h3>품목별 현재 Champion</h3>
                <span>품목마다 가장 최근에 선정된 1건입니다(analytics.v_champion_model). Bias는 Forecast - Actual이며
                  양수는 과대예측입니다. 수동 변경 이력은 core.audit_log에 함께 남습니다.</span>
              </div>
            </div>
            <DataTable columns={columns} rows={rows} rowKey={(row) => row.selectionId} empty="선정된 Champion 모델이 없습니다." />
          </div>
        )}
      </div>
    </section>
  );
}
