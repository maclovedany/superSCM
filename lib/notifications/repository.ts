import { createSupabaseServerClient } from '../supabase/server';
import { normalizeDeliveryRow, normalizeNotificationRow, type NotificationDeliveryRow, type NotificationRow } from './types';

export async function getMyNotifications(): Promise<{ rows: NotificationRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('analytics').from('v_my_notification').select('*').order('created_at', { ascending: false });
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeNotificationRow(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : '알림을 조회하지 못했습니다.' };
  }
}

export async function markNotificationRead(notificationId: string): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.schema('core').rpc('mark_notification_read', { p_notification_id: notificationId });
    return error?.message ?? null;
  } catch (error) {
    return error instanceof Error ? error.message : '알림 읽음 처리에 실패했습니다.';
  }
}

export async function getNotificationDeliveries(): Promise<{ rows: NotificationDeliveryRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('analytics').from('v_notification_delivery').select('*').order('attempted_at', { ascending: false }).limit(500);
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeDeliveryRow(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : '알림 발송 이력을 조회하지 못했습니다.' };
  }
}
