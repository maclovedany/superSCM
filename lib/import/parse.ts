import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { ImportRow } from './types.ts';

export function parseCsv(content: string): { columns: string[]; rows: ImportRow[] } {
  const parsed = Papa.parse<ImportRow>(content, { header: true, skipEmptyLines: 'greedy', transformHeader: (header) => header.trim() });
  if (parsed.errors.length) throw new Error(parsed.errors[0].message);
  return { columns: parsed.meta.fields ?? [], rows: parsed.data };
}

export function parseExcel(content: ArrayBuffer): { columns: string[]; rows: ImportRow[] } {
  const workbook = XLSX.read(content, { type: 'array', cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<ImportRow>(sheet, { defval: null, raw: false });
  return { columns: rows.length ? Object.keys(rows[0]) : [], rows };
}
