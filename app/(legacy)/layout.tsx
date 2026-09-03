// 레거시 데모 껍데기 — 폐기 예정.
//
// 기존 라이트 테마 프로토타입만 여기서 삽니다.
// 새 화면은 절대 이 레이아웃을 쓰지 않습니다 (styles/legacy.css 참조).

import type { ReactNode } from 'react';
import '../../styles/legacy.css';

export default function LegacyLayout({ children }: { children: ReactNode }) {
  return <div className="legacy-root">{children}</div>;
}
