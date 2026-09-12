'use client';

// 관리자 계정 관리 — 등록 계정 표. 행마다 편집 · 비활성화/재활성화 · 완전 삭제 세 폼을
// <details> 안에 접어 둔다(components/approvals/approval-table.tsx와 같은 방식 — 표를
// 좁게 유지하면서도 필요할 때만 편집 폼을 펼친다).
//
// ★ 완전 삭제가 업무 이력 때문에 거절되는지는 행마다 미리 조회하지 않는다(N+1 RPC 호출을
//   피한다). 시도했을 때 core.admin_delete_app_user_profile이 돌려주는 문구(참조 표 이름 포함)를
//   그대로 보여준다 — DB 판정 한 곳만 신뢰한다는 이 프로젝트의 원칙과 같다.

import { useActionState } from 'react';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';
import EmptyValue from '@/components/ui/empty-value';
import { DEPARTMENT_LABELS, DEPARTMENTS, JOB_ROLE_LABELS, JOB_ROLES, departmentLabel, jobRoleLabel } from '@/lib/permission';
import type { ManagedAppUser } from '@/lib/user-admin-model';
import {
  deleteUserAction,
  initialUserAdminActionState,
  setActiveAction,
  updateProfileAction,
  type UserAdminActionState,
} from '@/app/(admin)/admin/users/actions';

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('ko-KR') : '—';
}

function EditForm({ user }: { user: ManagedAppUser }) {
  const [state, action, pending] = useActionState<UserAdminActionState, FormData>(updateProfileAction, initialUserAdminActionState);
  return (
    <form action={action} className="master-form">
      <input type="hidden" name="userId" value={user.userId} />
      <input type="hidden" name="email" value={user.email} />
      {state.error ? <p className="form-error master-form-wide" role="alert">{state.error}</p> : null}
      {state.success ? <p className="form-success master-form-wide" role="status">{state.success}</p> : null}
      <label>이름<input className="form-input" name="name" defaultValue={user.name} required /></label>
      <label>
        시스템 권한
        <select className="table-select" name="role" defaultValue={user.role} aria-label={`${user.email} 시스템 권한`}>
          <option value="USER">USER</option>
          <option value="ADMIN">ADMIN</option>
        </select>
      </label>
      <label>
        업무 직책
        <select className="table-select" name="jobRole" defaultValue={user.jobRole ?? ''} aria-label={`${user.email} 업무 직책`}>
          <option value="">미지정</option>
          {JOB_ROLES.map((code) => <option key={code} value={code}>{JOB_ROLE_LABELS[code]}</option>)}
        </select>
      </label>
      <label>
        부서
        <select className="table-select" name="department" defaultValue={user.department ?? ''} aria-label={`${user.email} 부서`}>
          <option value="">미지정</option>
          {DEPARTMENTS.map((code) => <option key={code} value={code}>{DEPARTMENT_LABELS[code]}</option>)}
        </select>
      </label>
      <label>
        활성 상태
        <select className="table-select" name="active" defaultValue={String(user.active)} aria-label={`${user.email} 활성 상태`}>
          <option value="true">활성</option>
          <option value="false">비활성</option>
        </select>
      </label>
      <label className="master-form-wide">변경 사유(필수)<input className="form-input" name="reason" required /></label>
      <div className="master-form-actions"><Button type="submit" variant="primary" disabled={pending}>{pending ? '저장 중…' : '저장'}</Button></div>
    </form>
  );
}

function DeactivateForm({ user, self }: { user: ManagedAppUser; self: boolean }) {
  const [state, action, pending] = useActionState<UserAdminActionState, FormData>(setActiveAction, initialUserAdminActionState);
  const nextActive = !user.active;
  const blocked = self && !nextActive;
  return (
    <form action={action} className="master-row-form">
      <input type="hidden" name="userId" value={user.userId} />
      <input type="hidden" name="active" value={String(nextActive)} />
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state.success ? <p className="form-success" role="status">{state.success}</p> : null}
      <input className="form-input" name="reason" placeholder="사유(필수)" required style={{ width: 160 }} aria-label={`${user.email} ${nextActive ? '재활성화' : '비활성화'} 사유`} />
      <Button type="submit" disabled={pending || blocked} title={blocked ? '자신의 계정은 비활성화할 수 없습니다.' : undefined}>
        {pending ? '처리 중…' : nextActive ? '재활성화' : '비활성화'}
      </Button>
    </form>
  );
}

function DeleteForm({ user, self }: { user: ManagedAppUser; self: boolean }) {
  const [state, action, pending] = useActionState<UserAdminActionState, FormData>(deleteUserAction, initialUserAdminActionState);
  return (
    <form action={action} className="master-row-form">
      <input type="hidden" name="userId" value={user.userId} />
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state.success ? <p className="form-success" role="status">{state.success}</p> : null}
      <input className="form-input" name="reason" placeholder="삭제 사유(필수)" required style={{ width: 160 }} aria-label={`${user.email} 완전 삭제 사유`} />
      <Button type="submit" variant="danger" disabled={pending || self} title={self ? '자신의 계정은 삭제할 수 없습니다.' : '업무 이력이 있으면 거절됩니다 — 비활성화를 권장합니다.'}>
        {pending ? '삭제 중…' : '완전 삭제'}
      </Button>
    </form>
  );
}

export default function UserListTable({ users, actorId }: { users: ManagedAppUser[]; actorId: string }) {
  if (users.length === 0) return <p className="muted">등록된 계정이 없습니다.</p>;

  return (
    <div className="analysis-table-wrap">
      <table className="analysis-table user-table">
        <thead>
          <tr>
            <th>계정</th><th>부서</th><th>업무 직책</th><th>시스템 권한</th><th>상태</th><th>생성일</th><th>최근 로그인</th><th>관리</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const self = user.userId === actorId;
            return (
              <tr key={user.userId}>
                <td>
                  <strong>{user.name || user.email}</strong><br />
                  <span className="muted">{user.email}</span>
                  {self ? <span className="self-label">본인</span> : null}
                </td>
                <td>{user.department ? departmentLabel(user.department) : <EmptyValue reasonCode="DEPARTMENT_UNSET" />}</td>
                <td>{user.jobRole ? jobRoleLabel(user.jobRole) : <Badge status="WARNING"><EmptyValue reasonCode="JOB_ROLE_UNSET" /></Badge>}</td>
                <td>{user.role === 'ADMIN' ? <Badge status="WARNING">ADMIN</Badge> : <span className="muted">USER</span>}</td>
                <td><Badge status={user.active ? 'SAFE' : 'CRITICAL'}>{user.active ? '활성' : '비활성'}</Badge></td>
                <td>{formatDateTime(user.createdAt)}</td>
                <td>{formatDateTime(user.lastLoginAt)}</td>
                <td>
                  <details className="user-edit-details">
                    <summary>편집</summary>
                    <EditForm user={user} />
                    <DeactivateForm user={user} self={self} />
                    <DeleteForm user={user} self={self} />
                  </details>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
