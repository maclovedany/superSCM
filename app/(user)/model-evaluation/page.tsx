// 모델 평가 — renew.prd 13장 · 14장
//
// 백테스트를 돌리고, SKU 별 Champion 을 봅니다.
// 어느 모델이 좋은지는 여기서 판정됩니다.

import Link from 'next/link';
import { Award, Gauge, Hand, TrendingUp } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import Badge from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import FilterNotice from '@/components/ui/filter-notice';
import InsightBanner from '@/components/ui/insight-banner';
import { ErrorState, EmptyState } from '@/components/ui/state';
import { getBacktestKpi, getChampions, type ChampionModel } from '@/lib/backtest';
import { DEMAND_TYPE_LABEL, type DemandType } from '@/lib/demand-profile';
import Forbidden from '@/components/ui/forbidden';
import { getSessionUser, isSalesUser } from '@/lib/auth';
import { applyFilter, labelOf, readFilter, type FilterSpec, type SearchParams } from '@/lib/filter';
import BacktestForm from './backtest-form';
import ChartFrame from '@/components/chart/_base/chart-frame';
import EvaluationWapeBars from '@/components/chart/evaluation-wape-bars';
import EvaluationChampionShare from '@/components/chart/evaluation-champion-share';
import EvaluationImprovement from '@/components/chart/evaluation-improvement';
import { getChampionShare } from '@/lib/charts';
import { toImprovementBars, toWapeBars } from '@/lib/chart-model';

export const dynamic = 'force-dynamic';

/** 비율을 % 로. null 이면 산출 불가입니다 */
function Pct({ value, signed = false }: { value: number | null; signed?: boolean }) {
  if (value === null) return <EmptyValue align="right" showLabel={false} />;
  const pct = value * 100;
  const color = signed
    ? pct > 0
      ? 'var(--crit-fg)'   // 과대예측
      : pct < 0
        ? 'var(--info-fg)' // 과소예측
        : 'var(--text-3)'
    : undefined;
  return (
    <span style={{ color, fontWeight: signed ? 500 : 400 }}>
      {signed && pct > 0 ? '+' : ''}
      {pct.toFixed(1)}%
    </span>
  );
}

const FILTERS: FilterSpec<ChampionModel>[] = [
  { key: 'all', label: '전체 품목', match: null },
  {
    key: 'better',
    label: '기준선보다 나음',
    match: (row) => row.baselineImprovement !== null && row.baselineImprovement > 0,
  },
  { key: 'manual', label: '수동 지정', match: (row) => row.selectionMethod === 'MANUAL' },
  { key: 'unknown', label: '판정 불가', match: (row) => row.metricValue === null },
];

const columns: Column<ChampionModel>[] = [
  {
    key: 'itemId',
    label: '품목코드',
    variant: 'code',
    render: (row) => (
      <Link href={`/model-comparison?item=${row.itemId}`} style={{ color: 'var(--info-fg)' }}>
        {row.itemId}
      </Link>
    ),
  },
  {
    key: 'itemName',
    label: '품목명',
    variant: 'strong',
    render: (row) => row.itemName ?? <span className="text-3">이름 없음</span>,
  },
  {
    key: 'demandType',
    label: '수요 패턴',
    render: (row) =>
      row.demandType ? (
        <Badge tone="plain">{DEMAND_TYPE_LABEL[row.demandType as DemandType] ?? row.demandType}</Badge>
      ) : (
        <span className="text-3">—</span>
      ),
  },
  {
    key: 'champion',
    label: 'Champion',
    render: (row) => (
      <span style={{ display: 'inline-flex', gap: 'var(--s-2)', alignItems: 'center' }}>
        <Badge tone="safe">{row.modelName ?? row.championModelId ?? '—'}</Badge>
        {row.selectionMethod === 'MANUAL' && <Badge tone="info">수동</Badge>}
      </span>
    ),
  },
  {
    key: 'wape',
    label: 'WAPE',
    align: 'right',
    variant: 'num',
    render: (row) => <Pct value={row.wape} />,
  },
  {
    key: 'bias',
    label: 'Bias',
    align: 'right',
    variant: 'num',
    render: (row) => <Pct value={row.bias} signed />,
  },
  {
    key: 'improvement',
    label: '기준선 대비',
    align: 'right',
    variant: 'num',
    render: (row) => {
      if (row.baselineImprovement === null) return <EmptyValue align="right" showLabel={false} />;
      const pct = row.baselineImprovement * 100;
      return (
        <span style={{ color: pct > 0 ? 'var(--safe-fg)' : 'var(--text-3)', fontWeight: 500 }}>
          {pct > 0 ? '+' : ''}
          {pct.toFixed(1)}%
        </span>
      );
    },
  },
  {
    key: 'reason',
    label: '선정 근거',
    render: (row) => <span className="t-sm text-2">{row.reason ?? '—'}</span>,
  },
];

export default async function ModelEvaluationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const activeFilter = readFilter(await searchParams);
  const [{ rows, error }, { data: kpi }, user, share] = await Promise.all([
    getChampions(),
    getBacktestKpi(),
    getSessionUser(),
    getChampionShare(),
  ]);

  const isAdmin = user?.role === 'ADMIN';

  const header = (
    <PageHeader
      title="모델 평가"
      subtitle="예측을 검증 구간 실적과 대조해 채점하고, 품목마다 가장 잘 맞은 모델을 Champion 으로 뽑습니다. WAPE 와 Bias 를 핵심 지표로 씁니다."
      meta={
        <>
          <MetaChip>PRD 13 · 14</MetaChip>
          <MetaChip>STEP 7</MetaChip>
        </>
      }
    />
  );

  // ★ renew.prd 4.5 — 예측 정확도 지표는 영업에게 ✕ 입니다.
  //
  //   이 화면은 **전체가** 정확도입니다 (WAPE · Bias · Champion 선정 근거). 열을 몇 개
  //   빼면 껍데기만 남고, 남은 껍데기가 "여기엔 볼 게 없다" 가 아니라 "데이터가 없다" 로
  //   읽힙니다. 그래서 화면을 열지 않고 이유를 말합니다.
  //
  //   메뉴에서도 감추는 편이 낫습니다 — lib/menu.ts 는 컨트롤러가 고칩니다
  //   (보고서 §11 의 목록).
  if (isSalesUser(user)) {
    return (
      <>
        {header}
        <Forbidden
          role={user?.role ?? 'USER'}
          reason="예측 정확도 지표는 영업 권한에서 볼 수 없습니다 (renew.prd 4.5)."
        />
      </>
    );
  }

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

  const visible = applyFilter(rows, FILTERS, activeFilter);
  const filterLabel = labelOf(FILTERS, activeFilter);
  const better = kpi?.betterThanBaseline ?? 0;
  const manual = kpi?.manual ?? 0;

  return (
    <>
      {header}

      <div className="grid grid-kpi">
        <KpiCard
          label="Champion 선정"
          value={rows.length}
          unit="품목"
          icon={Award}
          foot={kpi?.lastRunAt ? `최근 채점 ${kpi.lastRunAt.slice(0, 10)}` : '아직 채점 전'}
          filter={{ key: 'all', active: activeFilter === 'all' }}
        />
        <KpiCard
          label="기준선보다 나음"
          value={better}
          unit={`/ ${rows.length}`}
          icon={TrendingUp}
          foot="이동평균 3개월 대비"
          filter={{ key: 'better', active: activeFilter === 'better' }}
        />
        <KpiCard
          label="수동 지정"
          value={manual}
          unit="품목"
          icon={Hand}
          foot="사유가 함께 저장됩니다"
          filter={{ key: 'manual', active: activeFilter === 'manual' }}
        />
        <KpiCard
          label="평균 WAPE"
          value={kpi?.avgWape === null || kpi?.avgWape === undefined ? null : `${(kpi.avgWape * 100).toFixed(1)}%`}
          icon={Gauge}
          reason="INSUFFICIENT_SAMPLE"
          foot="Champion 기준 · 낮을수록 좋습니다"
        />
      </div>

      <InsightBanner eyebrow="BACKTEST">
        <b>WAPE</b> 는 Σ|실적−예측| ÷ Σ실적 입니다. MAPE 를 단독으로 쓰지 않는 이유는 수요가 0 에 가까운 달에서
        발산하기 때문입니다. <b>Bias</b> 는 부호를 남겨 과대예측(+)과 과소예측(−)을 구분합니다. 품목을 누르면
        모델 비교 화면에서 <b>후보 전체 성능</b>과 겹친 차트를 볼 수 있습니다.
      </InsightBanner>

      {isAdmin && (
        <Panel title="백테스트 실행">
          <BacktestForm />
        </Panel>
      )}

      {filterLabel && <FilterNotice label={filterLabel} shown={visible.length} total={rows.length} />}

      {/* ── 차트 띠 — spec §4.2 ── */}
      <div className="grid-charts" data-cols="3">
        <ChartFrame
          title="품목별 Champion WAPE"
          desc="부정확한 품목이 위 · 상위 20 · 옅은 막대는 수동 지정 · 누르면 모델 비교"
          empty={rows.every((r) => r.wape === null) ? '채점된 품목이 없습니다' : null}
        >
          <EvaluationWapeBars bars={toWapeBars(rows)} hrefFor={(id) => `/model-comparison?item=${encodeURIComponent(id)}`} />
        </ChartFrame>
        <ChartFrame
          title="모델별 Champion 점유"
          desc="어느 모델이 몇 품목의 Champion 인가"
          error={share.error}
          empty={share.rows.length === 0 ? 'Champion 이 없습니다' : null}
        >
          <EvaluationChampionShare rows={share.rows} />
        </ChartFrame>
        <ChartFrame
          title="베이스라인 대비 개선율"
          desc="이동평균 3개월 대비 · 음수는 베이스라인이 더 맞은 품목 · 하위 20"
          empty={toImprovementBars(rows).length === 0 ? '개선율을 낸 품목이 없습니다' : null}
        >
          <EvaluationImprovement bars={toImprovementBars(rows)} hrefFor={(id) => `/model-comparison?item=${encodeURIComponent(id)}`} />
        </ChartFrame>
      </div>

      <Panel
        title="품목별 Champion"
        actions={<span className="t-label">WAPE 낮은 순 · 품목을 누르면 비교 화면으로</span>}
        flush
      >
        {rows.length === 0 ? (
          <EmptyState
            title="아직 채점하지 않았습니다"
            desc={
              isAdmin
                ? '위에서 백테스트 실행을 누르면 예측을 검증 구간 실적과 대조합니다.'
                : '관리자가 백테스트를 실행하면 여기에 결과가 나타납니다.'
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={`${filterLabel ?? ''} 에 해당하는 품목이 없습니다`}
            desc="위 카드를 다시 눌러 전체 목록으로 돌아갈 수 있습니다."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(row) => row.itemId}
            caption="analytics.v_champion_model — 품목별 Champion 과 선정 근거"
          />
        )}
      </Panel>
    </>
  );
}
