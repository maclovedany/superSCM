// 목록을 표로 그리는 재사용 컴포넌트입니다.
//
// 기존에는 LeadtimeGap 전용이었는데, 오후에 소진 위험 표에도 쓰려면
// 어떤 타입이든 받을 수 있어야 합니다. 그래서 컬럼 정의를 밖에서 받습니다.

import type { ReactNode } from 'react';

export type Column<T> = {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  /** 값을 그대로 쓰지 않고 가공하고 싶을 때 */
  render?: (row: T) => ReactNode;
};

export function formatNumber(value: number | null, suffix = '') {
  if (value === null) return '—';
  return (Number.isInteger(value) ? String(value) : value.toFixed(1)) + suffix;
}

export default function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  empty = '표시할 데이터가 없습니다.',
  rowKey,
}: {
  columns: Column<T>[];
  rows: T[];
  empty?: string;
  rowKey?: (row: T, index: number) => string;
}) {
  if (rows.length === 0) return <p className="muted">{empty}</p>;

  return (
    <div className="analysis-table-wrap">
      <table className="analysis-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={c.align ? { textAlign: c.align } : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey ? rowKey(row, i) : String(i)}>
              {columns.map((c) => (
                <td key={c.key} style={c.align ? { textAlign: c.align } : undefined}>
                  {c.render ? c.render(row) : String(row[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
