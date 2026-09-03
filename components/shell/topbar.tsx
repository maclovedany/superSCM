// 탑바 — design.md §6.2

import Link from 'next/link';
import { Bell, Search, Sparkles, TriangleAlert } from 'lucide-react';
import UserMenu from './user-menu';
import type { SessionUser } from '@/lib/auth';

export default function Topbar({
  user,
  placeholder = 'SKU · 발주 · 공급처 검색',
}: {
  user: SessionUser;
  placeholder?: string;
}) {
  return (
    <header className="topbar">
      <div className="search">
        <Search size={15} className="search-icon" aria-hidden />
        <input type="search" placeholder={placeholder} aria-label="검색" disabled />
      </div>

      <div className="topbar-right">
        <Link href="/agent" className="topbar-chip">
          <Sparkles size={13} aria-hidden />
          AI Agent
        </Link>
        <button type="button" className="topbar-chip" disabled>
          <TriangleAlert size={13} aria-hidden />
          전체 알림
        </button>
        <button type="button" className="btn ghost icon" aria-label="알림" disabled>
          <Bell size={15} aria-hidden />
        </button>
        <UserMenu user={user} />
      </div>
    </header>
  );
}
