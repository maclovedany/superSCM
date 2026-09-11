// 입고 차이 분석 — Task 10b
//
// ★ 법인 · 품목 · 월별 평균 · 합계는 analytics.v_receipt_gap_*에 이미 계산돼 저장된 값이다. 세 뷰 모두
//   같은 원천 행(core.receipt_schedule_result의 SCHEDULED 행)에서 나눠 집계했다.

import PageHeader from '@/components/shell/page-header';
import Panel from '@/components/ui/panel';
import { ReceiptGapEntityTable, ReceiptGapItemTable, ReceiptGapMonthTable } from '@/components/analysis/receipt-gap-table';
import { requireAnyPermission } from '@/lib/auth';
import { WORK_ROUTE_PERMISSIONS } from '@/lib/permission';
import { getReceiptGapByEntity, getReceiptGapByItem, getReceiptGapByMonth } from '@/lib/schedule/repository';

export const dynamic = 'force-dynamic';

function QueryError({ message }: { message: string }) {
  return (
    <>
      <p className="text-danger">조회에 실패했습니다.</p>
      <p className="muted">{message}</p>
    </>
  );
}

export default async function ReceiptGapPage() {
  await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/analysis/receipt-gap']);

  const [entity, item, month] = await Promise.all([
    getReceiptGapByEntity(),
    getReceiptGapByItem(),
    getReceiptGapByMonth(),
  ]);

  return (
    <section className="analysis-page">
      <PageHeader
        title="입고 차이"
        description="확정 계획 입고일과 실제 입고일의 차이(부호 있는 일수)를 해외법인 · 품목 · 월별로 봅니다. 실제 입고일이 없는 건은 평균 · 합계에서 빠지고 건수만 따로 보여줍니다."
      />
      <div className="analysis-content">
        <Panel title="해외법인별" description="공급처가 속한 해외법인 기준 집계입니다.">
          {entity.error ? <QueryError message={entity.error} /> : <ReceiptGapEntityTable rows={entity.rows} />}
        </Panel>

        <Panel title="품목별">
          {item.error ? <QueryError message={item.error} /> : <ReceiptGapItemTable rows={item.rows} />}
        </Panel>

        <Panel title="월별" description="확정 계획 입고일이 속한 월 기준입니다.">
          {month.error ? <QueryError message={month.error} /> : <ReceiptGapMonthTable rows={month.rows} />}
        </Panel>
      </div>
    </section>
  );
}
