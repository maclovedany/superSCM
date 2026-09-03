// 상태와 사유 코드 — design.md §8
//
// 화면·AI·API 가 같은 문구를 쓰도록 여기 한 곳에 모읍니다.

/** renew.prd 20.1 */
export type RiskStatus = 'SAFE' | 'WARNING' | 'CRITICAL' | 'CALCULATION_UNAVAILABLE';

/** renew.prd 20.2 — 계산 불가 사유 */
export type ReasonCode =
  | 'NO_USAGE_HISTORY'
  | 'NO_LEADTIME'
  | 'NO_INVENTORY_DATA'
  | 'NO_FORECAST'
  | 'INSUFFICIENT_SAMPLE';

/** design.md §3.5 의 상태 토큰과 1:1 로 대응하는 CSS 클래스명 */
export type Tone = 'safe' | 'warn' | 'crit' | 'unknown' | 'info' | 'plain';

export const RISK_LABEL: Record<RiskStatus, string> = {
  SAFE: '안정',
  WARNING: '주의',
  CRITICAL: '위험',
  CALCULATION_UNAVAILABLE: '산출 불가',
};

export const RISK_TONE: Record<RiskStatus, Tone> = {
  SAFE: 'safe',
  WARNING: 'warn',
  CRITICAL: 'crit',
  CALCULATION_UNAVAILABLE: 'unknown',
};

export const REASON_LABEL: Record<ReasonCode, string> = {
  NO_USAGE_HISTORY: '사용 이력 없음',
  NO_LEADTIME: '리드타임 미확정',
  NO_INVENTORY_DATA: '재고 데이터 없음',
  NO_FORECAST: '예측 없음',
  INSUFFICIENT_SAMPLE: '표본 부족',
};

/**
 * DB 값을 상태로 변환합니다.
 *
 * analytics.v_stockout_risk 는 STEP 9 에서 재고 전개 기반으로 재작성되어
 * SAFE / WARNING / CRITICAL / CALCULATION_UNAVAILABLE 4종을 돌려줍니다.
 * 재작성 전 덤프가 쓰던 'UNKNOWN' 도 CALCULATION_UNAVAILABLE 로 받습니다.
 */
export function toRiskStatus(value: unknown): RiskStatus {
  if (value === 'SAFE' || value === 'WARNING' || value === 'CRITICAL') return value;
  return 'CALCULATION_UNAVAILABLE';
}

/**
 * 사유 코드를 정규화합니다.
 *
 * 기존 뷰는 NO_USAGE 를 쓰고 renew.prd 는 NO_USAGE_HISTORY 를 씁니다.
 * 뷰를 고치기 전까지 둘 다 받습니다 (AGENTS.md 의 컬럼명 후보 방식과 같은 이유).
 */
export function toReasonCode(value: unknown): ReasonCode | null {
  switch (value) {
    case 'NO_USAGE':
    case 'NO_USAGE_HISTORY':
      return 'NO_USAGE_HISTORY';
    case 'NO_LEADTIME':
      return 'NO_LEADTIME';
    case 'NO_INVENTORY_DATA':
      return 'NO_INVENTORY_DATA';
    case 'NO_FORECAST':
      return 'NO_FORECAST';
    case 'INSUFFICIENT_SAMPLE':
      return 'INSUFFICIENT_SAMPLE';
    default:
      return null;
  }
}

/**
 * 산출 불가 행을 맨 뒤로 보내는 비교 함수 (design.md §8.2).
 *
 * null 을 0 으로 취급해 맨 앞에 두면, 가장 급한 품목처럼 보입니다.
 */
export function nullsLast<T>(pick: (row: T) => number | null, direction: 'asc' | 'desc' = 'asc') {
  return (a: T, b: T) => {
    const x = pick(a);
    const y = pick(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return direction === 'asc' ? x - y : y - x;
  };
}
