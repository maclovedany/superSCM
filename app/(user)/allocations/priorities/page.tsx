import WorkEntryPage from '@/components/shell/work-entry-page';
import { requireAnyPermission } from '@/lib/auth';
import { WORK_ROUTE_PERMISSIONS } from '@/lib/permission';

export default async function AllocationPrioritiesPage() {
  await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/allocations/priorities']);
  return <WorkEntryPage title="배정 우선순위" description="주문 대기 순서와 우선순위를 관리합니다." nextTask="Task 5에서 우선순위 변경과 승인 흐름을 연결합니다." />;
}
