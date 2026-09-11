import PageHeader from '@/components/shell/page-header';
import Panel from '@/components/ui/panel';
import UrgentOrderTable, { CreateUrgentOrderForm } from '@/components/orders/urgent-order-table';
import { getPermissions, requireAnyPermission } from '@/lib/auth';
import { WORK_ROUTE_PERMISSIONS } from '@/lib/permission';
import { getUrgentOrderHistory, getUrgentOrders } from '@/lib/urgent-orders/repository';
import { formatOrderDateTime } from '@/lib/orders/model';

export const dynamic = 'force-dynamic';

// ★ 등록 · 수정 · 상태 변경은 SCM 품목담당자(ALLOC_MANUAL)만 한다(컨트롤러 판정 1). 서비스부
//   (URGENT_ORDER_VIEW)는 조회만 하고, 조회 범위는 analytics.v_urgent_order가 소모품으로 제한한다.
export default async function UrgentOrdersPage() {
  await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/urgent-orders']);
  const permissions = await getPermissions();
  const canManage = permissions.has('ALLOC_MANUAL');

  const [{ rows, error }, { rows: history, error: historyError }] = await Promise.all([
    getUrgentOrders(),
    getUrgentOrderHistory(),
  ]);

  return (
    <section className="analysis-page">
      <PageHeader
        eyebrow="WORK"
        title="긴급발주"
        description={
          canManage
            ? '긴급발주를 등록하고 상태를 관리합니다. 등록 · 수정 · 상태 변경은 모두 이력으로 남습니다.'
            : '소모품 긴급발주 현황을 조회합니다. 등록과 상태 변경은 SCM 품목담당자만 할 수 있습니다.'
        }
      />
      <div className="analysis-content">
        {canManage ? (
          <Panel title="긴급발주 등록" description="품목 · 수량 · 필요일 · 사유를 입력합니다.">
            <CreateUrgentOrderForm />
          </Panel>
        ) : null}

        {error ? (
          <div className="card">
            <p className="text-danger">조회에 실패했습니다.</p>
            <p className="muted">{error}</p>
            <p className="muted">Task 5 · 11 마이그레이션이 적용되고 analytics 스키마가 노출되었는지 확인하세요.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="card">
            <p className="muted">조회 권한 범위에 표시할 긴급발주가 없습니다.</p>
          </div>
        ) : (
          <div className="section card">
            <div className="card-title">
              <div>
                <h3>긴급발주 현황</h3>
                <span>{canManage ? '전체 품목' : '소모품 범위'}입니다.</span>
              </div>
              <span className="muted">{rows.length.toLocaleString('ko-KR')}건</span>
            </div>
            <UrgentOrderTable rows={rows} canManage={canManage} />
          </div>
        )}

        {historyError ? (
          <div className="card">
            <p className="text-danger">이력 조회에 실패했습니다.</p>
            <p className="muted">{historyError}</p>
          </div>
        ) : history.length === 0 ? null : (
          <Panel title="변경 이력" description="등록 · 수정 · 상태 변경 이력입니다. 지우거나 고칠 수 없습니다.">
            <ul className="order-history">
              {history.map((event) => (
                <li key={event.id}>
                  <div className="order-history-head">
                    <span className="tag blue">{event.actionLabel}</span>
                    <b>{event.itemId ?? event.urgentOrderId}</b>
                    <span className="muted">{event.actorName}</span>
                    <span className="muted">{formatOrderDateTime(event.at) ?? '—'}</span>
                  </div>
                  {event.after?.reason ? <p>{String(event.after.reason)}</p> : null}
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </section>
  );
}
