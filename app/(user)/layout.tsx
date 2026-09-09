import type { ReactNode } from 'react';
import Sidebar from '@/components/shell/sidebar';
import Topbar from '@/components/shell/topbar';
import { requireUser } from '@/lib/auth';

export default async function UserLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireUser();
  return <div className="app-shell"><Sidebar role={profile.role} /><main className="main"><Topbar name={profile.name || profile.email} role={profile.role} /><div className="content">{children}</div></main></div>;
}
