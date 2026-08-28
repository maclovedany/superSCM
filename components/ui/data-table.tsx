import type { ReactNode } from 'react';
import EmptyValue from './empty-value';

export type Column<T> = { key: string; label: string; align?: 'left' | 'right' | 'center'; render?: (row: T) => ReactNode };

export function formatNumber(value: number | null, suffix = '') { if (value === null) return null; return (Number.isInteger(value) ? String(value) : value.toFixed(1)) + suffix; }

export default function DataTable<T extends Record<string, unknown>>({ columns, rows, empty = '표시할 데이터가 없습니다.', rowKey }: { columns: Column<T>[]; rows: T[]; empty?: string; rowKey?: (row: T, index: number) => string }) {
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  return <div className="analysis-table-wrap"><table className="analysis-table"><thead><tr>{columns.map((c) => <th key={c.key} style={c.align ? { textAlign: c.align } : undefined}>{c.label}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={rowKey ? rowKey(row, i) : String(i)}>{columns.map((c) => <td key={c.key} style={c.align ? { textAlign: c.align } : undefined}>{c.render ? c.render(row) : row[c.key] === null || row[c.key] === undefined ? <EmptyValue reasonCode="CALCULATION_UNAVAILABLE" /> : String(row[c.key])}</td>)}</tr>)}</tbody></table></div>;
}

