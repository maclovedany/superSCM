// 로그인 — renew.prd 4.4
//
// 계정은 관리자가 Supabase 대시보드에서 만들고, 역할은 /admin/users 에서 바꿉니다.
// 첫 관리자 지정은 sql/05-first-admin.sql 을 보세요.

import { Suspense } from 'react';
import LoginForm from './login-form';

export const metadata = { title: '로그인 | SuperSCM' };

export default function LoginPage() {
  return (
    <main className="login-page">
      <div className="panel login-card">
        <div className="panel-body login-body">
          <div className="login-brand">
            <span className="brand-name">SuperSCM</span>
            <span className="brand-role">Supply Chain Decision Platform</span>
          </div>

          <Suspense fallback={<p className="t-sm text-3">불러오는 중…</p>}>
            <LoginForm />
          </Suspense>

          <p className="t-sm text-3" style={{ textAlign: 'center' }}>
            계정은 관리자가 발급합니다.
          </p>
        </div>
      </div>
    </main>
  );
}
