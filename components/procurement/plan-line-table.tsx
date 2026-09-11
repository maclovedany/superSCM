// 발주계획 라인 표 — Task 9b
//
// ★ 모든 수량은 analytics.v_procurement_plan_line에 저장된 값이다. 여기서는 숫자 표시 형식만 바꾸고 계산하지 않는다.
//   null은 0으로 바꾸지 않고 사유 코드와 함께 보여준다.

import DataTable, { type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import {
  SELECTION_REASON_LABELS,
  planReasonLabel,
  type ProcurementPlanLine,
} from '@/lib/procurement/model';

function formatNumber(value: number): string {
  return value.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

function qty(line: ProcurementPlanLine, value: number | null) {
  return value === null ? <EmptyValue reasonCode={line.reasonCode ?? 'CALCULATION_UNAVAILABLE'} /> : formatNumber(value);
}

const columns: Column<ProcurementPlanLine>[] = [
  {
    key: 'itemId', label: '품목 · 월',
    render: (line) => (
      <>
        <b>{line.itemId}</b> <span className="muted">{line.monthNo}개월차</span>
        <br />
        <span className="muted">{line.itemName ?? '품목명 미상'} · {line.targetMonth.slice(0, 7)}</span>
      </>
    ),
  },
  { key: 'baseForecastQty', label: '기준 Forecast', align: 'right', render: (line) => qty(line, line.baseForecastQty) },
  {
    key: 'candidateQty', label: '조정 후보', align: 'right',
    render: (line) => line.candidateQty === null ? qty(line, null) : (
      <>
        {formatNumber(line.candidateQty)}
        <br />
        <span className="muted">{line.candidateSource === 'DEPARTMENT_AGREED' ? '부서 합의' : '기준 Forecast'}</span>
      </>
    ),
  },
  {
    key: 'flexMinQty', label: 'Flex 범위', align: 'right',
    render: (line) => {
      if (line.flexMinQty === null || line.flexMaxQty === null) {
        return line.monthNo >= 4 ? <span className="muted">미적용</span> : qty(line, null);
      }
      return (
        <>
          {formatNumber(line.flexMinQty)} ~ {formatNumber(line.flexMaxQty)}
          {line.flexApplied ? <><br /><span className="tag amber">범위로 조정</span></> : null}
        </>
      );
    },
  },
  {
    key: 'approvedAddedQty', label: '승인 추가 수요', align: 'right',
    render: (line) => line.approvedAddedQty === null ? qty(line, null) : (
      <span title={`확정 수주 ${line.confirmedOrderQty ?? 0} · 수급회의 ${line.meetingQty ?? 0} · 이벤트 ${line.eventQty ?? 0}`}>
        {formatNumber(line.approvedAddedQty)}
      </span>
    ),
  },
  { key: 'demandQty', label: '수요', align: 'right', render: (line) => qty(line, line.demandQty) },
  { key: 'startStockQty', label: '시작재고', align: 'right', render: (line) => qty(line, line.startStockQty) },
  { key: 'avgUsage6m', label: '월평균사용량(6M)', align: 'right', render: (line) => qty(line, line.avgUsage6m) },
  {
    key: 'targetDosDays', label: '목표 DoS', align: 'right',
    render: (line) => line.targetDosDays === null ? <EmptyValue reasonCode="TARGET_DOS_UNSET" /> : (
      <>
        {formatNumber(line.targetDosDays)}일
        {line.targetDosApproved ? null : <><br /><span className="tag red">미승인</span></>}
      </>
    ),
  },
  { key: 'stockoutPreventionQty', label: '품절 방지', align: 'right', render: (line) => qty(line, line.stockoutPreventionQty) },
  { key: 'dosRequiredQty', label: 'DoS 충족', align: 'right', render: (line) => qty(line, line.dosRequiredQty) },
  {
    key: 'selectedQty', label: '선택 수량', align: 'right',
    render: (line) => line.selectedQty === null ? qty(line, null) : (
      <>
        {formatNumber(line.selectedQty)}
        <br />
        <span className="muted">{line.selectionReason ? SELECTION_REASON_LABELS[line.selectionReason] : ''}</span>
      </>
    ),
  },
  { key: 'effectiveMoq', label: 'MOQ(적용)', align: 'right', render: (line) => line.moq === null ? <span title="미설정이라 1로 적용">1 <span className="muted">(기본)</span></span> : qty(line, line.effectiveMoq) },
  { key: 'finalOrderQty', label: '최종 발주량', align: 'right', render: (line) => line.finalOrderQty === null ? qty(line, null) : <b>{formatNumber(line.finalOrderQty)}</b> },
  { key: 'projectedMonthEndQty', label: '예상 월말재고', align: 'right', render: (line) => qty(line, line.projectedMonthEndQty) },
  {
    key: 'projectedDosDays', label: '예상 DoS', align: 'right',
    render: (line) => line.projectedDosDays === null
      ? <EmptyValue reasonCode={line.calculationStatus === 'CALCULATED' ? 'AVG_USAGE_ZERO' : line.reasonCode ?? 'CALCULATION_UNAVAILABLE'} />
      : `${formatNumber(line.projectedDosDays)}일`,
  },
  { key: 'projectedInventoryValue', label: '예상 재고금액', align: 'right', render: (line) => qty(line, line.projectedInventoryValue) },
  {
    key: 'calculationStatus', label: '상태 · 사유',
    render: (line) => (
      <>
        {line.calculationStatus === 'CALCULATED' ? <span className="tag green">계산됨</span> : <span className="tag gray">계산 불가</span>}
        {line.reasonCodes.map((code) => (
          <div key={code} className="muted" title={code}>{planReasonLabel(code)}</div>
        ))}
      </>
    ),
  },
];

export default function PlanLineTable({ lines }: { lines: ProcurementPlanLine[] }) {
  return <DataTable columns={columns} rows={lines} rowKey={(line) => line.lineId} empty="계산 대상 품목이 없습니다." />;
}
