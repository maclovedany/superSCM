export type SystemStatus = 'SAFE' | 'WARNING' | 'CRITICAL' | 'CALCULATION_UNAVAILABLE';

export const STATUS_LABELS: Record<SystemStatus, string> = {
  SAFE: '안전', WARNING: '주의', CRITICAL: '위험', CALCULATION_UNAVAILABLE: '계산 불가',
};

export const STATUS_REASON_LABELS: Record<string, string> = {
  NO_USAGE: '사용 이력 없음', NO_LEADTIME: '계획 리드타임 없음', NO_DATA: '데이터 없음', CALCULATION_UNAVAILABLE: '계산 불가',
};

