// 파일 파싱 — renew.prd 8.1 · 33.2
//
// 브라우저에서 파싱하지 않습니다. 수만 행 파일은 서버로 올린 뒤 처리합니다.
// 이 모듈은 서버에서만 실행됩니다.

import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { ParseResult, SourceRow, SourceType } from './types';

const MAX_ROWS = 100_000;

/** 확장자와 내용으로 형식을 정합니다 */
export function detectSourceType(filename: string): SourceType | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) return 'MANUAL_CSV';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'MANUAL_EXCEL';
  if (lower.endsWith('.json')) return 'MANUAL_JSON';
  return null;
}

/**
 * CSV 를 텍스트로 읽습니다.
 *
 * UTF-8 · BOM · EUC-KR 을 지원합니다 (renew.prd 8.1).
 * BOM 이 없고 UTF-8 로 디코딩했을 때 깨진 문자가 많으면 EUC-KR 로 다시 읽습니다.
 */
function decodeCsv(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);

  // UTF-8 BOM
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }

  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const replacementCount = (utf8.match(/�/g) ?? []).length;

  // 깨진 문자가 눈에 띄면 EUC-KR 로 봅니다.
  if (replacementCount > 0 && replacementCount > utf8.length / 2000) {
    try {
      return new TextDecoder('euc-kr').decode(bytes);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

export function parseFile(buffer: ArrayBuffer, sourceType: SourceType): ParseResult {
  try {
    switch (sourceType) {
      case 'MANUAL_CSV':
        return parseCsv(decodeCsv(buffer));
      case 'MANUAL_EXCEL':
        return parseExcel(buffer);
      case 'MANUAL_JSON':
        return parseJson(decodeCsv(buffer));
      default:
        return { columns: [], rows: [], error: '지원하지 않는 형식입니다.' };
    }
  } catch (error) {
    return {
      columns: [],
      rows: [],
      error: error instanceof Error ? error.message : '파일을 읽지 못했습니다.',
    };
  }
}

function parseCsv(text: string): ParseResult {
  const parsed = Papa.parse<SourceRow>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });

  const rows = (parsed.data ?? []).slice(0, MAX_ROWS);
  const columns = (parsed.meta?.fields ?? []).filter((field) => field !== '');

  if (columns.length === 0) {
    return { columns: [], rows: [], error: '머리글 행을 찾지 못했습니다. 첫 줄에 컬럼명이 있어야 합니다.' };
  }
  return { columns, rows, error: null };
}

function parseExcel(buffer: ArrayBuffer): ParseResult {
  // cellDates: 날짜 셀을 Date 객체로 받습니다.
  const book = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = book.SheetNames[0];
  if (!sheetName) return { columns: [], rows: [], error: '시트를 찾지 못했습니다.' };

  const sheet = book.Sheets[sheetName];
  // raw: true 여야 Date 와 숫자가 원형으로 넘어옵니다.
  // raw: false 로 두면 셀 서식대로 문자열이 되어 날짜가 '8/30/26' 처럼 나오고,
  // 그러면 우리 날짜 파서가 전부 오류로 판정합니다.
  const rows = XLSX.utils.sheet_to_json<SourceRow>(sheet, { defval: null, raw: true });
  if (rows.length === 0) return { columns: [], rows: [], error: '데이터 행이 없습니다.' };

  const columns = Object.keys(rows[0]).map((key) => key.trim());
  return { columns, rows: rows.slice(0, MAX_ROWS), error: null };
}

function parseJson(text: string): ParseResult {
  const parsed: unknown = JSON.parse(text);

  // 배열이거나 { data: [...] } 형태를 받습니다 (renew.prd 9.1 과 같은 모양).
  const list = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { data?: unknown }).data)
      ? ((parsed as { data: unknown[] }).data)
      : null;

  if (!list) {
    return { columns: [], rows: [], error: 'JSON 은 배열이거나 { "data": [...] } 형태여야 합니다.' };
  }
  if (list.length === 0) return { columns: [], rows: [], error: '데이터가 비어 있습니다.' };

  const rows = list.slice(0, MAX_ROWS) as SourceRow[];
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  return { columns, rows, error: null };
}
