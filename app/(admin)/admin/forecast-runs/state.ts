export type RunActionState = { error: string | null; message: string | null };
export const EMPTY_RUN_ACTION: RunActionState = { error: null, message: null };

/**
 * 실행 모드 — sql/27-admin-ops.sql 의 core.forecast_run.mode check 제약 2종.
 *
 * 여기 둔 이유는 actions.ts 가 'use server' 라 상수를 export 할 수 없어서입니다
 * (error.md #10). 라벨과 설명은 lib/admin-ops-model.ts 한 곳에 있습니다.
 */
export const RUN_MODE_VALUES = ['VALIDATION', 'PRODUCTION'] as const;

export type RunModeValue = (typeof RUN_MODE_VALUES)[number];

export function isRunModeValue(value: string): value is RunModeValue {
  return (RUN_MODE_VALUES as readonly string[]).includes(value);
}
