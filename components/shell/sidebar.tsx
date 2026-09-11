'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { menuFor, type AppRole, type MenuItem } from '@/lib/menu';
import { PermissionSet } from '@/lib/permission';

function MenuGroup({ label, items }: { label: string; items: MenuItem[] }) {
  const pathname = usePathname();
  return <div className="shell-nav-group"><div className="nav-label">{label}</div><nav className="nav-list" aria-label={label}>{items.map((item) => { const Icon = item.icon; const active = pathname === item.href || pathname.startsWith(`${item.href}/`); return <Link key={item.href} href={item.href} className={`nav-button ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}><span className="nav-number"><Icon size={14} aria-hidden="true" /></span><span>{item.label}</span></Link>; })}</nav></div>;
}

export default function Sidebar({ role, permissionCodes }: { role: AppRole; permissionCodes: readonly string[] }) {
  const items = menuFor(role, new PermissionSet(permissionCodes));
  return <aside className="sidebar"><Link href="/dashboard" className="brand"><span className="brand-mark">SCM</span><span className="brand-copy"><strong>SCM Intelligence</strong><span>월간 발주계획</span></span></Link><div className="shell-nav"><MenuGroup label="USER" items={items.filter((item) => !item.href.startsWith('/admin/'))} />{role === 'ADMIN' ? <MenuGroup label="ADMIN" items={items.filter((item) => item.href.startsWith('/admin/'))} /> : null}</div><div className="sidebar-foot"><b>2026년 09월 발주계획</b><br />Supabase analytics · Phase 2</div></aside>;
}
