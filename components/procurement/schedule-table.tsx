// 발주 일정 표 — Task 10b
//
// ★ 날짜는 모두 analytics.v_procurement_schedule에 저장된 값이다. 여기서는 표시 형식만 바꾸고 계산하지
//   않는다. EXCLUDED 행도 사유와 함께 그대로 보여준다(조용히 빼지 않는다).

import DataTable, { type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import { RecordActualReceiptForm } from './schedule-actions';
import { scheduleReasonLabel, type ProcurementScheduleRow } from '@/lib/schedule/model';

function dateOrEmpty(row: ProcurementScheduleRow, value: string | null) {
  return value === null ? <EmptyValue reasonCode={row.reasonCode ?? 'CALCULATION_UNAVAILABLE'} /> : value;
}

function buildColumns(canRecord: boolean): Column<ProcurementScheduleRow>[] {
  return [
    {
      key: 'itemId', label: '품목',
      render: (row) => (
        <>
          <b>{row.itemId}</b>
          <br />
          <span className="muted">{row.itemName ?? '품목명 미상'} · {row.finalOrderQty === null ? '—' : row.finalOrderQty.toLocaleString('ko-KR')}개</span>
        </>
      ),
    },
    {
      key: 'supplierId', label: '공급처 · 법인',
      render: (row) => row.supplierId === null ? <EmptyValue reasonCode={row.reasonCode ?? 'CALCULATION_UNAVAILABLE'} /> : (
        <>
          {row.supplierName ?? row.supplierId}
          <br />
          <span className="muted">{row.entityName ?? row.entityId ?? '법인 미상'}</span>
        </>
      ),
    },
    {
      key: 'bundleKey', label: '출항일 · 묶음',
      render: (row) => row.departureDate === null ? <EmptyValue reasonCode={row.reasonCode ?? 'CALCULATION_UNAVAILABLE'} /> : (
        <>
          {row.departureDate}
          <br />
          <span className="muted">{row.bundleKey ?? ''}</span>
        </>
      ),
    },
    { key: 'requestedOrderDate', label: '요청 발주일', render: (row) => dateOrEmpty(row, row.requestedOrderDate) },
    { key: 'confirmedReceiptDate', label: '확정 계획 입고일', render: (row) => dateOrEmpty(row, row.confirmedReceiptDate) },
    {
      key: 'actualReceiptDate', label: '실제 입고일 · 차이',
      render: (row) => {
        if (row.calculationStatus !== 'SCHEDULED') {
          return <EmptyValue reasonCode={row.reasonCode ?? 'CALCULATION_UNAVAILABLE'} />;
        }
        return (
          <>
            {row.actualReceiptDate === null ? (
              <EmptyValue reasonCode="ACTUAL_RECEIPT_UNSET" />
            ) : (
              <>
                {row.actualReceiptDate}
                {' '}
                <span className={row.gapDays !== null && row.gapDays > 0 ? 'text-danger' : row.gapDays !== null && row.gapDays < 0 ? 'text-good' : 'muted'}>
                  ({row.gapDays !== null && row.gapDays > 0 ? '+' : ''}{row.gapDays}일)
                </span>
              </>
            )}
            {canRecord ? <RecordActualReceiptForm scheduleId={row.scheduleId} actualReceiptDate={row.actualReceiptDate} /> : null}
          </>
        );
      },
    },
    {
      key: 'calculationStatus', label: '상태 · 사유',
      render: (row) => (
        <>
          {row.calculationStatus === 'SCHEDULED' ? <span className="tag green">계산됨</span> : <span className="tag gray">제외</span>}
          {row.reasonCode ? <div className="muted" title={row.reasonCode}>{scheduleReasonLabel(row.reasonCode)}</div> : null}
        </>
      ),
    },
  ];
}

export default function ScheduleTable({ rows, canRecord }: { rows: ProcurementScheduleRow[]; canRecord: boolean }) {
  return (
    <DataTable
      columns={buildColumns(canRecord)}
      rows={rows}
      rowKey={(row) => row.scheduleId}
      empty="아직 만든 발주 일정이 없습니다."
    />
  );
}
