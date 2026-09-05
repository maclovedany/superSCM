// SKU Detail — renew.prd 29장
//
// 시스템의 핵심 업무 화면입니다. 예측 → Consensus → 재고 → 발주 → 승인을
// 위에서 아래로 한 흐름으로 읽습니다. 화면을 옮겨 다니지 않고 여기서 결정할 수 있어야 합니다.
//
// 계산은 전부 SQL 이 끝냈습니다. 여기서는 조회한 값을 병합해 그리기만 합니다 (AGENTS.md 규칙 2).
//
// ★ 다섯 절을 이 파일 안의 함수 컴포넌트로 나눠 두었습니다.
//   §2 ConsensusSection 의 표에는 STEP 12 가 Override 입력 폼을 붙였습니다(행마다 한 줄).
//   §5 ApprovalSection 에는 STEP 13 이 승인 폼과 결정 이력을 붙였습니다.
//
// ★ Primary 버튼은 §5 의 승인 버튼 하나뿐입니다 (design.md §14-8).
//   §2 의 보정 버튼은 secondary · ghost 입니다.
//
// kpi-filter: 없음 — 이 화면의 카드는 목록의 부분집합이 아니라 품목 하나를 설명하는
// 지표입니다. 좁힐 목록 자체가 없습니다 (design.md §6.4 · AGENTS.md 규칙 9).

import Link from 'next/link';
import { kstMinute } from '@/lib/time';
import DataWaitBanner from '@/components/ui/data-wait-banner';
import { notFound } from 'next/navigation';
import {
  Award,
  Boxes,
  CalendarClock,
  Gauge,
  Layers,
  Ruler,
  ShieldCheck,
  ShoppingCart,
  Timer,
  Truck,
} from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import Badge, { StatusBadge } from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import InsightBanner from '@/components/ui/insight-banner';
import { EmptyState, ErrorState } from '@/components/ui/state';
import AiRail from '@/components/ui/ai-rail';
import ForecastOverlayChart, { type SeriesPoint } from '@/components/chart/forecast-overlay-chart';
import ProjectionChart, { type ProjectionPoint } from '@/components/chart/projection-chart';
import RestrictedNotice from '@/components/ui/restricted-notice';
import { isSalesUser, requireUser } from '@/lib/auth';
import { getItemSeries } from '@/lib/backtest';
import { getForecastDetail, getLatestSuccessfulRun, getRunModels } from '@/lib/forecast';
import { getInventoryProjection, type ProjectionRow } from '@/lib/inventory';
import { getConsensusForecast, getSafetyStock, getSkuDetail } from '@/lib/recommendation';
import type { ConsensusRow, SafetyStock, SkuDetail } from '@/lib/recommendation-model';
// 사유 코드 8종은 lib/override-model.ts 한 곳에 있습니다 — 폼과 표가 같은 목록을 씁니다.
import { reasonLabel } from '@/lib/override-model';
import { getItemDecisionHistory } from '@/lib/approval';
import {
  DECISION_TONE,
  KIND_LABEL,
  KIND_TONE,
  decisionLabel,
  isDecision,
  type DecisionHistoryRow,
} from '@/lib/approval-model';
import OverrideRowForm from './override-row-form';
import ApprovalForm from './approval-form';

export const dynamic = 'force-dynamic';

const SOURCE_LABEL: Record<string, string> = {
  CHAMPION: 'Champion',
  DEFAULT: '기본 모델',
};

function pct(value: number | null, digits = 1): string | null {
  return value === null ? null : `${(value * 100).toFixed(digits)}%`;
}

function money(value: number): string {
  return `${Math.round(value).toLocaleString()}원`;
}

function monthOf(period: string): string {
  return period.slice(0, 7);
}

// ── §1 수요와 예측 ─────────────────────────────────────────────
//
// 실적(analytics.v_item_series)과 Champion 의 예측을 한 차트에 겹칩니다.
// model-comparison 화면과 같은 조립 방식입니다 — 계산이 아니라 병합입니다.

function DemandSection({
  detail,
  chartData,
  chartModels,
  bandModelId,
  sales,
}: {
  detail: SkuDetail;
  chartData: SeriesPoint[];
  chartModels: { modelId: string; label: string; isChampion?: boolean }[];
  bandModelId: string | null;
  /** renew.prd 4.5 — 영업이면 예측 정확도 지표를 만들지 않습니다 */
  sales: boolean;
}) {
  return (
    <>
      <Panel
        title="① 수요와 예측"
        actions={
          <span className="t-label">
            {detail.forecastSource
              ? `${SOURCE_LABEL[detail.forecastSource] ?? detail.forecastSource} 기준`
              : '예측 없음'}
          </span>
        }
      >
        <p className="t-sm text-2">
          Champion 모델이 검증 구간에서 얼마나 맞았는지, 그리고 앞으로 무엇을 예측하는지 봅니다.
          이 정확도가 아래 ④ 의 안전재고 두께를 결정합니다.
        </p>
      </Panel>

      <div className="grid grid-kpi">
        <KpiCard
          label="Champion"
          value={detail.championModelName ?? detail.championModelId}
          icon={Award}
          foot={
            detail.championSelectionMethod === 'MANUAL' ? '관리자 수동 지정' : '백테스트 자동 선정'
          }
        />
        {/* ★ renew.prd 4.5 — 예측 정확도 지표는 영업에게 ✕ 입니다.
            카드를 만들지 않습니다. 값을 '—' 로 두면 "데이터가 없다" 로 읽힙니다. */}
        {!sales && (
          <KpiCard
            label="WAPE"
            value={pct(detail.championWape)}
            icon={Gauge}
            reason="INSUFFICIENT_SAMPLE"
            foot="낮을수록 예측이 잘 맞습니다"
          />
        )}
        {!sales && (
          <KpiCard
            label="Bias"
            value={pct(detail.championBias)}
            icon={Ruler}
            reason="INSUFFICIENT_SAMPLE"
            tone={
              detail.championBias !== null && Math.abs(detail.championBias) > 0.1
                ? 'warn'
                : 'default'
            }
            foot="+ 는 과대예측 · − 는 과소예측"
          />
        )}
        <KpiCard
          label="수요 패턴"
          value={detail.demandType}
          icon={Layers}
          foot="패턴에 따라 적합한 모델이 다릅니다"
        />
      </div>

      <Panel
        title="실적과 예측"
        actions={<span className="t-label">음영 = 검증 구간 · 파선 = 예측 · 밴드 = P80/P90</span>}
      >
        {chartData.length === 0 ? (
          <EmptyState
            title="그릴 데이터가 없습니다"
            desc="예측을 한 번도 실행하지 않았거나, 이 품목의 실적이 없습니다."
          />
        ) : (
          <ForecastOverlayChart data={chartData} models={chartModels} bandModelId={bandModelId} />
        )}
      </Panel>
    </>
  );
}

// ── §2 Consensus ───────────────────────────────────────────────
//
// AI 예측 + 사람의 Override = Consensus (renew.prd 17.1).
//
// 기간마다 한 줄씩 보정할 수 있습니다. AI 예측 원본은 고치지 않고 증감만 따로 쌓습니다.
// 저장하면 Consensus 가 바뀌고, 그 값이 재고 전개(③)와 발주 추천(④)에 그대로 들어갑니다.

function ConsensusSection({ itemId, rows }: { itemId: string; rows: ConsensusRow[] }) {
  const columns: Column<ConsensusRow>[] = [
    { key: 'period', label: '기간', variant: 'code', render: (row) => monthOf(row.period) },
    {
      key: 'aiQty',
      label: 'AI 예측',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.aiQty === null ? (
          <EmptyValue align="right" reason="NO_FORECAST" showLabel={false} />
        ) : (
          formatNumber(row.aiQty)
        ),
    },
    {
      key: 'overrideQty',
      label: 'Override (증감)',
      align: 'right',
      variant: 'num',
      render: (row) => {
        if (row.overrideQty === null) return <span className="text-3">—</span>;
        return (
          <span className={row.overrideQty >= 0 ? 'hl-warn' : 'hl-crit'}>
            {row.overrideQty > 0 ? '+' : ''}
            {formatNumber(row.overrideQty)}
          </span>
        );
      },
    },
    {
      key: 'consensusQty',
      label: 'Consensus',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.consensusQty === null ? (
          <EmptyValue align="right" reason="NO_FORECAST" showLabel={false} />
        ) : (
          <b>{formatNumber(row.consensusQty)}</b>
        ),
    },
    {
      key: 'reasonCode',
      label: '사유 코드',
      render: (row) =>
        row.reasonCode === null ? (
          <span className="text-3">—</span>
        ) : (
          <Badge tone="info">{reasonLabel(row.reasonCode)}</Badge>
        ),
    },
    {
      key: 'override',
      label: '보정',
      render: (row) => (
        <OverrideRowForm
          itemId={itemId}
          period={row.period}
          overrideQty={row.overrideQty}
          reasonCode={row.reasonCode}
          reasonText={row.reasonText}
          hasOverride={row.hasOverride}
        />
      ),
    },
  ];

  return (
    <Panel
      title="② Consensus"
      actions={
        <span className="t-label">
          AI 예측은 그대로 두고 증감만 얹습니다 · 음수도 입력할 수 있습니다
        </span>
      }
      flush
    >
      {rows.length === 0 ? (
        <EmptyState
          title="예측 결과가 없습니다"
          desc="예측을 실행하면 기간별 AI 예측과 Consensus 가 여기에 나타납니다."
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.period}
          caption="analytics.v_consensus_forecast — 기간별 AI 예측과 Override"
        />
      )}
    </Panel>
  );
}

// ── §3 재고 ────────────────────────────────────────────────────

function InventorySection({
  detail,
  projection,
}: {
  detail: SkuDetail;
  projection: ProjectionRow[];
}) {
  const chartData: ProjectionPoint[] = projection.map((row) => ({
    period: monthOf(row.period),
    opening: row.openingQty,
    receipt: row.receiptQty,
    demand: row.demandQty,
    closing: row.closingQty,
  }));

  return (
    <>
      <Panel
        title="③ 재고"
        actions={
          <span className="t-label">
            {detail.dataSnapshotAt ? `기준 ${detail.dataSnapshotAt.slice(0, 10)}` : '기준 시각 없음'}
          </span>
        }
      >
        <p className="t-sm text-2">
          현재고에서 입고예정을 더하고 적용수요를 빼며 앞으로 굴려 봅니다. 기말 재고가 처음 음수가
          되는 달이 결품 시점입니다. 예측이 없는 기간은 임의 값으로 이어 붙이지 않습니다.
        </p>
      </Panel>

      <div className="grid grid-kpi">
        <KpiCard
          label="현재고"
          value={detail.currentInventory}
          unit={detail.currentInventory === null ? undefined : '개'}
          icon={Boxes}
          reason="NO_INVENTORY_DATA"
          foot="창고 합산"
        />
        <KpiCard
          label="입고예정"
          value={detail.incomingQty}
          unit={detail.incomingQty === null ? undefined : '개'}
          icon={Truck}
          foot={detail.incomingEta ? `가장 이른 ETA ${detail.incomingEta}` : '진행 중 선적 없음'}
        />
        <KpiCard
          label="결품 예상일"
          value={detail.stockoutDate}
          icon={CalendarClock}
          reason={detail.reasonCode}
          tone={detail.risk === 'CRITICAL' ? 'crit' : detail.risk === 'WARNING' ? 'warn' : 'default'}
          foot={
            detail.firstNegativePeriod
              ? `${monthOf(detail.firstNegativePeriod)} 에 기말 재고가 음수`
              : '전개 기간 안에서는 음수가 되지 않습니다'
          }
        />
        <KpiCard
          label="소진까지"
          value={detail.stockoutDays === null ? null : formatNumber(detail.stockoutDays)}
          unit={detail.stockoutDays === null ? undefined : '일'}
          icon={Timer}
          reason={detail.reasonCode}
          foot="음수는 이미 소진되었다는 뜻입니다"
        />
      </div>

      <Panel
        title="예상재고 전개"
        actions={<span className="t-label">0선 아래가 결품 구간입니다</span>}
      >
        {chartData.length === 0 ? (
          <EmptyState
            title="전개할 기간이 없습니다"
            desc="예측이 없으면 재고 전개를 그릴 수 없습니다."
          />
        ) : (
          <ProjectionChart data={chartData} leadTimeDays={detail.leadTime} />
        )}
      </Panel>
    </>
  );
}

// ── §4 발주 ────────────────────────────────────────────────────
//
// 안전재고와 추천 수량이 "어떤 값에서 나왔는지" 를 두 개의 표로 그대로 폅니다.
// 숫자만 보여 주고 근거를 감추면 사람이 승인할 수 없습니다 (renew.prd 22.3).

function OrderSection({
  detail,
  safety,
  overdue,
  sales,
}: {
  detail: SkuDetail;
  safety: SafetyStock | null;
  overdue: boolean;
  /** renew.prd 4.5 — 영업이면 발주 금액 열과 단가를 만들지 않습니다 */
  sales: boolean;
}) {
  const safetyColumns: Column<SafetyStock>[] = [
    {
      key: 'serviceLevel',
      label: 'Service Level',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.serviceLevel === null ? (
          <EmptyValue align="right" showLabel={false} />
        ) : (
          <span>
            {pct(row.serviceLevel)}
            {row.serviceLevelSource && (
              <>
                {' '}
                <span className="text-3">({row.serviceLevelSource})</span>
              </>
            )}
          </span>
        ),
    },
    {
      key: 'zValue',
      label: 'Z',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.zValue === null ? <EmptyValue align="right" showLabel={false} /> : row.zValue.toFixed(4),
    },
    {
      key: 'leadTimeDays',
      label: 'L (리드타임)',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.leadTimeDays === null ? (
          <EmptyValue align="right" reason="NO_LEADTIME" showLabel={false} />
        ) : (
          formatNumber(row.leadTimeDays, '일')
        ),
    },
    {
      key: 'leadTimeSd',
      // 표본이 1건이면 표준편차가 없습니다. σ_DLT 계산에서는 0 으로 두고,
      // 그 사실은 리드타임 카드의 신뢰도가 드러냅니다 (renew.prd 18.2).
      label: 'σ_L',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.leadTimeSd === null ? (
          <EmptyValue align="right" reason="INSUFFICIENT_SAMPLE" showLabel={false} />
        ) : (
          row.leadTimeSd.toFixed(2)
        ),
    },
    {
      key: 'dailyDemand',
      label: 'd (일평균 수요)',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.dailyDemand === null ? (
          <EmptyValue align="right" reason="NO_FORECAST" showLabel={false} />
        ) : (
          row.dailyDemand.toFixed(1)
        ),
    },
    {
      key: 'sigmaD',
      label: 'σ_d (일)',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.sigmaD === null ? (
          <EmptyValue align="right" reason="INSUFFICIENT_SAMPLE" showLabel={false} />
        ) : (
          <span>
            {row.sigmaD.toFixed(2)}{' '}
            <Badge tone={row.sigmaSource === 'BACKTEST' ? 'safe' : 'warn'}>
              {row.sigmaSource === 'BACKTEST' ? '백테스트' : 'in-sample'}
            </Badge>
          </span>
        ),
    },
    {
      key: 'sigmaDlt',
      label: 'σ_DLT',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.sigmaDlt === null ? (
          <EmptyValue align="right" reason={row.reason} showLabel={false} />
        ) : (
          row.sigmaDlt.toFixed(1)
        ),
    },
    {
      key: 'safetyStock',
      label: '안전재고',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.safetyStock === null ? (
          <EmptyValue align="right" reason={row.reason} showLabel={false} />
        ) : (
          <b>{formatNumber(row.safetyStock)}</b>
        ),
    },
  ];

  const recColumns: Column<SkuDetail>[] = [
    {
      key: 'consensusForecast',
      label: '창 수요',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.consensusForecast === null ? (
          <EmptyValue align="right" reason={row.reasonCode} showLabel={false} />
        ) : (
          formatNumber(row.consensusForecast)
        ),
    },
    {
      key: 'safetyStock',
      label: '+ 안전재고',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.safetyStock === null ? (
          <EmptyValue align="right" reason={row.reasonCode} showLabel={false} />
        ) : (
          formatNumber(row.safetyStock)
        ),
    },
    {
      key: 'currentInventory',
      // 뷰의 available_qty(현재고 + 입고예정)가 아니라 현재고입니다.
      // 입고예정은 다음 열에서 따로 뺍니다 — 두 번 빼지 않도록 제목을 정확히 씁니다.
      label: '− 현재고',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.currentInventory === null ? (
          <EmptyValue align="right" reason="NO_INVENTORY_DATA" showLabel={false} />
        ) : (
          formatNumber(row.currentInventory)
        ),
    },
    {
      key: 'incomingInWindowQty',
      // ★ 식이 빼는 값은 진행 중 선적 전량(incomingQty)이 아니라 창(리드타임 + 검토 주기)
      //   안에 도착하는 몫입니다 (renew.prd 22.1 · sql/16). 위 KPI 카드의 '입고예정' 은
      //   전량 그대로이므로, 두 숫자가 다를 수 있다는 것을 제목이 먼저 말합니다.
      label: '− 창 안 입고예정',
      align: 'right',
      variant: 'num',
      render: (row) =>
        // 컬럼이 없거나 창을 모르면 null 입니다. 0 으로 그리면 뺄셈이 맞는 것처럼
        // 보이지만 실제로 뺀 값은 아무도 모릅니다 (design.md §8.2).
        row.incomingInWindowQty === null ? (
          <EmptyValue align="right" showLabel={false} />
        ) : (
          <>
            {formatNumber(row.incomingInWindowQty)}
            {/* 창 뒤 몫이 있으면 그 자리에서 밝힙니다 — 카드의 전량과 이 칸의 차이가
                곧 이 숫자입니다. 문장 설명은 아래 근거 배너가 이어서 합니다. */}
            {row.incomingAfterWindowQty !== null && row.incomingAfterWindowQty > 0 && (
              <div className="t-label">창 뒤 {formatNumber(row.incomingAfterWindowQty)}</div>
            )}
          </>
        ),
    },
    {
      key: 'rawRecommendedQty',
      label: '→ 필요량',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.rawRecommendedQty === null ? (
          <EmptyValue align="right" reason={row.reasonCode} showLabel={false} />
        ) : (
          formatNumber(row.rawRecommendedQty)
        ),
    },
    {
      key: 'moq',
      label: 'MOQ',
      align: 'right',
      variant: 'num',
      // null 은 "제약 없음" 입니다. 0 으로 채우지 않습니다 (core.item_policy 주석).
      render: (row) =>
        row.moq === null ? <span className="text-3">제약 없음</span> : formatNumber(row.moq),
    },
    {
      key: 'packSize',
      label: '포장 단위',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.packSize === null ? (
          <span className="text-3">올림 없음</span>
        ) : (
          formatNumber(row.packSize)
        ),
    },
    {
      key: 'finalRecommendedQty',
      label: '→ 최종 추천',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.finalRecommendedQty === null ? (
          <EmptyValue align="right" reason={row.reasonCode} showLabel={false} />
        ) : (
          <b className={row.finalRecommendedQty > 0 ? 'hl-warn' : undefined}>
            {formatNumber(row.finalRecommendedQty)}
          </b>
        ),
    },
  ];

  // ★ renew.prd 4.5 — 발주 금액은 영업에게 ✕ 입니다. 열을 만들지 않습니다.
  if (!sales) {
    recColumns.push({
      key: 'recommendedAmount',
      label: '금액',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.recommendedAmount === null ? (
          <EmptyValue align="right" showLabel={false} />
        ) : (
          money(row.recommendedAmount)
        ),
    });
  }

  return (
    <>
      <Panel title="④ 발주">
        <p className="t-sm text-2">
          리드타임과 검토 주기 동안의 수요에 안전재고를 더하고, 현재고와 창 안 입고예정을
          뺍니다. 입고예정 중에서도 그 창 안에 도착하는 몫만 뺍니다 — 창 뒤에 오는 물량은 이
          기간의 수요를 덮지 못합니다. 그 값을 MOQ 와 포장 단위로 올려 실제 발주할 수 있는
          수량을 냅니다.
        </p>
      </Panel>

      <div className="grid grid-kpi">
        <KpiCard
          label="리드타임"
          value={detail.leadTime === null ? null : formatNumber(detail.leadTime)}
          unit={detail.leadTime === null ? undefined : '일'}
          icon={Timer}
          reason="NO_LEADTIME"
          tone={detail.leadTimeConfidence === 'LOW' ? 'warn' : 'default'}
          foot={
            // 신뢰도는 HIGH 를 생략하고 MEDIUM · LOW 만 밝힙니다 (design.md §8.3)
            detail.leadTimeConfidence === 'LOW'
              ? `${detail.leadTimeSource ?? '적용값'} · 표본 부족`
              : detail.leadTimeConfidence === 'MEDIUM'
                ? `${detail.leadTimeSource ?? '적용값'} · 표본 보통`
                : (detail.leadTimeSource ?? '적용 중인 계획 리드타임')
          }
        />
        <KpiCard
          label="안전재고"
          value={detail.safetyStock === null ? null : formatNumber(detail.safetyStock)}
          unit={detail.safetyStock === null ? undefined : '개'}
          icon={ShieldCheck}
          reason={detail.reasonCode}
          foot={
            detail.serviceLevel === null
              ? '서비스 수준 미확정'
              : `서비스 수준 ${pct(detail.serviceLevel)} · Z ${detail.zValue?.toFixed(4) ?? '—'}`
          }
        />
        <KpiCard
          label="발주 권고일"
          value={detail.requiredOrderDate}
          icon={CalendarClock}
          reason={detail.reasonCode}
          tone={overdue ? 'crit' : 'default'}
          foot={overdue ? '이미 지났습니다 — 지금 발주해도 늦습니다' : '결품일 − 리드타임 − 여유일'}
        />
        <KpiCard
          label="추천 수량"
          value={
            detail.finalRecommendedQty === null ? null : formatNumber(detail.finalRecommendedQty)
          }
          unit={detail.finalRecommendedQty === null ? undefined : '개'}
          icon={ShoppingCart}
          reason={detail.reasonCode}
          tone={
            detail.finalRecommendedQty !== null && detail.finalRecommendedQty > 0
              ? 'warn'
              : 'default'
          }
          foot={
            sales || detail.recommendedAmount === null
              ? 'MOQ · 포장 단위 반영'
              : `${money(detail.recommendedAmount)} · MOQ · 포장 단위 반영`
          }
        />
      </div>

      <Panel
        title="안전재고 근거"
        actions={
          <span className="t-label">σ_DLT = √( L × σ_d² + d² × σ_L² ) · 안전재고 = Z × σ_DLT</span>
        }
        flush
      >
        {safety === null ? (
          <EmptyState
            title="안전재고 근거가 없습니다"
            desc="analytics.v_safety_stock 에 이 품목의 행이 없습니다."
          />
        ) : (
          <DataTable
            columns={safetyColumns}
            rows={[safety]}
            rowKey={(row) => row.itemId}
            caption="analytics.v_safety_stock — 안전재고를 구성하는 값"
          />
        )}
      </Panel>

      <Panel
        title="추천 수량 근거"
        actions={
          // 아래 표의 열 제목과 같은 말을 씁니다. 그 칸이 빼는 값은 가용(현재고 + 입고예정)이
          // 아니라 현재고이고, 입고예정은 바로 다음 열에서 따로 뺍니다.
          // 마지막 항은 진행 중 선적 전량이 아니라 창 안에 도착하는 몫입니다 (renew.prd 22.1).
          <span className="t-label">
            창 수요 + 안전재고 − 현재고 − 창 안 입고예정 → MOQ · 포장 반영
          </span>
        }
        flush
      >
        <DataTable
          columns={recColumns}
          rows={[detail]}
          rowKey={(row) => row.itemId}
          caption="analytics.v_sku_detail — 추천 수량이 나온 경로"
        />
      </Panel>

      {detail.explanation && (
        <InsightBanner eyebrow="RECOMMENDATION">{detail.explanation}</InsightBanner>
      )}
    </>
  );
}

// ── §5 승인 · 이력 ─────────────────────────────────────────────
//
// renew.prd 23장 — "추천 확인 → 필요시 수정 → 수정 사유 입력 → 승인".
// renew.prd 32   — 추천과 승인의 분리. AI 가 추천하고 사람이 최종 결정합니다.
//
// 저장하면 그 시점의 계산 근거 전체가 Snapshot 으로 함께 남습니다 (renew.prd 23.2).
// 아래 결정 이력의 "근거 보기" 가 그 Snapshot 을 그대로 다시 펼칩니다.

/** 'YYYY-MM-DDTHH:MM:SS…' 을 분 단위까지만 보여줍니다 */
function stamp(value: string | null): string | null {
  return value === null ? null : kstMinute(value);
}

function ApprovalSection({
  detail,
  history,
}: {
  detail: SkuDetail;
  history: DecisionHistoryRow[];
}) {
  const columns: Column<DecisionHistoryRow>[] = [
    {
      key: 'at',
      label: '시각',
      variant: 'code',
      render: (row) =>
        row.at === null ? <EmptyValue showLabel={false} /> : stamp(row.at),
    },
    {
      key: 'kind',
      label: '종류',
      render: (row) =>
        row.kind === null ? (
          <EmptyValue showLabel={false} />
        ) : (
          <Badge tone={KIND_TONE[row.kind]}>{KIND_LABEL[row.kind]}</Badge>
        ),
    },
    {
      key: 'summary',
      label: '요약',
      render: (row) =>
        row.summary === null ? (
          <EmptyValue showLabel={false} />
        ) : (
          <span className="t-sm text-2">{row.summary}</span>
        ),
    },
    {
      key: 'actorEmail',
      label: '담당자',
      render: (row) =>
        row.actorEmail === null ? <EmptyValue showLabel={false} /> : row.actorEmail,
    },
    {
      key: 'ref',
      label: '근거',
      // 근거 Snapshot 은 승인에만 있습니다. 보정 · Champion · 리드타임은 요약이 전부입니다.
      render: (row) =>
        row.kind === 'APPROVAL' && row.refId !== null ? (
          <Link href={`/decision-history/${row.refId}`} className="btn ghost">
            근거 보기
          </Link>
        ) : (
          <span className="text-3">—</span>
        ),
    },
  ];

  return (
    <>
      {/* ★ hasActiveApproval 은 3상태입니다. null 은 "승인 컬럼을 읽지 못했다" 이고,
          그때 "아직 결정하지 않았습니다" 라고 쓰면 결정이 있는 품목을 없다고 단정하게
          됩니다. 승인은 거버넌스 기록이라 빈 칸이 잘못된 단정보다 낫습니다 (design.md §8.2). */}
      <Panel
        title="⑤ 승인 · 이력"
        actions={
          detail.hasActiveApproval === true && isDecision(detail.lastDecision) ? (
            <Badge tone={DECISION_TONE[detail.lastDecision]}>
              {decisionLabel(detail.lastDecision)}
            </Badge>
          ) : detail.hasActiveApproval === false ? (
            <span className="t-label">아직 결정하지 않았습니다</span>
          ) : (
            <EmptyValue showLabel={false} />
          )
        }
      >
        {detail.hasActiveApproval === true ? (
          <p className="t-sm text-2">
            지금 유효한 결정은 <b>{decisionLabel(detail.lastDecision)}</b> 입니다 · 승인 수량{' '}
            {detail.lastApprovedQty === null ? '—' : formatNumber(detail.lastApprovedQty)} · 담당자{' '}
            {detail.lastApprovedEmail ?? '—'} · {stamp(detail.lastApprovedAt) ?? '—'}. 아래에서 다시
            결정하면 이 결정은 이력으로 남고 새 결정이 유효해집니다.
          </p>
        ) : detail.hasActiveApproval === false ? (
          <p className="t-sm text-2">
            위 ④ 의 추천을 확인하고 결정합니다. 수량을 고치면 왜 고쳤는지를 사유로 남깁니다. 저장하는
            순간의 예측 · 재고 · 리드타임 · 안전재고 · Champion 을 함께 보관하므로, 나중에 데이터가
            바뀌어도 그때 무엇을 보고 결정했는지 그대로 다시 볼 수 있습니다.
          </p>
        ) : (
          <p className="t-sm text-2">
            지금 유효한 결정이 있는지 읽지 못했습니다. <span className="t-code">v_sku_detail</span>{' '}
            에 승인 컬럼이 없습니다 — <span className="t-code">sql/19-approval.sql</span> 실행 여부를
            확인해주세요. 아래 결정 이력 표는 그대로 볼 수 있습니다.
          </p>
        )}
      </Panel>

      <Panel
        title="발주 결정"
        actions={<span className="t-label">추천 수량이 기본값입니다 · 고치면 사유가 필요합니다</span>}
      >
        <ApprovalForm itemId={detail.itemId} recommendedQty={detail.finalRecommendedQty} />
      </Panel>

      <Panel
        title="결정 이력"
        actions={
          <span className="t-label">승인 · 보정 · Champion · 리드타임을 한 표로 · 최근 순</span>
        }
        flush
      >
        {history.length === 0 ? (
          <EmptyState
            title="이 품목에 남은 결정이 없습니다"
            desc="승인 · 예측 보정 · Champion 수동 지정 · 계획 리드타임 변경이 여기에 쌓입니다."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={history}
            rowKey={(row, index) => `${row.kind}-${row.refId}-${index}`}
            caption="analytics.v_decision_history — 이 품목과 공급처에 남은 결정"
          />
        )}
      </Panel>
    </>
  );
}

// ── 화면 ───────────────────────────────────────────────────────

export default async function SkuDetailPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const user = await requireUser();
  // renew.prd 4.5 — 영업은 조달 단가 · 발주 금액 · 공급처 상세 · 예측 정확도를 보지 않습니다.
  // 숨기는 것이 아니라 그 카드와 열을 만들지 않습니다. 서버 컴포넌트라 렌더하지 않은
  // 값은 브라우저까지 가지 않습니다.
  const sales = isSalesUser(user);

  const { itemId } = await params;
  const { data: detail, error } = await getSkuDetail(itemId);

  if (error) {
    return (
      <>
        <PageHeader title={itemId} subtitle="품목 상세" />
        <Panel>
          <ErrorState detail={error} />
        </Panel>
      </>
    );
  }

  // 없는 품목 코드로 들어오면 조용히 다른 품목을 보여주지 않습니다.
  if (!detail) notFound();

  const runId = detail.forecastRunId;
  const [
    series,
    consensus,
    projection,
    safetyResult,
    latestRun,
    forecastResult,
    runModelResult,
    decisions,
  ] = await Promise.all([
    getItemSeries(itemId),
    getConsensusForecast(itemId),
    getInventoryProjection(itemId),
    getSafetyStock(itemId),
    getLatestSuccessfulRun(),
    runId ? getForecastDetail(runId, itemId) : null,
    runId ? getRunModels(runId) : null,
    // 리드타임 변경은 공급처에 붙어 item_id 가 없습니다. 공급처를 알면 함께 읽습니다.
    getItemDecisionHistory(itemId, detail.supplierId),
  ]);

  const forecast = forecastResult?.rows ?? [];
  const runModels = runModelResult?.rows ?? [];

  // ── 차트 데이터 조립 ──
  // 계산이 아니라 병합입니다. 값은 이미 SQL 이 계산했습니다
  // (model-comparison/page.tsx 와 같은 방식).
  const byPeriod = new Map<string, SeriesPoint>();
  const ensure = (period: string): SeriesPoint => {
    const key = monthOf(period);
    const found = byPeriod.get(key);
    if (found) return found;
    const created: SeriesPoint = { period: key, actual: null, forecast: {}, isTest: false };
    byPeriod.set(key, created);
    return created;
  };

  for (const row of series.rows) {
    const point = ensure(row.period);
    point.actual = row.quantity;
    if (row.segment === 'TEST') point.isTest = true;
  }

  const modelIds = Array.from(new Set(forecast.map((row) => row.modelId)));
  // Champion 의 예측을 그립니다. Champion 이 이번 실행에 결과가 없으면 그 실행이 쓴 모델을 씁니다.
  const bandModelId =
    detail.championModelId && modelIds.includes(detail.championModelId)
      ? detail.championModelId
      : (modelIds[0] ?? null);

  for (const row of forecast) {
    if (row.modelId !== bandModelId) continue;
    const point = ensure(row.period);
    point.forecast[row.modelId] = row.predictedQty;
    point.p80 = row.p80;
    point.p90 = row.p90;
  }

  const chartData = Array.from(byPeriod.values()).sort((a, b) => a.period.localeCompare(b.period));
  const modelLabel = new Map(runModels.map((row) => [row.modelId, row.modelName ?? row.modelId]));
  const chartModels = bandModelId
    ? [
        {
          modelId: bandModelId,
          label: modelLabel.get(bandModelId) ?? detail.championModelName ?? bandModelId,
          isChampion: bandModelId === detail.championModelId,
        },
      ]
    : [];

  // 긴급 여부는 뷰가 판정합니다. 화면에서 오늘과 다시 비교하면 앱 서버와 DB 의 시간대가
  // 달라 목록 화면과 하루가 어긋납니다.
  const overdue = detail.isUrgent === true;
  const stale = detail.isStale || (latestRun?.isStale ?? false);

  return (
    <>
      <PageHeader
        title={detail.itemName ?? detail.itemId}
        subtitle="예측 · Consensus · 재고 · 발주 · 승인을 한 흐름으로 봅니다. 근거가 없는 값은 숫자로 채우지 않고 사유와 함께 산출 불가로 둡니다."
        meta={
          <>
            <MetaChip>{detail.itemId}</MetaChip>
            {/* 공급처 상세는 영업에게 ✕ 입니다 (renew.prd 4.5) */}
            {!sales && detail.supplierName && <MetaChip>{detail.supplierName}</MetaChip>}
            {detail.forecastRunId && <MetaChip>{detail.forecastRunId}</MetaChip>}
            <StatusBadge status={detail.risk} />
          </>
        }
        actions={
          <>
            <Link href="/purchase-recommendation" className="btn ghost">
              ← 목록
            </Link>
            <a
              className="btn secondary"
              href={`/api/recommendation/recommendations.csv?item=${detail.itemId}`}
            >
              CSV
            </a>
          </>
        }
      />

      <DataWaitBanner kinds={['INVENTORY', 'LEADTIME', 'PRICE']} />

      {stale && (
        <div className="stale-banner">
          기준 데이터가 예측 실행 이후 변경되었습니다. 이 화면의 예측과 추천도 함께 달라집니다.
          <Link href="/admin/forecast-runs" className="btn secondary">
            실행 화면으로
          </Link>
        </div>
      )}

      {sales && (
        <RestrictedNotice items={['조달 단가', '발주 금액', '공급처 상세', '예측 정확도']} />
      )}

      {/* AI 레일은 오른쪽에 섭니다 (design.md §6.11 · 지시서 STEP 16 §4).
          레일은 LLM 을 부르지 않고 뷰가 만들어 둔 근거만 보여줍니다. 비어도 왼쪽 본문은
          그대로 성립합니다 (renew.prd 31.4). */}
      <div className="grid grid-rail">
        <div style={{ display: 'grid', gap: 'var(--s-6)', minWidth: 0 }}>
          <DemandSection
            sales={sales}
            detail={detail}
            chartData={chartData}
            chartModels={chartModels}
            bandModelId={bandModelId}
          />

          <ConsensusSection itemId={detail.itemId} rows={consensus.rows} />

          <InventorySection detail={detail} projection={projection.rows} />

          <OrderSection
            detail={detail}
            safety={safetyResult.data}
            overdue={overdue}
            sales={sales}
          />

          <ApprovalSection detail={detail} history={decisions.rows} />
        </div>

        <AiRail itemId={detail.itemId} />
      </div>

      <InsightBanner eyebrow="SKU DETAIL">
        이 화면은 <span className="t-code">renew.prd</span> 29장의 28개 항목을 한 흐름으로 모읍니다.
        ② 에서 보정한 값은 저장하는 즉시 ③ 재고 전개와 ④ 발주 추천에 반영되고, ⑤ 에서 승인하면 그
        시점의 근거가 통째로 보관됩니다.
        {detail.overrideCount > 0 && (
          <>
            {' '}
            지금 이 품목에는 유효한 보정이 {detail.overrideCount}건 있습니다.{' '}
            <Link href="/forecast-override" style={{ color: 'var(--info-fg)' }}>
              예측 보정 화면
            </Link>
            에서 이력과 Forecast Value Add 를 함께 볼 수 있습니다.
          </>
        )}
      </InsightBanner>
    </>
  );
}
