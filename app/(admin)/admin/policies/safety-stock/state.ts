// 안전재고 정책 화면의 상태 타입과 초기값.
// actions.ts 는 'use server' 라 async 함수만 export 할 수 있습니다 (error.md #10).

export type PolicyConfigActionState = { error: string | null; message: string | null };

export const EMPTY_POLICY_CONFIG_ACTION: PolicyConfigActionState = { error: null, message: null };

/**
 * 이 화면에서 고치는 정책값 — renew.prd 32장.
 *
 * 여섯 개를 고른 이유는 전부 안전재고나 발주 권고일에 직접 들어가기 때문입니다.
 * 목록을 여기 둔 이유는 actions.ts 가 'use server' 라 상수를 export 할 수 없어서입니다.
 */
export const EDITABLE_POLICY_KEYS = [
  'SERVICE_LEVEL_DEFAULT',
  'Z_VALUE_DEFAULT',
  'REVIEW_PERIOD_DAYS',
  'SAFETY_BUFFER_DAYS',
  'DELIVERY_BUFFER_DAYS',
  'EXCESS_STOCK_MONTHS',
] as const;

export type EditablePolicyKey = (typeof EDITABLE_POLICY_KEYS)[number];

export function isEditablePolicyKey(value: string): value is EditablePolicyKey {
  return (EDITABLE_POLICY_KEYS as readonly string[]).includes(value);
}
