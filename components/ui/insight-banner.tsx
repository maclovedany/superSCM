import type { ReactNode } from 'react';

export default function InsightBanner({ title, children }: { title: string; children: ReactNode }) {
  return <aside className="insight-banner"><span className="insight-mark">i</span><div><strong>{title}</strong><p>{children}</p></div></aside>;
}

