// 서비스 수준 화면의 상태 타입과 초기값.
// actions.ts 는 'use server' 라 async 함수만 export 할 수 있습니다 (error.md #10).

export type PolicyActionState = { error: string | null; message: string | null };

export const EMPTY_POLICY_ACTION: PolicyActionState = { error: null, message: null };
