// 적재 이력과 검증 오류 조회 — renew.prd 8.5

import { createSupabaseServerClient } from '../supabase/server';

export type ImportBatch = {
  batchId: string;
  filename: string | null;
  dataType: string;
  targetTable: string;
  sourceType: string;
  mode: string;
  status: string;
  totalRows: number;
  successRows: number;
  warningRows: number;
  errorRows: number;
  importedRows: number;
  uploaderEmail: string | null;
  uploadedAt: string | null;
  message: string | null;
  rollbackAvailable: boolean;
};

export type ValidationErrorRow = {
  id: number;
  batchId: string;
  filename: string | null;
  dataType: string;
  rowNumber: number;
  columnName: string | null;
  severity: 'ERROR' | 'WARNING';
  code: string;
  message: string;
  uploadedAt: string | null;
};

function n(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getImportHistory(): Promise<{ rows: ImportBatch[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_import_history')
      .select('*')
      .order('uploaded_at', { ascending: false })
      .limit(100);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => {
      const row = item as Record<string, unknown>;
      return {
        batchId: String(row.batch_id),
        filename: (row.filename as string | null) ?? null,
        dataType: String(row.data_type ?? ''),
        targetTable: String(row.target_table ?? ''),
        sourceType: String(row.source_type ?? ''),
        mode: String(row.mode ?? ''),
        status: String(row.status ?? ''),
        totalRows: n(row.total_rows),
        successRows: n(row.success_rows),
        warningRows: n(row.warning_rows),
        errorRows: n(row.error_rows),
        importedRows: n(row.imported_rows),
        uploaderEmail: (row.uploader_email as string | null) ?? null,
        uploadedAt: (row.uploaded_at as string | null) ?? null,
        message: (row.message as string | null) ?? null,
        rollbackAvailable: row.rollback_available === true,
      };
    });
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}

export async function getValidationErrors(): Promise<{
  rows: ValidationErrorRow[];
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_validation_error')
      .select('id, batch_id, filename, data_type, row_number, column_name, severity, code, message, uploaded_at')
      .order('uploaded_at', { ascending: false })
      .order('row_number')
      .limit(300);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => {
      const row = item as Record<string, unknown>;
      return {
        id: n(row.id),
        batchId: String(row.batch_id),
        filename: (row.filename as string | null) ?? null,
        dataType: String(row.data_type ?? ''),
        rowNumber: n(row.row_number),
        columnName: (row.column_name as string | null) ?? null,
        severity: row.severity === 'WARNING' ? ('WARNING' as const) : ('ERROR' as const),
        code: String(row.code ?? ''),
        message: String(row.message ?? ''),
        uploadedAt: (row.uploaded_at as string | null) ?? null,
      };
    });
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}
