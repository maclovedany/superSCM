import PageHeader from '@/components/shell/page-header';
import { requireAdmin } from '@/lib/auth';
import { getNotificationDeliveries } from '@/lib/notifications/repository';

export const dynamic = 'force-dynamic';

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '—';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium' }).format(date);
}

export default async function NotificationHistoryPage() {
  await requireAdmin();
  const { rows, error } = await getNotificationDeliveries();
  return (
    <section className="analysis-page">
      <PageHeader eyebrow="ADMIN" title="알림 발송 이력" description="시스템 알림과 이메일의 성공·실패를 채널별로 확인합니다." />
      <div className="analysis-content"><div className="card">
        <div className="card-title"><div><h3>최근 발송</h3><span>최대 500건</span></div></div>
        {error ? <><p className="text-danger">조회에 실패했습니다.</p><p className="muted">{error}</p></>
          : rows.length === 0 ? <p className="muted">표시할 발송 이력이 없습니다.</p>
            : <div className="analysis-table-wrap"><table className="analysis-table notification-history-table">
              <thead><tr><th>시각</th><th>템플릿</th><th>수신자</th><th>채널</th><th>상태</th><th>오류·외부 ID</th></tr></thead>
              <tbody>{rows.map((row) => <tr key={row.deliveryId}><td>{formatDate(row.attemptedAt)}</td><td>{row.templateCode}</td><td><b>{row.recipientName}</b><br /><span className="muted">{row.recipientEmail ?? '이메일 없음'}</span></td><td><span className="tag blue">{row.channel}</span></td><td><span className={`tag ${row.status === 'SUCCESS' ? 'green' : 'red'}`}>{row.status}</span></td><td>{row.errorMessage ?? row.externalMessageId ?? '—'}</td></tr>)}</tbody>
            </table></div>}
      </div></div>
    </section>
  );
}
