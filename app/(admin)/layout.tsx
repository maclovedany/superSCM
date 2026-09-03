// 관리자 화면 껍데기.
//
// renew.prd 4.4 — USER 가 관리자 URL 을 직접 입력해도 접근할 수 없어야 합니다.
// 화면 숨김(메뉴)만으로는 부족하므로 여기서 서버가 막고, RLS 가 한 번 더 막습니다.

import type { ReactNode } from 'react';
import AppShell from '@/components/shell/app-shell';
import Forbidden from '@/components/ui/forbidden';
import { requireUser } from '@/lib/auth';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  if (user.role !== 'ADMIN') {
    return (
      <AppShell user={user}>
        <Forbidden role={user.role} />
      </AppShell>
    );
  }

  return <AppShell user={user}>{children}</AppShell>;
}
