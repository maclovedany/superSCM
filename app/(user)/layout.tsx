import type { ReactNode } from 'react';
import Sidebar from '@/components/shell/sidebar';
import Topbar from '@/components/shell/topbar';

export default function UserLayout({ children }: { children: ReactNode }) {
  return <div className="app-shell"><Sidebar /><main className="main"><Topbar /><div className="content">{children}</div></main></div>;
}

