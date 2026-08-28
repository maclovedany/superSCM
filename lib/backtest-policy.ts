export function backtestMetricAvailability(input: { matchedPeriods: number; actualAbsoluteSum: number; mapeNonzeroPeriods: number }) {
  if (input.matchedPeriods === 0) return { wape: 'INSUFFICIENT_PERIODS', mape: 'INSUFFICIENT_PERIODS', reasonCode: 'FORECAST_OR_ACTUAL_MISSING' };
  const wape = input.actualAbsoluteSum === 0 ? 'WAPE_ZERO_DENOMINATOR' : null;
  const mape = input.mapeNonzeroPeriods === 0 ? 'MAPE_ZERO_DENOMINATOR' : null;
  return { wape, mape, reasonCode: wape ?? mape };
}

export function biasDirection(bias: number | null) {
  if (bias === null) return 'CALCULATION_UNAVAILABLE';
  return bias >= 0 ? 'OVER_FORECAST' : 'UNDER_FORECAST';
}

export function validateManualChampionReason(reason: string) { return reason.trim().length > 0; }
