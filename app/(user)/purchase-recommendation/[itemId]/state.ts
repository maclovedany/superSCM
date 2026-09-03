// Override 폼의 상태 — error.md #10
//
// 'use server' 파일은 async 함수만 export 할 수 있어 상수와 타입을 여기 둡니다.

export type OverrideActionState = { error: string | null; message: string | null };

export const EMPTY_OVERRIDE_ACTION: OverrideActionState = { error: null, message: null };

// ── STEP 13 · 승인 폼 (renew.prd 23장) ──────────────────────────
//
// Override 폼과 모양은 같지만 이름을 나눠 둡니다. 한 화면에 폼이 둘이라
// 이름이 같으면 어느 폼의 결과인지 읽는 쪽에서 헷갈립니다.

export type ApprovalActionState = { error: string | null; message: string | null };

export const EMPTY_APPROVAL_ACTION: ApprovalActionState = { error: null, message: null };
