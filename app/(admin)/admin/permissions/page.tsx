// Phase 2 · 권한 화면 — refactor.md Phase 2
//
// ★ 두 축을 나란히 보입니다.
//     role(ADMIN·USER)  시스템 관리 권한 — 화면과 설정을 만질 수 있는가
//     job_role          업무 권한 — 발주 업무에서 무엇을 할 수 있는가
//   하나로 합치면 "관리자인데 승인 권한은 없는 사람" 을 표현할 수 없습니다.

import PageHeader from '@/components/shell/page-header';
import Badge from '@/components/ui/badge';
import DataTable, { type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import KpiCard from '@/components/ui/kpi-card';
import { getPermissionMatrix, getUserAccess, type PermissionMatrixRow, type UserAccess } from '@/lib/permission-repo';

export const dynamic = 'force-dynamic';

const userColumns: Column<UserAccess>[] = [
  { key: 'email', label: '계정', render: (row) => <><b>{row.name || row.email}</b><br /><span className="muted">{row.email}</span></> },
  { key: 'department', label: '부서', render: (row) => row.department ? row.departmentLabel : <EmptyValue reasonCode="DEPARTMENT_UNSET" /> },
  {
    key: 'jobRole', label: '업무 직책',
    render: (row) => row.reasonCode ? <EmptyValue reasonCode={row.reasonCode} /> : row.jobRoleLabel,
  },
  { key: 'permissionCount', label: '업무 권한', align: 'right', render: (row) => row.permissionCount === 0 ? <Badge status="WARNING">0개</Badge> : `${row.permissionCount}개` },
  { key: 'role', label: '시스템 권한', align: 'center', render: (row) => row.role === 'ADMIN' ? <Badge status="WARNING">ADMIN</Badge> : <span className="muted">USER</span> },
  { key: 'active', label: '상태', align: 'center', render: (row) => row.active ? <Badge status="SAFE">활성</Badge> : <Badge status="CRITICAL">비활성</Badge> },
];

const matrixColumns: Column<PermissionMatrixRow>[] = [
  { key: 'jobRole', label: '직책', render: (row) => <b>{row.jobRoleLabel}</b> },
  { key: 'domain', label: '영역' },
  { key: 'permissionCode', label: '권한 코드', render: (row) => <code>{row.permissionCode}</code> },
  { key: 'description', label: '설명' },
];

export default async function PermissionsPage() {
  const [users, matrix] = await Promise.all([getUserAccess(), getPermissionMatrix()]);
  const failure = users.error ?? matrix.error;

  if (failure) {
    return (
      <section className="analysis-page">
        <PageHeader eyebrow="ADMIN" title="권한" description="부서 · 직책 · 업무 권한" />
        <div className="analysis-content">
          <div className="card">
            <p className="text-danger">조회에 실패했습니다.</p>
            <p className="muted">{failure}</p>
            <p className="muted">STEP 19 마이그레이션(20260911000200_step19_permission.sql)이 적용되었는지 확인하세요.</p>
          </div>
        </div>
      </section>
    );
  }

  const noJobRole = users.rows.filter((row) => row.jobRole === null).length;
  const approvers = users.rows.filter((row) => row.jobRole === 'SCM_LEAD' && row.active).length;

  return (
    <section className="analysis-page">
      <PageHeader
        eyebrow="ADMIN"
        title="권한"
        description="시스템 권한(ADMIN·USER)과 업무 권한(직책)은 다른 축입니다. 업무 결재는 직책이 정합니다."
      />
      <div className="analysis-content">
        <div className="grid grid-4">
          <KpiCard label="계정" value={users.rows.length} foot="전체 등록 계정" />
          <KpiCard label="직책 미지정" value={noJobRole} foot="업무 권한 0개" status={noJobRole > 0 ? 'WARNING' : 'SAFE'} />
          <KpiCard label="승인권자" value={approvers} foot="활성 SCM팀장" status={approvers === 0 ? 'CRITICAL' : 'SAFE'} />
          <KpiCard label="권한 코드" value={new Set(matrix.rows.map((row) => row.permissionCode)).size} foot="정의된 업무 권한" />
        </div>

        {approvers === 0 ? (
          <div className="card notice-card">
            <p className="notice-eyebrow">승인 절차가 멈춥니다</p>
            <h3>활성 SCM팀장이 없습니다</h3>
            <p className="muted">
              품목 정책 승인 · 우선 배정 승인 · 최종 발주 승인은 모두 SCM팀장이 처리합니다.
              한 명도 없으면 승인 요청이 쌓이기만 하고 진행되지 않습니다.
              계정 하나에 <code>job_role = &apos;SCM_LEAD&apos;</code> 를 지정하세요.
            </p>
          </div>
        ) : null}

        <div className="section card">
          <div className="card-title"><div><h3>계정별 권한</h3><span>직책이 없으면 업무 권한이 하나도 없습니다</span></div></div>
          <DataTable columns={userColumns} rows={users.rows} rowKey={(row) => row.userId} empty="계정이 없습니다." />
        </div>

        <div className="section card">
          <div className="card-title"><div><h3>직책별 권한 표</h3><span>확정과 승인은 서로 다른 직책이 갖습니다 (stage1 §9)</span></div></div>
          <DataTable columns={matrixColumns} rows={matrix.rows} rowKey={(row) => `${row.jobRole}-${row.permissionCode}`} empty="권한 표가 비어 있습니다." />
        </div>
      </div>
    </section>
  );
}
