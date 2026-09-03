'use client';

import { useActionState } from 'react';
import { useSearchParams } from 'next/navigation';
import { TriangleAlert } from 'lucide-react';
import { signIn, type LoginState } from '@/lib/auth-actions';

const initial: LoginState = { error: null };

export default function LoginForm() {
  const [state, action, pending] = useActionState(signIn, initial);
  const params = useSearchParams();
  const next = params.get('next') ?? '/dashboard';

  // requireUser() 가 되돌려보낸 사유입니다 (lib/auth.ts).
  // "로그인은 됐는데 화면이 안 열린다" 를 말없이 두지 않습니다.
  const reason = params.get('reason');
  const notice =
    reason === 'no_profile'
      ? '로그인은 되었지만 사용자 정보가 등록되어 있지 않습니다. 관리자에게 계정 등록을 요청해주세요. (core.app_user 확인 필요)'
      : reason === 'inactive'
        ? '비활성 처리된 계정입니다. 관리자에게 문의해주세요.'
        : reason === 'error'
          ? `사용자 정보를 확인하지 못했습니다: ${params.get('detail') ?? '원인 미상'}`
          : null;

  return (
    <form action={action} className="login-form">
      <input type="hidden" name="next" value={next} />

      <div className="field">
        <label className="t-label text-3" htmlFor="email">
          이메일
        </label>
        <input id="email" name="email" type="email" autoComplete="email" placeholder="name@company.com" required />
      </div>

      <div className="field">
        <label className="t-label text-3" htmlFor="password">
          비밀번호
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>

      {notice && !state.error && (
        <p className="login-error" role="status" style={{ borderLeftColor: 'var(--tertiary)', background: 'var(--warn-bg)', color: 'var(--warn-fg)' }}>
          <TriangleAlert size={14} aria-hidden />
          {notice}
        </p>
      )}

      {state.error && (
        <p className="login-error" role="alert">
          <TriangleAlert size={14} aria-hidden />
          {state.error}
        </p>
      )}

      <button type="submit" className="btn primary lg block" disabled={pending}>
        {pending ? '확인하는 중…' : '로그인'}
      </button>
    </form>
  );
}
