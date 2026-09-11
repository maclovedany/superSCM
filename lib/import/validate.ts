import { IMPORT_SCHEMAS } from './schema.ts';
import type { ImportReferences, ImportRow, ImportType, ValidationIssue, ValidationResult } from './types.ts';

function text(value: unknown) { return typeof value === 'string' ? value.trim() : value; }
function empty(value: unknown) { return value === null || value === undefined || text(value) === ''; }
function validDate(value: unknown) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)); }
// Task 7 — 필요월(need_month)은 일자가 없는 월 단위 값이라 'YYYY-MM' 형식만 받는다. 실제 있는 달(1~12)인지도 확인한다.
function validMonth(value: unknown) { if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return false; const month = Number(value.slice(5, 7)); return month >= 1 && month <= 12; }
function numeric(value: unknown) { return typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)); }

export function validateRows(type: ImportType, rows: ImportRow[], references: ImportReferences): ValidationResult {
  const schema = IMPORT_SCHEMAS[type];
  const issues: ValidationIssue[] = [];
  const seen = new Map<string, number>();
  const validated = rows.map((data, index) => {
    const rowNumber = index + 2;
    const rowIssues: ValidationIssue[] = [];
    const add = (fieldName: string, code: string, message: string, originalValue: unknown, severity: 'ERROR' | 'WARNING' = 'ERROR') => { const issue = { rowNumber, fieldName, code, message, severity, originalValue }; rowIssues.push(issue); issues.push(issue); };
    for (const rule of schema.fields) {
      const value = data[rule.field];
      if (rule.required && empty(value)) { add(rule.field, 'REQUIRED_VALUE', '필수값이 없습니다.', value); continue; }
      if (!empty(value) && rule.kind === 'date' && !validDate(value)) add(rule.field, 'INVALID_DATE', '날짜 형식이 올바르지 않습니다.', value);
      if (!empty(value) && rule.kind === 'month' && !validMonth(value)) add(rule.field, 'INVALID_DATE', '연월 형식(YYYY-MM)이 올바르지 않습니다.', value);
      if (!empty(value) && rule.kind === 'number' && !numeric(value)) add(rule.field, 'INVALID_NUMBER', '숫자 형식이 올바르지 않습니다.', value);
      if (!empty(value) && rule.quantity && numeric(value) && Number(value) < 0) add(rule.field, 'NEGATIVE_QUANTITY', '수량은 음수일 수 없습니다.', value);
      if (!empty(value) && rule.reference === 'item' && !references.itemIds.has(String(value).trim())) add(rule.field, 'UNKNOWN_ITEM', '품목 마스터에 없습니다.', value);
      if (!empty(value) && rule.reference === 'supplier' && !references.supplierIds.has(String(value).trim())) add(rule.field, 'UNKNOWN_SUPPLIER', '공급처 마스터에 없습니다.', value);
      if (!empty(value) && rule.reference === 'inventory_status' && !references.inventoryStatuses.has(String(value).trim())) add(rule.field, 'UNKNOWN_INVENTORY_STATUS', '등록된 재고상태 분류가 아닙니다.', value);
      if (!empty(value) && rule.enumValues && !rule.enumValues.includes(String(value).trim())) add(rule.field, `UNKNOWN_${rule.field.toUpperCase()}`, `허용된 값(${rule.enumValues.join(', ')})이 아닙니다.`, value);
    }
    const sourceId = data.source_record_id ?? data.usage_id ?? data.order_no ?? data.receipt_no;
    if (!empty(sourceId)) { const previous = seen.get(String(sourceId)); if (previous !== undefined) add('source_record_id', 'DUPLICATE_RECORD', `행 ${previous}와 중복된 원본 식별자입니다.`, sourceId); else seen.set(String(sourceId), rowNumber); }
    return { rowNumber, data, issues: rowIssues };
  });
  const errorRows = validated.filter((row) => row.issues.some((issue) => issue.severity === 'ERROR')).length;
  const warningRows = validated.filter((row) => !row.issues.some((issue) => issue.severity === 'ERROR') && row.issues.length > 0).length;
  return { rows: validated, issues, summary: { totalRows: rows.length, successRows: rows.length - errorRows - warningRows, warningRows, errorRows } };
}
