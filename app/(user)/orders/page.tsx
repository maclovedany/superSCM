import Link from 'next/link';
import PageHeader from '@/components/shell/page-header';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import { getPermissions, requireAnyPermission } from '@/lib/auth';
import { formatOrderDateTime, orderStatusTone, type SalesOrder } from '@/lib/orders/model';
import { getMySalesOrders } from '@/lib/orders/repository';
import { WORK_ROUTE_PERMISSIONS } from '@/lib/permission';

export const dynamic = 'force-dynamic';

function quantity(value: number | null) {
  return value === null ? <EmptyValue /> : formatNumber(value);
}

const columns: Column<SalesOrder>[] = [
  {
    key: 'orderNo',
    label: '주문',
    render: (row) => (
      <>
        <Link href={`/orders/${row.orderId}`}><b>{row.orderNo}</b></Link>
        <br />
        <span className="muted">{row.customerName}{row.customerId ? ` (${row.customerId})` : ''}</span>
      </>
    ),
  },
  { key: 'status', label: '상태', render: (row) => <span className={`tag ${orderStatusTone(row.status)}`}>{row.statusLabel}</span> },
  { key: 'requestedQty', label: '요청', align: 'right', render: (row) => quantity(row.requestedQty) },
  { key: 'temporaryAllocatedQty', label: '임시배정', align: 'right', render: (row) => quantity(row.temporaryAllocatedQty) },
  { key: 'firmAllocatedQty', label: '확정배정', align: 'right', render: (row) => quantity(row.firmAllocatedQty) },
  { key: 'approvalHoldQty', label: '승인대기', align: 'right', render: (row) => quantity(row.approvalHoldQty) },
  { key: 'shortageQty', label: '부족', align: 'right', render: (row) => <b>{quantity(row.shortageQty)}</b> },
  {
    key: 'temporaryExpiresAt',
    label: '임시배정 만료',
    render: (row) => formatOrderDateTime(row.temporaryExpiresAt) ?? <span className="muted">검토 요청 전</span>,
  },
  {
    key: 'confirmedOrderNo',
    label: '최종 승인 주문번호',
    render: (row) => row.confirmedOrderNo ?? <span className="muted">—</span>,
  },
];

export default async function OrdersPage() {
  await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/orders']);
  const permissions = await getPermissions();
  const { rows, error } = await getMySalesOrders();

  return (
    <section className="analysis-page">
      <PageHeader
        eyebrow="WORK"
        title="주문"
        description="내가 등록한 영업 주문과 임시배정 · 확정배정 · 부족 수량을 확인합니다. 검토 요청과 수주 확정은 주문 상세에서 합니다."
        action={permissions.has('ORDER_CREATE') ? <Link className="button primary" href="/orders/new">주문 등록</Link> : null}
      />
      <div className="analysis-content">
        {error ? (
          <div className="card">
            <p className="text-danger">조회에 실패했습니다.</p>
            <p className="muted">{error}</p>
            <p className="muted">Task 5 주문 · 배정 마이그레이션이 적용되고 analytics 스키마가 노출되었는지 확인하세요.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="card">
            <p className="muted">등록한 주문이 없습니다.</p>
          </div>
        ) : (
          <div className="section card">
            <div className="card-title">
              <div>
                <h3>내 주문</h3>
                <span>부족 수량은 최초 검토 요청 순번을 유지한 채 대기합니다.</span>
              </div>
              <span className="muted">{rows.length.toLocaleString('ko-KR')}건</span>
            </div>
            <DataTable columns={columns} rows={rows} rowKey={(row) => row.orderId} />
          </div>
        )}
      </div>
    </section>
  );
}
