export type ForecastGranularity = 'DAY' | 'WEEK' | 'MONTH';

export type ForecastWindow = {
  trainStart: string | null;
  trainEnd: string | null;
  testStart: string | null;
  testEnd: string | null;
  granularity: ForecastGranularity | string | null;
};

function validDate(value: string | null): value is string {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function isIsolatedForecastWindow(window: ForecastWindow): boolean {
  if (!validDate(window.trainStart) || !validDate(window.trainEnd) || !validDate(window.testStart) || !validDate(window.testEnd)) return false;
  if (window.granularity !== 'DAY' && window.granularity !== 'WEEK' && window.granularity !== 'MONTH') return false;
  return window.trainStart <= window.trainEnd && window.testStart <= window.testEnd && window.trainEnd < window.testStart;
}
