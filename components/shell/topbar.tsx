import { Bell, History, LogOut } from 'lucide-react';
import type { AppRole } from '@/lib/menu';
import { logoutAction } from '@/lib/auth-actions';

export default function Topbar({ name, role }: { name: string; role: AppRole }) {
  const initials = name.trim().slice(0, 2).toUpperCase() || 'SC';
  return <header className="topbar"><div><div className="eyebrow">SCM INTELLIGENCE</div><h1>공급망 운영 콘솔</h1></div><div className="top-meta"><span className="local-badge">{role}</span><span>기준월 <b>2026.09</b></span><button className="icon-button" type="button" aria-label="알림"><Bell size={16} /></button><button className="icon-button" type="button" aria-label="변경 이력"><History size={16} /></button><span className="avatar" title={name}>{initials}</span><form action={logoutAction}><button className="icon-button" type="submit" aria-label="로그아웃"><LogOut size={16} /></button></form></div></header>;
}
