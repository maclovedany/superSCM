// API Key 화면의 상태 타입과 초기값.
// actions.ts 는 'use server' 라 async 함수만 export 할 수 있습니다 (error.md #10).

export type CreateKeyState = {
  error: string | null;
  message: string | null;
  /**
   * 발급 직후 **한 번만** 화면에 나타나는 원문입니다 (renew.prd 9.3).
   *
   * ★ 이 값은 DB · 로그 · 감사로그 어디에도 저장되지 않습니다.
   *   서버가 만들어 한 번 돌려주고, 화면이 보여준 뒤 새로고침하면 사라집니다.
   */
  plaintext: string | null;
  keyId: string | null;
};

export const EMPTY_CREATE_KEY: CreateKeyState = {
  error: null,
  message: null,
  plaintext: null,
  keyId: null,
};

export type RevokeKeyState = { error: string | null; message: string | null };
export const EMPTY_REVOKE_KEY: RevokeKeyState = { error: null, message: null };
