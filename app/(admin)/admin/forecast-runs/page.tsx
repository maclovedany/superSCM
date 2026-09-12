// Task 15 fix round 2 — 실데이터 이관(commit b2ee554) 당시 core.forecast_run이 비어 있어
// NoRealDataNotice만 보여주던 화면. 지금은 STEP 6 SQL Baseline Forecast가 실제 실행 이력을
// 남겼으므로("아직 산출할 수 없습니다"는 더 이상 사실이 아니므로) 그 이력을 조회해 보여준다.
//
// ★ 계산은 하지 않는다. analytics.v_forecast_run이 이미 만든 열(n_models · n_items · n_rows ·
//   is_stale)을 그대로 옮긴다.
// ★ fix round 1 — 원천 게이트(core.procurement_forecast_source_status)는 발주계획 생성 로직 내부
//   전용으로 authenticated에도 EXECUTE 권한이 없지만(20260911000900), 그 함수가 읽는 원본은 이미
//   활성 사용자에게 열려 있어 admin 전용 읽기 전용 래퍼를 추가해도 권한 설계를 훼손하지 않는다는
//   리뷰 판정에 따라 core.forecast_run_source_status_for_admin(uuid[])(20260912000700)을 추가했다.
//   그 마이그레이션이 아직 적용되지 않은 환경에서는 조회가 빈 Map으로 실패하고 각 행이 그대로
//   EmptyValue를 보여준다 — 화면이 깨지지 않는다.

import PageHeader from '@/components/shell/page-header';
import DataTable, { type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import ForecastPipelineNote from '@/components/admin/forecast-pipeline-note';
import { requireAdmin } from '@/lib/auth';
import { getForecastRuns, getForecastRunSourceStatuses } from '@/lib/scm';
import { getPracticeForecastRunIds } from '@/lib/practice/repository';
import { SOURCE_STATUS_LABELS, type ForecastRun, type SourceStatus } from '@/lib/scm-model';

export const dynamic = 'force-dynamic';

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function statusTag(status: ForecastRun['status']) {
  if (status === 'SUCCESS') return <span className="tag green">SUCCESS</span>;
  if (status === 'FAILED') return <span className="tag red">FAILED</span>;
  return <span className="tag amber">RUNNING</span>;
}

function sourceGateTag(status: SourceStatus) {
  const label = SOURCE_STATUS_LABELS[status];
  return status === 'VERIFIED' ? <span className="tag green">{label}</span> : <span className="tag amber" title={status}>{label}</span>;
}

export default async function ForecastRunsPage() {
  await requireAdmin();
  const [{ rows, error: runsError }, practiceRunIds] = await Promise.all([getForecastRuns(), getPracticeForecastRunIds()]);
  const { statuses: sourceStatuses, error: sourceStatusError } = await getForecastRunSourceStatuses(rows.map((row) => row.runId));
  const error = runsError;

  const columns: Column<ForecastRun>[] = [
    {
      key: 'runId', label: '실행 ID',
      render: (row) => (
        <>
          <code title={row.runId}>{row.runId.slice(0, 8)}</code>
          {practiceRunIds.has(row.runId) ? <> <span className="tag amber" title="실습용 데이터 묶음이 만든 실행입니다. 실제 실적이 아닙니다.">실습용</span></> : null}
        </>
      ),
    },
    { key: 'status', label: '상태', align: 'center', render: (row) => statusTag(row.status) },
    {
      key: 'trainWindow', label: '학습 기간',
      render: (row) => row.trainStart && row.trainEnd ? <>{row.trainStart} ~ {row.trainEnd}</> : <EmptyValue reasonCode="TRAIN_WINDOW_UNSET" />,
    },
    { key: 'horizon', label: '예측 기간', align: 'right', render: (row) => row.horizon === null ? <EmptyValue reasonCode="HORIZON_UNSET" /> : <>{row.horizon}개월</> },
    { key: 'nModels', label: '모델 수', align: 'right', render: (row) => row.nModels.toLocaleString('ko-KR') },
    { key: 'nItems', label: '품목 수', align: 'right', render: (row) => row.nItems.toLocaleString('ko-KR') },
    { key: 'nRows', label: '결과 행수', align: 'right', render: (row) => row.nRows.toLocaleString('ko-KR') },
    {
      key: 'isStale', label: 'stale', align: 'center',
      render: (row) => row.isStale ? <span className="tag amber" title="실행 이후 사용 이력이 새로 적재됐습니다.">stale</span> : <span className="tag green">최신</span>,
    },
    {
      key: 'sourceGate', label: '원천 게이트', align: 'center',
      render: (row) => {
        const status = sourceStatuses.get(row.runId);
        return status ? sourceGateTag(status) : <EmptyValue reasonCode={sourceStatusError ? 'SOURCE_STATUS_UNAVAILABLE' : 'SOURCE_STATUS_NOT_JUDGED'} />;
      },
    },
    { key: 'startedAt', label: '시작', render: (row) => formatDateTime(row.startedAt) },
    { key: 'finishedAt', label: '종료', render: (row) => formatDateTime(row.finishedAt) },
    { key: 'triggeredEmail', label: '실행자', render: (row) => row.triggeredEmail ?? <EmptyValue reasonCode="TRIGGERED_BY_UNKNOWN" /> },
    { key: 'message', label: '비고', render: (row) => row.message ?? <span className="muted">—</span> },
  ];

  return (
    <section className="analysis-page">
      <PageHeader eyebrow="ADMIN" title="Forecast Runs" description="예측 실행 이력입니다." />
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
                <span>최근 실행이 먼저 옵니다. 원천 게이트는 core.procurement_forecast_source_status와 같은 판정입니다
                  (VERIFIED만 발주계획 생성에 쓸 수 있습니다). {sourceStatusError ? <span className="text-danger">판정 조회에 실패했습니다: {sourceStatusError}</span> : null}</span>
              </div>
            </div>
            <DataTable columns={columns} rows={rows} rowKey={(row) => row.runId} empty="Forecast 실행 이력이 없습니다." />
          </div>
        )}
      </div>
    </section>
  );
}
