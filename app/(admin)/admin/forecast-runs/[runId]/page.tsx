// 예측 실행 상세 — renew.prd 12.2 · 31.2
//
// 한 실행이 무엇을 만들었는지 모델별로 봅니다. 실행 수준 값(총 품목 · 총 행 · 기간 ·
// 백테스트/가상운영 여부 · stale)은 analytics.v_forecast_run_detail 이 모든 줄에 같은
// 값으로 실어 보내므로, 화면은 첫 줄에서 꺼내 쓰기만 합니다 (AGENTS.md 규칙 1).
//
// kpi-filter: 없음 — 이 화면의 카드는 아래 표(모델별 결과)의 부분집합이 아니라
// 실행 하나를 설명하는 지표입니다. 좁힐 목록이 없습니다 (design.md §6.4).

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Boxes, CalendarRange, Layers, Rows3 } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import Badge from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import InsightBanner from '@/components/ui/insight-banner';
import { ErrorState, EmptyState } from '@/components/ui/state';
import { requireAdmin } from '@/lib/auth';
import {
  getForecastRunDetail,
  RUN_MODE_DESC,
  RUN_MODE_LABEL,
  type ForecastRunDetailRow,
} from '@/lib/admin-ops';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, { label: string; tone: 'safe' | 'warn' | 'crit' | 'info' }> = {
  RUNNING: { label: '실행 중', tone: 'info' },
  SUCCESS: { label: '성공', tone: 'safe' },
  FAILED: { label: '실패', tone: 'crit' },
};

const columns: Column<ForecastRunDetailRow>[] = [
  {
    key: 'model',
    label: '모델',
    render: (row) => (
      <>
        <span className="cell-strong">{row.modelName ?? row.modelId ?? '—'}</span>
        {row.modelId && <div className="t-code text-3">{row.modelId}</div>}
      </>
    ),
  },
  { key: 'family', label: '계열', render: (row) => row.family ?? <span className="text-3">—</span> },
  { key: 'engine', label: '엔진', variant: 'code', render: (row) => row.engine ?? '—' },
  { key: 'modelVersion', label: '버전', variant: 'code', render: (row) => row.modelVersion ?? '—' },
  {
    key: 'nItems',
    label: '품목',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.nItems === null ? <EmptyValue align="right" showLabel={false} /> : formatNumber(row.nItems),
  },
  {
    key: 'nRows',
    label: '결과 행',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.nRows === null ? <EmptyValue align="right" showLabel={false} /> : formatNumber(row.nRows),
  },
  {
    key: 'nWithInterval',
    label: '구간 있음',
    align: 'right',
    variant: 'num',
    render: (row) =>
      // P80 · P90 을 낼 수 있었던 행. 잔차 표준편차를 못 구하면 점추정만 남습니다.
      row.nWithInterval === null ? (
        <EmptyValue align="right" reason="INSUFFICIENT_SAMPLE" showLabel={false} />
      ) : (
        formatNumber(row.nWithInterval)
      ),
  },
  {
    key: 'period',
    label: '예측 기간',
    variant: 'num',
    render: (row) =>
      row.firstPeriod === null ? (
        <span className="text-3">—</span>
      ) : (
        `${row.firstPeriod.slice(0, 7)} ~ ${(row.lastPeriod ?? row.firstPeriod).slice(0, 7)}`
      ),
  },
];

export default async function ForecastRunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  await requireAdmin();

  const { runId } = await params;
  const { rows, error } = await getForecastRunDetail(runId);

  const header = (
    <PageHeader
      title="예측 실행 상세"
      subtitle="이 실행이 모델별로 무엇을 만들었는지, 그 결과를 누가 채점했는지 봅니다."
      meta={
        <>
          <MetaChip>PRD 12.2</MetaChip>
          <MetaChip>{runId}</MetaChip>
        </>
      }
    />
  );

  if (error) {
    return (
      <>
        {header}
        <Panel>
          <ErrorState detail={error} />
        </Panel>
      </>
    );
  }

  // 실행이 있으면 최소 한 줄은 옵니다 (결과가 없는 실패 실행도 모델 컬럼만 null).
  if (rows.length === 0) notFound();

  const run = rows[0];
  const status = STATUS[run.status ?? ''] ?? { label: run.status ?? '알 수 없음', tone: 'info' as const };
  const models = rows.filter((row) => row.modelId !== null);

  return (
    <>
      {header}

      <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <Link href="/admin/forecast-runs" className="btn ghost">
          <ArrowLeft size={13} aria-hidden />
          실행 목록
        </Link>
        <Badge tone={status.tone}>{status.label}</Badge>
        {run.mode !== null && (
          <Badge tone={run.mode === 'PRODUCTION' ? 'info' : 'plain'}>{RUN_MODE_LABEL[run.mode]}</Badge>
        )}
        {run.isStale === true && <Badge tone="warn">재실행 필요</Badge>}
      </div>

      {run.isStale === true && (
        <div className="stale-banner">
          이 실행 뒤에 원본 데이터가 바뀌었습니다. 이 실행의 예측은 그때의 데이터로 만든 것입니다.
          <Link href="/admin/forecast-runs" className="btn secondary">
            다시 실행하기
          </Link>
        </div>
      )}

      <div className="grid grid-kpi">
        <KpiCard
          label="모델"
          value={run.runModels ?? 0}
          unit="종"
          icon={Layers}
          foot={run.mode === null ? undefined : RUN_MODE_LABEL[run.mode]}
        />
        <KpiCard label="품목" value={run.runItems ?? 0} unit="개" icon={Boxes} foot="예측을 낸 품목" />
        <KpiCard
          label="결과 행"
          value={run.runRows === null ? null : formatNumber(run.runRows)}
          unit="행"
          icon={Rows3}
          foot="모델 × 품목 × 기간"
        />
        <KpiCard
          label="예측 기간"
          value={
            run.runFirstPeriod === null
              ? null
              : `${run.runFirstPeriod.slice(0, 7)} ~ ${(run.runLastPeriod ?? run.runFirstPeriod).slice(0, 7)}`
          }
          icon={CalendarRange}
          reason="NO_FORECAST"
          foot={run.horizon === null ? undefined : `${run.horizon}개월`}
        />
      </div>

      {run.mode !== null && (
        <InsightBanner eyebrow={run.mode}>
          {RUN_MODE_DESC[run.mode]}{' '}
          {run.mode === 'VALIDATION' ? (
            <>
              그래서 이 실행의 예측은 <b>과거 구간</b>을 덮습니다. 재고 전개 · 발주 추천은 오늘 이후
              예측을 찾으므로, 화면 숫자를 채우려면 <b>운영 실행</b>이 따로 필요합니다.
            </>
          ) : (
            <>
              백테스트는 이 실행을 채점하지 않습니다. 검증 구간을 이미 학습에 썼기 때문입니다.
            </>
          )}
        </InsightBanner>
      )}

      <Panel title="실행 정보" flush>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              <tr>
                <td className="cell-strong">학습 구간</td>
                <td className="cell-num">
                  {run.trainStart ?? '—'} ~ {run.trainEnd ?? '—'}
                </td>
                <td className="cell-strong">데이터 기준 시각</td>
                <td className="cell-num">
                  {run.dataSnapshotAt ? run.dataSnapshotAt.slice(0, 19).replace('T', ' ') : '—'}
                </td>
              </tr>
              <tr>
                <td className="cell-strong">실행 시각</td>
                <td className="cell-num">
                  {run.startedAt ? run.startedAt.slice(0, 19).replace('T', ' ') : '—'}
                </td>
                <td className="cell-strong">소요</td>
                <td className="cell-num">
                  {run.durationMs === null ? '—' : `${(run.durationMs / 1000).toFixed(1)}초`}
                </td>
              </tr>
              <tr>
                <td className="cell-strong">실행자</td>
                <td>{run.triggeredEmail ?? '—'}</td>
                <td className="cell-strong">Champion 지표</td>
                <td className="cell-code">{run.championMetric ?? '—'}</td>
              </tr>
              <tr>
                <td className="cell-strong">메모</td>
                <td>{run.note ?? '—'}</td>
                <td className="cell-strong">결과 메시지</td>
                <td>{run.message ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="이어진 실행">
        <div style={{ display: 'flex', gap: 'var(--s-3)', flexWrap: 'wrap', alignItems: 'center' }}>
          {run.hasBacktest === true ? (
            <Link href="/model-evaluation" className="btn secondary">
              백테스트 결과 보기
            </Link>
          ) : (
            <span className="t-sm text-2">
              {run.mode === 'PRODUCTION'
                ? '운영 실행은 채점하지 않습니다.'
                : '아직 채점하지 않았습니다. 모델 평가 화면에서 백테스트를 돌리세요.'}
            </span>
          )}
          {run.backtestRunId && <span className="t-code text-3">{run.backtestRunId}</span>}

          {run.hasSimulation === true ? (
            <Link href="/virtual-operation" className="btn secondary">
              가상 운영 결과 보기
            </Link>
          ) : (
            <span className="t-sm text-2">가상 운영 시뮬레이션은 아직 돌리지 않았습니다.</span>
          )}
          {run.simulationId && <span className="t-code text-3">{run.simulationId}</span>}
        </div>
      </Panel>

      <Panel title="모델별 결과" flush>
        {models.length === 0 ? (
          <EmptyState
            title="결과 행이 없습니다"
            desc={
              run.status === 'FAILED'
                ? '이 실행은 실패했습니다. 위 결과 메시지에 사유가 있습니다.'
                : '학습 데이터가 모자라 어떤 모델도 값을 내지 못했습니다.'
            }
          />
        ) : (
          <DataTable
            columns={columns}
            rows={models}
            rowKey={(row) => `${row.modelId}-${row.modelVersion}`}
            caption="analytics.v_forecast_run_detail — 실행 하나 × 모델 하나"
          />
        )}
      </Panel>
    </>
  );
}
