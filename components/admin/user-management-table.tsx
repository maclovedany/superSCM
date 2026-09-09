'use client';

import { useActionState } from 'react';
import Button from '@/components/ui/button';
import Badge from '@/components/ui/badge';
import { updateUserAction, type UserUpdateState } from '@/app/(admin)/admin/users/actions';

export type ManagedUser = { userId: string; email: string; name: string; department: string | null; role: 'ADMIN' | 'USER'; active: boolean; lastLoginAt: string | null };
const initialState: UserUpdateState = { error: null, success: null };

export default function UserManagementTable({ users, actorId }: { users: ManagedUser[]; actorId: string }) {
  const [state, action, pending] = useActionState(updateUserAction, initialState);
  return <>{state.error ? <p className="form-error" role="alert">{state.error}</p> : null}{state.success ? <p className="form-success" role="status">{state.success}</p> : null}<div className="analysis-table-wrap"><table className="analysis-table user-table"><thead><tr><th>사용자</th><th>부서</th><th>최근 로그인</th><th>현재 상태</th><th>권한 변경</th></tr></thead><tbody>{users.map((user) => { const self = user.userId === actorId; return <tr key={user.userId}><td><strong>{user.name || user.email}</strong><br /><span className="muted">{user.email}</span>{self ? <span className="self-label">본인</span> : null}</td><td>{user.department ?? '—'}</td><td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('ko-KR') : '—'}</td><td><Badge status={user.active ? 'SAFE' : 'CALCULATION_UNAVAILABLE'}>{user.active ? user.role : '비활성'}</Badge></td><td><form action={action} className="user-edit-form"><input type="hidden" name="userId" value={user.userId} /><select className="table-select" name="role" defaultValue={user.role} aria-label={`${user.email} 권한`}><option value="USER">USER</option><option value="ADMIN">ADMIN</option></select><select className="table-select" name="active" defaultValue={String(user.active)} aria-label={`${user.email} 활성 상태`}><option value="true">활성</option><option value="false">비활성</option></select><Button type="submit" disabled={pending}>{pending ? '저장 중…' : '저장'}</Button></form></td></tr>; })}</tbody></table></div></>;
}
