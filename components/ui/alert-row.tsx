import type { ReactNode } from 'react';
import type { SystemStatus } from '@/lib/status';
import Badge from './badge';

export default function AlertRow({ status, title, children }: { status: SystemStatus; title: string; children?: ReactNode }) {
  return <div className={`alert-row alert-${status.toLowerCase()}`}><Badge status={status} /><div><strong>{title}</strong>{children ? <p>{children}</p> : null}</div></div>;
}

