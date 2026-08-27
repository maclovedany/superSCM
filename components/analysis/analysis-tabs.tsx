'use client';

// 분석 화면 사이의 이동 탭입니다.
//
// 새 분석 화면을 만들면 아래 목록에 한 줄 추가합니다.
// 아직 안 만든 화면은 ready: false 로 두면 링크 대신 회색으로만 보입니다.
// (링크로 두면 404 가 떠서, 만들기 전인지 고장 난 건지 구분이 안 됩니다.)

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs: { href: string; label: string; ready: boolean }[] = [
  { href: '/analysis/leadtime', label: '리드타임 격차', ready: true },
  { href: '/analysis/stockout', label: '재고 소진 위험', ready: false },
];

export default function AnalysisTabs() {
  const pathname = usePathname();

  return (
    <nav className="analysis-tabs" aria-label="분석 화면">
      {tabs.map((tab) =>
        tab.ready ? (
          <Link
            key={tab.href}
            href={tab.href}
            className={`analysis-tab ${pathname === tab.href ? 'active' : ''}`}
            aria-current={pathname === tab.href ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        ) : (
          <span key={tab.href} className="analysis-tab locked">
            {tab.label}
            <span className="tag gray">오후 실습</span>
          </span>
        )
      )}
    </nav>
  );
}
