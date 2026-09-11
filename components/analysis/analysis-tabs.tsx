'use client';

// 분석 화면 사이의 이동 탭입니다.
//
// 분석 메뉴는 lib/menu.ts의 USER_MENU에서 관리합니다.
// ★ Task 10b — analysis/receipt-gap처럼 anyOf가 있는 항목은 권한이 없으면 탭에서도 숨긴다. sidebar의
//   menuFor()와 같은 1차 방어를 여기서도 해야, 권한 없는 사용자에게 탭 이름조차 보이지 않는다
//   (클릭하면 서버가 다시 거절하지만, 메뉴에 보이는 것 자체가 새는 정보다).

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { USER_MENU } from '@/lib/menu';
import { PermissionSet } from '@/lib/permission';

export default function AnalysisTabs({ permissionCodes }: { permissionCodes: readonly string[] }) {
  const pathname = usePathname();
  const permissions = new PermissionSet(permissionCodes);

  return (
    <nav className="analysis-tabs" aria-label="분석 화면">
      {USER_MENU.filter((item) => item.href.startsWith('/analysis/') && (!item.anyOf || permissions.hasAny(...item.anyOf))).map((tab) =>
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
