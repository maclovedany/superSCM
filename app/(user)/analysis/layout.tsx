import type { ReactNode } from 'react';
import AnalysisTabs from '@/components/analysis/analysis-tabs';

export default function AnalysisLayout({ children }: { children: ReactNode }) {
  return <div><AnalysisTabs />{children}</div>;
}
