import WorkEntryPage from '@/components/shell/work-entry-page';
import { requireAnyPermission } from '@/lib/auth';
import { WORK_ROUTE_PERMISSIONS } from '@/lib/permission';

export default async function ProcurementPlansPage() {
  await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/procurement-plans']);
  return <WorkEntryPage title="발주계획" description="최종 발주계획을 확정하고 승인합니다." nextTask="Task 9에서 발주량 산출과 승인 흐름을 연결합니다." />;
}
