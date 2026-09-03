// 'use server' 파일은 async 함수만 export 할 수 있습니다 (error.md #10).
// 상수와 타입은 이 파일에 둡니다.

export type SimulationState = { error: string | null; message: string | null };

export const EMPTY_SIMULATION: SimulationState = { error: null, message: null };
