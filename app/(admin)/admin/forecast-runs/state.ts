export type RunActionState = { error: string | null; message: string | null; pipelineId?: string | null };
export const EMPTY_RUN_ACTION: RunActionState = { error: null, message: null, pipelineId: null };

/** 폼이 5초마다 묻는 파이프라인 진행 상황 (actions.ts pollPipeline 의 결과) */
export type PipelinePoll = {
  status: string | null;
  stage: string | null;
  message: string | null;
  progress: { model: string | null; modelIndex: number | null; modelTotal: number | null; itemsSeen: number | null; itemsTotal: number | null } | null;
};

export const STAGE_LABEL: Record<string, string> = {
  QUEUED: '대기',
  SQL: 'SQL 기준 모델 실행',
  PYTHON: 'Python 모델 실행',
  MATERIALIZE: '화면 예측 표 갱신',
  BACKTEST: '백테스트 · Champion 선정',
  DONE: '완료',
  FAILED: '실패',
};

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
