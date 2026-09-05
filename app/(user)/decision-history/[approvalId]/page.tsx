// 근거 Snapshot 재현 — renew.prd 23.2 · 31.3
//
// "승인 시점의 계산 근거를 함께 저장한다. 이후 데이터가 바뀌어도 당시 무엇을 보고
//  결정했는지 재현할 수 있어야 한다."
//
// ★ 이 화면은 아무것도 다시 조회하지 않습니다. core.approval.snapshot 에 저장된 jsonb 를
//   펼쳐 그릴 뿐입니다. 지금 값을 한 칸이라도 섞으면 재현이 아니게 됩니다.
//   그래서 표의 구조는 SKU Detail §4 와 같게 두되, 값의 출처만 다릅니다.
//
// kpi-filter: 없음 — 이 화면에는 목록이 없습니다. 결정 한 건의 근거를 펴는 화면입니다
// (design.md §6.4 · AGENTS.md 규칙 9).

import Link from 'next/link';
import { kstMinute } from '@/lib/time';
import { notFound } from 'next/navigation';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import Badge, { StatusBadge } from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import InsightBanner from '@/components/ui/insight-banner';
import { EmptyState, ErrorState } from '@/components/ui/state';
import { requireUser } from '@/lib/auth';
import { getApproval, getApprovalSnapshot } from '@/lib/approval';
import {
  DECISION_TONE,
  approvalReasonLabel,
  decisionLabel,
  isDecision,
  type ApprovalRow,
  type SnapshotChampion,
  type SnapshotLeadtime,
  type SnapshotProjectionRow,
} from '@/lib/approval-model';
import type { PurchaseRecommendation, SafetyStock } from '@/lib/recommendation-model';

export const dynamic = 'force-dynamic';

function pct(value: number | null, digits = 1): string | null {
  return value === null ? null : `${(value * 100).toFixed(digits)}%`;
}

function money(value: number): string {
  return `${Math.round(value).toLocaleString()}원`;
}

function monthOf(period: string): string {
  return period.slice(0, 7);
}

/** 'YYYY-MM-DDTHH:MM:SS…' 을 분 단위까지만 보여줍니다 */
function stamp(value: string | null): string | null {
  return value === null ? null : kstMinute(value);
}

export default async function ApprovalSnapshotPage({
  params,
}: {
  params: Promise<{ approvalId: string }>;
}) {
  await requireUser();

  const { approvalId } = await params;
  const id = Number(approvalId);
  // 숫자가 아닌 주소로 들어오면 조용히 다른 결정을 보여주지 않습니다.
  if (!Number.isInteger(id) || id <= 0) notFound();

  const [approvalResult, snapshotResult] = await Promise.all([
    getApproval(id),
    getApprovalSnapshot(id),
  ]);

  const failure = approvalResult.error ?? snapshotResult.error;
  if (failure) {
    return (
      <>
        <PageHeader title={`결정 #${id}`} subtitle="승인 근거" />
        <Panel>
          <ErrorState detail={failure} />
        </Panel>
      </>
    );
  }

  const approval = approvalResult.data;
  if (!approval) notFound();

  const snapshot = snapshotResult.data;
  const recommendation = snapshot?.recommendation ?? null;
  const safety = snapshot?.safetyStock ?? null;
  const leadtime = snapshot?.leadtime ?? null;
  const champion = snapshot?.champion ?? null;
  const projection = snapshot?.projection ?? [];

  // ── 결정 요약 ──
  const decisionColumns: Column<ApprovalRow>[] = [
    {
      key: 'decision',
      label: '결정',
      render: (row) =>
        row.decision === null ? (
          <EmptyValue showLabel={false} />
        ) : (
          <Badge tone={DECISION_TONE[row.decision]}>{decisionLabel(row.decision)}</Badge>
        ),
    },
    {
      key: 'recommendedQty',
      label: 'AI 추천 수량',
      align: 'right',
      variant: 'num',
      // ★ 승인 시점에 함수가 직접 읽어 저장한 값입니다. 화면이 보낸 숫자가 아닙니다.
      render: (row) =>
        row.recommendedQty === null ? (
          <EmptyValue align="right" showLabel={false} />
        ) : (
          formatNumber(row.recommendedQty)
        ),
    },
    {
      key: 'approvedQty',
      label: '승인 수량',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.approvedQty === null ? (
          <EmptyValue align="right" showLabel={false} />
        ) : (
          <b>{formatNumber(row.approvedQty)}</b>
        ),
    },
    {
      key: 'adjustment',
      label: '조정량',
      align: 'right',
      variant: 'num',
      // 조정량을 모르는 경우(추천 산출 불가)와 0(추천대로)은 다릅니다.
      render: (row) => {
        if (row.adjustment === null) return <EmptyValue align="right" showLabel={false} />;
        if (row.adjustment === 0) return <span className="text-3">추천대로</span>;
        return (
          <span className={row.adjustment > 0 ? 'hl-warn' : 'hl-crit'}>
            {row.adjustment > 0 ? '+' : ''}
            {formatNumber(row.adjustment)}
          </span>
        );
      },
    },
    {
      key: 'reasonCode',
      label: '사유',
      render: (row) =>
        row.reasonCode === null ? (
          <EmptyValue showLabel={false} />
        ) : (
          <Badge tone="info">{approvalReasonLabel(row.reasonCode)}</Badge>
        ),
    },
    {
      key: 'reasonText',
      label: '사유 설명',
      render: (row) =>
        row.reasonText === null ? (
          <span className="text-3">—</span>
        ) : (
          <span className="t-sm text-2">{row.reasonText}</span>
        ),
    },
    {
      key: 'approvedEmail',
      label: '담당자',
      render: (row) =>
        row.approvedEmail === null ? <EmptyValue showLabel={false} /> : row.approvedEmail,
    },
    {
      key: 'approvedAt',
      label: '시각',
      variant: 'code',
      render: (row) =>
        row.approvedAt === null ? <EmptyValue showLabel={false} /> : stamp(row.approvedAt),
    },
  ];

  // ── 추천 근거 (SKU Detail §4 와 같은 열) ──
  const recColumns: Column<PurchaseRecommendation>[] = [
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
      key: 'incomingQty',
      label: '− 입고예정',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.incomingQty === null ? (
          <EmptyValue align="right" showLabel={false} />
        ) : (
          formatNumber(row.incomingQty)
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
          <b>{formatNumber(row.finalRecommendedQty)}</b>
        ),
    },
    {
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
    },
  ];

  // ── 안전재고 근거 ──
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
          pct(row.serviceLevel)
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
          row.sigmaD.toFixed(2)
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

  // ── 리드타임 ──
  const leadtimeColumns: Column<SnapshotLeadtime>[] = [
    {
      key: 'supplierId',
      label: '공급처',
      variant: 'code',
      render: (row) =>
        row.supplierId === null ? (
          <EmptyValue showLabel={false} />
        ) : (
          (row.supplierName ?? row.supplierId)
        ),
    },
    {
      key: 'effectiveLeadTime',
      label: '적용 리드타임',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.effectiveLeadTime === null ? (
          <EmptyValue align="right" reason="NO_LEADTIME" showLabel={false} />
        ) : (
          <b>{formatNumber(row.effectiveLeadTime, '일')}</b>
        ),
    },
    {
      key: 'plannedLeadTime',
      label: '계획값',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.plannedLeadTime === null ? (
          <span className="text-3">미확정</span>
        ) : (
          formatNumber(row.plannedLeadTime, '일')
        ),
    },
    {
      key: 'p80Days',
      label: '실적 P80',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.p80Days === null ? (
          <EmptyValue align="right" reason="INSUFFICIENT_SAMPLE" showLabel={false} />
        ) : (
          formatNumber(row.p80Days, '일')
        ),
    },
    {
      key: 'stdDays',
      label: 'σ_L',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.stdDays === null ? (
          <EmptyValue align="right" reason="INSUFFICIENT_SAMPLE" showLabel={false} />
        ) : (
          row.stdDays.toFixed(2)
        ),
    },
    {
      key: 'sampleCount',
      label: '표본',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.sampleCount === null ? (
          <EmptyValue align="right" showLabel={false} />
        ) : (
          formatNumber(row.sampleCount, '건')
        ),
    },
    {
      key: 'source',
      label: '출처',
      render: (row) =>
        row.source === null ? (
          <EmptyValue showLabel={false} />
        ) : (
          <span className="t-sm text-2">
            {row.source}
            {row.confidence === null ? '' : ` · 신뢰도 ${row.confidence}`}
          </span>
        ),
    },
  ];

  // ── Champion ──
  const championColumns: Column<SnapshotChampion>[] = [
    {
      key: 'modelName',
      label: '모델',
      variant: 'strong',
      render: (row) => row.modelName ?? row.championModelId ?? <EmptyValue showLabel={false} />,
    },
    {
      key: 'modelVersion',
      label: '버전',
      variant: 'code',
      render: (row) =>
        row.modelVersion === null ? <span className="text-3">—</span> : row.modelVersion,
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
      key: 'bias',
      label: 'Bias',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.bias === null ? (
          <EmptyValue align="right" reason="INSUFFICIENT_SAMPLE" showLabel={false} />
        ) : (
          pct(row.bias)
        ),
    },
    {
      key: 'selectionMethod',
      label: '선정',
      render: (row) => (
        <Badge tone={row.selectionMethod === 'MANUAL' ? 'warn' : 'plain'}>
          {row.selectionMethod === 'MANUAL' ? '수동 지정' : '백테스트 자동'}
        </Badge>
      ),
    },
  ];

  // ── 재고 전개 ──
  const projectionColumns: Column<SnapshotProjectionRow>[] = [
    { key: 'period', label: '기간', variant: 'code', render: (row) => monthOf(row.period) },
    {
      key: 'openingQty',
      label: '기초',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.openingQty === null ? (
          <EmptyValue align="right" showLabel={false} />
        ) : (
          formatNumber(row.openingQty)
        ),
    },
    {
      key: 'receiptQty',
      label: '+ 입고',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.receiptQty === null ? (
          <EmptyValue align="right" showLabel={false} />
        ) : (
          formatNumber(row.receiptQty)
        ),
    },
    {
      key: 'demandQty',
      label: '− 적용수요',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.demandQty === null ? (
          <EmptyValue align="right" reason="NO_FORECAST" showLabel={false} />
        ) : (
          formatNumber(row.demandQty)
        ),
    },
    {
      key: 'closingQty',
      label: '= 기말',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.closingQty === null ? (
          <EmptyValue align="right" showLabel={false} />
        ) : (
          <span className={row.closingQty < 0 ? 'hl-crit' : undefined}>
            {formatNumber(row.closingQty)}
          </span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={approval.itemName ?? approval.itemId}
        subtitle="승인 시점에 저장된 계산 근거입니다. 이 화면은 아무것도 다시 계산하지 않고, 그때 저장한 값을 그대로 펼칩니다."
        meta={
          <>
            <MetaChip>{approval.itemId}</MetaChip>
            <MetaChip>결정 #{approval.approvalId}</MetaChip>
            {snapshot?.runId && <MetaChip>{snapshot.runId}</MetaChip>}
            {snapshot?.modelVersion && <MetaChip>{snapshot.modelVersion}</MetaChip>}
            {isDecide(approval) && (
              <Badge tone={DECISION_TONE[approval.decision]}>
                {decisionLabel(approval.decision)}
              </Badge>
            )}
            {!approval.isActive && <Badge tone="unknown">대체됨</Badge>}
            {recommendation && <StatusBadge status={recommendation.risk} />}
          </>
        }
        actions={
          <>
            <Link href="/decision-history" className="btn ghost">
              ← 결정 이력
            </Link>
            <Link href={`/purchase-recommendation/${approval.itemId}`} className="btn secondary">
              지금 값 보기
            </Link>
          </>
        }
      />

      <InsightBanner eyebrow="SNAPSHOT">
        이 화면은 <b>{stamp(approval.approvedAt) ?? '승인'}</b> 시점의 근거입니다. 현재 값과 다를 수
        있습니다.
        {snapshot?.dataSnapshotAt && (
          <> 그때의 계산이 본 데이터 기준 시각은 {stamp(snapshot.dataSnapshotAt)} 입니다.</>
        )}
        {snapshot?.capturedAt && <> 근거를 담은 시각은 {stamp(snapshot.capturedAt)} 입니다.</>}
        {!approval.isActive && (
          <> 이 결정은 같은 품목의 이후 결정으로 대체되었습니다. 기록은 그대로 남습니다.</>
        )}
      </InsightBanner>

      <Panel title="결정" flush>
        <DataTable
          columns={decisionColumns}
          rows={[approval]}
          rowKey={(row) => String(row.approvalId)}
          caption="core.approval — 누가 무엇을 왜 결정했나"
        />
      </Panel>

      {snapshot === null ? (
        <Panel>
          <EmptyState
            title="근거 Snapshot 이 없습니다"
            desc="analytics.v_approval_snapshot 에 이 결정의 행이 없습니다. sql/19-approval.sql 실행 여부를 확인해주세요."
          />
        </Panel>
      ) : (
        <>
          <Panel
            title="추천 수량 근거"
            actions={
              <span className="t-label">창 수요 + 안전재고 − 현재고 − 입고예정 → MOQ · 포장 반영</span>
            }
            flush
          >
            {recommendation === null ? (
              <EmptyState
                title="추천 근거가 저장되지 않았습니다"
                desc="승인 당시 이 품목의 발주 추천 행이 없었습니다."
              />
            ) : (
              <DataTable
                columns={recColumns}
                rows={[recommendation]}
                rowKey={(row) => row.itemId}
                caption="승인 시점의 analytics.v_purchase_recommendation"
              />
            )}
          </Panel>

          {recommendation?.explanation && (
            <InsightBanner eyebrow="RECOMMENDATION">{recommendation.explanation}</InsightBanner>
          )}

          <Panel
            title="안전재고 근거"
            actions={
              <span className="t-label">σ_DLT = √( L × σ_d² + d² × σ_L² ) · 안전재고 = Z × σ_DLT</span>
            }
            flush
          >
            {safety === null ? (
              <EmptyState
                title="안전재고 근거가 저장되지 않았습니다"
                desc="승인 당시 이 품목의 안전재고 행이 없었습니다."
              />
            ) : (
              <DataTable
                columns={safetyColumns}
                rows={[safety]}
                rowKey={(row) => row.itemId}
                caption="승인 시점의 analytics.v_safety_stock"
              />
            )}
          </Panel>

          <Panel title="리드타임" flush>
            {leadtime === null ? (
              <EmptyState
                title="리드타임 근거가 저장되지 않았습니다"
                desc="승인 당시 이 품목의 공급처를 알 수 없었거나, 그 공급처의 리드타임 정책이 없었습니다."
              />
            ) : (
              <DataTable
                columns={leadtimeColumns}
                rows={[leadtime]}
                rowKey={(row) => row.supplierId ?? 'unknown'}
                caption="승인 시점의 analytics.v_leadtime_policy"
              />
            )}
          </Panel>

          <Panel title="Champion 모델" flush>
            {champion === null ? (
              <EmptyState
                title="Champion 이 저장되지 않았습니다"
                desc="승인 당시 이 품목에 선정된 Champion 모델이 없었습니다."
              />
            ) : (
              <DataTable
                columns={championColumns}
                rows={[champion]}
                rowKey={(row) => row.championModelId ?? 'unknown'}
                caption="승인 시점의 analytics.v_champion_model"
              />
            )}
          </Panel>

          <Panel
            title="재고 전개"
            actions={<span className="t-label">기말 재고가 처음 음수가 되는 달이 결품 시점입니다</span>}
            flush
          >
            {projection.length === 0 ? (
              <EmptyState
                title="전개가 저장되지 않았습니다"
                desc="승인 당시 이 품목의 재고 전개 행이 없었습니다."
              />
            ) : (
              <DataTable
                columns={projectionColumns}
                rows={projection}
                rowKey={(row) => row.period}
                caption="승인 시점의 analytics.v_inventory_projection"
              />
            )}
          </Panel>
        </>
      )}
    </>
  );
}

/** 배지를 그릴 수 있는 결정인가. 타입을 좁히려고 함수로 뺐습니다 (error.md #12) */
function isDecide(row: ApprovalRow): row is ApprovalRow & { decision: NonNullable<ApprovalRow['decision']> } {
  return isDecision(row.decision);
}
