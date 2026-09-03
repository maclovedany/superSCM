// 예측 재실행 배너 — renew.prd 8.6 · 31.5
//
// 데이터가 들어온 뒤 예측을 다시 돌리지 않았거나, 화면이 쓰는 예측이 검증 실행이면
// 화면 맨 위에 한 줄을 띄웁니다.
//
// ★ 화면마다 따로 판정하지 않습니다. 판정은 analytics.v_stale_summary 한 줄이 하고
//   (core.v_ai_forecast 와 같은 규칙으로 실행을 고릅니다), 이 컴포넌트는 그 한 줄을
//   문장으로 옮기기만 합니다 (AGENTS.md 규칙 1). 두 곳에서 판정하면 배너와 숫자가
//   어긋납니다.
//
// 서버 컴포넌트입니다. 붙일 화면에서 `<StaleBanner />` 한 줄이면 됩니다.
// 배너를 띄울 일이 없으면 null 을 렌더링합니다 — 조용한 것이 기본입니다.

import Link from 'next/link';
import { getStaleSummary } from '@/lib/admin-ops';
import { staleSentence } from '@/lib/admin-ops-model';

export default async function StaleBanner() {
  const { data } = await getStaleSummary();

  // 조회에 실패하면 아무것도 그리지 않습니다. 모르는 것을 경고로 올리지 않습니다.
  // 조회 실패는 화면 본문의 ErrorState 가 이미 말합니다.
  const sentence = staleSentence(data);
  if (sentence === null) return null;

  // 먼저 할 일 하나만 씁니다. 두 가지를 함께 시키면 어느 쪽도 하지 않습니다.
  const cta = data?.needsProductionRun === true ? '운영 실행 하러 가기' : '실행 화면으로';

  return (
    <div className="stale-banner">
      <span>
        {sentence}
        {data?.lastBatchAt && data.lastBatchRows !== null && (
          <>
            {' '}
            마지막 적재는 {data.lastBatchAt.slice(0, 10)} · {data.lastBatchRows.toLocaleString()}행
            입니다.
          </>
        )}
      </span>
      <Link href="/admin/forecast-runs" className="btn secondary">
        {cta}
      </Link>
    </div>
  );
}
