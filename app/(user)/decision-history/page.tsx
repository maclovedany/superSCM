// 결정 이력 — renew.prd 23장 · 31.2
//
// "모든 Forecast·Recommendation·Override·Approval 은 추적 가능해야 한다" (renew.prd 31.2).
// 사람이 시스템에 남긴 결정을 한 표로 모읍니다.
//
//   승인      발주 추천에 대한 승인 · 반려 · 보류        (renew.prd 23)
//   보정      AI 예측에 얹은 증감                        (renew.prd 17)
//   Champion  관리자가 손으로 지정한 모델                (renew.prd 14)
//   리드타임  계획 리드타임 변경                         (renew.prd 18.3)
//
// 요약 문장은 analytics.v_decision_history 가 조립한 것을 그대로 씁니다 —
// 화면 · CSV · AI Agent 가 같은 문장을 써야 근거가 흔들리지 않습니다 (AGENTS.md 규칙 2).

import Link from 'next/link';
import { kstMinute } from '@/lib/time';
import { CheckCircle2, Clock, ListChecks, PencilLine, XCircle } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import Badge from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import FilterNotice from '@/components/ui/filter-notice';
import InsightBanner from '@/components/ui/insight-banner';
import { EmptyState, ErrorState } from '@/components/ui/state';
import { requireUser } from '@/lib/auth';
import { getApprovalKpi, getDecisionHistory } from '@/lib/approval';
import { KIND_LABEL, KIND_TONE, type DecisionHistoryRow } from '@/lib/approval-model';
import { applyFilter, labelOf, readFilter, type FilterSpec, type SearchParams } from '@/lib/filter';
import ChartFrame from '@/components/chart/_base/chart-frame';
import DecisionMonthly from '@/components/chart/decision-monthly';
import DecisionAdjustment from '@/components/chart/decision-adjustment';
import { getApprovalMonthly } from '@/lib/charts';
import { pivotApprovalMonthly, toAdjustmentBars } from '@/lib/chart-model';

export const dynamic = 'force-dynamic';

/** 'YYYY-MM-DDTHH:MM:SS…' 을 분 단위까지만 보여줍니다 */
function stamp(value: string | null): string | null {
  return value === null ? null : kstMinute(value);
}

export default async function DecisionHistoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();

  /**
   * KPI 카드 하나 = 목록 필터 하나 (design.md §6.4).
   *
   * ★ 카드의 숫자를 analytics.v_approval_kpi 에서 가져오지 않습니다.
   *   그 뷰는 유효한(ACTIVE) 결정만 세는데 이 목록은 대체된 결정까지 보여줍니다.
   *   서로 다른 모집단을 한 화면에 두면 카드 숫자와 목록 건수가 어긋납니다.
   *   여기서는 같은 배열을 세므로 항상 맞습니다.
   */
  const FILTERS: FilterSpec<DecisionHistoryRow>[] = [
    { key: 'all', label: '전체 결정', match: null },
    {
      key: 'approved',
      label: '승인',
      match: (row) => row.kind === 'APPROVAL' && row.decision === 'APPROVED',
    },
    // renew.prd 23 — 추천을 그대로 두지 않고 수량을 고친 결정입니다.
    // 조정량을 모르는 행(추천 산출 불가)은 "고쳤다" 고 말할 수 없어 빼둡니다.
    {
      key: 'adjusted',
      label: '수정 승인',
      match: (row) =>
        row.kind === 'APPROVAL' &&
        row.decision === 'APPROVED' &&
        row.adjustment !== null &&
        row.adjustment !== 0,
    },
    {
      key: 'declined',
      label: '반려 · 보류',
      match: (row) =>
        row.kind === 'APPROVAL' && (row.decision === 'REJECTED' || row.decision === 'DEFERRED'),
    },
  ];

  const activeFilter = readFilter(await searchParams);
  const [{ rows, error }, { data: kpi }, monthly] = await Promise.all([
    getDecisionHistory(),
    getApprovalKpi(),
    getApprovalMonthly(),
  ]);

  const header = (
    <PageHeader
      title="결정 이력"
      subtitle="누가 · 언제 · 무엇을 근거로 결정했는지 되짚습니다. 승인 · 예측 보정 · Champion 수동 지정 · 계획 리드타임 변경을 한 표로 모았습니다. 승인은 그 시점의 계산 근거를 함께 보관하므로, 데이터가 바뀐 뒤에도 당시 판단을 그대로 다시 볼 수 있습니다."
      meta={
        <>
          <MetaChip>PRD 23</MetaChip>
          <MetaChip>최근 200건</MetaChip>
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

  const columns: Column<DecisionHistoryRow>[] = [
    {
      key: 'at',
      label: '시각',
      variant: 'code',
      render: (row) => (row.at === null ? <EmptyValue showLabel={false} /> : stamp(row.at)),
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
      key: 'item',
      label: '품목',
      variant: 'code',
      // ★ 리드타임 변경은 품목이 아니라 공급처에 붙습니다. 품목 칸에 아무 품목이나
      //   채우면 "이 품목을 바꿨다" 로 읽히므로 공급처 코드를 그대로 보여줍니다.
      render: (row) => {
        if (row.itemId !== null) {
          return (
            <Link href={`/purchase-recommendation/${row.itemId}`} style={{ color: 'var(--info-fg)' }}>
              {row.itemName ?? row.itemId}
            </Link>
          );
        }
        if (row.supplierId !== null) return <span>공급처 {row.supplierId}</span>;
        return <EmptyValue showLabel={false} />;
      },
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
      // 근거 Snapshot 은 승인에만 있습니다 (renew.prd 23.2).
      // 보정 · Champion · 리드타임은 요약 문장이 근거의 전부입니다.
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

  const visible = applyFilter(rows, FILTERS, activeFilter);
  // '전체 결정' 은 좁히지 않으므로 안내 줄을 띄우지 않습니다.
  const filterLabel = activeFilter === 'all' ? null : labelOf(FILTERS, activeFilter);

  const countOf = (key: string): number => applyFilter(rows, FILTERS, key).length;
  const approved = countOf('approved');
  const adjusted = countOf('adjusted');
  const declined = countOf('declined');
  const pending = kpi?.pendingCount ?? null;

  const lastApproval = rows.find((row) => row.kind === 'APPROVAL') ?? null;

  return (
    <>
      {header}

      <div className="grid grid-kpi">
        <KpiCard
          label="전체 결정"
          value={rows.length}
          unit="건"
          icon={ListChecks}
          foot="승인 · 보정 · Champion · 리드타임"
          filter={{ key: 'all', active: activeFilter === 'all' }}
        />
        <KpiCard
          label="승인"
          value={approved}
          unit="건"
          icon={CheckCircle2}
          foot="대체된 이전 결정도 포함합니다"
          filter={{ key: 'approved', active: activeFilter === 'approved' }}
        />
        <KpiCard
          label="수정 승인"
          value={adjusted}
          unit="건"
          icon={PencilLine}
          tone={adjusted > 0 ? 'warn' : 'default'}
          foot="추천과 다른 수량으로 승인"
          filter={{ key: 'adjusted', active: activeFilter === 'adjusted' }}
        />
        <KpiCard
          label="반려 · 보류"
          value={declined}
          unit="건"
          icon={XCircle}
          foot="발주하지 않기로 한 결정"
          filter={{ key: 'declined', active: activeFilter === 'declined' }}
        />
        {/* kpi-filter: 없음 — 이 카드가 세는 것은 결정이 아니라 "아직 결정하지 않은 품목" 입니다.
            목록(v_decision_history)에는 그 품목의 행이 아예 없어 좁힐 대상이 없습니다.
            어디서 볼 수 있는지를 foot 으로 밝힙니다 (design.md §6.4 · §8.2). */}
        <KpiCard
          label="승인 대기"
          value={pending}
          unit={pending === null ? undefined : '개'}
          icon={Clock}
          tone={pending !== null && pending > 0 ? 'warn' : 'default'}
          foot="발주가 필요한데 결정이 없습니다 · 발주 추천 화면에서 확인"
        />
      </div>

      {lastApproval?.summary && (
        <InsightBanner eyebrow="DECISION INSIGHT">
          가장 최근 승인은{' '}
          <b>{lastApproval.itemName ?? lastApproval.itemId ?? '품목 미상'}</b> 입니다.{' '}
          {lastApproval.summary}
          {pending !== null && pending > 0 && (
            <>
              {' '}
              아직 결정하지 않은 발주 대상이 {formatNumber(pending)}개 남아 있습니다.{' '}
              {/* 필터를 건 주소로 보내지 않습니다. 이 숫자는 뷰 전체를 세는데 저쪽 목록은
                  500행까지만 읽으므로, 필터를 걸어 보내면 건수가 달라 보일 수 있습니다.
                  저 화면에도 같은 이름의 "승인 대기" 카드가 있습니다. */}
              <Link href="/purchase-recommendation" style={{ color: 'var(--info-fg)' }}>
                발주 추천 화면
              </Link>
              의 <b>승인 대기</b> 카드에서 확인할 수 있습니다.
            </>
          )}
        </InsightBanner>
      )}

      {filterLabel && (
        <FilterNotice label={filterLabel} shown={visible.length} total={rows.length} />
      )}

      {/* ── 차트 띠 — spec §4.3 (산점도 대신 조정량 막대 — 이력 뷰에 추천·승인 수량이 없습니다) ── */}
      <div className="grid-charts">
        <ChartFrame
          title="월별 결정"
          desc="최근 6개월 발주 결정 건수 · 범례를 눌러 결정 종류를 끄고 켭니다"
          error={monthly.error}
          empty={monthly.rows.length === 0 ? '아직 내려진 결정이 없습니다' : null}
        >
          <DecisionMonthly stacks={pivotApprovalMonthly(monthly.rows)} href={null} />
        </ChartFrame>
        <ChartFrame
          title="승인 조정량"
          desc="승인 수량 − 추천 수량 · 절댓값 큰 순 20 · 누르면 그 결정의 근거"
          empty={toAdjustmentBars(rows).length === 0 ? '수량을 조정한 승인이 없습니다' : null}
        >
          <DecisionAdjustment bars={toAdjustmentBars(rows)} hrefTemplate="/decision-history/{id}" />
        </ChartFrame>
      </div>

      <Panel
        title="결정 이력"
        actions={<span className="t-label">최근 순 · 승인 행은 그때의 근거를 다시 볼 수 있습니다</span>}
        flush
      >
        {rows.length === 0 ? (
          <EmptyState
            title="아직 남은 결정이 없습니다"
            desc="발주 추천을 승인하거나, 예측을 보정하거나, 계획 리드타임을 바꾸면 여기에 쌓입니다."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={`${filterLabel ?? ''} 에 해당하는 결정이 없습니다`}
            desc="위 카드를 다시 눌러 전체 목록으로 돌아갈 수 있습니다."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(row, index) => `${row.kind}-${row.refId}-${index}`}
            caption="analytics.v_decision_history — 승인 · 보정 · Champion · 리드타임 통합 이력"
          />
        )}
      </Panel>
    </>
  );
}
