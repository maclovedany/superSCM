import PageHeader from '@/components/shell/page-header';
import Panel from '@/components/ui/panel';
import SubmissionStatusTable from '@/components/demand/submission-status-table';
import { requireAdmin } from '@/lib/auth';
import { getDemandSubmissions } from '@/lib/demand/repository';

// Task 7 — SCM 취합 상태를 ADMIN 시점에서 보는 오버뷰. 실제 제출·회수·합의 작업 화면은
// /demand-submissions(과 상세)이며, SCM 품목담당자(PLAN_CONFIRM)는 그 경로로 들어간다 —
// 이 (admin) 그룹의 레이아웃은 ADMIN 역할만 통과시키기 때문이다.
export const dynamic = 'force-dynamic';

export default async function AdminDemandPage() {
  await requireAdmin();
  const { rows, error } = await getDemandSubmissions();

  return (
    <section className="analysis-page">
      <PageHeader eyebrow="ADMIN" title="수요 관리" description="부서별 월간 수요 취합 현황을 확인합니다." />
      <Panel title="취합 현황" description="제출 여부·오류 건수·마지막 수정자와 시각을 한 화면에서 봅니다. 편집과 합의 확정은 각 항목을 눌러 이동합니다.">
        {error ? (
          <>
            <p className="text-danger">조회에 실패했습니다.</p>
            <p className="muted">{error}</p>
          </>
        ) : (
          <SubmissionStatusTable rows={rows} />
        )}
      </Panel>
    </section>
  );
}
