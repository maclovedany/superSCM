'use server';

// 계획 리드타임 확정과 해제 — renew.prd 18.3 · 11.4
//
// "확정값이 있으면 그 값, 없으면 실적 P80. 이 값을 변경하면 코드 수정 없이
//  모든 판정이 즉시 반영되어야 한다."
//
// 값은 core.set_leadtime_plan() 이 바꿉니다. 사유가 없으면 함수가 거부하고,
// 전/후 값이 core.leadtime_plan_history 에 남습니다.

import { revalidatePath } from 'next/cache';
import { requireAdminOrThrow } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { LeadtimeActionState } from './state';

export async function saveLeadtimePlan(
  _prev: LeadtimeActionState,
  formData: FormData,
): Promise<LeadtimeActionState> {
  let actor;
  try {
    actor = await requireAdminOrThrow();
  } catch {
    return { error: '관리자 권한이 필요합니다.', message: null };
  }

  const supplierId = String(formData.get('supplierId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  const release = formData.get('intent') === 'RELEASE';
  const rawValue = String(formData.get('plannedLeadTime') ?? '').trim();

  if (!supplierId) return { error: '대상 공급처를 찾을 수 없습니다.', message: null };
  if (!reason) return { error: '사유를 반드시 입력해야 합니다.', message: null };

  let plannedLeadTime: number | null = null;

  if (!release) {
    if (!rawValue) return { error: '리드타임 일수를 입력해주세요.', message: null };
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
      return { error: '리드타임은 1 이상의 정수여야 합니다.', message: null };
    }
    plannedLeadTime = parsed;
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('set_leadtime_plan', {
      p_supplier_id: supplierId,
      p_planned_lead_time: plannedLeadTime,
      p_reason: reason,
    });

    if (error) return { error: `저장에 실패했습니다: ${error.message}`, message: null };

    const row = (Array.isArray(data) ? data[0] : data) as
      | { ok?: boolean; message?: string }
      | null;

    if (row?.ok !== true) return { error: row?.message ?? '저장하지 못했습니다.', message: null };

    await writeAuditLog(actor, {
      action: 'LEADTIME_PLAN_SET',
      targetType: 'core.leadtime_plan',
      targetId: supplierId,
      after: { planned_lead_time: plannedLeadTime, reason },
    });

    // 리드타임을 바꾸면 결품 판정이 즉시 달라집니다. 관련 화면을 함께 갱신합니다.
    revalidatePath('/admin/policies/leadtime');
    revalidatePath('/analysis/stockout');
    revalidatePath('/inventory-projection');

    return { error: null, message: row?.message ?? '저장했습니다.' };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : '저장에 실패했습니다.',
      message: null,
    };
  }
}
