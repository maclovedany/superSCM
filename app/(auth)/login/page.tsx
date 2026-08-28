import Link from 'next/link';

export default function LoginPage() {
  return <main className="auth-page"><div className="card auth-card"><span className="eyebrow">SCM INTELLIGENCE</span><h1>공급망 운영 콘솔</h1><p className="muted">로그인 기능은 다음 단계에서 연결됩니다.</p><Link className="button primary" href="/dashboard">대시보드로 이동</Link></div></main>;
}

