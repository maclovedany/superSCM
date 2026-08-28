export type BaselineModelId = 'MA_3M' | 'MA_6M' | 'WMA_3M' | 'PY_SAME_MONTH' | 'SEASONAL_NAIVE';
export type DemandTypeCode = 'SMOOTH' | 'INTERMITTENT' | 'ERRATIC' | 'LUMPY';

type Availability = { availablePeriods: number; hasSameMonthLastYear: boolean; hasSeasonalHistory: boolean };

export function canProduceBaseline(modelId: BaselineModelId, availability: Availability) {
  if (modelId === 'MA_3M' || modelId === 'WMA_3M') return availability.availablePeriods >= 3;
  if (modelId === 'MA_6M') return availability.availablePeriods >= 6;
  if (modelId === 'PY_SAME_MONTH') return availability.hasSameMonthLastYear;
  return availability.hasSeasonalHistory;
}

export function validateModelParameters(modelId: BaselineModelId, parameters: Record<string, unknown>): { valid: true } | { valid: false; reasonCode: string } {
  const demandTypes = parameters.applicableDemandType;
  if (demandTypes !== undefined && (!Array.isArray(demandTypes) || demandTypes.some((value) => !['SMOOTH', 'INTERMITTENT', 'ERRATIC', 'LUMPY'].includes(String(value))))) {
    return { valid: false, reasonCode: 'INVALID_DEMAND_TYPE' };
  }
  if (modelId === 'WMA_3M') {
    const weights = parameters.weights;
    if (!Array.isArray(weights) || weights.length !== 3 || weights[0] !== 3 || weights[1] !== 2 || weights[2] !== 1) return { valid: false, reasonCode: 'INVALID_WEIGHTS' };
  }
  return { valid: true };
}
