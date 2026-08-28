'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type ForecastActionState = { error: string | null; success: string | null };

export async function runBaselineForecastAction(_: ForecastActionState, formData: FormData): Promise<ForecastActionState> {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServerClient();
    const note = String(formData.get('note') ?? '').trim() || null;
    const { data, error } = await supabase.rpc('run_baseline_forecast', { p_note: note });
    if (error) return { error: error.message, success: null };
    revalidatePath('/admin/forecast-runs');
    return { error: null, success: `Forecast 실행을 등록했습니다. Run ID: ${data}` };
  } catch (error) { return { error: error instanceof Error ? error.message : 'Forecast 실행에 실패했습니다.', success: null }; }
}

export async function updateForecastModelAction(_: ForecastActionState, formData: FormData): Promise<ForecastActionState> {
  try {
    const { profile } = await requireAdmin();
    const modelId = String(formData.get('modelId') ?? '');
    const enabled = formData.get('enabled') === 'true';
    if (!modelId) return { error: '모델 ID가 없습니다.', success: null };
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.schema('core').from('model_config').update({ enabled, updated_by: profile.userId }).eq('model_id', modelId);
    if (error) return { error: error.message, success: null };
    revalidatePath('/admin/forecast-models');
    return { error: null, success: `${modelId} 상태를 저장했습니다.` };
  } catch (error) { return { error: error instanceof Error ? error.message : '모델 상태 저장에 실패했습니다.', success: null }; }
}
