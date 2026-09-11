import Link from 'next/link';
import { notFound } from 'next/navigation';
import PageHeader from '@/components/shell/page-header';
import { ConfirmOrderForm, CopyOrderForm, ReviewRequestForm } from '@/components/orders/order-form';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import { getPermissions, requireAnyPermission } from '@/lib/auth';
import {
  ORDER_STATUS_LABELS,
  describeOrderEvent,
  formatOrderDateTime,
  orderActionsFor,
  orderStatusTone,
  validateCopyOrder,
  type SalesOrderLine,
} from '@/lib/orders/model';
import { getMySalesOrder } from '@/lib/orders/repository';
import { WORK_ROUTE_PERMISSIONS } from '@/lib/permission';

export const dynamic = 'force-dynamic';

function quantity(value: number | null) {
  return value === null ? <EmptyValue /> : formatNumber(value);
}

function dateText(value: string | null, fallback = '—') {
  return formatOrderDateTime(value) ?? <span className="muted">{fallback}</span>;
}

const lineColumns: Column<SalesOrderLine>[] = [
  {
    key: 'itemId',
    label: '품목',
    render: (line) => (
      <>
        <b>{line.itemId}</b>
        <br />
        <span className="muted">{line.itemName ?? '품목명 미상'}</span>
      </>
    ),
  },
  { key: 'requestedQty', label: '요청', align: 'right', render: (line) => quantity(line.requestedQty) },
  { key: 'temporaryAllocatedQty', label: '임시배정', align: 'right', render: (line) => quantity(line.temporaryAllocatedQty) },
  { key: 'firmAllocatedQty', label: '확정배정', align: 'right', render: (line) => quantity(line.firmAllocatedQty) },
  { key: 'approvalHoldQty', label: '승인대기 확보', align: 'right', render: (line) => quantity(line.approvalHoldQty) },
  { key: 'shortageQty', label: '부족', align: 'right', render: (line) => <b>{quantity(line.shortageQty)}</b> },
];

export default async function OrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/orders']);
  const { orderId } = await params;
  if (!validateCopyOrder({ orderId }).ok) notFound();

  const [permissions, { order, error }] = await Promise.all([getPermissions(), getMySalesOrder(orderId)]);

  if (error) {
    return (
      <section className="analysis-page">
        <PageHeader eyebrow="WORK" title="주문 상세" description="주문 상태와 배정 수량을 확인합니다." />
        <div className="analysis-content">
          <div className="card">
            <p className="text-danger">조회에 실패했습니다.</p>
            <p className="muted">{error}</p>
          </div>
        </div>
      </section>
    );
  }
  if (!order) notFound();

  const actions = orderActionsFor(order);
  const canReview = actions.canRequestReview && permissions.has('ORDER_REVIEW_REQUEST');
  const canConfirm = actions.canConfirm && permissions.has('ORDER_CREATE');
  const canCopy = actions.canCopy && permissions.has('ORDER_CREATE');

  return (
    <section className="analysis-page">
      <PageHeader
        eyebrow="WORK"
        title={`주문 ${order.orderNo}`}
        description={`${order.customerName}${order.customerId ? ` (${order.customerId})` : ''} · 영업담당자 ${order.ownerName}`}
        action={<Link className="button" href="/orders">주문 목록</Link>}
      />
      <div className="analysis-content">
        <div className="section card">
          <div className="card-title">
            <div>
              <h3>주문 상태</h3>
              <span>임시배정 만료는 최초 검토 요청 시각 + 30일이며 바뀌지 않습니다.</span>
            </div>
            <span className={`tag ${orderStatusTone(order.status)}`}>{order.statusLabel}</span>
          </div>
          <dl className="order-summary-grid">
            <div><dt>등록</dt><dd>{dateText(order.requestedAt)}</dd></div>
            <div><dt>최초 검토 요청</dt><dd>{dateText(order.firstReviewRequestedAt, '검토 요청 전')}</dd></div>
            <div><dt>임시배정 만료</dt><dd>{dateText(order.temporaryExpiresAt, '검토 요청 전')}</dd></div>
            <div><dt>배정 방식</dt><dd>{order.allocationChoiceLabel ?? <span className="muted">검토 요청 전</span>}</dd></div>
            <div><dt>배정 우선순위</dt><dd>{quantity(order.allocationPriority)}</dd></div>
            <div><dt>최종 승인 주문번호</dt><dd>{order.confirmedOrderNo ?? <span className="muted">—</span>}</dd></div>
            <div>
              <dt>이전 주문</dt>
              <dd>{order.replacesOrderId ? <Link href={`/orders/${order.replacesOrderId}`}>{order.replacesOrderNo ?? order.replacesOrderId}</Link> : <span className="muted">—</span>}</dd>
            </div>
            <div>
              <dt>재등록 주문</dt>
              <dd>{order.replacedByOrderId ? <Link href={`/orders/${order.replacedByOrderId}`}>{order.replacedByOrderNo ?? order.replacedByOrderId}</Link> : <span className="muted">—</span>}</dd>
            </div>
          </dl>
          {order.cancelReason ? <p className="muted">취소 사유: {order.cancelReason} · {dateText(order.cancelledAt)}</p> : null}
          {order.note ? <p className="muted">비고: {order.note}</p> : null}
        </div>

        <div className="section card">
          <div className="card-title">
            <div>
              <h3>주문 품목</h3>
              <span>승인대기 확보는 SCM팀장 결정 전까지 가용재고에서 차감되지만 확정배정은 아닙니다.</span>
            </div>
          </div>
          <DataTable columns={lineColumns} rows={order.lines} rowKey={(line) => line.lineId} empty="주문 품목이 없습니다." />
        </div>

        {canReview || canConfirm || canCopy ? (
          <div className="section card">
            <div className="card-title">
              <div>
                <h3>{canReview ? '검토 요청' : canConfirm ? '수주 확정' : '재등록'}</h3>
                <span>처리 결과는 DB가 재고를 잠근 뒤 판정한 값입니다.</span>
              </div>
            </div>
            {canReview ? <ReviewRequestForm orderId={order.orderId} /> : null}
            {canConfirm ? <ConfirmOrderForm orderId={order.orderId} /> : null}
            {canCopy ? <CopyOrderForm orderId={order.orderId} /> : null}
          </div>
        ) : null}

        <div className="section card">
          <div className="card-title">
            <div>
              <h3>처리 이력</h3>
              <span>주문 상태 · 배정 수량 · 처리자 · 시각 · 사유를 변경할 수 없는 이력으로 보관합니다.</span>
            </div>
          </div>
          {order.events.length === 0 ? (
            <p className="muted">이력이 없습니다.</p>
          ) : (
            <ol className="order-history">
              {order.events.map((event) => (
                <li key={event.eventId}>
                  <div className="order-history-head">
                    <b>{event.eventTypeLabel}</b>
                    <span className="muted">{event.actorName} · {dateText(event.at)}</span>
                  </div>
                  <p>
                    {describeOrderEvent(event)}
                    {event.previousStatus && event.nextStatus && event.previousStatus !== event.nextStatus
                      ? ` · ${ORDER_STATUS_LABELS[event.previousStatus]} → ${ORDER_STATUS_LABELS[event.nextStatus]}`
                      : ''}
                  </p>
                  {event.reason ? <p className="muted">사유: {event.reason}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
