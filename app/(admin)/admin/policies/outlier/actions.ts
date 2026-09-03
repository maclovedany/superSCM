'use server';

// 이상치 규칙과 수동 제외 — renew.prd 12.3
//
// "프로젝트성 대량 출고 · 반품(음수) · 중복 입력을 학습에서 제외한다.
//  규칙은 core 테이블로 관리하고 코드에 하드코딩하지 않는다."
//
// 여기서 바꾼 것은 다음 예측 실행부터 반영됩니다. 학습 뷰
// (core.v_train_demand · core.v_production_demand)가 core.outlier_exclusion 을
// 직접 보기 때문입니다. 이미 저장된 예측 결과는 바뀌지 않습니다 — 그래서 저장 뒤
// 문구로 "재실행이 필요하다" 고 말합니다.

import { revalidatePath } from 'next/cache';
import { requireAdminOrThrow } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isIsoDate, isOutlierReason } from '@/lib/admin-ops-model';
import type { OutlierExclusionActionState, OutlierRuleActionState } from './state';

/** 규칙 사용/중지 — renew.prd 12.3 */
export async function toggleOutlierRule(
  _prev: OutlierRuleActionState,
  formData: FormData,
): Promise<OutlierRuleActionState> {
  let actor;
  try {
    actor = await requireAdminOrThrow();
  } catch {
    return { error: '관리자 권한이 필요합니다.', message: null };
  }

  const ruleId = Number(String(formData.get('ruleId') ?? '').trim());
  if (!Number.isInteger(ruleId) || ruleId <= 0) {
    return { error: '대상 규칙을 찾을 수 없습니다.', message: null };
  }

  const active = formData.get('active') === 'true';

  try {
    const supabase = await createSupabaseServerClient();

    const { data: before, error: readError } = await supabase
      .schema('core')
      .from('outlier_rule')
      .select('rule_id, rule_type, scope, threshold, active')
      .eq('rule_id', ruleId)
      .maybeSingle();

    if (readError) return { error: `조회에 실패했습니다: ${readError.message}`, message: null };
    if (!before) return { error: `core.outlier_rule 에 ${ruleId} 번 규칙이 없습니다.`, message: null };

    const { error } = await supabase
      .schema('core')
      .from('outlier_rule')
      .update({ active })
      .eq('rule_id', ruleId);

    if (error) return { error: `저장에 실패했습니다: ${error.message}`, message: null };

    await writeAuditLog(actor, {
      action: 'OUTLIER_RULE_TOGGLE',
      targetType: 'core.outlier_rule',
      targetId: String(ruleId),
      before,
      after: { rule_id: ruleId, active },
    });

    revalidatePath('/admin/policies/outlier');
    return {
      error: null,
      message: `${active ? '사용' : '중지'} 로 바꿨습니다. 다음 예측 실행부터 반영됩니다.`,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : '저장에 실패했습니다.', message: null };
  }
}

/**
 * 수동 제외 추가 — 품목 · 날짜 · 사유.
 *
 * 규칙이 잡지 못한 한 건을 사람이 직접 빼는 길입니다. 사유를 반드시 남깁니다 —
 * 나중에 "왜 이 날이 빠졌지" 를 답할 수 있어야 합니다 (renew.prd 31.1).
 */
export async function addOutlierExclusion(
  _prev: OutlierExclusionActionState,
  formData: FormData,
): Promise<OutlierExclusionActionState> {
  let actor;
  try {
    actor = await requireAdminOrThrow();
  } catch {
    return { error: '관리자 권한이 필요합니다.', message: null };
  }

  const itemId = String(formData.get('itemId') ?? '').trim().toUpperCase();
  const useDate = String(formData.get('useDate') ?? '').trim();
  const reasonCode = String(formData.get('reasonCode') ?? '').trim().toUpperCase();
  const note = String(formData.get('note') ?? '').trim() || null;

  if (itemId === '') return { error: '품목 코드를 입력하세요.', message: null };
  if (!isIsoDate(useDate)) return { error: '날짜를 YYYY-MM-DD 로 입력하세요.', message: null };
  if (!isOutlierReason(reasonCode)) {
    return { error: '사유는 반품 · 프로젝트 · 중복 · 수동 중 하나여야 합니다.', message: null };
  }

  try {
    const supabase = await createSupabaseServerClient();

    // 없는 품목 코드를 받아 두면 목록에 아무 수량도 없는 줄만 남습니다.
    // 품목 마스터로 한 번 거릅니다 (lib/import/repository.ts 와 같은 뷰).
    const { data: existing, error: checkError } = await supabase
      .schema('core')
      .from('v_item_master')
      .select('item_id')
      .eq('item_id', itemId)
      .limit(1);

    if (checkError) return { error: `품목 확인에 실패했습니다: ${checkError.message}`, message: null };
    if ((existing ?? []).length === 0) {
      return { error: `${itemId} 은(는) 품목 마스터에 없습니다.`, message: null };
    }

    const { error } = await supabase
      .schema('core')
      .from('outlier_exclusion')
      .upsert(
        {
          item_id: itemId,
          use_date: useDate,
          reason_code: reasonCode,
          note,
          excluded_by: actor.userId,
        },
        { onConflict: 'item_id,use_date,reason_code' },
      );

    if (error) return { error: `저장에 실패했습니다: ${error.message}`, message: null };

    await writeAuditLog(actor, {
      action: 'OUTLIER_EXCLUSION_ADD',
      targetType: 'core.outlier_exclusion',
      targetId: `${itemId}:${useDate}:${reasonCode}`,
      after: { item_id: itemId, use_date: useDate, reason_code: reasonCode, note },
    });

    revalidatePath('/admin/policies/outlier');
    return {
      error: null,
      message: `${itemId} · ${useDate} 를 학습에서 뺐습니다. 다음 예측 실행부터 반영됩니다.`,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : '저장에 실패했습니다.', message: null };
  }
}

/** 수동 제외 되돌리기. 규칙이 만든 제외도 지울 수 있으나, 다음 적재에서 다시 잡힐 수 있습니다 */
export async function removeOutlierExclusion(
  _prev: OutlierExclusionActionState,
  formData: FormData,
): Promise<OutlierExclusionActionState> {
  let actor;
  try {
    actor = await requireAdminOrThrow();
  } catch {
    return { error: '관리자 권한이 필요합니다.', message: null };
  }

  const itemId = String(formData.get('itemId') ?? '').trim();
  const useDate = String(formData.get('useDate') ?? '').trim();
  const reasonCode = String(formData.get('reasonCode') ?? '').trim();

  if (itemId === '' || !isIsoDate(useDate) || reasonCode === '') {
    return { error: '되돌릴 대상을 찾을 수 없습니다.', message: null };
  }

  try {
    const supabase = await createSupabaseServerClient();

    const { error } = await supabase
      .schema('core')
      .from('outlier_exclusion')
      .delete()
      .eq('item_id', itemId)
      .eq('use_date', useDate)
      .eq('reason_code', reasonCode);

    if (error) return { error: `되돌리기에 실패했습니다: ${error.message}`, message: null };

    await writeAuditLog(actor, {
      action: 'OUTLIER_EXCLUSION_REMOVE',
      targetType: 'core.outlier_exclusion',
      targetId: `${itemId}:${useDate}:${reasonCode}`,
      before: { item_id: itemId, use_date: useDate, reason_code: reasonCode },
    });

    revalidatePath('/admin/policies/outlier');
    return { error: null, message: `${itemId} · ${useDate} 를 학습에 되돌렸습니다.` };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : '되돌리기에 실패했습니다.',
      message: null,
    };
  }
}
