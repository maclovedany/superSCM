import PageHeader from '@/components/shell/page-header';
import UserManagementTable, { type ManagedUser } from '@/components/admin/user-management-table';
import Panel from '@/components/ui/panel';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const { profile: actor } = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.schema('core').from('app_user').select('user_id, email, name, department, role, active, last_login_at').order('created_at');
  const users: ManagedUser[] = (data ?? []).map((row) => ({ userId: String(row.user_id), email: String(row.email ?? ''), name: String(row.name ?? ''), department: row.department ? String(row.department) : null, role: row.role === 'ADMIN' ? 'ADMIN' : 'USER', active: row.active === true, lastLoginAt: row.last_login_at ? String(row.last_login_at) : null }));
  return <section className="analysis-page"><PageHeader eyebrow="ADMIN" title="사용자 관리" description="사용자 권한과 계정 활성 상태를 관리합니다." /><Panel title="등록 사용자" description={`${users.length}명`}>{error ? <><p className="text-danger">사용자 목록을 조회하지 못했습니다.</p><p className="muted">{error.message}</p></> : <UserManagementTable users={users} actorId={actor.userId} />}</Panel></section>;
}
