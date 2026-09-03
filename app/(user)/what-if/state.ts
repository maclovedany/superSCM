// 'use server' 파일은 async 함수만 export 할 수 있습니다 (error.md #10).
// 상수와 타입은 이 파일에 둡니다.

export type WhatIfState = {
  error: string | null;
  /** 자연어 변환이 무엇으로 읽혔는지 같은 안내 */
  notice: string | null;
};

export const EMPTY_WHAT_IF: WhatIfState = { error: null, notice: null };
