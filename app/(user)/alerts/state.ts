// Alert Center 액션의 상태 — renew.prd 24장
//
// 'use server' 파일은 async 함수만 export 할 수 있습니다 (error.md #10).
// 상수와 타입은 이 파일에 둡니다. lib/use-server-exports.test.ts 가 검사합니다.

export type AlertActionState = {
  error: string | null;
  message: string | null;
};

export const EMPTY_ALERT_ACTION: AlertActionState = { error: null, message: null };
