// 배지 — design.md §6.6
//
// 색만으로 상태를 표현하지 않습니다. 배지에는 반드시 글자가 들어갑니다.

import type { ReactNode } from 'react';
import { RISK_LABEL, RISK_TONE, type RiskStatus, type Tone } from '@/lib/status';

export default function Badge({
  tone = 'plain',
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

/** 재고 위험 상태 배지. 상태 → 문구·색 매핑은 lib/status.ts 한 곳에 있습니다. */
export function StatusBadge({ status }: { status: RiskStatus }) {
  return <Badge tone={RISK_TONE[status]}>{RISK_LABEL[status]}</Badge>;
}
