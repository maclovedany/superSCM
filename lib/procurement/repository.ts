// 발주계획 저장소 — Task 9b
//
// ★ 조회는 analytics 뷰만, 변경은 core 명령 함수(RPC)만 쓴다. 계산 · 권한 · 확정 가능 여부를 여기서 판정하지
//   않는다 — DB 함수가 스스로 판정한 결과와 오류 문구를 그대로 돌려준다.
// ★ 반려는 공통 승인 엔진(lib/approvals/repository.ts decideApproval)을 그대로 쓴다. 승인만 계획 전용 포장 함수
//   core.approve_procurement_plan을 거쳐 "이 승인 요청이 이 계획의 것인가"를 함께 확인한다.

import { createSupabaseServerClient } from '../supabase/server';
import {
  normalizeConfirmResult,
  normalizeForecastRunOption,
  normalizePlanBlockerRow,
  normalizePlanEventRow,
  normalizePlanKpiRow,
  normalizePlanLineRow,
  normalizePlanRow,
  type ConfirmPlanResult,
  type ForecastRunOption,
  type PlanConfirmBlocker,
  type ProcurementPlan,
  type ProcurementPlanEvent,
  type ProcurementPlanKpi,
  type ProcurementPlanLine,
} from './model';

export type ProcurementMutationResult<T> = { data: T | null; error: string | null };
type Rows<T> = { rows: T[]; error: string | null };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function toRows<T>(data: unknown[] | null, normalize: (row: Record<string, unknown>) => T): T[] {
  return (data ?? []).map((row) => normalize(row as Record<string, unknown>));
}

/** 계획 버전 목록 — 최신 기준월 · 최신 버전 순 */
export async function getProcurementPlans(): Promise<Rows<ProcurementPlan>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_procurement_plan')
      .select('*')
      .order('plan_month', { ascending: false })
      .order('version', { ascending: false });
    if (error) return { rows: [], error: error.message };
    return { rows: toRows(data, normalizePlanRow), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '발주계획을 조회하지 못했습니다.') };
  }
}

export async function getProcurementPlan(planId: string): Promise<{ plan: ProcurementPlan | null; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('analytics').from('v_procurement_plan').select('*').eq('plan_id', planId).maybeSingle();
    if (error) return { plan: null, error: error.message };
    return { plan: data ? normalizePlanRow(data as Record<string, unknown>) : null, error: null };
  } catch (error) {
    return { plan: null, error: errorMessage(error, '발주계획을 조회하지 못했습니다.') };
  }
}

export async function getProcurementPlanLines(planId: string): Promise<Rows<ProcurementPlanLine>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_procurement_plan_line')
      .select('*')
      .eq('plan_id', planId)
      .order('item_id')
      .order('month_no');
    if (error) return { rows: [], error: error.message };
    return { rows: toRows(data, normalizePlanLineRow), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '발주계획 라인을 조회하지 못했습니다.') };
  }
}

export async function getProcurementPlanKpis(planId: string): Promise<Rows<ProcurementPlanKpi>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_procurement_plan_kpi')
      .select('*')
      .eq('plan_id', planId)
      .order('month_no');
    if (error) return { rows: [], error: error.message };
    return { rows: toRows(data, normalizePlanKpiRow), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '발주계획 KPI를 조회하지 못했습니다.') };
  }
}

/** 확정 차단 사유 — core.confirm_procurement_plan이 읽는 것과 같은 뷰 */
export async function getProcurementPlanBlockers(planId: string): Promise<Rows<PlanConfirmBlocker>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_procurement_plan_blocker')
      .select('*')
      .eq('plan_id', planId)
      .order('reason_rank')
      .order('reason_code');
    if (error) return { rows: [], error: error.message };
    return { rows: toRows(data, normalizePlanBlockerRow), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '확정 차단 사유를 조회하지 못했습니다.') };
  }
}

export async function getProcurementPlanEvents(planId: string): Promise<Rows<ProcurementPlanEvent>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_procurement_plan_event')
      .select('*')
      .eq('plan_id', planId)
      .order('at', { ascending: false })
      .order('event_id', { ascending: false });
    if (error) return { rows: [], error: error.message };
    return { rows: toRows(data, normalizePlanEventRow), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '발주계획 이력을 조회하지 못했습니다.') };
  }
}

/** 계획 생성 폼의 Forecast Run 선택지 — 성공한 실행만 */
export async function getForecastRunOptions(): Promise<Rows<ForecastRunOption>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_forecast_run')
      .select('*')
      .eq('status', 'SUCCESS')
      .order('finished_at', { ascending: false })
      .limit(20);
    if (error) return { rows: [], error: error.message };
    return { rows: toRows(data, normalizeForecastRunOption), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, 'Forecast Run을 조회하지 못했습니다.') };
  }
}

/** SCM 품목담당자(PLAN_CONFIRM) — 기준월 발주계획 새 버전 계산. 새 계획 ID를 돌려준다 */
export async function buildProcurementPlan(input: { planMonth: string; forecastRunId: string | null }): Promise<ProcurementMutationResult<string>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('build_procurement_plan', {
      p_plan_month: input.planMonth,
      p_forecast_run_id: input.forecastRunId,
    });
    if (error) return { data: null, error: error.message };
    return { data: data ? String(data) : null, error: null };
  } catch (error) {
    return { data: null, error: errorMessage(error, '발주계획을 계산하지 못했습니다.') };
  }
}

/** SCM 품목담당자(PLAN_CONFIRM) — 확정. 막히면 DB가 판정한 차단 사유를 그대로 돌려준다 */
export async function confirmProcurementPlan(planId: string): Promise<ProcurementMutationResult<ConfirmPlanResult>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('confirm_procurement_plan', { p_plan_id: planId });
    if (error) return { data: null, error: error.message };
    return { data: normalizeConfirmResult(data), error: null };
  } catch (error) {
    return { data: null, error: errorMessage(error, '발주계획을 확정하지 못했습니다.') };
  }
}

/** SCM팀장(PLAN_APPROVE) — 승인. 요청자 ≠ 승인자 · 권한은 core.decide_approval이 판정한다 */
export async function approveProcurementPlan(input: { planId: string; approvalId: string; comment: string | null }): Promise<ProcurementMutationResult<string>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('approve_procurement_plan', {
      p_plan_id: input.planId,
      p_approval_id: input.approvalId,
      p_comment: input.comment,
    });
    if (error) return { data: null, error: error.message };
    return { data: data ? String(data) : null, error: null };
  } catch (error) {
    return { data: null, error: errorMessage(error, '발주계획을 승인하지 못했습니다.') };
  }
}
