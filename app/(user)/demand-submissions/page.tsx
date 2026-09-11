import WorkEntryPage from '@/components/shell/work-entry-page';
import { requireAnyPermission } from '@/lib/auth';
import { WORK_ROUTE_PERMISSIONS } from '@/lib/permission';

export default async function DemandSubmissionsPage() {
  await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/demand-submissions']);
  return <WorkEntryPage title="수요 제출" description="부서별 월간 수요를 제출합니다." nextTask="Task 7에서 제출·마감·수정 흐름을 연결합니다." />;
}
