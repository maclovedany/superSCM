// 예측 기본 설정 — renew.prd 11.4 · 12.1
//
// kpi-filter: 없음 — 이 화면의 카드는 아래 목록(공통 정책값)의 부분집합이 아닙니다.
// 데이터 기간·학습 구간·검증 구간·격리 상태는 설정 자체를 설명하는 지표라
// 눌러도 좁힐 대상이 없습니다. 누를 수 없는 카드를 누르게 만들지 않습니다
// (AGENTS.md 규칙 9 · design.md §6.4).
//
// STEP 3 의 검증 화면입니다.
// 학습/검증 경계가 어디인지, 그 경계가 실제 데이터와 맞는지, 격리가 되는지를 보여줍니다.
// 모델 on/off 와 파라미터는 STEP 6 에서 이 화면에 붙습니다.

import Link from 'next/link';
import { CalendarRange, Database, FlaskConical, ShieldCheck } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import Badge from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import InsightBanner from '@/components/ui/insight-banner';
import { ErrorState, EmptyState } from '@/components/ui/state';
import { getDataCoverage } from '@/lib/coverage';
import { getPolicies, type Policy } from '@/lib/policy';
import { requireAdmin } from '@/lib/auth';
import { getStaleSummary, RUN_MODE_LABEL, staleSentence } from '@/lib/admin-ops';
import ProductionTrainEndForm from './production-train-end-form';

export const dynamic = 'force-dynamic';

const policyColumns: Column<Policy>[] = [
  { key: 'key', label: '항목', variant: 'code', render: (row) => row.key },
  {
    key: 'value',
    label: '값',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.valueNum === null && row.valueText === null ? (
        <EmptyValue align="right" showLabel={false} />
      ) : (
        <>
          {row.valueNum !== null ? formatNumber(row.valueNum) : row.valueText}
          {row.unit && <span className="text-3"> {row.unit}</span>}
        </>
      ),
  },
  { key: 'description', label: '설명', render: (row) => row.description },
];

export default async function ForecastSettingsPage() {
  const admin = await requireAdmin();
  const [{ data: coverage, error }, { rows: policies }, { data: stale, error: staleError }] =
    await Promise.all([getDataCoverage(), getPolicies(), getStaleSummary()]);

  const header = (
    <PageHeader
      title="예측 기본 설정"
      subtitle="학습과 검증 구간을 여기서 정합니다. 예측 모듈은 학습 구간 데이터만 볼 수 있으며, 검증 구간은 백테스트가 정답을 맞춰볼 때만 씁니다."
      meta={
        <>
          <MetaChip>PRD 11.4</MetaChip>
          <MetaChip>PRD 12.1</MetaChip>
          <MetaChip>STEP 3 · STEP 20</MetaChip>
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

  if (!coverage) {
    return (
      <>
        {header}
        <Panel>
          <EmptyState
            title="설정이 아직 없습니다"
            desc="sql/06-core-extend.sql 과 sql/07-train-isolation.sql 을 Supabase SQL Editor 에서 실행해주세요."
          />
        </Panel>
      </>
    );
  }

  const windowsOk = coverage.trainWindowOk && coverage.testWindowOk;
  const isolated = coverage.trainPeriods > 0 && coverage.testPeriods > 0;

  return (
    <>
      {header}

      <div className="grid grid-kpi">
        <KpiCard
          label="데이터 기간"
          value={coverage.dataMonths === null ? null : formatNumber(coverage.dataMonths)}
          unit="개월"
          icon={Database}
          foot={
            coverage.dataStart && coverage.dataEnd
              ? `${coverage.dataStart} ~ ${coverage.dataEnd}`
              : undefined
          }
        />
        <KpiCard
          label="학습 구간"
          value={coverage.trainPeriods}
          unit={coverage.granularity === 'WEEK' ? '주' : '개월'}
          icon={CalendarRange}
          tone={coverage.trainWindowOk ? 'default' : 'crit'}
          foot={
            coverage.trainStart && coverage.trainEnd
              ? `${coverage.trainStart} ~ ${coverage.trainEnd}`
              : undefined
          }
        />
        <KpiCard
          label="검증 구간"
          value={coverage.testPeriods}
          unit={coverage.granularity === 'WEEK' ? '주' : '개월'}
          icon={FlaskConical}
          tone={coverage.testWindowOk ? 'default' : 'crit'}
          foot={
            coverage.testStart && coverage.testEnd
              ? `${coverage.testStart} ~ ${coverage.testEnd}`
              : undefined
          }
        />
        <KpiCard
          label="격리 상태"
          value={isolated && windowsOk ? '정상' : '확인 필요'}
          icon={ShieldCheck}
          tone={isolated && windowsOk ? 'default' : 'warn'}
          foot="학습 뷰가 검증 구간을 내보내지 않음"
        />
      </div>

      {!windowsOk && (
        <div className="stale-banner">
          설정한 구간이 실제 데이터 범위와 어긋납니다. 학습 또는 검증 구간에 데이터가 없습니다.
          <span className="badge crit">확인 필요</span>
        </div>
      )}

      <InsightBanner eyebrow="DATA ISOLATION">
        예측 모듈은 <span className="t-code">core.v_train_demand</span> 만 조회합니다. 이 뷰는{' '}
        <b>{coverage.trainEnd}</b> 이후 행을 물리적으로 내보내지 않으므로, 학습 코드가 검증 구간을 볼 수
        없습니다. 정답지인 <span className="t-code">core.v_test_actual</span> 은 백테스트만 씁니다.
        {coverage.dataMonths !== null && coverage.dataMonths < 24 && (
          <>
            {' '}
            현재 데이터는 <span className="hl-warn">{formatNumber(coverage.dataMonths)}개월</span> 로,{' '}
            <span className="t-code">renew.prd</span> 12.1 이 전제한 3년치에 못 미칩니다. 계절성을 학습하려면
            최소 24개월이 필요합니다.
          </>
        )}
      </InsightBanner>

      <Panel
        title="운영 학습 종료일"
        actions={<span className="t-label">PRD 12.1 · STEP 20</span>}
      >
        <p className="t-sm text-2" style={{ marginBottom: 'var(--s-4)' }}>
          위 <b>학습 구간</b>은 <b>모델을 고르기 위한</b> 경계입니다. 그 뒤가 백테스트의 정답지라 운영
          예측이 거기까지만 학습하면 오늘 이후를 덮지 못합니다. 그래서 운영 실행은 이 날짜까지 학습합니다.
          두 경계는 서로 건드리지 않습니다.
        </p>
        {admin === null ? (
          <p className="t-sm text-2">관리자만 고칠 수 있습니다.</p>
        ) : (
          <ProductionTrainEndForm
            current={stale?.productionTrainEnd ?? null}
            dataEnd={stale?.dataEnd ?? coverage.dataEnd ?? null}
          />
        )}
      </Panel>

      <Panel title="예측 최신 상태" flush>
        {staleError !== null ? (
          <ErrorState detail={staleError} />
        ) : stale === null ? (
          <EmptyState
            title="아직 판정할 수 없습니다"
            desc="sql/27-admin-ops.sql 을 Supabase SQL Editor 에서 실행해주세요."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                <tr>
                  <td className="cell-strong">화면이 쓰는 실행</td>
                  <td className="cell-code">{stale.forecastRunId ?? '—'}</td>
                  <td className="cell-strong">모드</td>
                  <td>
                    {stale.forecastMode === null ? (
                      <span className="text-3">—</span>
                    ) : (
                      <Badge tone={stale.forecastMode === 'PRODUCTION' ? 'safe' : 'warn'}>
                        {RUN_MODE_LABEL[stale.forecastMode]}
                      </Badge>
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="cell-strong">예측의 데이터 기준</td>
                  <td className="cell-num">
                    {stale.dataSnapshotAt ? stale.dataSnapshotAt.slice(0, 19).replace('T', ' ') : '—'}
                  </td>
                  <td className="cell-strong">지금 데이터 기준</td>
                  <td className="cell-num">
                    {stale.dataLoadedAt ? stale.dataLoadedAt.slice(0, 19).replace('T', ' ') : '—'}
                  </td>
                </tr>
                <tr>
                  <td className="cell-strong">마지막 적재</td>
                  <td className="cell-num">
                    {stale.lastBatchAt ? stale.lastBatchAt.slice(0, 10) : '—'}
                    {stale.lastBatchDataType && (
                      <span className="text-3"> · {stale.lastBatchDataType}</span>
                    )}
                  </td>
                  <td className="cell-strong">적재 행</td>
                  <td className="cell-num">
                    {stale.lastBatchRows === null ? (
                      <EmptyValue align="right" showLabel={false} />
                    ) : (
                      formatNumber(stale.lastBatchRows)
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="cell-strong">판정</td>
                  <td colSpan={3}>
                    {staleSentence(stale) ?? '최신입니다. 다시 돌릴 것이 없습니다.'}
                  </td>
                </tr>
                <tr>
                  <td className="cell-strong">영향 화면</td>
                  <td colSpan={3}>
                    {stale.affectedScreens.length === 0 ? (
                      <span className="text-3">—</span>
                    ) : (
                      <span style={{ display: 'inline-flex', gap: 'var(--s-3)', flexWrap: 'wrap' }}>
                        {stale.affectedScreens.map((screen) => (
                          <Link key={screen} href={screen} className="t-code" style={{ color: 'var(--info-fg)' }}>
                            {screen}
                          </Link>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="구간 설정" flush>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">구분</th>
                <th scope="col">시작</th>
                <th scope="col">종료</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  기간 수
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  수량 합계
                </th>
                <th scope="col">범위</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="cell-strong">학습 (Train)</td>
                <td className="cell-num">{coverage.trainStart ?? '—'}</td>
                <td className="cell-num">{coverage.trainEnd ?? '—'}</td>
                <td className="cell-num">{coverage.trainPeriods}</td>
                <td className="cell-num">
                  {coverage.trainQty === null ? (
                    <EmptyValue align="right" showLabel={false} />
                  ) : (
                    formatNumber(coverage.trainQty)
                  )}
                </td>
                <td>
                  <Badge tone={coverage.trainWindowOk ? 'safe' : 'crit'}>
                    {coverage.trainWindowOk ? '정상' : '데이터 없음'}
                  </Badge>
                </td>
              </tr>
              <tr>
                <td className="cell-strong">검증 (Test)</td>
                <td className="cell-num">{coverage.testStart ?? '—'}</td>
                <td className="cell-num">{coverage.testEnd ?? '—'}</td>
                <td className="cell-num">{coverage.testPeriods}</td>
                <td className="cell-num">
                  {coverage.testQty === null ? (
                    <EmptyValue align="right" showLabel={false} />
                  ) : (
                    formatNumber(coverage.testQty)
                  )}
                </td>
                <td>
                  <Badge tone={coverage.testWindowOk ? 'safe' : 'crit'}>
                    {coverage.testWindowOk ? '정상' : '데이터 없음'}
                  </Badge>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="공통 정책값"
        actions={<span className="t-label">등급별 서비스 수준은 STEP 10 에서 분리</span>}
        flush
      >
        {policies.length === 0 ? (
          <EmptyState
            title="정책값이 없습니다"
            desc="sql/06-core-extend.sql 을 실행하면 기본값 8개가 들어갑니다."
          />
        ) : (
          <DataTable
            columns={policyColumns}
            rows={policies}
            rowKey={(row) => row.key}
            caption="core.policy_config — 이 값을 바꾸면 화면 코드를 고치지 않아도 계산이 달라집니다"
          />
        )}
      </Panel>
    </>
  );
}
