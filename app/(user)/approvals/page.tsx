import WorkEntryPage from '@/components/shell/work-entry-page';
import { requireAnyPermission } from '@/lib/auth';
import { WORK_ROUTE_PERMISSIONS } from '@/lib/permission';

export default async function ApprovalsPage() {
  await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/approvals']);
  return <WorkEntryPage title="승인함" description="업무 요청의 승인과 반려를 처리합니다." nextTask="Task 2에서 공통 승인과 감사 이력 엔진을 연결합니다." />;
}
