import { safeNextPath } from '@/lib/auth-policy';
import LoginForm from './login-form';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  return <main className="auth-page"><div className="card auth-card"><span className="eyebrow">SCM INTELLIGENCE</span><h1>공급망 운영 콘솔</h1><p className="muted">발급받은 계정으로 로그인하세요.</p><LoginForm next={safeNextPath(params.next)} /></div></main>;
}

