// 업로드 화면의 상태 타입과 초기값.
//
// actions.ts 는 'use server' 파일이라 async 함수만 export 할 수 있습니다.
// 상수와 타입은 여기 둡니다.

import type { DataType, ImportMode, ValidationIssue } from '@/lib/import/types';

export type PreviewState = {
  error: string | null;
  batchId: string | null;
  filename: string;
  dataType: DataType | null;
  mode: ImportMode;
  columns: string[];
  mapping: Record<string, string>;
  /** 화면에 보여줄 앞부분 몇 행 */
  sample: Record<string, unknown>[];
  issues: ValidationIssue[];
  counts: { total: number; success: number; warning: number; error: number } | null;
};

export const EMPTY_PREVIEW: PreviewState = {
  error: null,
  batchId: null,
  filename: '',
  dataType: null,
  mode: 'append',
  columns: [],
  mapping: {},
  sample: [],
  issues: [],
  counts: null,
};

export type CommitState = { error: string | null; message: string | null };

export const EMPTY_COMMIT: CommitState = { error: null, message: null };
