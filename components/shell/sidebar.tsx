'use client';

// 사이드바 — design.md §6.1
//
// 활성 표시는 잉크 블랙 알약입니다 (design.md §9 ①).
// 색이 아니라 명도로 표시하므로 상태색(초록·앰버·빨강)과 헷갈리지 않습니다.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LifeBuoy, RefreshCw } from 'lucide-react';
import { menuFor, type Role } from '@/lib/menu';

export default function Sidebar({ role, isSales = false }: { role: Role; isSales?: boolean }) {
  const pathname = usePathname();
  const sections = menuFor(role, isSales);

  return (
    <aside className="sidebar">
      {/* 로고 마크를 쓰지 않습니다. 워드마크만 둡니다 (design.md §14-11) */}
      <Link href="/dashboard" className="brand">
        <span className="brand-copy">
          <span className="brand-name">SuperSCM</span>
          <span className="brand-role">{role === 'ADMIN' ? 'Administrator' : 'Strategic Planner'}</span>
        </span>
      </Link>

      <nav aria-label="주 메뉴">
        {sections.map((section, index) => (
          <div className="nav-section" key={section.heading ?? `section-${index}`}>
            {section.heading && <div className="nav-heading t-label">{section.heading}</div>}
            <div className="nav-list">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-item${active ? ' active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <span className="nav-item-icon">
                      <Icon size={16} aria-hidden />
                    </span>
                    <span className="nav-item-label">{item.label}</span>
                    {!item.ready && <span className="nav-item-soon">예정</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="sidebar-foot">
        <button type="button" className="btn primary block" disabled>
          <RefreshCw size={14} aria-hidden />
          S&amp;OP 실행
        </button>
        <Link href="/workflow" className="sidebar-foot-link">
          <LifeBuoy size={14} aria-hidden />
          <span>레거시 데모</span>
        </Link>
        <span className="sidebar-foot-link">
          <span className="status-dot" aria-hidden />
          <span>시스템 정상</span>
        </span>
      </div>
    </aside>
  );
}
