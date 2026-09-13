export type DemandType = 'SMOOTH' | 'INTERMITTENT' | 'ERRATIC' | 'LUMPY';

export function classifyDemandType(adi: number | null, cvSquared: number | null): DemandType | null {
  if (adi === null || cvSquared === null) return null;
  if (adi < 1.32 && cvSquared < 0.49) return 'SMOOTH';
  if (adi >= 1.32 && cvSquared < 0.49) return 'INTERMITTENT';
  if (adi < 1.32 && cvSquared >= 0.49) return 'ERRATIC';
  return 'LUMPY';
}

/** analytics.v_item_demand_kpi 한 행에서 카드가 쓰는 세 칸 */
export type DemandProfileKpiRow = { nItems: number; nCrostonCandidate: number; nUnknown: number };

/**
 * 수요 패턴 화면의 카드 세 개 — 전부 집계 뷰(analytics.v_item_demand_kpi)의 합입니다.
 *
 * ★ 품목 수를 **표에 받아 온 행 수로 세지 않습니다.** 그 배열은 PostgREST 상한에서 잘리므로
 *   (2026-09-13 실측: 10,198행 중 1,000행) 분모가 분자보다 작아집니다 — 실제로 화면에
 *   "분석 품목 1,000 · Croston 후보 6,133" 이라는 모순이 떠 있었습니다.
 * ★ 집계 행이 없으면 0 으로 채우지 않고 null 을 돌려줍니다 (AGENTS.md 규칙 5).
 */
export function demandProfileKpiCounts(rows: DemandProfileKpiRow[]): {
  itemCount: number | null;
  croston: number | null;
  unknown: number | null;
} {
  if (rows.length === 0) return { itemCount: null, croston: null, unknown: null };
  return {
    itemCount: rows.reduce((sum, row) => sum + row.nItems, 0),
    croston: rows.reduce((sum, row) => sum + row.nCrostonCandidate, 0),
    unknown: rows.reduce((sum, row) => sum + row.nUnknown, 0),
  };
}

export function seasonalityAvailability(
  nPeriods: number,
  seasonalIndexCv: number | null,
  threshold: number | null,
): { value: boolean | null; reasonCode: string | null } {
  if (nPeriods < 24) return { value: null, reasonCode: 'INSUFFICIENT_PERIODS' };
  if (seasonalIndexCv === null || threshold === null) return { value: null, reasonCode: 'CALCULATION_UNAVAILABLE' };
  return { value: seasonalIndexCv >= threshold, reasonCode: null };
}
