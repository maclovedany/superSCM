import WorkEntryPage from '@/components/shell/work-entry-page';
import { requireAnyPermission } from '@/lib/auth';
import { WORK_ROUTE_PERMISSIONS } from '@/lib/permission';

export default async function OrdersPage() {
  await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/orders']);
  return <WorkEntryPage title="주문" description="영업 주문을 등록하고 검토를 요청합니다." nextTask="Task 5에서 주문 등록과 배정 흐름을 연결합니다." />;
}
