'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { menuFor, type AppRole, type MenuItem } from '@/lib/menu';
import { PermissionSet } from '@/lib/permission';
import { formatBaseMonthKorean, type BaseMonthDisplay } from '@/lib/kpi/model';
import BaseMonthValue from '@/components/ui/base-month-value';

function MenuGroup({ label, items }: { label: string; items: MenuItem[] }) {
  const pathname = usePathname();
  return <div className="shell-nav-group"><div className="nav-label">{label}</div><nav className="nav-list" aria-label={label}>{items.map((item) => { const Icon = item.icon; const active = pathname === item.href || pathname.startsWith(`${item.href}/`); return <Link key={item.href} href={item.href} className={`nav-button ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}><span className="nav-number"><Icon size={14} aria-hidden="true" /></span><span>{item.label}</span></Link>; })}</nav></div>;
}

// ★ Task 12 — 하드코딩된 "2026년 09월"을 Topbar와 같은 출처(analytics.v_current_planning_cycle)로
//   교체한다. 같은 layout.tsx가 한 번 조회한 값을 그대로 내려받으므로 Topbar와 항상 같은 달을
//   보여준다(검증 체크리스트 1번).
// ★ fix round 1(리뷰 반영) — baseMonth는 layout.tsx가 resolveBaseMonthDisplay로 "조회 실패"와
//   "취합 주기 없음"을 이미 구분해 만든 값이다. BaseMonthValue가 그 구분을 그대로 반영한다.
export default function Sidebar({ role, permissionCodes, baseMonth }: { role: AppRole; permissionCodes: readonly string[]; baseMonth: BaseMonthDisplay }) {
  const items = menuFor(role, new PermissionSet(permissionCodes));
  const formatted = formatBaseMonthKorean(baseMonth.planMonth);
  return <aside className="sidebar"><Link href="/dashboard" className="brand"><span className="brand-mark">SCM</span><span className="brand-copy"><strong>SCM Intelligence</strong><span>월간 발주계획</span></span></Link><div className="shell-nav"><MenuGroup label="USER" items={items.filter((item) => !item.href.startsWith('/admin/'))} />{role === 'ADMIN' ? <MenuGroup label="ADMIN" items={items.filter((item) => item.href.startsWith('/admin/'))} /> : null}</div><div className="sidebar-foot"><b><BaseMonthValue formatted={formatted} reasonCode={baseMonth.reasonCode} suffix=" 발주계획" /></b><br />Supabase analytics · Phase 2</div></aside>;
}
