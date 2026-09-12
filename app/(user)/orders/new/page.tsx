// 주문 등록 — Task 5
//
// ★ Task 15 fix round 1 (C2-3) — 이 화면의 주문 가능 수량(ATP)은 실습 재고에서 그대로 나온다.
//   영업담당자가 그 숫자를 보고 주문을 만들므로, 실습 품목이 섞여 있으면 반드시 알려야 한다.

import PageHeader from '@/components/shell/page-header';
import OrderCreateForm from '@/components/orders/order-form';
import PracticeDataBanner from '@/components/ui/practice-banner';
import { requirePermission } from '@/lib/auth';
import { getOrderAvailableStock } from '@/lib/inventory/repository';
import { getPracticeDataStatus, getPracticeItemIds } from '@/lib/practice/repository';

export const dynamic = 'force-dynamic';

export default async function NewOrderPage() {
  await requirePermission('ORDER_CREATE');
  const [{ rows, error }, practiceItemIds, { status: practiceStatus }] = await Promise.all([
    getOrderAvailableStock(),
    getPracticeItemIds(),
    getPracticeDataStatus(),
  ]);

  const showPractice =
    practiceStatus !== null &&
    practiceStatus.hasPracticeData &&
    rows.some((row) => practiceItemIds.has(row.itemId));

  return (
    <section className="analysis-page">
      <PageHeader
        eyebrow="WORK"
        title="주문 등록"
        description="고객과 품목 · 수량을 입력해 작성 중 주문을 만듭니다. 재고는 검토 요청 때 배정됩니다."
      />
      <div className="analysis-content">
        {showPractice && practiceStatus !== null ? <PracticeDataBanner status={practiceStatus} /> : null}
        {error ? (
          <div className="card">
            <p className="text-danger">품목과 주문 가능 수량을 조회하지 못했습니다.</p>
            <p className="muted">{error}</p>
            <p className="muted">주문 가능 수량 조회에는 ATP_VIEW 권한과 Task 4 · 5 마이그레이션이 필요합니다.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="card">
            <p className="muted">주문할 수 있는 품목이 없습니다. 품목 마스터가 적재되었는지 확인하세요.</p>
          </div>
        ) : (
          <div className="section card">
            <div className="card-title">
              <div>
                <h3>새 주문</h3>
                <span>같은 품목은 한 줄로 합쳐 입력합니다.</span>
              </div>
            </div>
            <OrderCreateForm items={rows} />
          </div>
        )}
      </div>
    </section>
  );
}
