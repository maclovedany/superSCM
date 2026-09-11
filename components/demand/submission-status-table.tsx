import Link from 'next/link';
import DataTable, { type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import { departmentLabel } from '@/lib/permission';
import { formatDemandDateTime, submissionStatusTone, type DemandSubmission } from '@/lib/demand/model';

/** SCM 취합 화면 공통 표 — 제출 여부·오류 건수·마지막 수정자와 시각을 한 화면에 보여준다 */
const columns: Column<DemandSubmission>[] = [
  {
    key: 'department',
    label: '부서 · 대상월',
    render: (row) => (
      <>
        <Link href={`/demand-submissions/${row.submissionId}`}><b>{departmentLabel(row.department)}</b></Link>
        <br />
        <span className="muted">{row.planMonth?.slice(0, 7) ?? '—'}</span>
      </>
    ),
  },
  {
    key: 'status',
    label: '상태',
    render: (row) => <span className={`tag ${submissionStatusTone(row.status)}`}>{row.statusLabel}</span>,
  },
  {
    key: 'totalLineCount',
    label: '항목',
    align: 'right',
    render: (row) => (row.totalLineCount === null ? <EmptyValue /> : row.totalLineCount.toLocaleString('ko-KR')),
  },
  {
    key: 'errorLineCount',
    label: '오류',
    align: 'right',
    render: (row) => {
      const count = row.errorLineCount ?? 0;
      return count > 0 ? <b className="text-danger">{count.toLocaleString('ko-KR')}</b> : <span className="muted">0</span>;
    },
  },
  { key: 'submissionDeadline', label: '마감일', render: (row) => row.submissionDeadline ?? <span className="muted">—</span> },
  {
    key: 'lastModifiedByName',
    label: '마지막 수정',
    render: (row) => (
      <>
        {row.lastModifiedByName ?? <span className="muted">—</span>}
        <br />
        <span className="muted">{formatDemandDateTime(row.lastModifiedAt) ?? '—'}</span>
      </>
    ),
  },
];

export default function SubmissionStatusTable({ rows }: { rows: DemandSubmission[] }) {
  return <DataTable columns={columns} rows={rows} rowKey={(row) => row.submissionId} empty="제출 현황이 없습니다." />;
}
