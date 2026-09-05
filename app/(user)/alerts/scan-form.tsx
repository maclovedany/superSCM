'use client';

// 지금 스캔 (관리자) — renew.prd 24.4
//
// 스케줄러가 6시간마다 돌지만, 데이터를 방금 올린 뒤 바로 보고 싶을 때가 있습니다.

import { useActionState } from 'react';
import { kstStamp } from '@/lib/time';
import { RadarIcon, TriangleAlert } from 'lucide-react';
import { scanAlertsNow } from './actions';
import { EMPTY_ALERT_ACTION } from './state';

export default function ScanForm({ lastScanAt }: { lastScanAt: string | null }) {
  const [state, action, pending] = useActionState(scanAlertsNow, EMPTY_ALERT_ACTION);

  return (
    <form action={action} style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" className="btn primary lg" disabled={pending}>
          <RadarIcon size={15} aria-hidden />
          {pending ? '스캔하는 중…' : '지금 스캔'}
        </button>
        <span className="t-sm text-3">
          {lastScanAt
            ? `마지막 스캔 ${kstStamp(lastScanAt)}`
            : '아직 스캔한 적이 없습니다'}
          {' · 스케줄러는 6시간마다 돕니다'}
        </span>
      </div>

      {state.error && (
        <p className="login-error" role="alert">
          <TriangleAlert size={14} aria-hidden />
          {state.error}
        </p>
      )}
      {state.message && (
        <div className="insight">
          <div className="insight-head">완료</div>
          <div className="insight-body">{state.message}</div>
        </div>
      )}
    </form>
  );
}
