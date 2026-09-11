import type { ReactNode } from 'react';
import Sidebar from '@/components/shell/sidebar';
import Topbar from '@/components/shell/topbar';
import { getPermissions, requireAdmin } from '@/lib/auth';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireAdmin();
  const permissions = await getPermissions();
  return <div className="app-shell"><Sidebar role={profile.role} permissionCodes={permissions.list()} /><main className="main"><Topbar name={profile.name || profile.email} role={profile.role} /><div className="content">{children}</div></main></div>;
}
