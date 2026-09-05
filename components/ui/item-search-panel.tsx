// 품목 검색 패널 — 실데이터 전환 Plan 3 (spec §7)
//
// 품목이 11,000개라 칩으로 나열할 수 없습니다. 서버가 검색하고(lib/items.searchItems) 이 컴포넌트는
// 폼 하나와 결과 칩을 그립니다. 자바스크립트가 없어도 됩니다 — GET 폼이라 ?q= 로 갑니다.
// 결과 칩을 누르면 ?item= 으로 그 화면이 다시 열립니다. 다른 파라미터는 hidden 으로 유지합니다.

import Link from 'next/link';
import { Search } from 'lucide-react';
import Panel from '@/components/ui/panel';
import Badge from '@/components/ui/badge';
import type { ItemHit } from '@/lib/items-model';

export default function ItemSearchPanel({
  q,
  results,
  selectedItemId,
  itemParam = 'item',
  keep = {},
  title = '품목 검색',
  hint = '대표코드 · 품목명 · 구코드(XCN) 로 찾습니다. 두 글자 이상.',
  children,
}: {
  q: string;
  results: ItemHit[];
  selectedItemId: string | null;
  /** 결과 칩이 채울 파라미터 이름 */
  itemParam?: string;
  /** 검색해도 유지할 다른 파라미터 */
  keep?: Record<string, string | null | undefined>;
  title?: string;
  hint?: string;
  /** 검색 결과가 없을 때 대신 보여줄 것 (예: 상위 품목 칩) */
  children?: React.ReactNode;
}) {
  const kept = Object.entries(keep).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '');
  const href = (itemId: string) => {
    const params = new URLSearchParams();
    for (const [k, v] of kept) params.set(k, v);
    params.set(itemParam, itemId);
    return `?${params.toString()}`;
  };
  return (
    <Panel title={title} actions={<span className="t-label">{hint}</span>}>
      <form method="get" style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center', marginBottom: 'var(--s-3)' }}>
        {kept.map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="예: 602K02693 · Fuser · MDL222"
          aria-label="품목 검색"
          style={{ flex: '1 1 16rem' }}
        />
        <button type="submit" className="btn secondary">
          <Search size={14} aria-hidden /> 검색
        </button>
        {q && (
          <Link href={kept.length ? `?${new URLSearchParams(Object.fromEntries(kept)).toString()}` : '?'} className="btn ghost">
            지우기
          </Link>
        )}
      </form>
      {q.trim().length >= 2 ? (
        results.length === 0 ? (
          <p className="t-sm text-3">&lsquo;{q}&rsquo; 에 맞는 품목이 없습니다.</p>
        ) : (
          <div className="chart-legend">
            {results.map((hit) => {
              const active = hit.itemId === selectedItemId;
              return (
                <Link
                  key={hit.itemId}
                  href={href(hit.itemId)}
                  className="chart-legend-item"
                  aria-pressed={active}
                  scroll={false}
                  style={active ? { borderColor: 'var(--ink)', color: 'var(--text-1)', fontWeight: 600 } : undefined}
                >
                  <span className="t-code">{hit.itemId}</span>
                  {hit.itemName && <span className="text-2">{hit.itemName}</span>}
                  {hit.itemType && <Badge tone={hit.isMachine ? 'info' : 'plain'}>{hit.itemType}</Badge>}
                  {hit.matchedAlias && <span className="text-3">구코드 {hit.matchedAlias}</span>}
                </Link>
              );
            })}
          </div>
        )
      ) : (
        children
      )}
    </Panel>
  );
}
