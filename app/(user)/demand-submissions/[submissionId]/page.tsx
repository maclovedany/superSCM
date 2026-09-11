import Link from 'next/link';
import { notFound } from 'next/navigation';
import PageHeader from '@/components/shell/page-header';
import Panel from '@/components/ui/panel';
import DataTable, { type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import {
  AgreeSubmissionForm,
  DirectEntryLinesForm,
  SubmitSubmissionForm,
  UploadLinesForm,
  WithdrawSubmissionForm,
} from '@/components/demand/submission-form';
import { getPermissions, requireAnyPermission } from '@/lib/auth';
import { departmentLabel, WORK_ROUTE_PERMISSIONS } from '@/lib/permission';
import {
  formatDemandDateTime,
  submissionActionsFor,
  submissionStatusTone,
  validateSubmissionId,
  type DemandSubmissionLine,
} from '@/lib/demand/model';
import { getDemandSubmission, getDemandSubmissionLines } from '@/lib/demand/repository';

export const dynamic = 'force-dynamic';

const lineColumns: Column<DemandSubmissionLine>[] = [
  {
    key: 'itemId',
    label: '품목',
    render: (line) => (
      <>
        <b>{line.itemId ?? line.rawItemCode ?? '미상'}</b>
        <br />
        <span className="muted">{line.itemName ?? (line.itemId ? '품목명 미상' : `원본: ${line.rawItemCode ?? '—'}`)}</span>
      </>
    ),
  },
  { key: 'qty', label: '수량', align: 'right', render: (line) => (line.qty === null ? <EmptyValue reasonCode="INVALID_OR_MISSING" /> : line.qty.toLocaleString('ko-KR')) },
  { key: 'needMonth', label: '필요월', render: (line) => line.needMonth ?? <EmptyValue reasonCode="INVALID_OR_MISSING" /> },
  {
    key: 'issues',
    label: '오류',
    render: (line) =>
      line.issues.length === 0 ? (
        <span className="muted">정상</span>
      ) : (
        <ul className="demand-issue-list">
          {line.issues.map((issue, index) => (
            <li key={index}><span className="tag red">{issue.code}</span> {issue.message}</li>
          ))}
        </ul>
      ),
  },
];

export default async function DemandSubmissionDetailPage({ params }: { params: Promise<{ submissionId: string }> }) {
  const { profile } = await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/demand-submissions']);
  const { submissionId } = await params;
  if (!validateSubmissionId(submissionId).ok) notFound();

  const [permissions, { submission, error: submissionError }] = await Promise.all([
    getPermissions(),
    getDemandSubmission(submissionId),
  ]);

  if (submissionError) {
    return (
      <section className="analysis-page">
        <PageHeader eyebrow="WORK" title="수요 제출 상세" description="제출 상태와 항목을 확인합니다." />
        <div className="analysis-content">
          <div className="card"><p className="text-danger">조회에 실패했습니다.</p><p className="muted">{submissionError}</p></div>
        </div>
      </section>
    );
  }
  if (!submission) notFound();

  const { rows: lines, error: lineError } = await getDemandSubmissionLines(submissionId);

  const isOwnDepartment = permissions.has('DEMAND_SUBMIT') && submission.department === profile.department;
  const isConsolidator = permissions.has('PLAN_CONFIRM') || permissions.has('DEMAND_CONSOLIDATE') || profile.role === 'ADMIN';
  const canAgreeRole = permissions.has('PLAN_CONFIRM') || profile.role === 'ADMIN';

  const actions = submissionActionsFor(submission);
  const canEdit = isOwnDepartment && actions.canEdit;
  const canSubmit = isOwnDepartment && actions.canSubmit;
  const canWithdraw = isOwnDepartment && actions.canWithdraw;
  const canAgree = canAgreeRole && actions.canAgree;

  return (
    <section className="analysis-page">
      <PageHeader
        eyebrow="WORK"
        title={`${departmentLabel(submission.department)} · ${submission.planMonth?.slice(0, 7) ?? '—'}`}
        description="제출 상태, 마감일, 오류 건수, 마지막 수정자와 시각을 확인합니다."
        action={<Link className="button" href="/demand-submissions">목록</Link>}
      />
      <div className="analysis-content">
        <div className="section card">
          <div className="card-title">
            <div>
              <h3>제출 상태</h3>
              <span>버전 {submission.version ?? '—'} · 마감일 {submission.submissionDeadline ?? '—'}</span>
            </div>
            <span className={`tag ${submissionStatusTone(submission.status)}`}>{submission.statusLabel}</span>
          </div>
          <dl className="order-summary-grid">
            <div><dt>제출자</dt><dd>{submission.submittedByName ?? <span className="muted">—</span>}</dd></div>
            <div><dt>제출 시각</dt><dd>{formatDemandDateTime(submission.submittedAt) ?? <span className="muted">—</span>}</dd></div>
            <div><dt>합의자</dt><dd>{submission.agreedByName ?? <span className="muted">—</span>}</dd></div>
            <div><dt>합의 시각</dt><dd>{formatDemandDateTime(submission.agreedAt) ?? <span className="muted">—</span>}</dd></div>
            <div><dt>마지막 수정</dt><dd>{submission.lastModifiedByName ?? <span className="muted">—</span>}</dd></div>
            <div><dt>수정 시각</dt><dd>{formatDemandDateTime(submission.lastModifiedAt) ?? <span className="muted">—</span>}</dd></div>
          </dl>
          {isConsolidator && !isOwnDepartment ? (
            <p className="muted">SCM 취합 권한으로 다른 부서의 제출본을 보고 있습니다. 편집은 소속 부서만 할 수 있습니다.</p>
          ) : null}
        </div>

        <div className="section card">
          <div className="card-title">
            <div>
              <h3>제출 항목</h3>
              <span>{(submission.totalLineCount ?? 0).toLocaleString('ko-KR')}건 · 오류 {(submission.errorLineCount ?? 0).toLocaleString('ko-KR')}건</span>
            </div>
          </div>
          {lineError ? (
            <p className="text-danger">항목을 조회하지 못했습니다: {lineError}</p>
          ) : (
            <DataTable columns={lineColumns} rows={lines} rowKey={(line) => line.lineId} empty="저장된 항목이 없습니다." />
          )}
        </div>

        {canEdit ? (
          <div className="section card">
            <div className="card-title"><div><h3>파일 업로드</h3><span>CSV 또는 XLSX. 저장하면 기존 항목을 전부 대체합니다.</span></div></div>
            <UploadLinesForm submissionId={submission.submissionId} />
          </div>
        ) : null}

        {canEdit ? (
          <div className="section card">
            <div className="card-title"><div><h3>직접 입력</h3><span>품목코드·수량·필요월을 한 줄씩 입력합니다.</span></div></div>
            <DirectEntryLinesForm submissionId={submission.submissionId} />
          </div>
        ) : null}

        {canSubmit || canWithdraw || canAgree ? (
          <div className="section card">
            <div className="card-title"><div><h3>{canSubmit ? '제출' : canWithdraw ? '회수' : '합의 확정'}</h3></div></div>
            {canSubmit ? <SubmitSubmissionForm submissionId={submission.submissionId} /> : null}
            {canWithdraw ? <WithdrawSubmissionForm submissionId={submission.submissionId} /> : null}
            {canAgree ? <AgreeSubmissionForm submissionId={submission.submissionId} /> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
