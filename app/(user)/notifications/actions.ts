'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { markNotificationRead } from '@/lib/notifications/repository';

export async function markNotificationReadAction(formData: FormData) {
  await requireUser();
  const notificationId = String(formData.get('notificationId') ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(notificationId)) {
    throw new Error('올바른 알림 ID가 필요합니다.');
  }
  const error = await markNotificationRead(notificationId);
  if (error) throw new Error(error);
  if (!error) revalidatePath('/notifications');
}
