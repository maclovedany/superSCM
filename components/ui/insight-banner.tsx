// 인사이트 배너 — design.md §6.10
//
// AI 는 옆에 서고 앞에 서지 않습니다 (design.md §2 ⑤).
// 이 배너가 없어도 화면이 성립해야 합니다.

import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';

export default function InsightBanner({
  eyebrow = 'AI INSIGHT',
  children,
  actions,
}: {
  eyebrow?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <aside className="insight">
      <header className="insight-head">
        <Sparkles size={14} aria-hidden />
        <span>{eyebrow}</span>
      </header>
      <div className="insight-body">{children}</div>
      {actions && <div className="insight-actions">{actions}</div>}
    </aside>
  );
}
