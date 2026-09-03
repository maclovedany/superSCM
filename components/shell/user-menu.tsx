// 사용자 표시와 로그아웃 — 탑바 우측

import { LogOut } from 'lucide-react';
import { signOut } from '@/lib/auth-actions';
import type { SessionUser } from '@/lib/auth';

/** 이메일에서 @ 앞부분만 씁니다. 전체 주소는 길고 탑바 공간을 많이 먹습니다. */
function shortName(user: SessionUser) {
  const name = user.name?.trim();
  if (name) return name;
  return user.email.split('@')[0];
}

function initials(user: SessionUser) {
  return shortName(user).slice(0, 2).toUpperCase();
}

export default function UserMenu({ user }: { user: SessionUser }) {
  return (
    <>
      <span className="user-chip">
        <span className="avatar" aria-hidden>
          {initials(user)}
        </span>
        <span className="user-chip-name" title={user.email}>
          {shortName(user)}
        </span>
        <span className="user-chip-role">{user.role}</span>
      </span>
      <form action={signOut}>
        <button type="submit" className="btn ghost icon" aria-label="로그아웃" title="로그아웃">
          <LogOut size={15} aria-hidden />
        </button>
      </form>
    </>
  );
}
