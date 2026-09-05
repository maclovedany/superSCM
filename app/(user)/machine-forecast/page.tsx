// 기종 예측 — 실데이터 전환 Plan 3 (spec §7 /machine-forecast)
//
// 기종 하나를 고르면
//   ① 차트 — 판매 실적(act) 잉크 실선 · 영업 OL · SCM OL(사람의 예측) · 모델 예측(파선) · Champion 밴드
//   ② 표   — 그 기종 1대에 딸린 구성품(Neutral · 필수 옵션 · SCC · BOM)마다
//            구성수량 · 기종 예측 합 × 구성수량 = 종속수요 · 그 품목의 독립 예측 · 둘의 차이
//
// ★ 이 화면은 새 숫자를 만들지 않습니다. 종속수요는 core.build_dependent_demand() 가 운영 실행
//   끝에 써 둔 값이고(sql/35), 독립 예측은 core.forecast_current 입니다. 여기서는 병합만 합니다.
//
// kpi-filter: 없음 — 이 화면의 카드는 기종 하나의 설명 지표라 좁힐 목록이 없습니다.

import Link from 'next/link';
import { Factory, Layers, Sigma, Target } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import Badge from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import InsightBanner from '@/components/ui/insight-banner';
import Forbidden from '@/components/ui/forbidden';
import StaleBanner from '@/components/ui/stale-banner';
import ItemSearchPanel from '@/components/ui/item-search-panel';
import { EmptyState, ErrorState } from '@/components/ui/state';
import ForecastOverlayChart, { type SeriesPoint } from '@/components/chart/forecast-overlay-chart';
import { isSalesUser, requireUser } from '@/lib/auth';
import { readFilter, type SearchParams } from '@/lib/filter';
import { getForecastDetail, getLatestValidationRun, getRunModels } from '@/lib/forecast';
import { getChampions } from '@/lib/backtest';
import { getMachineBom, getMachinePlanActual, getMachines } from '@/lib/machines';
import { ROLE_LABEL, SALES_OL_MODEL, SCM_OL_MODEL, type MachineBomRow } from '@/lib/machines-model';
import { searchItems } from '@/lib/items';

export const dynamic = 'force-dynamic';

const bomColumns: Column<MachineBomRow>[] = [
  { key: 'role', label: '역할', render: (row) => <Badge tone={row.role === 'MUST_OPTION' ? 'info' : 'plain'}>{ROLE_LABEL[row.role] ?? row.role}</Badge> },
  {
    key: 'itemId', label: '구성품', variant: 'code',
    render: (row) => (
      <Link href={`/model-comparison?item=${encodeURIComponent(row.itemId)}`} style={{ color: 'var(--info-fg)' }}>{row.itemId}</Link>
    ),
  },
  { key: 'itemName', label: '품목명', variant: 'strong', render: (row) => row.itemName ?? '—' },
  { key: 'qty', label: '구성수량', align: 'right', variant: 'num', render: (row) => (row.qtyPerUnit === null ? <EmptyValue align="right" /> : formatNumber(row.qtyPerUnit)) },
  { key: 'dependent', label: '종속수요 (지평 합)', align: 'right', variant: 'num', render: (row) => (row.dependentH === null ? <EmptyValue align="right" reason={row.reasonCode === 'NO_MACHINE_FORECAST' ? 'NO_FORECAST' : undefined} showLabel={false} /> : formatNumber(Math.round(row.dependentH))) },
  { key: 'independent', label: '독립 예측 (지평 합)', align: 'right', variant: 'num', render: (row) => (row.independentH === null ? <EmptyValue align="right" reason="NO_FORECAST" showLabel={false} /> : formatNumber(Math.round(row.independentH))) },
  {
    key: 'gap', label: '차이 (독립 − 종속)', align: 'right', variant: 'num',
    render: (row) => row.gapH === null ? <EmptyValue align="right" /> : (
      <span className={Math.abs(row.gapH) > Math.max(1, (row.dependentH ?? 0) * 0.5) ? 'hl-warn' : undefined}>{row.gapH > 0 ? '+' : ''}{formatNumber(Math.round(row.gapH))}</span>
    ),
  },
  { key: 'common', label: '공용', render: (row) => (row.isCommon ? <Badge tone="warn">{row.nModels ?? '여러'} 기종 공용</Badge> : <span className="text-3">—</span>) },
];

export default async function MachineForecastPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const params = await searchParams;
  const q = readFilter(params, 'q') ?? '';
  const requested = readFilter(params, 'item');

  const header = (
    <PageHeader
      title="기종 예측"
      subtitle="기종의 판매 실적과 영업 OL · SCM OL · 모델 예측을 한 차트에 겹치고, 그 기종 1대에 딸린 필수품 · 옵션의 종속수요를 독립 예측과 나란히 봅니다."
      meta={<><MetaChip>실데이터</MetaChip><MetaChip>종속수요</MetaChip></>}
    />
  );

  if (isSalesUser(user)) {
    return (<>{header}<Forbidden role={user?.role ?? 'USER'} reason="예측 정확도와 기종 계획은 영업 권한에서 볼 수 없습니다 (renew.prd 4.5)." /></>);
  }

  const [{ rows: machines, error: machineError }, run, search] = await Promise.all([
    getMachines(),
    getLatestValidationRun(),
    q.trim().length >= 2 ? searchItems(q, 30, { machinesOnly: true }) : Promise.resolve({ rows: [], error: null }),
  ]);

  if (machineError) return (<>{header}<Panel><ErrorState detail={machineError} /></Panel></>);
  if (machines.length === 0) {
    return (<>{header}<Panel><EmptyState title="기종이 없습니다" desc="6회차 실데이터(raw.dim_model)를 적재하고 sql/34 를 실행하면 기종 137개가 여기에 나타납니다." /></Panel></>);
  }

  const activeItem = requested && machines.some((m) => m.itemId === requested) ? requested : machines[0].itemId;
  const machine = machines.find((m) => m.itemId === activeItem) ?? machines[0];

  const [plan, bom, detail, runModels, champions] = await Promise.all([
    getMachinePlanActual(activeItem),
    getMachineBom(activeItem),
    run ? getForecastDetail(run.runId, activeItem) : Promise.resolve({ rows: [], error: null }),
    run ? getRunModels(run.runId) : Promise.resolve({ rows: [], error: null }),
    getChampions(),
  ]);
  const champion = champions.rows.find((c) => c.itemId === activeItem) ?? null;

  // ── 차트 데이터 병합 — 계산이 아니라 병합입니다 ──
  const byPeriod = new Map<string, SeriesPoint>();
  const ensure = (period: string): SeriesPoint => {
    const key = period.slice(0, 7);
    const found = byPeriod.get(key);
    if (found) return found;
    const created: SeriesPoint = { period: key, actual: null, forecast: {}, isTest: false };
    byPeriod.set(key, created);
    return created;
  };
  for (const row of plan.rows) {
    const point = ensure(row.period);
    point.actual = row.act;
    if (row.salesOl !== null) point.forecast[SALES_OL_MODEL] = row.salesOl;
    if (row.scmOl !== null) point.forecast[SCM_OL_MODEL] = row.scmOl;
  }
  const bandModel = champion?.championModelId ?? runModels.rows[0]?.modelId ?? null;
  for (const row of detail.rows) {
    const point = ensure(row.period);
    point.forecast[row.modelId] = row.predictedQty;
    if (row.modelId === bandModel) { point.p80 = row.p80; point.p90 = row.p90; }
  }
  const chartData = Array.from(byPeriod.values()).sort((a, b) => a.period.localeCompare(b.period));
  const chartModels = [
    { modelId: SALES_OL_MODEL, label: '영업 OL' },
    { modelId: SCM_OL_MODEL, label: 'SCM OL' },
    ...runModels.rows
      .filter((m) => detail.rows.some((d) => d.modelId === m.modelId))
      .map((m) => ({ modelId: m.modelId, label: m.modelName ?? m.modelId, isChampion: m.modelId === champion?.championModelId })),
  ];

  const nActual = plan.rows.filter((r) => r.act !== null).length;
  const mustOptions = bom.rows.filter((r) => r.role === 'MUST_OPTION').length;
  const common = bom.rows.filter((r) => r.isCommon).length;
  const horizonDependent = bom.rows.reduce((sum, r) => sum + (r.dependentH ?? 0), 0);
  const hasDependent = bom.rows.some((r) => r.dependentH !== null);

  return (
    <>
      {header}
      <StaleBanner />

      <ItemSearchPanel
        q={q}
        results={search.rows}
        selectedItemId={activeItem}
        title="기종 선택"
        hint="기종 코드(MDL…)로 찾습니다. 실적이 많은 기종이 앞에 옵니다."
      >
        <div className="chart-legend">
          {machines.slice(0, 24).map((m) => {
            const active = m.itemId === activeItem;
            return (
              <Link key={m.itemId} href={`?item=${encodeURIComponent(m.itemId)}`} className="chart-legend-item" aria-pressed={active} scroll={false}
                style={active ? { borderColor: 'var(--ink)', color: 'var(--text-1)', fontWeight: 600 } : undefined}>
                <span className="t-code">{m.itemId}</span>
                <span className="text-3">{m.nActualMonths > 0 ? `실적 ${m.nActualMonths}개월` : '실적 없음'}</span>
              </Link>
            );
          })}
        </div>
      </ItemSearchPanel>

      <div className="grid grid-kpi">
        <KpiCard label="판매 실적" value={nActual > 0 ? nActual : null} unit={nActual > 0 ? '개월' : undefined} icon={Factory} reason={nActual === 0 ? 'INSUFFICIENT_SAMPLE' : null} foot={machine.itemName ?? machine.itemId} />
        <KpiCard label="Champion" value={champion?.modelName ?? champion?.championModelId ?? null} icon={Target} reason={champion ? null : 'INSUFFICIENT_SAMPLE'} foot={champion?.wape === null || !champion ? '백테스트 전' : `WAPE ${(champion.wape * 100).toFixed(1)}%`} />
        <KpiCard label="구성품" value={bom.rows.length} unit="개" icon={Layers} foot={`필수 옵션 ${mustOptions} · 공용 ${common}`} />
        <KpiCard label="종속수요 (지평 합)" value={hasDependent ? Math.round(horizonDependent) : null} unit={hasDependent ? '개' : undefined} icon={Sigma} reason={hasDependent ? null : 'NO_FORECAST'} foot="기종 예측 × 구성수량, 구성품 전체 합" />
      </div>

      <Panel
        title={`${machine.itemName ?? machine.itemId} · 실적과 예측`}
        actions={<span className="t-label">잉크 실선 = 판매 실적 · 영업 OL · SCM OL 은 사람의 예측 · 파선 = 모델</span>}
      >
        {plan.error || detail.error ? (
          <ErrorState detail={plan.error ?? detail.error ?? ''} />
        ) : chartData.length === 0 ? (
          <EmptyState title="이 기종은 실적도 예측도 없습니다" desc="fact_mc_plan_actual 에 실적(act)이 있는 기종만 차트가 그려집니다." />
        ) : (
          <ForecastOverlayChart data={chartData} models={chartModels} bandModelId={bandModel} />
        )}
      </Panel>

      <InsightBanner eyebrow="DEPENDENT DEMAND">
        아래 표의 <b>종속수요</b>는 이 기종의 Champion 예측에 구성수량을 곱한 값이고, <b>독립 예측</b>은 그 구성품 자신의
        출고 실적으로 낸 예측입니다. 둘이 크게 다르면 기종 판매와 무관하게 나가는 수요(보수 · 교체)가 있거나,
        공용 옵션이 다른 기종에도 실리는 것입니다. <span className="hl-warn">공용</span> 표시가 있는 행은 기종별로 더하면
        이중 계상됩니다.
      </InsightBanner>

      <Panel title="구성품 — 종속수요 vs 독립 예측" actions={<span className="t-label">구성품을 누르면 모델 비교로 갑니다</span>} flush>
        {bom.error ? (
          <ErrorState detail={bom.error} />
        ) : bom.rows.length === 0 ? (
          <EmptyState title="구성 정보가 없습니다" desc="BOM · CAP · 옵션 표에 이 기종이 없습니다." />
        ) : (
          <DataTable columns={bomColumns} rows={bom.rows} rowKey={(row) => `${row.role}-${row.itemId}`} caption="analytics.v_machine_bom_forecast — 기종 1대 구성품의 종속수요와 독립 예측" />
        )}
      </Panel>
    </>
  );
}
