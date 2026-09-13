// 표 대체 표현 — 차트와 **같은 값**을 표로 다시 보인다.
//
// ★ 그림을 읽지 못하는 사용자에게 차트는 없는 것과 같다. 접힌 표를 함께 두면 같은 값에 닿을
//   수 있다. 값이 없는 칸은 비워 두지 않고 사유 문구를 적는다 — 빈칸은 0 과 구분되지 않는다.

export type ChartTableRow = { key: string; cells: (string | null)[]; reasons?: (string | null)[] };

export default function ChartTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: readonly string[];
  rows: readonly ChartTableRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <details className="chart-table-details">
      <summary>{caption}</summary>
      <div className="analysis-table-wrap">
        <table className="analysis-table">
          <caption className="muted">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                {row.cells.map((cell, index) => (
                  <td key={columns[index] ?? String(index)}>
                    {cell ?? <span className="muted">{row.reasons?.[index] ?? '값 없음'}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
