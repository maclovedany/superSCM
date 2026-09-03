// 패널 카드 — design.md §6.5

import type { ReactNode } from 'react';

export default function Panel({
  title,
  actions,
  children,
  flush = false,
}: {
  title?: ReactNode;
  /** 헤더 우측 컨트롤 (토글·버튼) */
  actions?: ReactNode;
  children: ReactNode;
  /** 표처럼 자체 여백이 있는 내용은 flush 로 패딩을 없앱니다 */
  flush?: boolean;
}) {
  return (
    <section className="panel">
      {(title || actions) && (
        <header className="panel-head">
          {title && <h2 className="t-h2">{title}</h2>}
          {actions && <div className="panel-head-actions">{actions}</div>}
        </header>
      )}
      <div className={`panel-body${flush ? ' flush' : ''}`}>{children}</div>
    </section>
  );
}
