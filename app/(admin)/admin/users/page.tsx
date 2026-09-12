// 관리자 계정 관리 — refactor_260911.md "Admin account management".
//
// ★ core.app_user를 analytics 뷰가 아니라 직접 읽는다(lib/user-admin.ts 주석 참고) — RLS
//   정책(app_user_select_self_or_admin, STEP 2)이 ADMIN에게는 전체 행을, 그 외에는 자기 자신만
//   허용하므로 이 화면(ADMIN 전용)에서는 이 편이 analytics.v_user_access보다 노출 범위가 좁다.

import PageHeader from '@/components/shell/page-header';
import CreateUserForm from '@/components/admin/users/create-user-form';
import UserListTable from '@/components/admin/users/user-list-table';
import Panel from '@/components/ui/panel';
import { requireAdmin } from '@/lib/auth';
import { listManagedUsers } from '@/lib/user-admin';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const { profile: actor } = await requireAdmin();
  const { rows, error } = await listManagedUsers();
  const noJobRoleCount = rows.filter((row) => row.jobRole === null).length;

  return (
    <section className="analysis-page">
      <PageHeader
        eyebrow="ADMIN"
        title="사용자 관리"
        description="계정 생성 · 시스템 권한(ADMIN/USER) · 업무 직책 · 활성 상태를 관리합니다. 업무 직책이 없으면 업무 권한이 하나도 없습니다."
      />
      <div className="analysis-content">
        <Panel title="계정 생성" description="Auth 사용자와 계정 프로필을 함께 만듭니다">
          <CreateUserForm />
        </Panel>
        <Panel title="등록 계정" description={`${rows.length}명 · 업무 직책 미지정 ${noJobRoleCount}명`}>
          {error ? (
            <>
              <p className="text-danger">계정 목록을 조회하지 못했습니다.</p>
              <p className="muted">{error}</p>
            </>
          ) : (
            <UserListTable users={rows} actorId={actor.userId} />
          )}
        </Panel>
      </div>
    </section>
  );
}
