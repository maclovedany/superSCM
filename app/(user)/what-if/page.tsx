// What-If 시뮬레이션 — renew.prd 25장
//
//   "Base Scenario 와 나란히 비교한다."                     (25.2)
//   "★ 실제 데이터를 변경하지 않는다. 시뮬레이션 컨텍스트에서만 계산한다." (25.2)
//
// 계산은 전부 SQL 입니다 (AGENTS.md 규칙 2). 이 화면은 rpc 두 번의 결과를 그립니다.
//   core.simulate_scenario          기간별 Base vs 시나리오 (차트 · 표)
//   core.simulate_scenario_summary  요약 (KPI 카드 · 판정)
// 두 함수 모두 `stable` 이라 본문에서 쓰기가 불가능합니다 — "안 바꾼다" 가 성질입니다.
//
// ★ 결과는 URL 에 있습니다 (?item= · ?p=<base64 파라미터>).
//   클라이언트 state 에 두면 링크로 공유할 수 없고 뒤로가기가 어긋납니다.
//   서버 컴포넌트가 URL 을 읽어 매번 다시 계산합니다 — 저장된 숫자를 믿지 않습니다.

import Link from 'next/link';
import {
  CalendarClock,
  CalendarX2,
  PackageCheck,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import Badge, { StatusBadge } from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import Forbidden from '@/components/ui/forbidden';
import { ErrorState, EmptyState } from '@/components/ui/state';
import ComparisonChart, { type ComparisonPoint } from '@/components/chart/comparison-chart';
import { isSalesUser, requireUser } from '@/lib/auth';
import { getProjectionItems } from '@/lib/inventory';
import {
  DELAY_ABSORBED_MESSAGE,
  PARAM_LABEL,
  SCENARIO_PRESETS,
  dayDelta,
  decodeParams,
  delayAbsorbed,
  delta,
  monthOf,
  presetOf,
  runWhatIf,
  type WhatIfPoint,
  type WhatIfSide,
} from '@/lib/what-if';
import type { SearchParams } from '@/lib/filter';
import WhatIfForm from './what-if-form';
import WhatIfNlForm from './what-if-nl-form';
import ChartFrame from '@/components/chart/_base/chart-frame';
import WhatIfCompare from '@/components/chart/whatif-compare';
import { toWhatIfCompare } from '@/lib/chart-model';

export const dynamic = 'force-dynamic';

// kpi-filter: 없음 — 이 화면의 카드는 목록의 부분집합이 아니라 한 품목의 두 가정을
// 나란히 놓은 값입니다. 좁힐 목록이 없습니다 (AGENTS.md 규칙 9 · design.md §6.4).
// 목록을 고르는 조작은 위의 품목 선택 칩이 맡습니다.

function param(params: SearchParams, key: string): string | null {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** 차이 한 줄. 값이 없으면 아무것도 그리지 않습니다 (0 으로 채우지 않습니다) */
function deltaOf(value: number | null, unit: string): { value: string; direction: 'up' | 'down' | 'flat' } | undefined {
  if (value === null) return undefined;
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return { value: `± 0${unit}`, direction: 'flat' };
  return {
    value: `${rounded > 0 ? '+' : '−'}${formatNumber(Math.abs(rounded))}${unit}`,
    direction: rounded > 0 ? 'up' : 'down',
  };
}

/** 한 쪽(Base 또는 시나리오)의 KPI 넉 장 */
function SideCards({ side, against }: { side: WhatIfSide; against?: WhatIfSide }) {
  return (
    <div className="grid grid-2">
      <KpiCard
        label="결품 예상일"
        value={side.stockoutDate}
        icon={CalendarX2}
        reason={side.reason}
        tone={side.risk === 'CRITICAL' ? 'crit' : side.risk === 'WARNING' ? 'warn' : 'default'}
        delta={
          against ? deltaOf(dayDelta(against.stockoutDate, side.stockoutDate), '일') : undefined
        }
        foot="기말이 처음 음수가 되는 시점"
      />
      <KpiCard
        label="안전재고"
        value={side.safetyStock}
        unit={side.safetyStock === null ? undefined : '개'}
        icon={ShieldCheck}
        reason={side.reason}
        delta={against ? deltaOf(delta(against.safetyStock, side.safetyStock), '개') : undefined}
        foot="Z × σ_DLT"
      />
      <KpiCard
        label="발주 수량"
        value={side.orderQty === null ? null : Math.round(side.orderQty)}
        unit={side.orderQty === null ? undefined : '개'}
        icon={PackageCheck}
        reason={side.reason}
        delta={against ? deltaOf(delta(against.orderQty, side.orderQty), '개') : undefined}
        foot="MOQ · 포장 단위 반영"
      />
      <KpiCard
        label="발주 권고일"
        value={side.requiredOrderDate}
        icon={CalendarClock}
        reason={side.reason}
        delta={
          against
            ? deltaOf(dayDelta(against.requiredOrderDate, side.requiredOrderDate), '일')
            : undefined
        }
        foot="결품일 − 리드타임 − 여유일"
      />
    </div>
  );
}

function Qty({ value }: { value: number | null }) {
  if (value === null) return <EmptyValue align="right" showLabel={false} />;
  return <>{formatNumber(value)}</>;
}

const columns: Column<WhatIfPoint>[] = [
  { key: 'period', label: '기간', variant: 'code', render: (row) => monthOf(row.period) },
  {
    key: 'baseOpening',
    label: '기초 (기준)',
    align: 'right',
    variant: 'num',
    render: (row) => <Qty value={row.baseOpening} />,
  },
  {
    key: 'baseReceipt',
    label: '입고 (기준)',
    align: 'right',
    variant: 'num',
    render: (row) => <Qty value={row.baseReceipt} />,
  },
  {
    key: 'baseDemand',
    label: '수요 (기준)',
    align: 'right',
    variant: 'num',
    render: (row) => <Qty value={row.baseDemand} />,
  },
  {
    key: 'baseClosing',
    label: '기말 (기준)',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.baseClosing === null ? (
        <EmptyValue align="right" showLabel={false} />
      ) : (
        <span className={row.baseClosing < 0 ? 'hl-crit' : undefined}>
          {formatNumber(row.baseClosing)}
        </span>
      ),
  },
  {
    key: 'scenarioOpening',
    label: '기초 (시나리오)',
    align: 'right',
    variant: 'num',
    render: (row) => <Qty value={row.scenarioOpening} />,
  },
  {
    key: 'scenarioReceipt',
    label: '입고 (시나리오)',
    align: 'right',
    variant: 'num',
    render: (row) => <Qty value={row.scenarioReceipt} />,
  },
  {
    key: 'scenarioDemand',
    label: '수요 (시나리오)',
    align: 'right',
    variant: 'num',
    render: (row) => <Qty value={row.scenarioDemand} />,
  },
  {
    key: 'scenarioClosing',
    label: '기말 (시나리오)',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.scenarioClosing === null ? (
        <EmptyValue align="right" showLabel={false} />
      ) : (
        <span className={row.scenarioClosing < 0 ? 'hl-crit' : undefined}>
          {formatNumber(row.scenarioClosing)}
        </span>
      ),
  },
];

export default async function WhatIfPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();

  const header = (
    <PageHeader
      title="What-If 시뮬레이션"
      subtitle="가정을 바꿔 결품 예상일 · 안전재고 · 발주 수량을 기준(Base)과 나란히 놓습니다. 실제 데이터는 바뀌지 않습니다."
      meta={<MetaChip>PRD 25</MetaChip>}
    />
  );

  // 리드타임 통계와 발주 수량이 결과에 들어갑니다 (renew.prd 4.5).
  // DB 함수도 core.is_sales() 로 막지만, 화면에서 먼저 말해 줍니다.
  if (isSalesUser(user)) {
    return (
      <>
        {header}
        <Forbidden role={user.role} reason="영업 권한에서 볼 수 없는 화면입니다." />
      </>
    );
  }

  const params = await searchParams;
  const { rows: items, error: itemError } = await getProjectionItems();

  const requested = param(params, 'item');
  const activeItem = requested && requested.trim() !== '' ? requested.trim() : items[0]?.itemId ?? null;

  // 폼의 기본값 — 지금 보고 있는 시나리오(?p=)가 있으면 그것, 없으면 프리셋 칩(?preset=).
  const encoded = param(params, 'p');
  const fromUrl = decodeParams(encoded);
  const preset = presetOf(param(params, 'preset'));
  const formDefaults = encoded ? fromUrl.params : (preset?.params ?? {});

  const result =
    activeItem && encoded ? await runWhatIf(activeItem, fromUrl.params) : null;

  const itemChips = (
    <Panel title="품목 선택" actions={<span className="t-label">결품 임박 순 · 산출 불가는 맨 뒤</span>}>
      <div className="chart-legend">
        {items.slice(0, 24).map((item) => {
          const active = item.itemId === activeItem;
          return (
            <Link
              key={item.itemId}
              href={`/what-if?item=${encodeURIComponent(item.itemId)}`}
              className="chart-legend-item"
              aria-pressed={active}
              scroll={false}
              style={
                active
                  ? { borderColor: 'var(--ink)', color: 'var(--text-1)', fontWeight: 600 }
                  : undefined
              }
            >
              <span className="t-code">{item.itemId}</span>
              <StatusBadge status={item.riskStatus} />
            </Link>
          );
        })}
      </div>
    </Panel>
  );

  if (itemError) {
    return (
      <>
        {header}
        <Panel>
          <ErrorState detail={itemError} />
        </Panel>
      </>
    );
  }

  if (!activeItem) {
    return (
      <>
        {header}
        <Panel>
          <EmptyState
            title="시뮬레이션할 품목이 없습니다"
            desc="sql/15 · sql/16 · sql/24 를 실행하고, 관리자 화면에서 예측을 한 번 실행해주세요."
          />
        </Panel>
      </>
    );
  }

  const summary = result?.summary ?? null;

  // 사람이 읽는 "바꾼 가정" 줄. 라벨은 lib/what-if-model.ts 한 곳에 있습니다.
  const appliedList = summary
    ? Object.entries(summary.paramsApplied).map(
        ([key, value]) =>
          `${PARAM_LABEL[key as keyof typeof PARAM_LABEL] ?? key} ${String(value)}`,
      )
    : [];

  // 입고 지연이 흡수됐는가 — 판정은 lib 의 순수 함수가 합니다 (화면은 그리기만).
  const absorbed = summary
    ? delayAbsorbed(summary.paramsApplied, result?.series ?? [])
    : null;

  const chartData: ComparisonPoint[] = (result?.series ?? []).map((row) => ({
    period: monthOf(row.period),
    actual: row.baseClosing,
    simulated: row.scenarioClosing,
    actualStockout: row.baseClosing !== null && row.baseClosing < 0,
    simStockout: row.scenarioClosing !== null && row.scenarioClosing < 0,
  }));

  return (
    <>
      {header}

      {itemChips}

      <Panel
        title="시나리오"
        actions={<span className="t-label">renew.prd 25.1 의 7종</span>}
      >
        <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
          <WhatIfNlForm itemId={activeItem} />

          <div>
            <p className="t-label" style={{ marginBottom: 'var(--s-3)' }}>
              프리셋 — 누르면 아래 폼이 채워집니다
            </p>
            <div className="chart-legend">
              {SCENARIO_PRESETS.map((item) => {
                const active = preset?.key === item.key;
                return (
                  <Link
                    key={item.key}
                    href={`/what-if?item=${encodeURIComponent(activeItem)}&preset=${item.key}`}
                    className="chart-legend-item"
                    aria-pressed={active}
                    title={item.description}
                    scroll={false}
                    style={
                      active
                        ? { borderColor: 'var(--ink)', color: 'var(--text-1)', fontWeight: 600 }
                        : undefined
                    }
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
            {preset && (
              <p className="t-sm text-3" style={{ marginTop: 'var(--s-3)' }}>
                {preset.description}
              </p>
            )}
          </div>

          <WhatIfForm itemId={activeItem} defaults={formDefaults} />
        </div>
      </Panel>

      {result?.error && (
        <Panel>
          <ErrorState detail={result.error} />
        </Panel>
      )}

      {result && !result.error && summary && !summary.found && (
        <Panel>
          <EmptyState
            title="요청한 품목을 찾을 수 없습니다"
            desc={`품목코드 ${activeItem} 에 해당하는 활성 품목이 없습니다. 단종되었거나 주소가 잘못되었을 수 있습니다. 위 목록에서 품목을 골라주세요.`}
          />
        </Panel>
      )}

      {summary?.found && (
        <>
          {summary.ignored.length > 0 && (
            <div className="stale-banner">
              <TriangleAlert size={15} aria-hidden />
              모르는 파라미터가 있어 적용하지 않았습니다: {summary.ignored.join(' · ')}
            </div>
          )}

          {/* 입고 지연을 넣었는데 도착 달이 하나도 바뀌지 않았습니다.
              두 열이 똑같은 채로 "지연 적용됨" 만 보이면 기능이 고장 난 것처럼 읽힙니다. */}
          {absorbed && (
            <div className="stale-banner">
              <TriangleAlert size={15} aria-hidden />
              {DELAY_ABSORBED_MESSAGE[absorbed]}
            </div>
          )}

          <Panel
            title={summary.itemName ?? summary.itemId}
            actions={<span className="t-label t-code">{summary.itemId}</span>}
          >
            <p className="t-sm">
              바꾼 가정 —{' '}
              {appliedList.length === 0 ? (
                <span className="text-3">없음. 시나리오가 기준과 같습니다</span>
              ) : (
                appliedList.map((line) => (
                  <Badge key={line} tone="info">
                    {line}
                  </Badge>
                ))
              )}
            </p>
          </Panel>

          <div className="grid grid-2">
            <Panel
              title="기준 (Base)"
              actions={<StatusBadge status={summary.base.risk} />}
            >
              <SideCards side={summary.base} />
            </Panel>
            <Panel
              title="시나리오"
              actions={<StatusBadge status={summary.scenario.risk} />}
            >
              <SideCards side={summary.scenario} against={summary.base} />
            </Panel>
          </div>

          {/* ── 지표 비교 — spec §4.3 ── */}
          <ChartFrame title="지표 비교" desc="기준과 시나리오의 결품까지 일수 · 안전재고 · 발주 수량 · 리드타임">
            <WhatIfCompare rows={toWhatIfCompare(summary.base, summary.scenario)} />
          </ChartFrame>

          <Panel
            title="재고 전개 비교"
            actions={
              <span className="t-label">
                기말 재고 · 0선 아래가 결품
                {summary.dataSnapshotAt ? ` · 기준 ${summary.dataSnapshotAt.slice(0, 10)}` : ''}
              </span>
            }
          >
            {chartData.length === 0 ? (
              <EmptyState
                title="전개할 기간이 없습니다"
                desc="이 품목의 예측이 없습니다. 예측을 먼저 실행해주세요."
              />
            ) : (
              <ComparisonChart data={chartData} actualLabel="기준" simulatedLabel="시나리오" />
            )}
          </Panel>

          <Panel title="기간별" flush>
            <DataTable
              columns={columns}
              rows={result?.series ?? []}
              rowKey={(row) => row.period}
              caption="기간별 기준과 시나리오의 기초 · 입고 · 수요 · 기말"
            />
          </Panel>
        </>
      )}

      <Panel>
        <p className="t-sm text-3">
          실제 데이터는 바뀌지 않습니다. 시나리오는 저장되지 않으며 URL 로 공유할 수 있습니다.
          {summary?.found && (
            <>
              {' '}
              <Badge tone="plain">읽기 전용</Badge>
            </>
          )}
        </p>
      </Panel>
    </>
  );
}
