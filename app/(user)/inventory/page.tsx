import PageHeader from '@/components/shell/page-header';
import OrderAvailableTable from '@/components/inventory/order-available-table';
import StockTable from '@/components/inventory/stock-table';
import { getPermissions, requireAnyPermission } from '@/lib/auth';
import { getAvailableStock, getOrderAvailableStock } from '@/lib/inventory/repository';
import { WORK_ROUTE_PERMISSIONS } from '@/lib/permission';

export const dynamic = 'force-dynamic';

// ★ ATP_VIEW만 가진 사용자(영업담당자)는 재고 상세(배정 내역 · Open PO · 이동 중 · 스냅샷)를
//   보면 안 되고 실제 주문 가능 수량만 봅니다 (stage1 §2, fix round 1). STOCK_VIEW_ALL ·
//   STOCK_VIEW_PAPER · STOCK_VIEW_SUPPLY 중 하나라도 있으면 상세 표를 봅니다 — SCM팀은
//   ATP_VIEW도 함께 갖고 있지만 상세 권한이 우선입니다.
const DETAIL_PERMISSIONS = ['STOCK_VIEW_ALL', 'STOCK_VIEW_PAPER', 'STOCK_VIEW_SUPPLY'] as const;

export default async function InventoryPage() {
  await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/inventory']);
  const permissions = await getPermissions();
  const hasDetailAccess = permissions.hasAny(...DETAIL_PERMISSIONS);

  if (!hasDetailAccess) {
    const { rows, error } = await getOrderAvailableStock();
    return (
      <section className="analysis-page">
        <PageHeader
          eyebrow="WORK"
          title="재고"
          description="실제 주문 가능 수량을 조회합니다. 재고 상세(배정 내역·Open PO·이동 중)는 SCM·마케팅·서비스 담당자만 볼 수 있습니다."
        />
        <div className="analysis-content">
          {error ? (
            <div className="card">
              <p className="text-danger">조회에 실패했습니다.</p>
              <p className="muted">{error}</p>
              <p className="muted">Task 4 마이그레이션이 적용되고 analytics 스키마가 노출되었는지 확인하세요.</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="card">
              <p className="muted">조회 권한 범위에 표시할 품목이 없습니다.</p>
            </div>
          ) : (
            <div className="section card">
              <div className="card-title">
                <div>
                  <h3>주문 가능 수량</h3>
                  <span>정상 창고재고에서 임시배정·확정배정·승인대기 확보수량을 뺀 값입니다.</span>
                </div>
                <span className="muted">{rows.length.toLocaleString('ko-KR')}품목</span>
              </div>
              <OrderAvailableTable rows={rows} />
            </div>
          )}
        </div>
      </section>
    );
  }

  const { rows, error } = await getAvailableStock();

  return (
    <section className="analysis-page">
      <PageHeader
        eyebrow="WORK"
        title="재고"
        description="업무 범위에 맞는 정상 창고재고와 가용재고를 조회합니다. Open PO와 이동 중 수량은 참고 열이며 가용재고에 더하지 않습니다."
      />
      <div className="analysis-content">
        {error ? (
          <div className="card">
            <p className="text-danger">조회에 실패했습니다.</p>
            <p className="muted">{error}</p>
            <p className="muted">Task 4 마이그레이션이 적용되고 analytics 스키마가 노출되었는지 확인하세요.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="card">
            <p className="muted">조회 권한 범위에 표시할 품목이 없습니다.</p>
          </div>
        ) : (
          <div className="section card">
            <div className="card-title">
              <div>
                <h3>정상 창고재고 · 가용재고</h3>
                <span>검사 대기·불량·서비스센터·파트너·이동 중 재고는 정상 창고재고에서 제외합니다.</span>
              </div>
              <span className="muted">{rows.length.toLocaleString('ko-KR')}품목</span>
            </div>
            <StockTable rows={rows} />
          </div>
        )}
      </div>
    </section>
  );
}
