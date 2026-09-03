// 예측 기본 설정 화면의 상태 타입과 초기값.
// actions.ts 는 'use server' 라 async 함수만 export 할 수 있습니다 (error.md #10).

export type ProductionTrainEndActionState = { error: string | null; message: string | null };

export const EMPTY_PRODUCTION_TRAIN_END_ACTION: ProductionTrainEndActionState = {
  error: null,
  message: null,
};
