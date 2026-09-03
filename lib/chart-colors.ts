// 차트 시리즈 색 — design.md §7.2
//
// 모델 ID → 색을 고정 매핑합니다.
// 화면마다 같은 모델이 다른 색으로 보이면 안 됩니다.

/** 시리즈 색. 순서를 바꾸지 마세요. */
export const SERIES_COLORS = [
  '#2563EB', // 파랑
  '#16A34A', // 초록
  '#EC4899', // 분홍
  '#F59E0B', // 앰버
  '#8B5CF6', // 보라
  '#06B6D4', // 청록
] as const;

/** 실적(Actual)은 잉크 블랙 굵은 실선입니다. 시리즈 색을 쓰지 않습니다. */
export const ACTUAL_COLOR = '#18181B';

export const CHART_TOKENS = {
  grid: '#E4E4E7',
  axis: '#A1A1AA',
  cursor: '#D4D4D8',
  validationBand: 'rgba(37,99,235,.06)',
  deficitBand: 'rgba(220,38,38,.10)',
  /** 0선과 결품 경계선. design.md §7.3 의 --crit 파선 */
  deficitLine: '#DC2626',
  /** 리드타임 기준선. 상태색이 아니라 안내선이라 회색입니다 */
  markerLine: '#79808F',
} as const;

/**
 * 모델 ID 목록을 받아 ID → 색 매핑을 만듭니다.
 * 목록 순서가 곧 색 순서이므로, 호출하는 쪽에서 순서를 고정해 넘겨야 합니다.
 */
export function colorMap(seriesIds: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  seriesIds.forEach((id, i) => {
    map[id] = SERIES_COLORS[i % SERIES_COLORS.length];
  });
  return map;
}
