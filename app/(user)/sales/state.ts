// 영업 수급 조회 화면의 상수와 타입 — renew.prd 27장 · 28.3
//
// 'use server' 파일은 async 함수만 export 할 수 있습니다 (error.md #10).
// 상수와 타입은 이 파일에 둡니다. lib/use-server-exports.test.ts 가 검사합니다.
//
// 이 파일은 클라이언트 컴포넌트(*-form.tsx)도 import 합니다.
// 서버 전용 모듈을 여기서 부르지 마세요.

import type { Feasibility } from '@/lib/atp-model';

/** 가예약 [확정] · [해제] 버튼의 상태 */
export type AllocationActionState = {
  error: string | null;
  message: string | null;
};

export const EMPTY_ALLOCATION_ACTION: AllocationActionState = { error: null, message: null };

/**
 * 빠른 확인 폼의 상태.
 *
 * 판정 결과를 그대로 실어 화면이 카드로 그립니다. 실패했을 때는 result 가 null 이고
 * error 만 채워집니다 — 숫자 자리를 0 으로 채우지 않습니다 (AGENTS.md 규칙 5).
 */
export type FeasibilityState = {
  error: string | null;
  result: Feasibility | null;
  /** 이 판정을 만든 입력. [가예약] 버튼이 그대로 씁니다 */
  input: { itemId: string; qty: number; targetDate: string } | null;
  /** 가예약을 만들었으면 그 결과 문장 */
  allocationMessage: string | null;
};

export const EMPTY_FEASIBILITY: FeasibilityState = {
  error: null,
  result: null,
  input: null,
  allocationMessage: null,
};

/**
 * 가예약이 "만료 임박" 인 기준 일수.
 *
 * KPI 카드와 표 배지가 같은 값을 봅니다. 정책값이 아니라 화면 표시 기준이라
 * core.policy_config 에 두지 않았습니다 — 알림 쪽 기준은 별도로
 * ALERT_SOFT_ALLOC_EXPIRY_DAYS 가 관리합니다 (sql/20 룰 11).
 */
export const EXPIRING_WITHIN_DAYS = 3;
