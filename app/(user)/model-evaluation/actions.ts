'use server';

// 백테스트 실행과 Champion 수동 지정 — renew.prd 13장 · 14.3

import { revalidatePath } from 'next/cache';
import { requireAdminOrThrow } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { BacktestState } from './state';

export async function runBacktest(
  _prev: BacktestState,
  formData: FormData,
): Promise<BacktestState> {
  let actor;
  try {
    actor = await requireAdminOrThrow();
  } catch {
    return { error: '관리자 권한이 필요합니다.', message: null };
  }

  const note = String(formData.get('note') ?? '').trim() || null;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('run_backtest', {
      p_forecast_run_id: null,
      p_note: note,
    });

    if (error) return { error: `채점에 실패했습니다: ${error.message}`, message: null };

    const row = (Array.isArray(data) ? data[0] : data) as
      | { backtest_run_id?: string; n_models?: number; n_items?: number; n_rows?: number; message?: string }
      | null;

    const rows = Number(row?.n_rows ?? 0);
    if (rows === 0) {
      return {
        error:
          row?.message ??
          '채점할 결과가 없습니다. 예측 기간과 검증 구간이 겹치는지 확인해주세요.',
        message: null,
      };
    }

    await writeAuditLog(actor, {
      action: 'BACKTEST_RUN',
      targetType: 'core.backtest_run',
      targetId: row?.backtest_run_id ?? '',
      after: { models: row?.n_models, items: row?.n_items, rows },
    });

    revalidatePath('/model-evaluation');
    revalidatePath('/model-comparison');
    return {
      error: null,
      message: `${row?.backtest_run_id} · 모델 ${row?.n_models}종 · 품목 ${row?.n_items}개 · ${rows.toLocaleString()}건을 채점했습니다.`,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : '채점에 실패했습니다.', message: null };
  }
}

/**
 * Champion 수동 지정 — renew.prd 14.3
 *
 * "성능이 조금 낮아도 설명 가능성 때문에 단순 모델을 택할 수 있으며, 사유를 필수로 남긴다."
 */
export async function setChampion(
  _prev: BacktestState,
  formData: FormData,
): Promise<BacktestState> {
  let actor;
  try {
    actor = await requireAdminOrThrow();
  } catch {
    return { error: '관리자 권한이 필요합니다.', message: null };
  }

  const itemId = String(formData.get('itemId') ?? '');
  const modelId = String(formData.get('modelId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();

  if (!itemId || !modelId) return { error: '품목과 모델을 확인해주세요.', message: null };
  if (!reason) return { error: '사유를 반드시 입력해야 합니다.', message: null };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.schema('core').rpc('set_champion_manual', {
    p_item_id: itemId,
    p_model_id: modelId,
    p_reason: reason,
  });

  if (error) return { error: `지정에 실패했습니다: ${error.message}`, message: null };

  const row = (Array.isArray(data) ? data[0] : data) as { ok?: boolean; message?: string } | null;
  if (row?.ok !== true) return { error: row?.message ?? '지정하지 못했습니다.', message: null };

  await writeAuditLog(actor, {
    action: 'CHAMPION_MANUAL',
    targetType: 'core.champion_model',
    targetId: itemId,
    after: { model_id: modelId, reason },
  });

  revalidatePath('/model-comparison');
  revalidatePath('/model-evaluation');
  return { error: null, message: row?.message ?? '지정했습니다.' };
}
