// 사용자 관리 — renew.prd 4.4
//
// 계정 생성은 Supabase Auth 가 맡고, 역할은 여기서 관리합니다.
// 첫 관리자 지정은 sql/05-first-admin.sql 을 보세요.

import { ShieldCheck, UserCheck, Users } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { type Column } from '@/components/ui/data-table';
import Badge from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import InsightBanner from '@/components/ui/insight-banner';
import { ErrorState, EmptyState } from '@/components/ui/state';
import FilterNotice from '@/components/ui/filter-notice';
import { getAppUsers, type AppUser } from '@/lib/users';
import { requireUser } from '@/lib/auth';
import { applyFilter, labelOf, readFilter, type FilterSpec, type SearchParams } from '@/lib/filter';
import UserRowForm from './user-row-form';

export const dynamic = 'force-dynamic';

function formatDate(value: string | null) {
  if (!value) return null;
  return value.slice(0, 10);
}

/** KPI 카드 하나 = 목록 필터 하나 (design.md §6.4) */
const FILTERS: FilterSpec<AppUser>[] = [
  { key: 'all', label: '전체 사용자', match: null },
  { key: 'admin', label: '관리자', match: (row) => row.role === 'ADMIN' },
  { key: 'active', label: '활성 계정', match: (row) => row.active },
];

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const activeFilter = readFilter(await searchParams);
  const actor = await requireUser();
  const { rows, error } = await getAppUsers();

  const header = (
    <PageHeader
      title="사용자 관리"
      subtitle="계정은 Supabase Auth 에서 발급하고, 역할과 활성 여부는 여기서 관리합니다. 모든 변경은 감사 로그에 남습니다."
      meta={
        <>
          <MetaChip>PRD 4.4</MetaChip>
          <MetaChip>ROLE: {actor.role}</MetaChip>
        </>
      }
    />
  );

  if (error) {
    return (
      <>
        {header}
        <Panel>
          <ErrorState detail={error} />
        </Panel>
      </>
    );
  }

  if (rows.length === 0) {
    return (
      <>
        {header}
        <Panel>
          <EmptyState
            title="등록된 사용자가 없습니다"
            desc="sql/03-auth.sql 을 실행했는지 확인해주세요. core.app_user 가 없거나 비어 있습니다."
          />
        </Panel>
      </>
    );
  }

  const adminCount = rows.filter((row) => row.role === 'ADMIN').length;
  const activeCount = rows.filter((row) => row.active).length;
  const visible = applyFilter(rows, FILTERS, activeFilter);
  const filterLabel = labelOf(FILTERS, activeFilter);

  const columns: Column<AppUser>[] = [
    { key: 'email', label: '이메일', variant: 'strong', render: (row) => row.email },
    {
      key: 'name',
      label: '이름',
      render: (row) => row.name ?? <span className="text-3">미입력</span>,
    },
    {
      key: 'department',
      label: '부서',
      render: (row) => row.department ?? <span className="text-3">미입력</span>,
    },
    {
      key: 'role',
      label: '역할',
      render: (row) => <Badge tone={row.role === 'ADMIN' ? 'info' : 'plain'}>{row.role}</Badge>,
    },
    {
      key: 'active',
      label: '상태',
      render: (row) => <Badge tone={row.active ? 'safe' : 'unknown'}>{row.active ? '활성' : '비활성'}</Badge>,
    },
    {
      key: 'lastLoginAt',
      label: '최근 로그인',
      align: 'right',
      variant: 'num',
      render: (row) => {
        const date = formatDate(row.lastLoginAt);
        return date ?? <EmptyValue align="right" showLabel={false} />;
      },
    },
    {
      key: 'edit',
      label: '변경',
      render: (row) => <UserRowForm user={row} isSelf={row.userId === actor.userId} />,
    },
  ];

  return (
    <>
      {header}

      <div className="grid grid-3">
        <KpiCard
          label="전체 사용자"
          value={rows.length}
          unit="명"
          icon={Users}
          foot="core.app_user 기준"
          filter={{ key: 'all', active: activeFilter === 'all' }}
        />
        <KpiCard
          label="관리자"
          value={adminCount}
          unit="명"
          icon={ShieldCheck}
          tone={adminCount === 0 ? 'crit' : 'default'}
          foot={adminCount === 0 ? '관리자가 없습니다' : '모든 USER 기능 + 관리 기능'}
          filter={{ key: 'admin', active: activeFilter === 'admin' }}
        />
        <KpiCard
          label="활성 계정"
          value={activeCount}
          unit={`/ ${rows.length}`}
          icon={UserCheck}
          foot="로그인 가능"
          filter={{ key: 'active', active: activeFilter === 'active' }}
        />
      </div>

      <InsightBanner eyebrow="ACCESS CONTROL">
        권한은 세 곳에서 검증됩니다. 메뉴가 역할별로 갈리고, 관리자 레이아웃이 서버에서 막고, DB 의 RLS 가 마지막으로
        막습니다. 화면을 우회해 액션을 직접 호출해도 <b>RLS 가 거부</b>합니다.
      </InsightBanner>

      {filterLabel && (
        <FilterNotice label={filterLabel} shown={visible.length} total={rows.length} />
      )}

      <Panel
        title="사용자 목록"
        actions={<span className="t-label text-3">자기 계정은 스스로 바꿀 수 없음</span>}
        flush
      >
        <DataTable columns={columns} rows={visible} rowKey={(row) => row.userId} caption="등록된 사용자와 역할" />
      </Panel>
    </>
  );
}
