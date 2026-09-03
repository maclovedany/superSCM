// 앱 셸 — design.md §5.1
//
// 사이드바 + 탑바 + 콘텐츠. 모든 화면이 이 안에 들어갑니다.
// 역할은 세션에서 옵니다. 화면이 스스로 정하지 않습니다.

import type { ReactNode } from 'react';
import Sidebar from './sidebar';
import Topbar from './topbar';
import { isSalesUser, type SessionUser } from '@/lib/auth';

export default function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  return (
    <div className="shell">
      <Sidebar role={user.role} isSales={isSalesUser(user)} />
      <div className="main">
        <Topbar user={user} />
        <div className="page">
          {children}
          <p className="page-foot">
            <span className="kbd">⌘K</span> 로 명령 패널 열기 · 아직 준비 중입니다
          </p>
        </div>
      </div>
    </div>
  );
}
