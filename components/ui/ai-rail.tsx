// AI 우측 레일 — design.md §6.11 · renew.prd 26장
//
// ★ 이 컴포넌트는 LLM 을 부르지 않습니다.
//   페이지 렌더 경로에 LLM 을 넣으면, AI 가 느리거나 죽었을 때 화면 자체가 함께 멈춥니다.
//   그것이 renew.prd 31.4 가 금지하는 것입니다. 그래서 여기 보이는 문장과 수치는
//   전부 뷰가 이미 만들어 둔 값(analytics.v_sku_detail.explanation)입니다.
//
//   물어볼 것이 있으면 [이 품목에 대해 묻기] 로 /agent 로 넘어갑니다. LLM 은 거기서만 돕니다.
//
// 쓰는 곳 — `.grid.grid-rail` 의 두 번째 칸
//
//   <div className="grid grid-rail">
//     <div>…본문…</div>
//     <AiRail itemId={itemId} />
//   </div>
//
//   지금 붙어 있는 화면: app/(user)/purchase-recommendation/[itemId]/page.tsx (SKU Detail)
//
// 행동 버튼은 Secondary 입니다. 한 화면의 Primary 는 그 화면이 시키려는 일 하나뿐이고,
// SKU Detail 에서 그것은 발주 승인입니다 (design.md §6.7).

import Link from 'next/link';
import { MessageSquareText, Sparkles } from 'lucide-react';
import { getSkuDetail } from '@/lib/recommendation';
import { RISK_LABEL } from '@/lib/status';

/** 숫자 자리에 숫자를 넣지 않습니다 (design.md §8.2) */
function Tile({
  label,
  value,
  unit,
  wide = false,
}: {
  label: string;
  value: number | string | null;
  unit?: string;
  wide?: boolean;
}) {
  return (
    <div className={`rail-tile${wide ? ' wide' : ''}`}>
      <span className="rail-tile-label">{label}</span>
      <span className="rail-tile-value">
        {value === null ? (
          <span style={{ color: 'var(--text-3)' }}>—</span>
        ) : (
          <>
            {typeof value === 'number' ? value.toLocaleString('ko-KR') : value}
            {unit ? <span className="t-sm text-3"> {unit}</span> : null}
          </>
        )}
      </span>
    </div>
  );
}

export default async function AiRail({ itemId }: { itemId: string }) {
  const { data, error } = await getSkuDetail(itemId);

  // 레일이 비어도 본문은 그대로 서 있어야 합니다 (design.md §6.11).
  if (error || !data) {
    return (
      <aside className="rail">
        <header className="rail-head">
          <Sparkles size={14} aria-hidden />
          AI Insight
        </header>
        <p className="rail-note">
          {error
            ? '근거를 불러오지 못했습니다. 아래 링크로 직접 물어볼 수 있습니다.'
            : '이 품목의 요약이 아직 없습니다.'}
        </p>
        <Link className="btn secondary block" href={`/agent?q=${encodeURIComponent(`${itemId} 상태 알려줘.`)}`}>
          <MessageSquareText size={14} aria-hidden />이 품목에 대해 묻기
        </Link>
      </aside>
    );
  }

  const question = `${data.itemId} 왜 이만큼 발주해야 해?`;

  return (
    <aside className="rail">
      <header className="rail-head">
        <Sparkles size={14} aria-hidden />
        AI Insight
      </header>

      <span className="t-code">{data.itemId}</span>

      <p className="rail-note">
        {data.explanation ?? `판정은 ${RISK_LABEL[data.risk]} 입니다. 근거 문장이 아직 만들어지지 않았습니다.`}
      </p>

      <div className="rail-tiles">
        <Tile label="적용 수요" value={data.consensusForecast} unit="개" />
        <Tile label="가용 재고" value={data.currentInventory} unit="개" />
        <Tile label="안전 재고" value={data.safetyStock} unit="개" />
        <Tile label="추천 수량" value={data.finalRecommendedQty} unit="개" />
        <Tile label="결품 예상일" value={data.stockoutDate} wide />
      </div>

      <Link className="btn secondary block" href={`/agent?q=${encodeURIComponent(question)}`}>
        <MessageSquareText size={14} aria-hidden />이 품목에 대해 묻기
      </Link>

      <p className="rail-note t-sm">
        기준 {data.dataSnapshotAt?.slice(0, 10) ?? '—'} · 이 레일은 AI 를 부르지 않습니다.
      </p>
    </aside>
  );
}
