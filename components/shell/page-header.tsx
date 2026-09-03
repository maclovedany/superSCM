// 페이지 헤더 — design.md §6.3

import type { ReactNode } from 'react';

export default function PageHeader({
  title,
  subtitle,
  meta,
  actions,
}: {
  title: string;
  subtitle?: string;
  /** mono 대문자 메타 칩 — SKU · ROLE · 기준일 등 */
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <div className="page-title-row">
          <h1 className="t-h1">{title}</h1>
          {meta}
        </div>
        {subtitle && <p className="page-subtitle t-sm">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function MetaChip({ children }: { children: ReactNode }) {
  return <span className="meta-chip">{children}</span>;
}
