'use client';

// 수요 프로파일 — 품목 × 월 사용량 히트맵 (spec §4.2)
// recharts 에 히트맵이 없어 CSS 그리드로 그립니다. 칸 진하기는 그 품목의 최댓값 대비 상대 명도이고,
// 실제 수량은 title 툴팁으로 냅니다. 값은 v_chart_usage_heatmap 이 냈습니다.

import { useRouter } from 'next/navigation';
import { SERIES_COLORS } from '@/lib/chart-colors';
import { formatValue, monthTick } from '@/lib/chart-format';
import type { HeatmapRow } from '@/lib/chart-model';
import { fillHref } from './_base/click';

const BASE = SERIES_COLORS[0];

function shade(qty: number | null, max: number | null): string {
  if (qty === null) return 'var(--surface-3)';
  if (max === null || max <= 0) return 'var(--surface-3)';
  const alpha = 0.08 + 0.72 * Math.min(qty / max, 1);
  return `${BASE}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
}

export default function DemandHeatmap({
  periods,
  rows,
  hrefTemplate,
  selectedItemId = null,
  maxRows = 40,
}: {
  periods: string[];
  rows: HeatmapRow[];
  /** 이동 주소 템플릿. {id} 가 품목·공급처·모델 ID 로 치환됩니다 (서버는 함수를 넘길 수 없습니다) */
  hrefTemplate: string;
  selectedItemId?: string | null;
  maxRows?: number;
}) {
  const router = useRouter();
  const shown = rows.slice(0, maxRows);
  return (
    <div className="heatmap" style={{ gridTemplateColumns: `minmax(96px, 1.4fr) repeat(${periods.length}, minmax(0, 1fr))` }}>
      <div className="heatmap-corner" />
      {periods.map((p) => (
        <div key={p} className="heatmap-head">{monthTick(p)}</div>
      ))}
      {shown.map((row) => (
        <div key={row.itemId} className="heatmap-row-group" style={{ display: 'contents' }}>
          <button
            type="button"
            className={`heatmap-label${selectedItemId === row.itemId ? ' selected' : ''}`}
            title={row.label}
            onClick={() => router.push(fillHref(hrefTemplate, row.itemId))}
          >
            {row.label}
          </button>
          {row.cells.map((cell) => (
            <div
              key={cell.period}
              className="heatmap-cell"
              style={{ background: shade(cell.qty, row.max) }}
              title={`${row.label} · ${monthTick(cell.period)} · ${formatValue(cell.qty, 'qty')}`}
              onClick={() => router.push(fillHref(hrefTemplate, row.itemId))}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
