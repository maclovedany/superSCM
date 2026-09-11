import PageHeader from '@/components/shell/page-header';
import AllocationTable from '@/components/orders/allocation-table';
import { requireAnyPermission } from '@/lib/auth';
import { getAllocationQueue } from '@/lib/orders/repository';
import { WORK_ROUTE_PERMISSIONS } from '@/lib/permission';

export const dynamic = 'force-dynamic';

export default async function AllocationPrioritiesPage() {
  await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/allocations/priorities']);
  const { rows, error } = await getAllocationQueue();

  return (
    <section className="analysis-page">
      <PageHeader
        eyebrow="WORK"
        title="배정 우선순위"
        description="임시배정 건과 대기 순번을 보고 우선순위를 변경합니다. 변경한 우선순위는 신규 입고 배정 순서에 먼저 적용됩니다."
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
            <p className="muted">검토 요청 이후 진행 중인 주문이 없습니다.</p>
          </div>
        ) : (
          <div className="section card">
            <div className="card-title">
              <div>
                <h3>임시배정 · 대기 주문</h3>
                <span>같은 우선순위 안에서는 검토 요청이 먼저 등록된 주문이 앞섭니다. 변경 전후 값 · 변경자 · 시각 · 사유가 이력으로 남습니다.</span>
              </div>
              <span className="muted">{rows.length.toLocaleString('ko-KR')}줄</span>
            </div>
            <AllocationTable rows={rows} mode="PRIORITY" />
          </div>
        )}
      </div>
    </section>
  );
}
