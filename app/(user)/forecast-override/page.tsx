// 예측 보정 (Forecast Override) — renew.prd 17장
//
// 담당자가 AI 예측을 고치지 않고 증감만 얹으면 Consensus 가 만들어집니다.
// 그 Consensus 는 재고 전개와 발주 추천이 이미 읽고 있습니다 (sql/15 · sql/16).
// 실적이 확정된 뒤에는 AI 와 Consensus 중 누가 더 맞았는지(Forecast Value Add)를 봅니다.
//
// 입력은 SKU Detail(② Consensus)에서 합니다. 이 화면은 이력과 성적표입니다.
//
// 계산은 전부 SQL 이 끝냈습니다. WAPE 도 개선률도 뷰가 냅니다 (AGENTS.md 규칙 2).
//
// ★ KPI 카드 숫자는 아래 표와 같은 200건에서 셉니다. 두 곳이 같은 배열을 보므로
//   카드와 목록이 어긋날 수 없습니다. 보정이 200건을 넘으면 양쪽이 함께 잘립니다.

import Link from 'next/link';
import { CalendarPlus, PencilLine, RotateCcw, Sparkles } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import Badge from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import InsightBanner from '@/components/ui/insight-banner';
import FilterNotice from '@/components/ui/filter-notice';
import { EmptyState, ErrorState } from '@/components/ui/state';
import { requireUser } from '@/lib/auth';
import {
  getOverrideExcess,
  getOverrides,
  getValueAdd,
  getValueAddByReason,
  getValueAddSummary,
} from '@/lib/override';
import { reasonLabel } from '@/lib/override-model';
import type { OverrideRow, ValueAddByReason, ValueAddRow } from '@/lib/override-model';
import { applyFilter, labelOf, readFilter, type FilterSpec, type SearchParams } from '@/lib/filter';
import ChartFrame from '@/components/chart/_base/chart-frame';
import OverrideReasonBars from '@/components/chart/override-reason-bars';
import OverrideErrorScatter from '@/components/chart/override-error-scatter';
import { toErrorPoints, toReasonBars } from '@/lib/chart-model';

export const dynamic = 'force-dynamic';

function pct(value: number | null, digits = 1): string | null {
  return value === null ? null : `${(value * 100).toFixed(digits)}%`;
}

function monthOf(period: string): string {
  return period.slice(0, 7);
}

/** 'YYYY-MM-DD HH:MM' — 초까지는 필요 없습니다 */
function stamp(value: string | null): string | null {
  if (value === null) return null;
  return value.slice(0, 16).replace('T', ' ');
}

/**
 * 이번 달에 입력된 보정인가.
 *
 * created_at 은 UTC 로 옵니다. 오늘도 UTC 로 잘라 같은 자로 비교합니다.
 * 두 값을 다른 시간대로 재면 월말·월초 하루가 카드와 목록에서 어긋납니다.
 */
function isThisMonth(createdAt: string | null, thisMonth: string): boolean {
  return createdAt !== null && createdAt.slice(0, 7) === thisMonth;
}

const columns: Column<OverrideRow>[] = [
  {
    key: 'itemId',
    label: '품목',
    variant: 'code',
    // 코드를 누르면 그 품목의 SKU Detail 로 갑니다. 입력 폼이 거기 있습니다.
    render: (row) => (
      <Link
        href={`/purchase-recommendation/${row.itemId}`}
        style={{ color: 'var(--info-fg)' }}
        title={row.itemName ?? row.itemId}
      >
        {row.itemId}
      </Link>
    ),
  },
  { key: 'itemName', label: '품목명', variant: 'strong', render: (row) => row.itemName },
  { key: 'period', label: '기간', variant: 'code', render: (row) => monthOf(row.period) },
  {
    key: 'aiForecast',
    label: 'AI 예측',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.aiForecast === null ? (
        <EmptyValue align="right" reason="NO_FORECAST" showLabel={false} />
      ) : (
        formatNumber(row.aiForecast)
      ),
  },
  {
    key: 'overrideQty',
    label: '증감',
    align: 'right',
    variant: 'num',
    render: (row) => {
      if (row.overrideQty === null) return <EmptyValue align="right" showLabel={false} />;
      return (
        <span className={row.overrideQty >= 0 ? 'hl-warn' : 'hl-crit'}>
          {row.overrideQty > 0 ? '+' : ''}
          {formatNumber(row.overrideQty)}
        </span>
      );
    },
  },
  {
    key: 'consensusForecast',
    label: 'Consensus',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.consensusForecast === null ? (
        <EmptyValue align="right" showLabel={false} />
      ) : (
        <b>{formatNumber(row.consensusForecast)}</b>
      ),
  },
  {
    key: 'reasonCode',
    label: '사유',
    render: (row) =>
      row.reasonCode === null ? (
        <span className="text-3">—</span>
      ) : (
        <span title={row.reasonText ?? undefined}>
          <Badge tone="info">{reasonLabel(row.reasonCode)}</Badge>
        </span>
      ),
  },
  {
    key: 'createdEmail',
    label: '입력자',
    render: (row) =>
      row.createdEmail === null ? <span className="text-3">—</span> : row.createdEmail,
  },
  {
    key: 'createdAt',
    label: '입력 시각',
    variant: 'code',
    render: (row) =>
      row.createdAt === null ? <span className="text-3">—</span> : stamp(row.createdAt),
  },
  {
    key: 'isActive',
    label: '상태',
    render: (row) =>
      row.isActive ? (
        <Badge tone="safe">유효</Badge>
      ) : (
        <span title={stamp(row.supersededAt) ?? undefined}>
          <Badge tone="plain">대체됨</Badge>
        </span>
      ),
  },
];

const valueAddColumns: Column<ValueAddRow>[] = [
  {
    key: 'itemId',
    label: '품목',
    variant: 'code',
    render: (row) => (
      <Link href={`/purchase-recommendation/${row.itemId}`} style={{ color: 'var(--info-fg)' }}>
        {row.itemId}
      </Link>
    ),
  },
  { key: 'period', label: '기간', variant: 'code', render: (row) => monthOf(row.period) },
  {
    key: 'actual',
    label: '실적',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.actual === null ? (
        <EmptyValue align="right" showLabel={false} />
      ) : (
        formatNumber(row.actual)
      ),
  },
  {
    key: 'aiForecast',
    label: 'AI 예측',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.aiForecast === null ? (
        <EmptyValue align="right" reason="NO_FORECAST" showLabel={false} />
      ) : (
        formatNumber(row.aiForecast)
      ),
  },
  {
    key: 'consensusForecast',
    label: 'Consensus',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.consensusForecast === null ? (
        <EmptyValue align="right" showLabel={false} />
      ) : (
        formatNumber(row.consensusForecast)
      ),
  },
  {
    key: 'aiAbsError',
    label: 'AI 오차',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.aiAbsError === null ? (
        <EmptyValue align="right" showLabel={false} />
      ) : (
        formatNumber(row.aiAbsError)
      ),
  },
  {
    key: 'consensusAbsError',
    label: 'Consensus 오차',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.consensusAbsError === null ? (
        <EmptyValue align="right" showLabel={false} />
      ) : (
        formatNumber(row.consensusAbsError)
      ),
  },
  {
    key: 'reasonCode',
    label: '사유',
    render: (row) =>
      row.reasonCode === null ? (
        <span className="text-3">—</span>
      ) : (
        <Badge tone="info">{reasonLabel(row.reasonCode)}</Badge>
      ),
  },
  {
    key: 'improved',
    label: '판정',
    // 오차를 못 구한 기간은 "개선하지 못했다" 가 아니라 "모른다" 입니다.
    render: (row) =>
      row.improved === null ? (
        <EmptyValue showLabel={false} />
      ) : row.improved ? (
        <Badge tone="safe">개선</Badge>
      ) : (
        <Badge tone="warn">개선 없음</Badge>
      ),
  },
];

const byReasonColumns: Column<ValueAddByReason>[] = [
  {
    key: 'reasonCode',
    label: '사유',
    render: (row) =>
      row.reasonCode === null ? (
        <span className="text-3">—</span>
      ) : (
        <Badge tone="info">{reasonLabel(row.reasonCode)}</Badge>
      ),
  },
  { key: 'n', label: '건수', align: 'right', variant: 'num', render: (row) => formatNumber(row.n) },
  {
    key: 'aiWape',
    label: 'AI WAPE',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.aiWape === null ? (
        <EmptyValue align="right" reason="INSUFFICIENT_SAMPLE" showLabel={false} />
      ) : (
        pct(row.aiWape)
      ),
  },
  {
    key: 'consensusWape',
    label: 'Consensus WAPE',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.consensusWape === null ? (
        <EmptyValue align="right" reason="INSUFFICIENT_SAMPLE" showLabel={false} />
      ) : (
        pct(row.consensusWape)
      ),
  },
  {
    key: 'improvementPct',
    label: '개선률',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.improvementPct === null ? (
        <EmptyValue align="right" reason="INSUFFICIENT_SAMPLE" showLabel={false} />
      ) : (
        <span className={row.improvementPct >= 0 ? undefined : 'hl-crit'}>
          {row.improvementPct > 0 ? '+' : ''}
          {pct(row.improvementPct)}
        </span>
      ),
  },
];

/**
 * KPI 카드 하나가 목록 필터 하나에 대응합니다 (design.md §6.4).
 * 카드 숫자도 이 배열로 셉니다 — 카드와 목록이 어긋날 수 없습니다.
 *
 * Value Add 개선률 카드에는 filter 를 주지 않았습니다.
 * // kpi-filter: 없음 — 개선률은 실적이 확정된 기간의 성적이라 보정 목록의 부분집합이 아닙니다.
 */
function filtersOf(thisMonth: string): FilterSpec<OverrideRow>[] {
  return [
    { key: 'all', label: '전체 보정', match: null },
    { key: 'active', label: '유효 보정', match: (row) => row.isActive },
    {
      key: 'month',
      label: '이번 달 입력',
      match: (row) => isThisMonth(row.createdAt, thisMonth),
    },
    { key: 'superseded', label: '해제·대체됨', match: (row) => !row.isActive },
  ];
}

export default async function ForecastOverridePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();

  const activeFilter = readFilter(await searchParams);

  const [overrides, valueAdd, summaryResult, byReason, excess] = await Promise.all([
    getOverrides(),
    getValueAdd(),
    getValueAddSummary(),
    getValueAddByReason(),
    getOverrideExcess(),
  ]);

  const header = (
    <PageHeader
      title="예측 보정"
      subtitle="AI 예측은 그대로 두고 증감만 따로 쌓습니다. AI 예측 + 보정 = Consensus 이고, 이 Consensus 가 재고 전개와 발주 추천에 들어갑니다. 실적이 확정된 기간은 AI 와 Consensus 중 누가 더 맞았는지 함께 봅니다."
      meta={
        <>
          <MetaChip>PRD 17</MetaChip>
          <MetaChip>입력은 SKU 상세 ②</MetaChip>
        </>
      }
    />
  );

  if (overrides.error) {
    return (
      <>
        {header}
        <Panel>
          <ErrorState detail={overrides.error} />
        </Panel>
      </>
    );
  }

  const thisMonth = new Date().toISOString().slice(0, 7);
  const FILTERS = filtersOf(thisMonth);
  const rows = overrides.rows;
  const visible = applyFilter(rows, FILTERS, activeFilter);
  const filterLabel = labelOf(FILTERS, activeFilter);

  const countOf = (key: string) => applyFilter(rows, FILTERS, key).length;
  const activeCount = countOf('active');
  const monthCount = countOf('month');
  const supersededCount = countOf('superseded');
  const activeItemCount = new Set(rows.filter((row) => row.isActive).map((row) => row.itemId)).size;

  const summary = summaryResult.data;

  // 조회 실패와 빈 결과를 구분합니다 (AGENTS.md 규칙 3 · design.md §8).
  // sql/18 을 아직 실행하지 않았다면 뷰가 없어 여기서 error 가 옵니다. 그때 "실적이 확정된
  // 기간이 아직 없습니다" 라고 말하면 화면이 없는 사실을 단정하게 됩니다.
  const valueAddError = summaryResult.error ?? valueAdd.error ?? byReason.error;

  // 보정 반복 품목도 마찬가지입니다. 조회에 실패한 빈 배열을 "반복 보정 없음" 으로 읽지 않고
  // 배너를 아예 감춥니다 — 배너는 없어도 화면이 성립합니다 (design.md §6.10).
  const excessTop =
    excess.error === null ? excess.rows.filter((row) => row.nRecent90d > 0).slice(0, 3) : [];

  return (
    <>
      {header}

      <div className="grid grid-kpi">
        <KpiCard
          label="유효 보정"
          value={activeCount}
          unit="건"
          icon={PencilLine}
          tone={activeCount > 0 ? 'warn' : 'default'}
          foot={`품목 ${activeItemCount.toLocaleString()}개에 적용 중`}
          filter={{ key: 'active', active: activeFilter === 'active' }}
        />
        <KpiCard
          label="이번 달 입력"
          value={monthCount}
          unit="건"
          icon={CalendarPlus}
          foot={`${thisMonth} 에 입력된 보정`}
          filter={{ key: 'month', active: activeFilter === 'month' }}
        />
        <KpiCard
          label="해제·대체됨"
          value={supersededCount}
          unit="건"
          icon={RotateCcw}
          foot="지금은 Consensus 에 들어가지 않습니다"
          filter={{ key: 'superseded', active: activeFilter === 'superseded' }}
        />
        {/* kpi-filter: 없음 — 개선률은 실적이 확정된 기간의 성적이라 이 목록으로 좁혀지지 않습니다 */}
        <KpiCard
          label="Value Add 개선률"
          value={pct(summary?.improvementPct ?? null)}
          icon={Sparkles}
          reason="INSUFFICIENT_SAMPLE"
          tone={
            summary?.improvementPct !== undefined &&
            summary?.improvementPct !== null &&
            summary.improvementPct < 0
              ? 'crit'
              : 'default'
          }
          foot={
            valueAddError
              ? '조회에 실패했습니다 — 아래 패널을 보세요'
              : summary && summary.nPeriods > 0
                ? `실적이 확정된 ${summary.nPeriods.toLocaleString()}개 기간 기준`
                : '실적이 확정된 기간이 아직 없습니다'
          }
        />
      </div>

      {excessTop.length > 0 && (
        <InsightBanner eyebrow="OVERRIDE INSIGHT">
          특정 품목에서 보정이 반복되면 모델 개선 신호입니다. 최근 90일 동안 보정이 가장 잦은 품목은{' '}
          {excessTop.map((row, index) => (
            <span key={row.itemId}>
              {index > 0 && ' · '}
              <b>{row.itemName ?? row.itemId}</b>(
              <span className="t-code">{row.itemId}</span>) <span className="hl-warn">
                {row.nRecent90d}회
              </span>
            </span>
          ))}{' '}
          입니다. 같은 방향으로 계속 고치고 있다면 모델이나 입력 데이터를 먼저 살펴보세요.
        </InsightBanner>
      )}

      {filterLabel && activeFilter !== 'all' && (
        <FilterNotice label={filterLabel} shown={visible.length} total={rows.length} />
      )}

      <Panel
        title="보정 이력"
        actions={<span className="t-label">최근 입력 순 · 최대 200건</span>}
        flush
      >
        {rows.length === 0 ? (
          <EmptyState
            title="아직 입력된 보정이 없습니다"
            desc="발주 추천 목록에서 품목을 열면 ② Consensus 표에서 기간별로 보정을 입력할 수 있습니다."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={`${filterLabel ?? ''} 에 해당하는 보정이 없습니다`}
            desc="위 카드를 다시 눌러 전체 목록으로 돌아갈 수 있습니다."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(row, index) => String(row.id ?? `${row.itemId}-${row.period}-${index}`)}
            caption="analytics.v_forecast_override — 보정 입력 이력"
          />
        )}
      </Panel>

      {/* ── 차트 띠 — spec §4.2 (Plan B: 기간별 선 대신 오차 산점도) ── */}
      <div className="grid-charts">
        <ChartFrame
          title="사유별 AI vs Consensus WAPE"
          desc="보정 사유마다 누가 더 맞았나 · 실적이 확정된 기간만"
          error={byReason.error}
          empty={byReason.rows.length === 0 ? '실적이 확정된 보정이 아직 없습니다' : null}
        >
          <OverrideReasonBars bars={toReasonBars(byReason.rows, (code) => reasonLabel(code) ?? code)} />
        </ChartFrame>
        <ChartFrame
          title="오차 비교"
          desc="점 하나가 품목 × 기간 · 대각선 아래는 보정이 AI 보다 맞은 것"
          error={valueAdd.error}
          empty={toErrorPoints(valueAdd.rows).length === 0 ? '두 오차를 낸 기간이 아직 없습니다' : null}
        >
          <OverrideErrorScatter points={toErrorPoints(valueAdd.rows)} />
        </ChartFrame>
      </div>

      <Panel
        title="Forecast Value Add"
        actions={<span className="t-label">WAPE 는 낮을수록 잘 맞은 것입니다</span>}
      >
        {valueAddError ? (
          <ErrorState detail={valueAddError} />
        ) : summary === null || summary.nPeriods === 0 ? (
          <EmptyState
            title="실적이 확정된 기간이 아직 없습니다"
            desc="기간이 끝나고 실적이 쌓이면 AI 예측과 Consensus 중 어느 쪽이 더 맞았는지 여기서 채점합니다."
          />
        ) : (
          <p className="t-sm text-2">
            실적이 확정된 <b>{summary.nPeriods.toLocaleString()}</b>개 기간에서 AI WAPE{' '}
            <b>{pct(summary.aiWape) ?? '—'}</b> 대 Consensus WAPE{' '}
            <b>{pct(summary.consensusWape) ?? '—'}</b> 입니다. 보정이 도움이 된 기간{' '}
            <span className="hl-warn">{summary.nImproved.toLocaleString()}</span>건, 오히려 나빴던
            기간 <span className="hl-crit">{summary.nWorsened.toLocaleString()}</span>건입니다.
            {summary.improvementPct !== null && (
              <>
                {' '}
                전체 개선률은 <b>{pct(summary.improvementPct)}</b> 입니다.
              </>
            )}
          </p>
        )}
      </Panel>

      {byReason.rows.length > 0 && (
        <Panel
          title="사유별 개선률"
          actions={<span className="t-label">어떤 유형의 보정이 효과적이었나</span>}
          flush
        >
          <DataTable
            columns={byReasonColumns}
            rows={byReason.rows}
            rowKey={(row, index) => row.reasonCode ?? `unknown-${index}`}
            caption="analytics.v_forecast_value_add_by_reason — 사유 코드별 AI · Consensus 오차"
          />
        </Panel>
      )}

      {valueAdd.rows.length > 0 && (
        <Panel
          title="기간별 채점"
          actions={<span className="t-label">최근 기간 순 · 최대 500건</span>}
          flush
        >
          <DataTable
            columns={valueAddColumns}
            rows={valueAdd.rows}
            rowKey={(row) => `${row.itemId}-${row.period}`}
            caption="analytics.v_forecast_value_add — 실적이 확정된 기간의 AI 오차와 Consensus 오차"
          />
        </Panel>
      )}
    </>
  );
}
