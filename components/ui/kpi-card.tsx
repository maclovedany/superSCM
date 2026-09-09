import type { ReactNode } from 'react';
import type { SystemStatus } from '@/lib/status';

export default function KpiCard({ label, value, foot, status, children }: { label: string; value: ReactNode; foot?: ReactNode; status?: SystemStatus; children?: ReactNode }) {
  return <article className={`card metric ${status ? `metric-${status.toLowerCase()}` : ''}`}><div className="metric-label">{label}</div><div className="metric-value">{value}</div>{foot ? <div className={`metric-foot ${status === 'CRITICAL' ? 'danger' : status === 'WARNING' ? 'warn' : status === 'SAFE' ? 'good' : ''}`}>{foot}</div> : null}{children}</article>;
}

