'use server';

// 알림 수동 스캔과 확인 — renew.prd 24.2 · 24.4
//
// 권한 규칙 (공통규칙 §3-4)
//   scanAlertsNow    관리자 전용   → requireAdminOrThrow()
//   acknowledgeAlert 로그인 사용자 → getSessionUser()
//
// requireUser() 는 redirect() 를 던지므로(NEXT_REDIRECT) 액션의 try/catch 가 삼킵니다.
// 액션에서는 쓰지 않습니다.

import { revalidatePath } from 'next/cache';
import { getSessionUser, requireAdminOrThrow } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { AlertActionState } from './state';

/**
 * 지금 스캔 — 관리자만.
 *
 * p_secret 없이 부릅니다. core.scan_alerts 는 core.is_admin() 으로 통과시킵니다.
 * 비밀값은 로그인 세션이 없는 스케줄러만 씁니다 (app/api/cron/scan-alerts).
 */
export async function scanAlertsNow(
  _prev: AlertActionState,
  _formData: FormData,
): Promise<AlertActionState> {
  let actor;
  try {
    actor = await requireAdminOrThrow();
  } catch {
    return { error: '관리자 권한이 필요합니다.', message: null };
  }

  try {
    const supabase = await createSupabaseServerClient();
    // p_secret 을 null 로 넘깁니다. 함수는 `p_secret is not null` 일 때만 비밀값을 보므로
    // null 은 "비밀값 없이 왔다" 이고, core.is_admin() 이 유일한 문이 됩니다.
    // 키를 아예 빼면 PostgREST 가 기본값으로 함수를 찾아야 하는데, 이렇게 두면 시그니처가 하나로 정해집니다.
    const { data, error } = await supabase
      .schema('core')
      .rpc('scan_alerts', { p_secret: null });

    if (error) return { error: `스캔에 실패했습니다: ${error.message}`, message: null };

    const row = (Array.isArray(data) ? data[0] : data) as
      | { n_new?: number; n_updated?: number; n_resolved?: number; message?: string }
      | null;

    // 스캔은 특정 알림 하나를 건드리는 게 아니라 전체를 훑습니다. 그래서 식별자는
    // 실행 시각으로 둡니다 — 감사 로그에서 "어느 스캔이었나" 를 되짚을 수 있는 값입니다.
    const scannedAt = new Date().toISOString();

    await writeAuditLog(actor, {
      action: 'ALERT_SCAN',
      targetType: 'core.alert',
      targetId: `scan:${scannedAt}`,
      after: {
        scanned_at: scannedAt,
        n_new: row?.n_new,
        n_updated: row?.n_updated,
        n_resolved: row?.n_resolved,
        message: row?.message,
      },
    });

    revalidatePath('/alerts');
    revalidatePath('/dashboard');
    return { error: null, message: row?.message ?? '알림 스캔을 실행했습니다.' };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : '스캔에 실패했습니다.',
      message: null,
    };
  }
}

/**
 * 알림 확인 — renew.prd 24.2 의 acknowledged_by.
 *
 * 담당자(USER)도 확인할 수 있어야 하므로 관리자 검사를 하지 않습니다.
 * 확인자는 DB 함수가 auth.uid() 로 직접 채웁니다.
 */
export async function acknowledgeAlert(
  _prev: AlertActionState,
  formData: FormData,
): Promise<AlertActionState> {
  const user = await getSessionUser();
  if (!user) return { error: '로그인이 필요합니다.', message: null };

  const raw = String(formData.get('alertId') ?? '').trim();
  const alertId = Number(raw);
  if (!raw || !Number.isFinite(alertId)) {
    return { error: '알림을 확인할 수 없습니다.', message: null };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('core')
      .rpc('acknowledge_alert', { p_alert_id: alertId });

    if (error) return { error: `확인에 실패했습니다: ${error.message}`, message: null };

    const row = (Array.isArray(data) ? data[0] : data) as
      | { ok?: boolean; message?: string }
      | null;

    if (row?.ok !== true) return { error: row?.message ?? '확인하지 못했습니다.', message: null };

    await writeAuditLog(user, {
      action: 'ALERT_ACKNOWLEDGE',
      targetType: 'core.alert',
      targetId: String(alertId),
      after: { acknowledged: true },
    });

    revalidatePath('/alerts');
    return { error: null, message: row?.message ?? '확인 처리했습니다.' };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : '확인에 실패했습니다.',
      message: null,
    };
  }
}
