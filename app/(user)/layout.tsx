// 일반 사용자 화면 껍데기.
//
// requireUser() 가 미로그인 요청을 /login 으로 보냅니다.
// middleware 가 이미 한 번 거르지만, 레이아웃에서도 검증합니다.
// middleware 를 우회하는 경로(직접 렌더링·향후 설정 변경)가 생겨도 뚫리지 않게 합니다.

import type { ReactNode } from 'react';
import AppShell from '@/components/shell/app-shell';
import { requireUser } from '@/lib/auth';

export default async function UserLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
