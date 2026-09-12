// 월말 재고 성과 · 운영 기준월 · 대시보드 요약 저장소 — Task 12
//
// ★ 조회는 analytics 뷰만 쓴다(SCHEMA.md). 계산은 하지 않는다 — DB가 이미 계산해 둔 값을
//   그대로 옮긴다.
// ★ 대시보드 요약(getDashboardSummary)은 새 집계 뷰를 만들지 않는다. Task 5·6·7·8·9b가 이미
//   만든 analytics 뷰(v_demand_submission_status · v_my_approval_inbox · v_allocation_queue ·
//   v_procurement_plan)를 그대로 다시 읽고, 화면(app/(user)/dashboard/page.tsx)은 이 저장소가
//   돌려준 값을 그대로 보여주기만 한다 — 화면은 집계하지 않는다(컨트롤러 판정 4). 여기서 하는
//   일은 "그 뷰가 이미 계산해 둔 상태 값"의 건수를 세는 것뿐이며, 평균 · 비율 같은 새 계산은
//   하지 않는다.

import { getMyApprovalInbox } from '../approvals/repository';
import { getDemandSubmissions } from '../demand/repository';
import { getAllocationQueue } from '../orders/repository';
import { getProcurementPlans } from '../procurement/repository';
import { createSupabaseServerClient } from '../supabase/server';
import {
  normalizeCurrentPlanningCycle,
  normalizeInventoryPerformanceKpiRow,
  normalizeInventoryPerformanceRow,
  resolveBaseMonthDisplay,
  type CurrentPlanningCycle,
  type InventoryPerformanceKpi,
  type InventoryPerformanceRow,
} from './model';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** 운영 기준월과 취합 주기 상태 — analytics.v_current_planning_cycle(항상 1행) */
export async function getCurrentPlanningCycle(): Promise<{ cycle: CurrentPlanningCycle | null; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('analytics').from('v_current_planning_cycle').select('*').maybeSingle();
    if (error) return { cycle: null, error: error.message };
    return { cycle: data ? normalizeCurrentPlanningCycle(data as Record<string, unknown>) : null, error: null };
  } catch (error) {
    return { cycle: null, error: errorMessage(error, '운영 기준월을 조회하지 못했습니다.') };
  }
}

/** 기준월의 월말 재고 성과(품목별) — analytics.v_inventory_performance. STOCK_VIEW_ALL이 없으면 RLS로 0행 */
export async function getInventoryPerformance(planMonth: string | null): Promise<{ rows: InventoryPerformanceRow[]; error: string | null }> {
  if (planMonth === null) return { rows: [], error: null };
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_inventory_performance')
      .select('*')
      .eq('plan_month', planMonth)
      .order('item_id');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeInventoryPerformanceRow(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '월말 재고 성과를 조회하지 못했습니다.') };
  }
}

/** 기준월의 월말 재고 성과 요약 — analytics.v_inventory_performance_kpi(그 달에 표시할 품목이 있으면 1행) */
export async function getInventoryPerformanceKpi(planMonth: string | null): Promise<{ kpi: InventoryPerformanceKpi | null; error: string | null }> {
  if (planMonth === null) return { kpi: null, error: null };
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_inventory_performance_kpi')
      .select('*')
      .eq('plan_month', planMonth)
      .maybeSingle();
    if (error) return { kpi: null, error: error.message };
    return { kpi: data ? normalizeInventoryPerformanceKpiRow(data as Record<string, unknown>) : null, error: null };
  } catch (error) {
    return { kpi: null, error: errorMessage(error, '월말 재고 성과 요약을 조회하지 못했습니다.') };
  }
}

export type DashboardSummary = {
  baseMonth: string | null;
  planningCycleStatus: string | null;
  planningCycleReasonCode: string | null;
  /** analytics.v_demand_submission_status 중 이 기준월 행 — RLS가 이미 조회 범위(본인 부서 또는 SCM 전체)를 가른다 */
  demandTotalCount: number;
  demandSubmittedCount: number;
  demandAgreedCount: number;
  /** analytics.v_my_approval_inbox — 로그인한 사용자가 처리할 수 있는 PENDING 승인 건수 */
  pendingApprovalCount: number;
  /** analytics.v_allocation_queue 중 shortage_qty > 0인 품목 수(중복 제거) */
  allocationShortageItemCount: number;
  /** analytics.v_procurement_plan 중 이 기준월의 최신 버전 */
  procurementPlanStatus: string | null;
  procurementPlanConfirmable: boolean;
  procurementPlanIsFinal: boolean;
  error: string | null;
};

/**
 * 대시보드 KPI 카드 4종 — 수요 제출 상태 · 승인 대기 · 배정 부족 · 발주계획 상태.
 *
 * ★ 각 값은 그 도메인의 analytics 뷰가 이미 계산해 둔 상태(status · shortage_qty 등)를 세거나
 *   고르기만 한다 — 여기서 새로 평균 내거나 비율을 만들지 않는다(컨트롤러 판정 4).
 * ★ fix round 1(리뷰 반영) — planningCycleReasonCode는 resolveBaseMonthDisplay로 판정한다.
 *   cycleError를 그냥 버리면(예전 코드처럼 cycle?.reasonCode만 보면) 조회 실패가
 *   PLANNING_CYCLE_NOT_OPEN(업무 상태)으로 둔갑한다 — error 자체는 summary.error에도 그대로
 *   남아 InsightBanner가 보여주지만, 기준월 KPI 카드도 같은 시스템 오류임을 스스로 알 수 있어야
 *   한다(카드 하나만 보고도 "조회 실패"와 "취합 주기 없음"을 구분할 수 있어야 한다).
 */
export async function getDashboardSummary(): Promise<DashboardSummary> {
  const { cycle, error: cycleError } = await getCurrentPlanningCycle();
  const baseMonthDisplay = resolveBaseMonthDisplay(cycle, cycleError);
  const baseMonth = baseMonthDisplay.planMonth;

  const [demand, approvals, allocations, plans] = await Promise.all([
    getDemandSubmissions(),
    getMyApprovalInbox(),
    getAllocationQueue(),
    getProcurementPlans(),
  ]);

  const demandForMonth = baseMonth === null ? [] : demand.rows.filter((row) => row.planMonth === baseMonth);
  const shortageItemIds = new Set(
    allocations.rows.filter((row) => (row.shortageQty ?? 0) > 0).map((row) => row.itemId),
  );
  const planForMonth =
    baseMonth === null ? null : plans.rows.find((plan) => plan.planMonth === baseMonth && plan.isLatestVersion) ?? null;

  const firstError = cycleError ?? demand.error ?? approvals.error ?? allocations.error ?? plans.error;

  return {
    baseMonth,
    planningCycleStatus: cycle?.status ?? null,
    planningCycleReasonCode: baseMonthDisplay.reasonCode,
    demandTotalCount: demandForMonth.length,
    demandSubmittedCount: demandForMonth.filter((row) => row.status === 'SUBMITTED' || row.status === 'AGREED').length,
    demandAgreedCount: demandForMonth.filter((row) => row.status === 'AGREED').length,
    pendingApprovalCount: approvals.rows.length,
    allocationShortageItemCount: shortageItemIds.size,
    procurementPlanStatus: planForMonth?.status ?? null,
    procurementPlanConfirmable: planForMonth?.confirmable ?? false,
    procurementPlanIsFinal: planForMonth?.isFinal ?? false,
    error: firstError ?? null,
  };
}
