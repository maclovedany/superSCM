// Task 15 fix round 2 — forecast-runs와 같은 이유(commit b2ee554 이관 당시엔 core.backtest_run이
// 비어 있어 NoRealDataNotice만 보여줬다. STEP 7 core.run_backtest가 실제 실행 이력을 남긴 지금은
// "아직 산출할 수 없습니다"가 사실이 아니다).
//
// ★ fix round 1 — 채점 요약(개수 · WAPE 범위)은 이제 analytics.v_backtest_performance_summary가
//   집계한 값을 그대로 읽는다(20260912000700). 예전엔 화면이 core.model_performance 원본 행을
//   내려받아 최솟값·최댓값을 직접 계산했는데, 이 저장소에 화면 계층이 집계하는 선례가 없어서 SQL로
//   내렸다(lib/scm-model.ts의 BacktestPerformanceSummary 주석 참고).

import PageHeader from '@/components/shell/page-header';
import DataTable, { type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import ForecastPipelineNote from '@/components/admin/forecast-pipeline-note';
import { requireAdmin } from '@/lib/auth';
import { getBacktestPerformanceSummaries, getBacktestRuns } from '@/lib/scm';
import { getPracticeBacktestRunIds } from '@/lib/practice/repository';
import type { BacktestPerformanceSummary, BacktestRun } from '@/lib/scm-model';

export const dynamic = 'force-dynamic';

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function statusTag(status: BacktestRun['status']) {
  if (status === 'SUCCESS') return <span className="tag green">SUCCESS</span>;
  if (status === 'FAILED') return <span className="tag red">FAILED</span>;
  return <span className="tag amber">RUNNING</span>;
}

function formatWape(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

const EMPTY_SUMMARY: BacktestPerformanceSummary = { backtestRunId: '', scoredCount: 0, unavailableCount: 0, wapeMin: null, wapeMax: null };

type Row = BacktestRun & { summary: BacktestPerformanceSummary };

export default async function BacktestRunsPage() {
  await requireAdmin();
  const [{ rows: runs, error: runsError }, practiceRunIds] = await Promise.all([getBacktestRuns(), getPracticeBacktestRunIds()]);
  const { rows: summaryRows, error: summaryError } = await getBacktestPerformanceSummaries(runs.map((run) => run.backtestRunId));
  const error = runsError ?? summaryError;

  const summaryByRun = new Map(summaryRows.map((summary) => [summary.backtestRunId, summary]));
  const rows: Row[] = runs.map((run) => ({ ...run, summary: summaryByRun.get(run.backtestRunId) ?? EMPTY_SUMMARY }));

  const columns: Column<Row>[] = [
    {
      key: 'backtestRunId', label: 'Backtest ID',
      render: (row) => (
        <>
          <code title={row.backtestRunId}>{row.backtestRunId.slice(0, 8)}</code>
          {practiceRunIds.has(row.backtestRunId) ? <> <span className="tag amber" title="실습용 데이터 묶음이 만든 실행입니다. 실제 실적이 아닙니다.">실습용</span></> : null}
        </>
      ),
    },
    { key: 'forecastRunId', label: 'Forecast Run', render: (row) => <code title={row.forecastRunId}>{row.forecastRunId.slice(0, 8)}</code> },
    { key: 'status', label: '상태', align: 'center', render: (row) => statusTag(row.status) },
    {
      key: 'testWindow', label: '검증 기간',
      render: (row) => row.testStart && row.testEnd ? <>{row.testStart} ~ {row.testEnd}</> : <EmptyValue reasonCode="TEST_WINDOW_UNSET" />,
    },
    { key: 'metric', label: '지표', align: 'center', render: (row) => row.metric ?? <EmptyValue reasonCode="METRIC_UNSET" /> },
    { key: 'referenceModelId', label: '기준 모델', render: (row) => row.referenceModelId ?? <EmptyValue reasonCode="REFERENCE_MODEL_UNSET" /> },
    {
      key: 'scored', label: '채점 완료', align: 'right',
      render: (row) => row.summary.scoredCount === 0 && row.summary.unavailableCount === 0
        ? <EmptyValue reasonCode="NO_CANDIDATES" />
        : <>{row.summary.scoredCount.toLocaleString('ko-KR')}건{row.summary.unavailableCount > 0 ? <span className="muted"> (판정 불가 {row.summary.unavailableCount}건)</span> : null}</>,
    },
    {
      key: 'wapeRange', label: 'WAPE 범위', align: 'right',
      render: (row) => row.summary.wapeMin === null || row.summary.wapeMax === null
        ? <EmptyValue reasonCode="WAPE_UNAVAILABLE" />
        : <>{formatWape(row.summary.wapeMin)} ~ {formatWape(row.summary.wapeMax)}</>,
    },
    { key: 'startedAt', label: '시작', render: (row) => formatDateTime(row.startedAt) },
    { key: 'finishedAt', label: '종료', render: (row) => formatDateTime(row.finishedAt) },
    { key: 'message', label: '비고', render: (row) => row.message ?? <span className="muted">—</span> },
  ];

  return (
    <section className="analysis-page">
      <PageHeader eyebrow="ADMIN" title="Backtest Runs" description="저장된 예측을 검증 Actual과 대조하는 실행 이력입니다." />
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
                <h3>실행 이력</h3>
                <span>채점 완료 · WAPE 범위는 analytics.v_backtest_performance_summary가 core.model_performance를
                  집계한 값입니다(화면은 다시 계산하지 않습니다). 판정 불가 건은 검증 기간에 짝지을 Actual이
                  없거나 WAPE 분모가 0인 경우입니다.</span>
              </div>
            </div>
            <DataTable columns={columns} rows={rows} rowKey={(row) => row.backtestRunId} empty="Backtest 실행 이력이 없습니다." />
          </div>
        )}
      </div>
    </section>
  );
}
