import type { ReactNode } from 'react';
import AnalysisTabs from '@/components/analysis/analysis-tabs';
import { getPermissions } from '@/lib/auth';

export default async function AnalysisLayout({ children }: { children: ReactNode }) {
  const permissions = await getPermissions();
  return <div><AnalysisTabs permissionCodes={permissions.list()} />{children}</div>;
}
