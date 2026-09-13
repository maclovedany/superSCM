// 범례 — 색이 무엇을 뜻하는지. 색은 styles/chart.css 의 클래스가 정한다(토큰 경유).

export type LegendEntry = {
  /** chart.css 의 .chart-dot 보조 클래스 — actual · predicted · band-p80 · stack-0 … */
  tone: string;
  label: string;
};

export default function ChartLegend({ entries }: { entries: readonly LegendEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <ul className="chart-legend">
      {entries.map((entry) => (
        <li className="chart-legend-item" key={`${entry.tone}-${entry.label}`}>
          <span className={`chart-dot ${entry.tone}`} aria-hidden="true" />
          {entry.label}
        </li>
      ))}
    </ul>
  );
}
