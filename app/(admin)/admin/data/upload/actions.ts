'use server';

// 업로드 파이프라인 Server Action — renew.prd 8.1
//
//   파일 선택 → 파싱 → 미리보기 → 컬럼 매핑 → 검증 → 사용자 확인 → 적재
//
// 파싱과 검증은 서버에서 합니다. 브라우저에서 수만 행을 다루지 않습니다.

import { revalidatePath } from 'next/cache';
import { requireAdminOrThrow } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { detectSourceType, parseFile } from '@/lib/import/parse';
import { autoMap, TABLE_SPECS } from '@/lib/import/schema';
import { validate } from '@/lib/import/validate';
import {
  cancelBatch,
  commitBatch,
  loadSavedMapping,
  loadValidationContext,
  rollbackBatch,
  saveMapping,
  stageBatch,
} from '@/lib/import/repository';
import type { DataType, ImportMode } from '@/lib/import/types';
import { EMPTY_PREVIEW, type CommitState, type PreviewState } from './state';

/** 배치 ID. 같은 날 여러 번 올려도 겹치지 않게 시각을 붙입니다 */
function newBatchId() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const suffix = Math.floor(now.getTime() % 1000)
    .toString()
    .padStart(3, '0');
  return `b_${stamp}_${suffix}`;
}

export async function analyzeUpload(
  _prev: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  let actor;
  try {
    actor = await requireAdminOrThrow();
  } catch {
    return { ...EMPTY_PREVIEW, error: '관리자 권한이 필요합니다.' };
  }

  const file = formData.get('file');
  const dataType = String(formData.get('dataType') ?? '') as DataType;
  const mode = (String(formData.get('mode') ?? 'append') || 'append') as ImportMode;

  if (!(file instanceof File) || file.size === 0) {
    return { ...EMPTY_PREVIEW, dataType, mode, error: '파일을 선택해주세요.' };
  }
  if (!TABLE_SPECS[dataType]) {
    return { ...EMPTY_PREVIEW, mode, error: '데이터 종류를 선택해주세요.' };
  }

  const sourceType = detectSourceType(file.name);
  if (!sourceType) {
    return {
      ...EMPTY_PREVIEW,
      dataType,
      mode,
      error: `지원하지 않는 형식입니다: ${file.name}. CSV · Excel · JSON 만 올릴 수 있습니다.`,
    };
  }

  const parsed = parseFile(await file.arrayBuffer(), sourceType);
  if (parsed.error) {
    return { ...EMPTY_PREVIEW, dataType, mode, filename: file.name, error: parsed.error };
  }

  // 자동 매핑 위에 저장해 둔 규칙을 덮어씁니다 (renew.prd 8.2).
  const spec = TABLE_SPECS[dataType];
  const saved = await loadSavedMapping(dataType);
  const mapping: Record<string, string> = { ...autoMap(spec, parsed.columns) };
  for (const column of parsed.columns) {
    if (saved[column]) mapping[column] = saved[column];
  }

  const context = await loadValidationContext(dataType);
  const result = validate(dataType, parsed.rows, mapping, context);

  const batchId = newBatchId();
  const counts = {
    total: result.totalRows,
    success: result.successRows,
    warning: result.warningRows,
    error: result.errorRows,
  };

  const { error } = await stageBatch({
    batchId,
    filename: file.name,
    dataType,
    sourceType,
    mode,
    mapping,
    rows: result.rows,
    rawRows: parsed.rows,
    rowValid: result.rowValid,
    issues: result.issues,
    counts,
    uploader: { userId: actor.userId, email: actor.email },
    options: {
      periodFrom: String(formData.get('periodFrom') ?? '') || undefined,
      periodTo: String(formData.get('periodTo') ?? '') || undefined,
    },
  });

  if (error) {
    return { ...EMPTY_PREVIEW, dataType, mode, filename: file.name, error };
  }

  await saveMapping(dataType, mapping);

  return {
    error: null,
    batchId,
    filename: file.name,
    dataType,
    mode,
    columns: parsed.columns,
    mapping,
    sample: parsed.rows.slice(0, 5) as Record<string, unknown>[],
    issues: result.issues.slice(0, 50),
    counts,
  };
}

export async function confirmImport(
  _prev: CommitState,
  formData: FormData,
): Promise<CommitState> {
  let actor;
  try {
    actor = await requireAdminOrThrow();
  } catch {
    return { error: '관리자 권한이 필요합니다.', message: null };
  }

  const batchId = String(formData.get('batchId') ?? '');
  if (!batchId) return { error: '배치를 찾을 수 없습니다.', message: null };

  const { imported, error } = await commitBatch(batchId);
  if (error) return { error, message: null };

  await writeAuditLog(actor, {
    action: 'DATA_IMPORT',
    targetType: 'core.upload_batch',
    targetId: batchId,
    after: { imported },
  });

  revalidatePath('/admin/data/history');
  revalidatePath('/admin/forecast-settings');
  return { error: null, message: `${imported.toLocaleString()}행을 적재했습니다.` };
}

export async function cancelImport(_prev: CommitState, formData: FormData): Promise<CommitState> {
  try {
    await requireAdminOrThrow();
  } catch {
    return { error: '관리자 권한이 필요합니다.', message: null };
  }
  const batchId = String(formData.get('batchId') ?? '');
  if (batchId) await cancelBatch(batchId);
  revalidatePath('/admin/data/history');
  return { error: null, message: '취소했습니다. 적재된 데이터는 없습니다.' };
}

export async function undoBatch(_prev: CommitState, formData: FormData): Promise<CommitState> {
  let actor;
  try {
    actor = await requireAdminOrThrow();
  } catch {
    return { error: '관리자 권한이 필요합니다.', message: null };
  }

  const batchId = String(formData.get('batchId') ?? '');
  const { message, error } = await rollbackBatch(batchId);
  if (error) return { error, message: null };

  await writeAuditLog(actor, {
    action: 'DATA_ROLLBACK',
    targetType: 'core.upload_batch',
    targetId: batchId,
    after: { message },
  });

  revalidatePath('/admin/data/history');
  return { error: null, message };
}
