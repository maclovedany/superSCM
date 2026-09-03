// 상태 메시지 — AGENTS.md 규칙 3 · design.md §12
//
// 조회 실패와 빈 결과를 구분합니다.
// 빈 배열을 "데이터가 없다" 로만 표시하면 Exposed schemas 누락 같은 문제를 놓칩니다.

export function ErrorState({ detail }: { detail: string }) {
  return (
    <div className="state error">
      <p className="state-title">조회에 실패했습니다</p>
      <p className="state-desc">
        Supabase 연결과 Exposed schemas 설정(core · analytics)을 확인해주세요.
      </p>
      <p className="state-detail">{detail}</p>
    </div>
  );
}

export function EmptyState({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="state">
      <p className="state-title">{title}</p>
      {desc && <p className="state-desc">{desc}</p>}
    </div>
  );
}
