export type DemandType = 'SMOOTH' | 'INTERMITTENT' | 'ERRATIC' | 'LUMPY';

export function classifyDemandType(adi: number | null, cvSquared: number | null): DemandType | null {
  if (adi === null || cvSquared === null) return null;
  if (adi < 1.32 && cvSquared < 0.49) return 'SMOOTH';
  if (adi >= 1.32 && cvSquared < 0.49) return 'INTERMITTENT';
  if (adi < 1.32 && cvSquared >= 0.49) return 'ERRATIC';
  return 'LUMPY';
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
