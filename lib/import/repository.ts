// 적재 파이프라인의 DB 접근 — renew.prd 8장
//
// 검증(validate.ts)은 순수 함수로 두고, DB 가 필요한 일은 여기에 모읍니다.
// 화면과 Server Action 은 이 모듈만 부릅니다.

import { createSupabaseServerClient } from '../supabase/server';
import { TABLE_SPECS } from './schema';
import type { DataType, ImportMode, MappedRow, SourceRow, ValidationIssue } from './types';

const CHUNK = 500;

/** 검증에 필요한 마스터 목록과 실제 테이블 컬럼을 모읍니다 */
export async function loadValidationContext(dataType: DataType) {
  const supabase = await createSupabaseServerClient();
  const spec = TABLE_SPECS[dataType];

  const [items, suppliers, columns] = await Promise.all([
    supabase.schema('core').from('v_item_master').select('item_id'),
    supabase.schema('analytics').from('v_leadtime_gap').select('supplier_id'),
    supabase
      .schema('analytics')
      .from('v_raw_schema')
      .select('column_name')
      .eq('table_name', spec.targetTable),
  ]);

  return {
    knownItemIds: new Set((items.data ?? []).map((row) => String((row as { item_id: unknown }).item_id))),
    knownSupplierIds: new Set(
      (suppliers.data ?? []).map((row) => String((row as { supplier_id: unknown }).supplier_id)),
    ),
    targetColumns: new Set(
      (columns.data ?? []).map((row) => String((row as { column_name: unknown }).column_name)),
    ),
  };
}

/** 저장해 둔 매핑 규칙 (renew.prd 8.2) */
export async function loadSavedMapping(dataType: DataType): Promise<Record<string, string>> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .schema('core')
    .from('column_mapping')
    .select('source_column, target_column')
    .eq('data_type', dataType);

  const mapping: Record<string, string> = {};
  for (const row of data ?? []) {
    const typed = row as { source_column: string; target_column: string };
    mapping[typed.source_column] = typed.target_column;
  }
  return mapping;
}

export async function saveMapping(dataType: DataType, mapping: Record<string, string>) {
  const supabase = await createSupabaseServerClient();
  const rows = Object.entries(mapping).map(([source, target]) => ({
    data_type: dataType,
    source_column: source,
    target_column: target,
  }));
  if (rows.length === 0) return;
  await supabase.schema('core').from('column_mapping').upsert(rows, {
    onConflict: 'data_type,source_column',
  });
}

export type StageInput = {
  batchId: string;
  filename: string;
  dataType: DataType;
  sourceType: string;
  mode: ImportMode;
  mapping: Record<string, string>;
  rows: MappedRow[];
  rawRows: SourceRow[];
  rowValid: boolean[];
  issues: ValidationIssue[];
  counts: { total: number; success: number; warning: number; error: number };
  uploader: { userId: string; email: string };
  options?: Record<string, unknown>;
};

/**
 * 파싱·검증 결과를 임시 보관합니다.
 *
 * 미리보기와 실제 적재 사이에 파일을 다시 올리게 하지 않기 위해서입니다.
 * 이 시점에는 raw 테이블을 건드리지 않습니다.
 */
export async function stageBatch(input: StageInput): Promise<{ error: string | null }> {
  const supabase = await createSupabaseServerClient();
  const spec = TABLE_SPECS[input.dataType];

  const { error: batchError } = await supabase
    .schema('core')
    .from('upload_batch')
    .insert({
      batch_id: input.batchId,
      filename: input.filename,
      data_type: input.dataType,
      target_table: `raw.${spec.targetTable}`,
      source_type: input.sourceType,
      mode: input.mode,
      status: 'PENDING',
      total_rows: input.counts.total,
      success_rows: input.counts.success,
      warning_rows: input.counts.warning,
      error_rows: input.counts.error,
      mapping: input.mapping,
      // SQL 함수(core.import_commit)가 upsert 키와 replace 기준 컬럼을 여기서 읽습니다.
      options: {
        ...(input.options ?? {}),
        keyFields: spec.keyFields,
        periodField: spec.periodField,
      },
      uploader: input.uploader.userId,
      uploader_email: input.uploader.email,
    });

  if (batchError) return { error: batchError.message };

  const staging = input.rows.map((row, index) => ({
    batch_id: input.batchId,
    row_number: index + 1,
    payload: row,
    raw_row: input.rawRows[index] ?? null,
    is_valid: input.rowValid[index] ?? false,
  }));

  for (let i = 0; i < staging.length; i += CHUNK) {
    const { error } = await supabase
      .schema('core')
      .from('import_staging')
      .insert(staging.slice(i, i + CHUNK));
    if (error) return { error: error.message };
  }

  const errors = input.issues.map((issue) => ({
    batch_id: input.batchId,
    row_number: issue.rowNumber,
    column_name: issue.column,
    severity: issue.severity,
    code: issue.code,
    message: issue.message,
    raw_row: issue.rowNumber > 0 ? (input.rawRows[issue.rowNumber - 1] ?? null) : null,
  }));

  for (let i = 0; i < errors.length; i += CHUNK) {
    const { error } = await supabase
      .schema('core')
      .from('validation_error')
      .insert(errors.slice(i, i + CHUNK));
    if (error) return { error: error.message };
  }

  return { error: null };
}

/**
 * 임시 보관한 행을 실제 테이블로 옮깁니다 — renew.prd 8.4
 *
 * raw 스키마는 REST API 에 노출하지 않습니다(SCHEMA.md).
 * 그래서 여기서 직접 insert 하지 않고, core 의 security definer 함수를 부릅니다.
 * 적재가 한 트랜잭션에서 끝나므로 중간에 실패해도 절반만 들어가는 일이 없습니다.
 *
 *   append   기존 유지 + 신규 추가
 *   replace  대상 기간 삭제 후 적재
 *   upsert   키가 같으면 지우고 다시 넣습니다
 *
 * 오류 행은 넣지 않습니다. 부분 성공을 허용합니다.
 */
export async function commitBatch(batchId: string): Promise<{
  imported: number;
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('import_commit', {
      p_batch_id: batchId,
    });

    if (error) return { imported: 0, error: error.message };

    const row = (Array.isArray(data) ? data[0] : data) as
      | { imported?: number | string; message?: string }
      | null;
    const imported = Number(row?.imported ?? 0);

    // 함수가 사유를 담아 돌려줍니다. 0행이면 그 사유를 그대로 보여줍니다.
    if (imported === 0) {
      return { imported: 0, error: row?.message ?? '적재하지 못했습니다.' };
    }
    return { imported, error: null };
  } catch (error) {
    return {
      imported: 0,
      error: error instanceof Error ? error.message : '적재에 실패했습니다.',
    };
  }
}

export async function cancelBatch(batchId: string) {
  const supabase = await createSupabaseServerClient();
  await supabase.schema('core').from('import_staging').delete().eq('batch_id', batchId);
  await supabase
    .schema('core')
    .from('upload_batch')
    .update({ status: 'CANCELLED', message: '사용자가 취소했습니다.' })
    .eq('batch_id', batchId)
    .eq('status', 'PENDING');
}

export async function rollbackBatch(batchId: string): Promise<{ message: string; error: string | null }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.schema('core').rpc('rollback_batch', { p_batch_id: batchId });

  if (error) return { message: '', error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  return { message: String((row as { message?: string })?.message ?? '완료'), error: null };
}
