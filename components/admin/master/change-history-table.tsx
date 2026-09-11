// Task 10a — 마스터 변경 이력. before/after/actor/at을 그대로 보여 준다(임의 요약하지 않는다).

import type { MasterHistoryEntry } from '@/lib/master-model';

const TARGET_LABELS: Record<string, string> = {
  supply_entity: '해외법인',
  supplier: '공급처',
  supplier_departure: '출항일 규칙',
  business_calendar: '영업일 달력',
  business_calendar_readiness: '달력 준비 상태',
};

export default function ChangeHistoryTable({ rows }: { rows: MasterHistoryEntry[] }) {
  if (rows.length === 0) return <p className="muted">변경 이력이 없습니다.</p>;
  return (
    <div>
      {rows.map((row) => (
        <div key={row.id} className="master-history-item">
          <div><b>{TARGET_LABELS[row.targetType] ?? row.targetType}</b> · {row.targetId} · <span className="muted">{row.action}</span></div>
          <div className="muted">{row.actorName ?? '알 수 없음'} · {new Date(row.at).toLocaleString('ko-KR')}</div>
          {row.after?.reason ? <div>사유: {String(row.after.reason)}</div> : null}
          <pre>before {JSON.stringify(row.before)}</pre>
          <pre>after {JSON.stringify(row.after)}</pre>
        </div>
      ))}
    </div>
  );
}
