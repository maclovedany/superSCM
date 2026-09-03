// 데이터 테이블 — design.md §6.8
//
// 계산은 하지 않습니다. 이미 계산된 값을 받아 그리기만 합니다 (AGENTS.md 규칙 2).

import type { ReactNode } from 'react';

export type Column<T> = {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  /** 코드·식별자는 mono 로 표시합니다 (design.md §4.4) */
  variant?: 'text' | 'code' | 'num' | 'strong';
  render?: (row: T) => ReactNode;
};

/**
 * 숫자를 표시합니다. null 은 이 함수로 처리하지 않습니다.
 * 값이 없으면 호출하는 쪽에서 EmptyValue 를 렌더링하세요 (design.md §8.2).
 */
export function formatNumber(value: number, suffix = '') {
  const text = Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);
  return suffix ? `${text}${suffix}` : text;
}

function cellClass<T>(column: Column<T>) {
  switch (column.variant) {
    case 'code':
      return 'cell-code';
    case 'num':
      return 'cell-num';
    case 'strong':
      return 'cell-strong';
    default:
      return '';
  }
}

export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  selectedKey,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  /** 스크린리더용 표 설명 (design.md §10) */
  caption?: string;
  selectedKey?: string;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        {caption && <caption className="t-label text-3">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={column.align ? { textAlign: column.align } : undefined}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const key = rowKey(row, index);
            return (
              <tr key={key} className={selectedKey === key ? 'selected' : undefined}>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cellClass(column)}
                    style={column.align ? { textAlign: column.align } : undefined}
                  >
                    {column.render ? column.render(row) : null}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
