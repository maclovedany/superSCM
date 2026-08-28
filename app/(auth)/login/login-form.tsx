'use client';

import { useActionState } from 'react';
import Button from '@/components/ui/button';
import { loginAction, type LoginState } from './actions';

const initialState: LoginState = { error: null };

export default function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, initialState);
  return <form action={action} className="auth-form"><input type="hidden" name="next" value={next} /><label>이메일<input className="form-input" type="email" name="email" autoComplete="email" required /></label><label>비밀번호<input className="form-input" type="password" name="password" autoComplete="current-password" required /></label>{state.error ? <p className="form-error" role="alert">{state.error}</p> : null}<Button type="submit" variant="primary" disabled={pending}>{pending ? '로그인 중…' : '로그인'}</Button></form>;
}
