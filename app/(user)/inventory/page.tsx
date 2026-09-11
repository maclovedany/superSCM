import PageHeader from '@/components/shell/page-header';
import StockTable from '@/components/inventory/stock-table';
import { requireAnyPermission } from '@/lib/auth';
import { getAvailableStock } from '@/lib/inventory/repository';
import { WORK_ROUTE_PERMISSIONS } from '@/lib/permission';

export const dynamic = 'force-dynamic';

export default async function InventoryPage() {
  await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/inventory']);
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
