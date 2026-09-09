'use client';

// 분석 화면 사이의 이동 탭입니다.
//
// 분석 메뉴는 lib/menu.ts의 USER_MENU에서 관리합니다.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { USER_MENU } from '@/lib/menu';

export default function AnalysisTabs() {
  const pathname = usePathname();

  return (
    <nav className="analysis-tabs" aria-label="분석 화면">
      {USER_MENU.filter((item) => item.href.startsWith('/analysis/')).map((tab) =>
        (
          <Link
            key={tab.href}
            href={tab.href}
            className={`analysis-tab ${pathname === tab.href ? 'active' : ''}`}
            aria-current={pathname === tab.href ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        )
      )}
    </nav>
  );
}
