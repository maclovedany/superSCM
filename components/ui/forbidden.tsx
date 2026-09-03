// 403 — renew.prd 4.4 · 4.5
//
// "USER 가 관리자 URL 을 직접 입력해도 접근할 수 없다" 를 화면으로 보여주는 자리입니다.
// 실제 차단은 app/(admin)/layout.tsx 의 서버 검증과 RLS 가 합니다.
//
// STEP 17 에서 reason 을 더했습니다. 화면 전체가 renew.prd 4.5 의 금지 항목으로만
// 이루어진 경우(예측 정확도 화면)에도 이 자리를 씁니다 — 그때는 "관리자 전용" 이
// 아니라 "영업 권한에서 볼 수 없다" 가 맞는 문장입니다.

import Link from 'next/link';

export default function Forbidden({
  role,
  reason,
}: {
  role: string;
  /** 적지 않으면 관리자 전용 화면으로 안내합니다 */
  reason?: string;
}) {
  return (
    <div className="panel">
      <div className="forbidden">
        <span className="forbidden-code">403</span>
        <p className="state-title">이 화면에 접근할 권한이 없습니다</p>
        <p className="state-desc">
          {reason ?? '관리자 전용 화면입니다.'} 현재 계정의 역할은{' '}
          <span className="t-code">{role}</span> 입니다. 권한이 필요하면 관리자에게 요청해주세요.
        </p>
        <Link href="/dashboard" className="btn secondary">
          대시보드로 돌아가기
        </Link>
      </div>
    </div>
  );
}
