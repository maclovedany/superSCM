// 감사 로그 — renew.prd 31.1
//
// 모든 수정과 승인에 근거와 이력이 남아야 합니다.
// 기록에 실패해도 본 작업을 막지는 않되, 실패 사실은 서버 로그에 남깁니다.

import { createSupabaseServerClient } from './supabase/server';
import type { SessionUser } from './auth';

export type AuditEntry = {
  action: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
};

export async function writeAuditLog(actor: SessionUser, entry: AuditEntry): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .schema('core')
      .from('audit_log')
      .insert({
        actor: actor.userId,
        actor_email: actor.email,
        action: entry.action,
        target_type: entry.targetType ?? null,
        target_id: entry.targetId ?? null,
        before: entry.before ?? null,
        after: entry.after ?? null,
      });

    if (error) console.error('[audit] 기록 실패:', error.message, entry.action);
  } catch (error) {
    console.error('[audit] 기록 실패:', error);
  }
}
