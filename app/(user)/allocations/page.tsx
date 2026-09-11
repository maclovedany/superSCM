import WorkEntryPage from '@/components/shell/work-entry-page';
import { requireAnyPermission } from '@/lib/auth';
import { WORK_ROUTE_PERMISSIONS } from '@/lib/permission';

export default async function AllocationsPage() {
  await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/allocations']);
  return <WorkEntryPage title="배정" description="품목별 재고 배정 업무를 처리합니다." nextTask="Task 5에서 임시·확정 배정 트랜잭션을 연결합니다." />;
}
