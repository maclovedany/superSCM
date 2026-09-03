// 오류 행만 CSV 로 내려받기 — renew.prd 8.3
//
// "임의 보정하지 않는다. 오류 행만 CSV로 내려받아 수정 후 재업로드할 수 있게 한다."

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(_request: Request, context: { params: Promise<{ batchId: string }> }) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
  }

  const { batchId } = await context.params;
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .schema('core')
    .from('validation_error')
    .select('row_number, column_name, severity, code, message, raw_row')
    .eq('batch_id', batchId)
    .order('row_number');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as {
    row_number: number;
    column_name: string | null;
    severity: string;
    code: string;
    message: string;
    raw_row: Record<string, unknown> | null;
  }[];

  // 원본 컬럼을 그대로 붙여 줍니다. 고쳐서 그대로 다시 올릴 수 있어야 합니다.
  const sourceColumns = Array.from(
    new Set(rows.flatMap((row) => (row.raw_row ? Object.keys(row.raw_row) : []))),
  );

  const header = ['행번호', '컬럼', '심각도', '코드', '사유', ...sourceColumns];
  const lines = [header.map(csvCell).join(',')];

  for (const row of rows) {
    lines.push(
      [
        row.row_number,
        row.column_name ?? '',
        row.severity,
        row.code,
        row.message,
        ...sourceColumns.map((column) => row.raw_row?.[column] ?? ''),
      ]
        .map(csvCell)
        .join(','),
    );
  }

  // Excel 이 UTF-8 로 읽도록 BOM 을 붙입니다.
  const body = `﻿${lines.join('\n')}`;

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="validation-errors-${batchId}.csv"`,
    },
  });
}
