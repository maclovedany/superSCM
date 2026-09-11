import ApprovalTable from '@/components/approvals/approval-table';
import PageHeader from '@/components/shell/page-header';
import { requireAnyPermission } from '@/lib/auth';
import { getMyApprovalInbox } from '@/lib/approvals/repository';
import { WORK_ROUTE_PERMISSIONS } from '@/lib/permission';

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/approvals']);
  const { rows, error } = await getMyApprovalInbox();

  return (
    <section className="analysis-page">
      <PageHeader
        eyebrow="WORKFLOW"
        title="승인함"
        description="권한이 있는 업무 요청을 검토하고 승인하거나 반려합니다. 본인이 요청한 건은 직접 처리할 수 없습니다."
      />
      <div className="analysis-content">
        {error ? (
          <div className="card">
            <p className="text-danger">조회에 실패했습니다.</p>
            <p className="muted">{error}</p>
            <p className="muted">Task 2 승인 마이그레이션이 적용되고 analytics 스키마가 노출되었는지 확인하세요.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="card approval-empty">
            <span className="tag green">처리 완료</span>
            <h3>대기 중인 승인 요청이 없습니다.</h3>
            <p className="muted">새 요청이 등록되면 권한에 따라 이 승인함에 표시됩니다.</p>
          </div>
        ) : (
          <div className="card">
            <div className="card-title"><div><h3>승인 대기</h3><span>요청 내용과 사유를 확인한 뒤 처리하세요</span></div></div>
            <ApprovalTable rows={rows} />
          </div>
        )}
      </div>
    </section>
  );
}
