// ★ 검증 — renew.prd 8.3
//
// 이 모듈이 파일 업로드와 External API(STEP 19) **양쪽의 단일 검증 경로**입니다.
// 두 경로가 다른 규칙을 쓰면 "파일로는 되는데 API 로는 안 된다"가 생깁니다.
//
// 원칙 두 가지
//   1  임의로 보정하지 않는다. 고칠 수 있어 보여도 오류로 남긴다.
//   2  순수 함수로 둔다. DB 조회가 필요한 정보는 ValidationContext 로 주입받는다.

import { TABLE_SPECS, type FieldSpec, type TableSpec } from './schema.ts';
import type {
  DataType,
  MappedRow,
  SourceRow,
  ValidationContext,
  ValidationIssue,
  ValidationResult,
} from './types';

/** 빈 값 판정. 0 과 false 는 값이 있는 것으로 봅니다 */
function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/**
 * 날짜 파싱. 허용 형식만 받고 나머지는 실패로 둡니다.
 *
 * new Date('2025/13/01') 은 브라우저마다 다르게 동작하므로 쓰지 않습니다.
 * 2월 30일 같은 값도 걸러내야 합니다.
 */
export function parseDate(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : toIsoDate(value);
  }
  if (typeof value === 'number') {
    // Excel 일련번호 (1900-01-01 기준). SheetJS 가 Date 로 주지 못한 경우입니다.
    if (value < 1 || value > 2958465) return null;
    const ms = Math.round((value - 25569) * 86400 * 1000);
    return toIsoDate(new Date(ms));
  }
  if (typeof value !== 'string') return null;

  const text = value.trim();
  const match =
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text) ??
    /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // 2월 30일 같은 값을 걸러냅니다.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return toIsoDate(date);
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 숫자 파싱. 천 단위 쉼표는 허용하고, 그 밖의 문자가 섞이면 실패입니다 */
export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const text = value.trim().replace(/,/g, '');
  if (text === '' || !/^-?\d+(\.\d+)?$/.test(text)) return null;

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function convert(field: FieldSpec, value: unknown) {
  switch (field.kind) {
    case 'number':
      return parseNumber(value);
    case 'date':
      return parseDate(value);
    default:
      return String(value).trim();
  }
}

/**
 * 행 단위 검증.
 *
 * @param dataType  데이터 종류
 * @param rows      원본 행 (파서가 준 그대로)
 * @param mapping   원본 컬럼 → 대상 컬럼. 사용자가 화면에서 고친 최종본
 * @param context   마스터 목록과 실제 테이블 컬럼
 */
export function validate(
  dataType: DataType,
  rows: SourceRow[],
  mapping: Record<string, string>,
  context: ValidationContext,
): ValidationResult {
  const spec: TableSpec = TABLE_SPECS[dataType];
  const issues: ValidationIssue[] = [];
  const mapped: MappedRow[] = [];
  const rowValid: boolean[] = [];

  const mappedTargets = new Set(Object.values(mapping));

  // ── 1. 필수 컬럼이 매핑되었는가 (행과 무관한 파일 단위 오류) ──
  for (const field of spec.fields) {
    if (!field.required) continue;
    if (!mappedTargets.has(field.target)) {
      issues.push({
        rowNumber: 0,
        column: field.target,
        severity: 'ERROR',
        code: 'MISSING_COLUMN',
        message: `필수 항목 '${field.target}' 에 연결된 컬럼이 없습니다. 컬럼 매핑을 확인해주세요.`,
      });
    }
  }

  // 대상 테이블에 없는 컬럼으로 매핑되면 적재할 수 없습니다.
  for (const [source, target] of Object.entries(mapping)) {
    if (context.targetColumns.size > 0 && !context.targetColumns.has(target)) {
      issues.push({
        rowNumber: 0,
        column: source,
        severity: 'WARNING',
        code: 'UNMAPPED_COLUMN',
        message: `'${target}' 컬럼이 대상 테이블에 없어 이 값은 적재되지 않습니다.`,
      });
    }
  }

  const fieldByTarget = new Map(spec.fields.map((field) => [field.target, field]));
  const seenKeys = new Map<string, number>();

  // ── 2. 행 단위 검증 ──
  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const output: MappedRow = {};
    let hasError = false;

    for (const [source, target] of Object.entries(mapping)) {
      const field = fieldByTarget.get(target);
      if (!field) continue;
      if (context.targetColumns.size > 0 && !context.targetColumns.has(target)) continue;

      const raw = row[source];

      if (isBlank(raw)) {
        if (field.required) {
          hasError = true;
          issues.push({
            rowNumber,
            column: source,
            severity: 'ERROR',
            code: 'REQUIRED',
            message: `'${target}' 은(는) 비워둘 수 없습니다.`,
          });
        }
        output[target] = null;
        continue;
      }

      const converted = convert(field, raw);

      if (converted === null) {
        hasError = true;
        issues.push({
          rowNumber,
          column: source,
          severity: 'ERROR',
          code: field.kind === 'date' ? 'INVALID_DATE' : 'INVALID_NUMBER',
          message:
            field.kind === 'date'
              ? `'${String(raw)}' 은(는) 날짜 형식이 아닙니다. YYYY-MM-DD 로 입력해주세요.`
              : `'${String(raw)}' 은(는) 숫자가 아닙니다.`,
        });
        output[target] = null;
        continue;
      }

      // 음수 검사. 반품은 별도 데이터로 관리하며 수량 컬럼에 음수를 넣지 않습니다.
      if (field.nonNegative && typeof converted === 'number' && converted < 0) {
        hasError = true;
        issues.push({
          rowNumber,
          column: source,
          severity: 'ERROR',
          code: 'NEGATIVE',
          message: `'${target}' 에 음수(${converted})가 들어갈 수 없습니다.`,
        });
      }

      // 마스터 존재 여부
      if (field.references === 'ITEM' && context.knownItemIds.size > 0) {
        if (!context.knownItemIds.has(String(converted))) {
          hasError = true;
          issues.push({
            rowNumber,
            column: source,
            severity: 'ERROR',
            code: 'UNKNOWN_ITEM',
            message: `품목코드 '${String(converted)}' 가 마스터에 없습니다.`,
          });
        }
      }
      if (field.references === 'SUPPLIER' && context.knownSupplierIds.size > 0) {
        if (!context.knownSupplierIds.has(String(converted))) {
          issues.push({
            rowNumber,
            column: source,
            severity: 'WARNING',
            code: 'UNKNOWN_SUPPLIER',
            message: `공급처코드 '${String(converted)}' 가 마스터에 없습니다.`,
          });
        }
      }

      output[target] = converted;
    }

    // ── 3. 논리 오류 — 입고일이 발주일보다 빠를 수 없습니다 ──
    const orderDate = output.order_date as string | null | undefined;
    const dueDate = output.due_date as string | null | undefined;
    if (orderDate && dueDate && dueDate < orderDate) {
      hasError = true;
      issues.push({
        rowNumber,
        column: 'due_date',
        severity: 'ERROR',
        code: 'DATE_ORDER',
        message: `납기일(${dueDate})이 발주일(${orderDate})보다 빠릅니다.`,
      });
    }

    const receiptDate = output.warehouse_receipt_date as string | null | undefined;
    const qcDate = output.qc_release_date as string | null | undefined;
    if (receiptDate && qcDate && qcDate < receiptDate) {
      hasError = true;
      issues.push({
        rowNumber,
        column: 'qc_release_date',
        severity: 'ERROR',
        code: 'DATE_ORDER',
        message: `검수완료일(${qcDate})이 창고입고일(${receiptDate})보다 빠릅니다.`,
      });
    }

    const periodStart = output.period_start as string | null | undefined;
    const periodEnd = output.period_end as string | null | undefined;
    if (periodStart && periodEnd && periodEnd < periodStart) {
      hasError = true;
      issues.push({
        rowNumber,
        column: 'period_end',
        severity: 'ERROR',
        code: 'DATE_ORDER',
        message: `종료일(${periodEnd})이 시작일(${periodStart})보다 빠릅니다.`,
      });
    }

    // ── 4. 파일 안 중복 ──
    if (spec.keyFields.every((key) => mappedTargets.has(key))) {
      const keyValue = spec.keyFields.map((key) => String(output[key] ?? '')).join('|');
      if (keyValue.replace(/\|/g, '') !== '') {
        const first = seenKeys.get(keyValue);
        if (first !== undefined) {
          issues.push({
            rowNumber,
            column: spec.keyFields.join(', '),
            severity: 'WARNING',
            code: 'DUPLICATE',
            message: `${first}행과 키가 같습니다 (${keyValue}). 적재 방식에 따라 덮어쓰거나 중복됩니다.`,
          });
        } else {
          seenKeys.set(keyValue, rowNumber);
        }
      }
    }

    mapped.push(output);
    rowValid.push(!hasError);
  });

  const errorRows = rowValid.filter((valid) => !valid).length;
  const warnRowNumbers = new Set(
    issues.filter((issue) => issue.severity === 'WARNING' && issue.rowNumber > 0).map((i) => i.rowNumber),
  );

  return {
    issues,
    rows: mapped,
    rowValid,
    totalRows: rows.length,
    errorRows,
    warningRows: warnRowNumbers.size,
    successRows: rows.length - errorRows,
  };
}
