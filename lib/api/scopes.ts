// scope 6종 — renew.prd 9.3
//
// ★ 이 파일에는 node:crypto 가 들어오지 않습니다.
//   키 발급 폼('use client')이 scope 목록을 쓰는데, crypto 를 import 한 모듈을 함께 끌고 가면
//   webpack 이 "Reading from node:crypto is not handled" 로 빌드를 멈춥니다.
//   그래서 서버에서만 쓰는 해시 함수(lib/api/auth-model.ts)와 나눠 둡니다.

export const API_SCOPES = [
  'demand:write',
  'inventory:write',
  'purchase_order:write',
  'forecast:read',
  'recommendation:read',
  'alert:read',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export const API_SCOPE_LABEL: Record<ApiScope, string> = {
  'demand:write': '수요 · 이벤트 · 수주 입력',
  'inventory:write': '재고 · 품목 · 공급처 입력',
  'purchase_order:write': '발주 · 입고 입력',
  'forecast:read': '예측 · 리드타임 조회',
  'recommendation:read': '재고 전개 · 발주 추천 · ATP 조회',
  'alert:read': '알림 조회',
};

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).indexOf(value) >= 0;
}
