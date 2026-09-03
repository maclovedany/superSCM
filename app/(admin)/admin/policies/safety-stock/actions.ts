'use server';

// 공통 정책값 저장 — renew.prd 32장 · 11.4
//
// "정책값(리드타임 · 서비스 수준 · 여유일 등)을 코드에 하드코딩하지 않는다."
// 이 표를 바꾸면 SQL 뷰가 즉시 다른 값을 내고, 화면 코드는 한 줄도 바뀌지 않습니다.
//
// 전/후 값을 감사 로그에 남깁니다. 판정이 달라진 이유를 나중에 찾을 수 있어야 합니다.

import { revalidatePath } from 'next/cache';
import { requireAdminOrThrow } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isEditablePolicyKey, type PolicyConfigActionState } from './state';

export async function savePolicyConfig(
  _prev: PolicyConfigActionState,
  formData: FormData,
): Promise<PolicyConfigActionState> {
  let actor;
  try {
    actor = await requireAdminOrThrow();
  } catch {
    return { error: '관리자 권한이 필요합니다.', message: null };
  }

  const key = String(formData.get('key') ?? '').trim();
  if (!isEditablePolicyKey(key)) {
    return { error: '이 화면에서 고칠 수 있는 정책값이 아닙니다.', message: null };
  }

  const raw = String(formData.get('valueNum') ?? '').trim();
  if (!raw) {
    // 값을 비우면 뷰가 산출 불가로 떨어집니다. 실수로 지우는 일을 막습니다.
    return { error: '값을 비울 수 없습니다. 비우면 판정이 통째로 멈춥니다.', message: null };
  }

  const valueNum = Number(raw);
  if (!Number.isFinite(valueNum) || valueNum < 0) {
    return { error: '정책값은 0 이상의 숫자여야 합니다.', message: null };
  }

  try {
    const supabase = await createSupabaseServerClient();

    const { data: before, error: readError } = await supabase
      .schema('core')
      .from('policy_config')
      .select('key, value_num, unit, description')
      .eq('key', key)
      .maybeSingle();

    if (readError) return { error: `조회에 실패했습니다: ${readError.message}`, message: null };
    if (!before) return { error: `core.policy_config 에 ${key} 행이 없습니다.`, message: null };

    const { error } = await supabase
      .schema('core')
      .from('policy_config')
      .update({ value_num: valueNum, updated_by: actor.userId, updated_at: new Date().toISOString() })
      .eq('key', key);

    if (error) return { error: `저장에 실패했습니다: ${error.message}`, message: null };

    await writeAuditLog(actor, {
      action: 'POLICY_CONFIG_SET',
      targetType: 'core.policy_config',
      targetId: key,
      before,
      after: { key, value_num: valueNum },
    });

    // 정책값은 결품 판정 · 안전재고 · 발주 추천에 함께 들어갑니다.
    revalidatePath('/admin/policies/safety-stock');
    revalidatePath('/admin/policies/service-level');
    revalidatePath('/purchase-recommendation');
    revalidatePath('/analysis/stockout');
    revalidatePath('/inventory-projection');

    return { error: null, message: `${key} 를 ${valueNum} 로 저장했습니다.` };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : '저장에 실패했습니다.',
      message: null,
    };
  }
}
