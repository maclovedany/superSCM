import type { ReactNode } from 'react';
import type { SystemStatus } from '@/lib/status';
import { STATUS_LABELS } from '@/lib/status';

const badgeClass: Record<SystemStatus, string> = { SAFE: 'green', WARNING: 'amber', CRITICAL: 'red', CALCULATION_UNAVAILABLE: 'gray' };

export default function Badge({ status, children }: { status?: SystemStatus; children?: ReactNode }) {
  return <span className={`tag ${status ? badgeClass[status] : 'gray'}`}>{children ?? (status ? STATUS_LABELS[status] : null)}</span>;
}
