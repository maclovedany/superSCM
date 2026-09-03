'use server';

// 가상 운영 결과 실행 — renew.prd 13.2
//
// 권한은 서버에서 먼저 막습니다 (AGENTS.md 규칙 8).
// DB 의 core.run_virtual_operation() 도 첫 줄에서 core.is_admin() 을 다시 봅니다.

import { revalidatePath } from 'next/cache';
import { requireAdminOrThrow } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { SimulationState } from './state';

export async function runVirtualOperation(
  _prev: SimulationState,
  formData: FormData,
): Promise<SimulationState> {
  let actor;
  try {
    actor = await requireAdminOrThrow();
  } catch {
    return { error: '관리자 권한이 필요합니다.', message: null };
  }

  const note = String(formData.get('note') ?? '').trim() || null;
  const runId = String(formData.get('forecastRunId') ?? '').trim() || null;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('run_virtual_operation', {
      p_forecast_run_id: runId,
      p_note: note,
    });

    if (error) return { error: `시뮬레이션에 실패했습니다: ${error.message}`, message: null };

    const row = (Array.isArray(data) ? data[0] : data) as
      | { simulation_id?: string; n_items?: number; message?: string }
      | null;

    const items = Number(row?.n_items ?? 0);
    if (items === 0) {
      return {
        error:
          row?.message ??
          '시뮬레이션할 품목이 없습니다. 예측을 먼저 실행하고 리드타임·재고가 채워졌는지 확인해주세요.',
        message: null,
      };
    }

    await writeAuditLog(actor, {
      action: 'VIRTUAL_OPERATION_RUN',
      targetType: 'core.simulation_run',
      targetId: row?.simulation_id ?? '',
      after: { items, forecast_run_id: runId },
    });

    revalidatePath('/virtual-operation');
    return {
      error: null,
      message: `${row?.simulation_id} · ${row?.message ?? `품목 ${items}개를 시뮬레이션했습니다.`}`,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : '시뮬레이션에 실패했습니다.',
      message: null,
    };
  }
}
