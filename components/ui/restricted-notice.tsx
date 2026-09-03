// 정보 접근 범위 안내 — renew.prd 4.5
//
// 화면의 일부 항목이 이 사용자에게 보이지 않을 때 그 사실을 말합니다.
//
// ★ 왜 조용히 빼지 않는가
//   열이 하나 없어지면 사람은 "데이터가 없나" 로 읽습니다. 그러면 SCM 담당자에게
//   "단가가 왜 안 보이죠?" 가 아니라 "단가 데이터가 없어요" 라고 말하게 됩니다.
//   빠진 이유가 권한이면 권한이라고 적어야 합니다 (design.md §8 — 빈 자리는 사유를 답니다).
//
// ★ 이것은 안내일 뿐 차단이 아닙니다. 실제 차단은 화면이 그 값을 **애초에 렌더하지
//   않는 것**이고, 서버 컴포넌트라 브라우저까지 가지 않습니다.

import { ShieldAlert } from 'lucide-react';

export default function RestrictedNotice({
  items,
}: {
  /** 보이지 않는 항목 이름들. 예: ['단가', '발주 금액'] */
  items: string[];
}) {
  return (
    <aside className="insight">
      <header className="insight-head">
        <ShieldAlert size={14} aria-hidden />
        <span>영업 권한</span>
      </header>
      <div className="insight-body">
        일부 항목은 영업 권한에서 보이지 않습니다
        {items.length > 0 && (
          <>
            {' — '}
            <b>{items.join(' · ')}</b>
          </>
        )}
        . 필요하면 SCM 담당자에게 문의하세요.
      </div>
    </aside>
  );
}
