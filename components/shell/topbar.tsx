import { Bell, History } from 'lucide-react';

export default function Topbar() {
  return <header className="topbar"><div><div className="eyebrow">SCM INTELLIGENCE</div><h1>공급망 운영 콘솔</h1></div><div className="top-meta"><span className="local-badge">SUPABASE LIVE</span><span>기준월 <b>2026.09</b></span><button className="icon-button" type="button" aria-label="알림"><Bell size={16} /></button><button className="icon-button" type="button" aria-label="변경 이력"><History size={16} /></button><span className="avatar" aria-hidden="true">SC</span></div></header>;
}

