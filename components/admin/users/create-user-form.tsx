'use client';

// 관리자 계정 관리 — 신규 계정 생성 폼. Auth 사용자와 core.app_user 프로필을 한 번에 만든다
// (실제 처리는 app/(admin)/admin/users/actions.ts의 createUserAction, 실패 시 롤백도 그쪽에서 한다).

import { useActionState } from 'react';
import Button from '@/components/ui/button';
import { DEPARTMENT_LABELS, DEPARTMENTS, JOB_ROLE_LABELS, JOB_ROLES } from '@/lib/permission';
import { createUserAction, initialUserAdminActionState, type UserAdminActionState } from '@/app/(admin)/admin/users/actions';

export default function CreateUserForm() {
  const [state, action, pending] = useActionState<UserAdminActionState, FormData>(createUserAction, initialUserAdminActionState);

  return (
    <form action={action} className="master-form">
      {state.error ? <p className="form-error master-form-wide" role="alert">{state.error}</p> : null}
      {state.success ? <p className="form-success master-form-wide" role="status">{state.success}</p> : null}

      <label>이메일<input className="form-input" type="email" name="email" required /></label>
      <label>이름<input className="form-input" name="name" required /></label>
      <label>초기 비밀번호(8자 이상)<input className="form-input" type="password" name="password" minLength={8} required /></label>
      <label>
        시스템 권한
        <select className="table-select" name="role" defaultValue="USER">
          <option value="USER">USER</option>
          <option value="ADMIN">ADMIN</option>
        </select>
      </label>
      <label>
        업무 직책
        <select className="table-select" name="jobRole" defaultValue="">
          <option value="">미지정</option>
          {JOB_ROLES.map((code) => <option key={code} value={code}>{JOB_ROLE_LABELS[code]}</option>)}
        </select>
      </label>
      <label>
        부서
        <select className="table-select" name="department" defaultValue="">
          <option value="">미지정</option>
          {DEPARTMENTS.map((code) => <option key={code} value={code}>{DEPARTMENT_LABELS[code]}</option>)}
        </select>
      </label>
      <div className="master-form-actions">
        <Button type="submit" variant="primary" disabled={pending}>{pending ? '생성 중…' : '계정 생성'}</Button>
      </div>
    </form>
  );
}
