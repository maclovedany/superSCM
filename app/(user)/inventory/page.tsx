import WorkEntryPage from '@/components/shell/work-entry-page';
import { requireAnyPermission } from '@/lib/auth';
import { WORK_ROUTE_PERMISSIONS } from '@/lib/permission';

export default async function InventoryPage() {
  await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/inventory']);
  return <WorkEntryPage title="재고" description="업무 범위에 맞는 가용재고를 조회합니다." nextTask="Task 4에서 정상 창고재고와 가용재고 기준을 연결합니다." />;
}
