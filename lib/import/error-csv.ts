import type { ValidatedRow } from './types.ts';

function escape(value: unknown) { const text = value === null || value === undefined ? '' : String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
export function errorRowsToCsv(rows: ValidatedRow[]) {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row.data))));
  const lines = ['row_number,error_code,error_message,severity,' + columns.join(',')];
  for (const row of rows) for (const issue of row.issues) lines.push([row.rowNumber, issue.code, issue.message, issue.severity, ...columns.map((column) => row.data[column])].map(escape).join(','));
  return lines.join('\n');
}
