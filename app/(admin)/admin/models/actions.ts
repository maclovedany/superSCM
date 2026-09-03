'use server';

// 모델 on/off 와 파라미터 변경 — renew.prd 11.4
//
// "설정 변경은 코드 수정 없이 반영되며 변경 이력을 남긴다."

import { revalidatePath } from 'next/cache';
import { requireAdminOrThrow } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { ModelActionState } from './state';

export async function toggleModel(
  _prev: ModelActionState,
  formData: FormData,
): Promise<ModelActionState> {
  let actor;
  try {
    actor = await requireAdminOrThrow();
  } catch {
    return { error: '관리자 권한이 필요합니다.', message: null };
  }

  const modelId = String(formData.get('modelId') ?? '');
  const enabled = formData.get('enabled') === 'true';
  const rawParameters = String(formData.get('parameters') ?? '').trim();

  if (!modelId) return { error: '대상 모델을 찾을 수 없습니다.', message: null };

  let parameters: unknown;
  if (rawParameters) {
    try {
      parameters = JSON.parse(rawParameters);
    } catch {
      return { error: '파라미터가 올바른 JSON 이 아닙니다. 예: {"window": 3}', message: null };
    }
    if (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters)) {
      return { error: '파라미터는 { } 형태의 객체여야 합니다.', message: null };
    }
  }

  const supabase = await createSupabaseServerClient();

  const { data: before } = await supabase
    .schema('core')
    .from('model_config')
    .select('model_id, enabled, parameters')
    .eq('model_id', modelId)
    .maybeSingle();

  const patch: Record<string, unknown> = { enabled, updated_by: actor.userId };
  if (rawParameters) patch.parameters = parameters;

  const { error } = await supabase
    .schema('core')
    .from('model_config')
    .update(patch)
    .eq('model_id', modelId);

  if (error) return { error: `변경에 실패했습니다: ${error.message}`, message: null };

  await writeAuditLog(actor, {
    action: 'MODEL_CONFIG_UPDATE',
    targetType: 'core.model_config',
    targetId: modelId,
    before: before ?? null,
    after: patch,
  });

  revalidatePath('/admin/models');
  return {
    error: null,
    message: `${modelId} 을(를) ${enabled ? '켰습니다' : '껐습니다'}.`,
  };
}
