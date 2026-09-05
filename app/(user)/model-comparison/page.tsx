// 모델 비교 — renew.prd 16장
//
// ★ 모델을 켜고 끄면 재실행 없이 차트가 즉시 갱신됩니다 (renew.prd 16.5).
//   실행 시점에 모든 모델 결과를 저장해 두었기 때문입니다.
//   사용자가 가장 자주 하는 조작이 이것입니다.

import Link from 'next/link';
import StaleBanner from '@/components/ui/stale-banner';
import { Award, Gauge, LineChart, Ruler } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import Badge from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import InsightBanner from '@/components/ui/insight-banner';
import { ErrorState, EmptyState } from '@/components/ui/state';
import ForecastOverlayChart, { type SeriesPoint } from '@/components/chart/forecast-overlay-chart';
import { getChampions, getItemPerformance, getItemSeries, type ModelPerformance } from '@/lib/backtest';
import { getForecastDetail, getLatestSuccessfulRun, getRunModels } from '@/lib/forecast';
import Forbidden from '@/components/ui/forbidden';
import { getSessionUser, isSalesUser } from '@/lib/auth';
import type { SearchParams } from '@/lib/filter';
import ChampionForm from './champion-form';
import ItemSearchPanel from '@/components/ui/item-search-panel';
import { getItem, searchItems } from '@/lib/items';
import { getDemandCompare } from '@/lib/machines';
import { DEPENDENT_MODEL } from '@/lib/machines-model';
import ChartFrame from '@/components/chart/_base/chart-frame';
import ComparisonMetricBars from '@/components/chart/comparison-metric-bars';
import { toMetricBars } from '@/lib/chart-model';

export const dynamic = 'force-dynamic';

// kpi-filter: 없음 — 이 화면의 카드는 아래 표(모델별 성능)의 부분집합이 아니라
// 선택된 품목 하나를 설명하는 지표입니다. 목록을 좁히는 조작은 품목 선택이 맡습니다
// (AGENTS.md 규칙 9).

function param(params: SearchParams, key: string): string | null {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function pct(value: number | null, digits = 1) {
  return value === null ? null : `${(value * 100).toFixed(digits)}%`;
}

export default async function ModelComparisonPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const [{ rows: champions, error: championError }, run, user] = await Promise.all([
    getChampions(),
    getLatestSuccessfulRun(),
    getSessionUser(),
  ]);

  const header = (
    <PageHeader
      title="모델 비교"
      subtitle="실적과 여러 모델의 예측을 한 차트에 겹쳐 봅니다. 모델을 켜고 끄면 다시 계산하지 않고 즉시 갱신됩니다."
      meta={
        <>
          <MetaChip>PRD 16</MetaChip>
          {run && <MetaChip>{run.runId}</MetaChip>}
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

  if (championError) {
    return (
      <>
        {header}
        <Panel>
          <ErrorState detail={championError} />
        </Panel>
      </>
    );
  }

  if (champions.length === 0 || !run) {
    return (
      <>
        {header}
        <Panel>
          <EmptyState
            title="비교할 결과가 없습니다"
            desc="예측을 실행하고 모델 평가 화면에서 백테스트를 먼저 돌려주세요."
          />
        </Panel>
      </>
    );
  }

  // ★ 품목 11,000개 — champions 목록(상한 1,000)에 없어도 마스터에 있으면 그 품목을 봅니다.
  //   구코드로 들어와도 getItem 이 대표코드로 바꿔 줍니다.
  const requestedItem = param(params, 'item');
  const q = param(params, 'q') ?? '';
  const [resolved, search] = await Promise.all([
    requestedItem ? getItem(requestedItem) : Promise.resolve({ data: null, error: null }),
    q.trim().length >= 2 ? searchItems(q) : Promise.resolve({ rows: [], error: null }),
  ]);
  const activeItem = resolved.data?.itemId ?? champions[0].itemId;

  const [{ rows: performance }, { rows: series }, { rows: forecast }, { rows: runModels }, { rows: compare }] =
    await Promise.all([
      getItemPerformance(activeItem),
      getItemSeries(activeItem),
      getForecastDetail(run.runId, activeItem),
      getRunModels(run.runId),
      getDemandCompare(activeItem),
    ]);

  const champion = champions.find((c) => c.itemId === activeItem) ?? null;
  const modelLabel = new Map(runModels.map((m) => [m.modelId, m.modelName ?? m.modelId]));

  // ── 차트 데이터 조립 ──
  // 계산이 아니라 병합입니다. 지표는 이미 SQL 이 계산했습니다.
  const byPeriod = new Map<string, SeriesPoint>();
  const ensure = (period: string): SeriesPoint => {
    const key = period.slice(0, 7);
    const found = byPeriod.get(key);
    if (found) return found;
    const created: SeriesPoint = { period: key, actual: null, forecast: {}, isTest: false };
    byPeriod.set(key, created);
    return created;
  };

  for (const row of series) {
    const point = ensure(row.period);
    point.actual = row.quantity;
    if (row.segment === 'TEST') point.isTest = true;
  }
  const bandModel = champion?.championModelId ?? runModels[0]?.modelId ?? null;
  for (const row of forecast) {
    const point = ensure(row.period);
    point.forecast[row.modelId] = row.predictedQty;
    if (row.modelId === bandModel) {
      point.p80 = row.p80;
      point.p90 = row.p90;
    }
    // 예측 구간이 검증 구간과 겹치면 음영도 여기까지입니다
  }

  // 종속수요(기종 예측 × BOM) — 있을 때만 시리즈로 얹습니다 (sql/35 analytics.v_demand_compare).
  const hasDependent = compare.some((row) => row.dependentQty !== null);
  for (const row of compare) {
    if (row.dependentQty === null) continue;
    ensure(row.period).forecast[DEPENDENT_MODEL] = row.dependentQty;
  }

  const chartData = Array.from(byPeriod.values()).sort((a, b) => a.period.localeCompare(b.period));
  const chartModels = [
    ...runModels.map((m) => ({
      modelId: m.modelId,
      label: m.modelName ?? m.modelId,
      isChampion: m.modelId === champion?.championModelId,
    })),
    ...(hasDependent ? [{ modelId: DEPENDENT_MODEL, label: '종속수요 (기종 × BOM)' }] : []),
  ];

  const columns: Column<ModelPerformance>[] = [
    {
      key: 'rank',
      label: '순위',
      align: 'right',
      variant: 'num',
      render: (row) => (row.rank === null ? <EmptyValue align="right" showLabel={false} /> : row.rank),
    },
    {
      key: 'model',
      label: '모델',
      variant: 'strong',
      render: (row) => (
        <span style={{ display: 'inline-flex', gap: 'var(--s-2)', alignItems: 'center' }}>
          {row.modelName ?? row.modelId}
          {row.isChampion && <Badge tone="safe">Champion</Badge>}
        </span>
      ),
    },
    {
      key: 'wape',
      label: 'WAPE',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.wape === null ? (
          <EmptyValue align="right" reason="INSUFFICIENT_SAMPLE" showLabel={false} />
        ) : (
          pct(row.wape)
        ),
    },
    {
      key: 'mape',
      label: 'MAPE',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.mape === null ? <EmptyValue align="right" showLabel={false} /> : pct(row.mape),
    },
    {
      key: 'bias',
      label: 'Bias',
      align: 'right',
      variant: 'num',
      render: (row) => {
        if (row.bias === null) return <EmptyValue align="right" showLabel={false} />;
        const value = row.bias * 100;
        return (
          <span style={{ color: value > 0 ? 'var(--crit-fg)' : 'var(--info-fg)', fontWeight: 500 }}>
            {value > 0 ? '+' : ''}
            {value.toFixed(1)}%
          </span>
        );
      },
    },
    {
      key: 'rmse',
      label: 'RMSE',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.rmse === null ? <EmptyValue align="right" showLabel={false} /> : formatNumber(row.rmse),
    },
    {
      key: 'improvement',
      label: '기준선 대비',
      align: 'right',
      variant: 'num',
      render: (row) => {
        if (row.baselineImprovement === null) return <EmptyValue align="right" showLabel={false} />;
        const value = row.baselineImprovement * 100;
        return (
          <span style={{ color: value > 0 ? 'var(--safe-fg)' : 'var(--text-3)', fontWeight: 500 }}>
            {value > 0 ? '+' : ''}
            {value.toFixed(1)}%
          </span>
        );
      },
    },
    { key: 'periods', label: '채점 기간', align: 'right', variant: 'num', render: (row) => row.periods },
  ];

  return (
    <>
      {header}

      <StaleBanner />

      <ItemSearchPanel
        q={q}
        results={search.rows}
        selectedItemId={activeItem}
        title="품목 선택"
        hint="대표코드 · 품목명 · 구코드로 검색 · 아래 칩은 Champion 기준 WAPE 낮은 순"
      >
        <div className="chart-legend">
          {champions.slice(0, 24).map((item) => {
            const active = item.itemId === activeItem;
            return (
              <Link
                key={item.itemId}
                href={`?item=${item.itemId}`}
                className="chart-legend-item"
                aria-pressed={active}
                style={
                  active ? { borderColor: 'var(--ink)', color: 'var(--text-1)', fontWeight: 600 } : undefined
                }
              >
                <span className="t-code">{item.itemId}</span>
                <span className="text-3">{pct(item.wape) ?? '—'}</span>
              </Link>
            );
          })}
        </div>
      </ItemSearchPanel>

      <div className="grid grid-kpi">
        <KpiCard
          label="Champion"
          value={champion?.modelName ?? champion?.championModelId ?? null}
          icon={Award}
          foot={champion?.selectionMethod === 'MANUAL' ? '관리자 수동 지정' : '자동 선정'}
        />
        <KpiCard
          label="WAPE"
          value={pct(champion?.wape ?? null)}
          icon={Gauge}
          reason="INSUFFICIENT_SAMPLE"
          foot="낮을수록 좋습니다"
        />
        <KpiCard
          label="Bias"
          value={champion?.bias === null || champion?.bias === undefined ? null : pct(champion.bias)}
          icon={Ruler}
          reason="INSUFFICIENT_SAMPLE"
          tone={champion?.bias !== null && champion?.bias !== undefined && Math.abs(champion.bias) > 0.1 ? 'warn' : 'default'}
          foot="+ 는 과대예측 · − 는 과소예측"
        />
        <KpiCard
          label="기준선 대비"
          value={
            champion?.baselineImprovement === null || champion?.baselineImprovement === undefined
              ? null
              : pct(champion.baselineImprovement)
          }
          icon={LineChart}
          reason="INSUFFICIENT_SAMPLE"
          foot="이동평균 3개월 대비 개선율"
        />
      </div>

      <Panel
        title={`${activeItem} 실적과 예측`}
        actions={<span className="t-label">음영 = 검증 구간 · 파선 = 예측 · 밴드 = Champion 의 P80/P90</span>}
      >
        {chartData.length === 0 ? (
          <EmptyState title="그릴 데이터가 없습니다" />
        ) : (
          <ForecastOverlayChart data={chartData} models={chartModels} bandModelId={bandModel} />
        )}
      </Panel>

      <InsightBanner eyebrow="MODEL COMPARISON">
        위 범례를 눌러 모델을 켜고 끌 수 있습니다. <b>다시 계산하지 않습니다</b> — 실행 시점에 모든 모델 결과를
        저장해 두었기 때문입니다(<span className="t-code">renew.prd</span> 16.5). 학습·검증 기간을 바꾸려면 예측을
        다시 실행해야 하지만, 모델을 켜고 끄는 것은 조회만으로 처리됩니다.
      </InsightBanner>

      <ChartFrame
        title="모델별 WAPE · Bias"
        desc="이 품목의 후보 전체 · WAPE 는 낮을수록, Bias 는 0 에 가까울수록 좋습니다 · 테두리는 Champion"
        empty={performance.length === 0 ? '이 품목은 아직 채점되지 않았습니다' : null}
      >
        <ComparisonMetricBars bars={toMetricBars(performance)} />
      </ChartFrame>

      <Panel
        title="성능 비교"
        actions={
          <a className="btn secondary" href={`/api/backtest/performance.csv?item=${activeItem}`}>
            CSV 내보내기
          </a>
        }
        flush
      >
        {performance.length === 0 ? (
          <EmptyState
            title="이 품목은 아직 채점되지 않았습니다"
            desc="모델 평가 화면에서 백테스트를 실행해주세요."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={performance}
            rowKey={(row) => row.modelId}
            caption="analytics.v_model_performance — 후보 전체 성능"
          />
        )}
      </Panel>

      {user?.role === 'ADMIN' && performance.length > 0 && (
        <Panel
          title="Champion 수동 지정"
          actions={<span className="t-label">성능이 조금 낮아도 설명 가능성을 택할 수 있습니다</span>}
        >
          <ChampionForm
            itemId={activeItem}
            models={performance.map((row) => ({
              modelId: row.modelId,
              label: `${row.modelName ?? row.modelId} · WAPE ${pct(row.wape) ?? '—'}`,
            }))}
            current={champion?.championModelId ?? null}
          />
        </Panel>
      )}
    </>
  );
}
