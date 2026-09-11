import PageHeader from '@/components/shell/page-header';
import AllocationTable from '@/components/orders/allocation-table';
import ManualAllocationQueue, { type ManualAllocationQueueGroup } from '@/components/orders/manual-allocation-queue';
import { getPermissions, requireAnyPermission } from '@/lib/auth';
import { getAllocationQueue, getManualAllocationCandidates } from '@/lib/orders/repository';
import { WORK_ROUTE_PERMISSIONS } from '@/lib/permission';

export const dynamic = 'force-dynamic';

// MANUAL 품목 · 부족수량이 있는 품목만 core.list_manual_allocation_candidates를 부른다(Task 11
// 컨트롤러 판정 3) — 계산 없이 대기 순번만 옮긴다. AUTO 품목이나 부족수량이 없는 품목은 대상이 아니다.
async function loadManualAllocationGroups(rows: Awaited<ReturnType<typeof getAllocationQueue>>['rows']): Promise<ManualAllocationQueueGroup[]> {
  const manualItems = new Map<string, string | null>();
  for (const row of rows) {
    if (row.allocationMode === 'MANUAL' && row.shortageQty !== null && row.shortageQty > 0) {
      manualItems.set(row.itemId, row.itemName);
    }
  }
  return Promise.all(
    Array.from(manualItems.entries()).map(async ([itemId, itemName]) => {
      const { rows: candidateRows, error } = await getManualAllocationCandidates(itemId);
      return { itemId, itemName, rows: candidateRows, error };
    }),
  );
}

export default async function AllocationsPage() {
  await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/allocations']);
  const [permissions, { rows, error }] = await Promise.all([getPermissions(), getAllocationQueue()]);
  const canManual = permissions.has('ALLOC_MANUAL');
  const manualGroups = canManual && !error ? await loadManualAllocationGroups(rows) : [];

  return (
    <section className="analysis-page">
      <PageHeader
        eyebrow="WORK"
        title="배정"
        description="진행 중 주문의 임시배정 · 확정배정 · 부족 수량과 대기 순번을 보고 수동 확정배정과 확정배정 취소를 처리합니다."
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
                <h3>배정 대기열</h3>
                <span>
                  순번은 우선순위 → 최초 검토 요청 시각 → 주문 생성 순서입니다. 앞선 대기 주문을 건너뛴 수동 배정은
                  사유와 SCM팀장 승인이 필요하며 승인 전에는 승인대기 확보로만 차감됩니다.
                </span>
              </div>
              <span className="muted">{rows.length.toLocaleString('ko-KR')}줄</span>
            </div>
            <AllocationTable
              rows={rows}
              mode="SCM"
              canManual={canManual}
              canCancelFirm={permissions.has('ALLOC_FIRM_CANCEL')}
            />
          </div>
        )}

        {canManual ? <ManualAllocationQueue groups={manualGroups} /> : null}
      </div>
    </section>
  );
}
