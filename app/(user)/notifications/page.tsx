import PageHeader from '@/components/shell/page-header';
import { requireUser } from '@/lib/auth';
import { getMyNotifications } from '@/lib/notifications/repository';
import { markNotificationReadAction } from './actions';

export const dynamic = 'force-dynamic';

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '—';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default async function NotificationsPage() {
  await requireUser();
  const { rows, error } = await getMyNotifications();
  return (
    <section className="analysis-page">
      <PageHeader eyebrow="NOTIFICATIONS" title="알림" description="승인, 배정, 수요 제출과 관련된 시스템 알림을 확인합니다." />
      <div className="analysis-content"><div className="card">
        <div className="card-title"><div><h3>내 알림</h3><span>읽음 상태는 이메일 발송 결과와 별도로 관리됩니다</span></div></div>
        {error ? <><p className="text-danger">조회에 실패했습니다.</p><p className="muted">{error}</p></>
          : rows.length === 0 ? <p className="muted">표시할 알림이 없습니다.</p>
            : <div className="notification-list">{rows.map((row) => (
              <article className={`notification-item${row.isRead ? ' is-read' : ''}`} key={row.notificationId}>
                <div><div className="notification-title"><span className={`tag ${row.isRead ? 'gray' : 'blue'}`}>{row.isRead ? '읽음' : '새 알림'}</span><strong>{row.title}</strong></div><p>{row.message}</p><time className="muted">{formatDate(row.createdAt)}</time></div>
                {!row.isRead ? <form action={markNotificationReadAction}><input type="hidden" name="notificationId" value={row.notificationId} /><button className="button" type="submit">읽음</button></form> : null}
              </article>
            ))}</div>}
      </div></div>
    </section>
  );
}
