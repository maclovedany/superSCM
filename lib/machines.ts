// 기종 — 조회 (실데이터 전환 Plan 3 · spec §7 /machine-forecast)
//
// ★ 서버 전용. 클라이언트는 타입만 lib/machines-model.ts 에서 가져옵니다.
// 기종의 item_id 는 core.norm_code(model_base) 입니다 (sql/34 §5).

import { createSupabaseServerClient } from './supabase/server';
import {
  normalizeDemandCompare,
  normalizeMachine,
  normalizeMachineBom,
  normalizeMachinePlanActual,
  type DemandCompareRow,
  type MachineBomRow,
  type MachinePlanActualRow,
  type MachineRow,
} from './machines-model';

function failure(error: unknown): string {
  return error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.';
}

/** 기종 목록 — 실적이 있는 기종이 앞에 오도록 v_machine_plan_actual 의 기간 수를 함께 냅니다 */
export async function getMachines(limit = 200): Promise<{ rows: MachineRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const [{ data, error }, { data: act }] = await Promise.all([
      supabase.schema('core').from('v_item_master').select('item_id, item_name, family')
        .eq('is_machine', true).order('item_id', { ascending: true }).limit(limit),
      supabase.schema('analytics').from('v_machine_plan_actual').select('item_id, act').not('act', 'is', null).limit(1000),
    ]);
    if (error) return { rows: [], error: error.message };
    const months = new Map<string, number>();
    for (const row of (act ?? []) as Record<string, unknown>[]) {
      const id = String(row.item_id);
      months.set(id, (months.get(id) ?? 0) + 1);
    }
    const rows = (data ?? [])
      .map((row) => normalizeMachine({ ...(row as Record<string, unknown>), n_actual_months: months.get(String((row as Record<string, unknown>).item_id)) ?? 0 }))
      .sort((a, b) => b.nActualMonths - a.nActualMonths || a.itemId.localeCompare(b.itemId));
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/** 기종 × 월 — 영업 OL · SCM OL · 실적 */
export async function getMachinePlanActual(itemId: string): Promise<{ rows: MachinePlanActualRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics').from('v_machine_plan_actual').select('*')
      .eq('item_id', itemId).order('period', { ascending: true }).limit(200);
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((r) => normalizeMachinePlanActual(r as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/** 기종 → 구성품 — 구성수량 · 기종 예측 합 · 종속수요 합 · 독립 예측 합 */
export async function getMachineBom(machineId: string): Promise<{ rows: MachineBomRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics').from('v_machine_bom_forecast').select('*')
      .eq('machine_id', machineId)
      .order('role', { ascending: true }).order('item_id', { ascending: true }).limit(1000);
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((r) => normalizeMachineBom(r as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/** 품목 × 기간 — 실적 · 독립 예측 · 종속수요 (모델 비교의 종속수요 시리즈) */
export async function getDemandCompare(itemId: string): Promise<{ rows: DemandCompareRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics').from('v_demand_compare').select('*')
      .eq('item_id', itemId).order('period', { ascending: true }).limit(120);
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((r) => normalizeDemandCompare(r as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}
