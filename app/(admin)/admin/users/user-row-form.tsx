'use client';

import { useActionState } from 'react';
import { Check } from 'lucide-react';
import { updateUser, type UserActionState } from './actions';
import type { AppUser } from '@/lib/users';

const initial: UserActionState = { error: null, message: null };

export default function UserRowForm({ user, isSelf }: { user: AppUser; isSelf: boolean }) {
  const [state, action, pending] = useActionState(updateUser, initial);

  return (
    <form action={action} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
      <input type="hidden" name="userId" value={user.userId} />

      <select name="role" defaultValue={user.role} className="select" aria-label="역할" disabled={isSelf}>
        <option value="USER">USER</option>
        <option value="ADMIN">ADMIN</option>
      </select>

      <select name="active" defaultValue={String(user.active)} className="select" aria-label="활성 여부" disabled={isSelf}>
        <option value="true">활성</option>
        <option value="false">비활성</option>
      </select>

      <button
        type="submit"
        className="btn secondary icon"
        aria-label="변경 저장"
        title={isSelf ? '자기 계정은 바꿀 수 없습니다' : '변경 저장'}
        disabled={pending || isSelf}
      >
        <Check size={14} aria-hidden />
      </button>

      {state.error && (
        <span className="t-sm" style={{ color: 'var(--crit-fg)' }}>
          {state.error}
        </span>
      )}
      {state.message && (
        <span className="t-sm" style={{ color: 'var(--safe-fg)' }}>
          저장됨
        </span>
      )}
    </form>
  );
}
