// AI Agent 화면의 상수와 타입 — renew.prd 26장
//
// 'use server' 파일은 async 함수만 export 할 수 있습니다 (error.md #10).
// 상수와 타입은 이 파일에 둡니다. lib/use-server-exports.test.ts 가 검사합니다.
//
// 이 파일은 클라이언트 컴포넌트(chat-form.tsx)도 import 합니다.
// 서버 전용 모듈을 여기서 부르지 마세요.

export type AskState = {
  error: string | null;
  /**
   * 저장에 실패했을 때만 채웁니다.
   *
   * 답변은 이미 만들어졌습니다. 기록이 남지 않았다는 이유로 사람이 기다린 답을
   * 버리지 않습니다 (renew.prd 31.4).
   */
  answer: string | null;
};

export const EMPTY_ASK: AskState = { error: null, answer: null };

/** renew.prd 26.5 의 SCM 질의 예시 그대로입니다 */
export const EXAMPLE_QUESTIONS = [
  'ITEM012 왜 이만큼 발주해야 해?',
  '향후 60일 결품 위험 품목 보여줘.',
  'Forecast Error 가 큰 SKU 알려줘.',
  '이번 달 총 발주 추천금액 알려줘.',
  '인도 공급사 품목 중 위험한 것만 알려줘.',
  '재고가 너무 많이 쌓인 품목 알려줘.',
] as const;

/** renew.prd 27.2 의 영업 질의 예시 그대로입니다 (STEP 17) */
export const SALES_EXAMPLE_QUESTIONS = [
  'X700 지금 500대 추가 주문 받을 수 있어?',
  '10월 15일까지 700대 납품 가능해?',
  '현재 바로 출고 가능한 수량은?',
  '다음 달까지 추가 확보 가능한 수량은?',
  '현재 주문을 수락하면 이후 결품이 생겨?',
  '이 모델 단종 예정인가? 대체품 있어?',
] as const;

/**
 * 모델에게 함께 넘길 이전 대화 줄 수 (문답 3턴).
 *
 * 후속 질문이 앞의 문답을 알아야 답할 수 있습니다. 다만 대화 전체를 매번 넘기면
 * 토큰과 지연이 대화 길이에 비례해 늘어납니다.
 */
export const HISTORY_TURNS = 6;
