import type { ReactNode } from 'react';

export default function ForecastOverlayChart({ children }: { children: ReactNode }) {
  return <div className="forecast-overlay-chart" aria-label="Actual과 저장된 Forecast 비교 차트">{children}</div>;
}
