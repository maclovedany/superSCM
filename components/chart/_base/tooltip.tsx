'use client';

// 공통 툴팁 — design.md §7.4 "색만으로 구분하지 않는다"
// 이름 · 값 · (있으면) 상태 글자를 한 줄씩 보여 줍니다. 값은 이미 포맷된 문자열로 받습니다.

export type TooltipRow = { name: string; value: string; color?: string };

export default function ChartTooltip({
  title,
  rows,
  note,
}: {
  title: string;
  rows: TooltipRow[];
  note?: string;
}) {
  return (
    <div className="chart-annotation" style={{ borderRadius: 'var(--r-md)' }}>
      <div style={{ marginBottom: 4, color: 'var(--text-3)' }}>{title}</div>
      {rows.map((row) => (
        <div
          key={row.name}
          style={{ display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {row.color && <span className="chart-legend-swatch" style={{ background: row.color }} />}
            {row.name}
          </span>
          <b>{row.value}</b>
        </div>
      ))}
      {note && <div style={{ marginTop: 4, color: 'var(--text-3)' }}>{note}</div>}
    </div>
  );
}
