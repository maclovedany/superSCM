// 부서별 월간 수요 제출 저장소 — Task 7
//
// ★ 조회는 analytics 뷰만, 변경은 core 명령 함수(RPC)만 쓴다. raw · core 테이블을 직접 읽거나
//   쓰지 않는다.
// ★ 여기서 권한·마감·검증을 판정하지 않는다. 모든 명령 함수가 스스로 로그인 · 업무 권한 ·
//   부서 소유권을 확인한다. 이 파일은 DB 결과와 오류 문구를 그대로 돌려준다.

import { createSupabaseServerClient } from '../supabase/server';
import {
  normalizeDemandSubmissionLineRow,
  normalizeDemandSubmissionRow,
  type DemandSubmission,
  type DemandSubmissionLine,
} from './model';

export type DemandMutationResult<T> = { data: T | null; error: string | null };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export type PlanningCycle = {
  cycleId: string;
  planMonth: string;
  submissionDeadline: string;
  status: string;
  isActive: boolean;
};

function normalizePlanningCycle(row: Record<string, unknown>): PlanningCycle {
  return {
    cycleId: String(row.cycle_id ?? ''),
    planMonth: String(row.plan_month ?? ''),
    submissionDeadline: String(row.submission_deadline ?? ''),
    status: String(row.status ?? ''),
    isActive: row.is_active === true,
  };
}

/** 활성(열린) 취합 주기 목록 — analytics.v_planning_cycle */
export async function getActivePlanningCycles(): Promise<{ rows: PlanningCycle[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_planning_cycle')
      .select('*')
      .eq('is_active', true)
      .order('plan_month', { ascending: false });
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizePlanningCycle(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '취합 주기를 조회하지 못했습니다.') };
  }
}

/** 내 부서(또는 SCM/ADMIN이면 전체) 제출 상태 — analytics.v_demand_submission_status. RLS가 범위를 가른다 */
export async function getDemandSubmissions(): Promise<{ rows: DemandSubmission[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_demand_submission_status')
      .select('*')
      .order('plan_month', { ascending: false })
      .order('department');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeDemandSubmissionRow(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '제출 현황을 조회하지 못했습니다.') };
  }
}

/** 제출본 한 건. 소유 부서가 아니면 RLS가 행을 돌려주지 않아 null */
export async function getDemandSubmission(submissionId: string): Promise<{ submission: DemandSubmission | null; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_demand_submission_status')
      .select('*')
      .eq('submission_id', submissionId)
      .maybeSingle();
    if (error) return { submission: null, error: error.message };
    return { submission: data ? normalizeDemandSubmissionRow(data as Record<string, unknown>) : null, error: null };
  } catch (error) {
    return { submission: null, error: errorMessage(error, '제출본을 조회하지 못했습니다.') };
  }
}

/** 제출본의 라인. 부모 제출본이 RLS로 보이지 않으면 빈 배열 */
export async function getDemandSubmissionLines(submissionId: string): Promise<{ rows: DemandSubmissionLine[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_demand_submission_line')
      .select('*')
      .eq('submission_id', submissionId)
      .order('line_no');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeDemandSubmissionLineRow(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '제출 항목을 조회하지 못했습니다.') };
  }
}

async function callCommand<T>(name: string, args: Record<string, unknown>, fallback: string): Promise<DemandMutationResult<T>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc(name, args);
    if (error) return { data: null, error: error.message };
    return { data: (data ?? null) as T | null, error: null };
  } catch (error) {
    return { data: null, error: errorMessage(error, fallback) };
  }
}

export function openPlanningCycle(input: { planMonth: string }) {
  return callCommand<string>('open_planning_cycle', { p_plan_month: input.planMonth }, '취합 주기를 열지 못했습니다.');
}

export function closePlanningCycle(input: { cycleId: string }) {
  return callCommand<null>('close_planning_cycle', { p_cycle_id: input.cycleId }, '취합 주기를 닫지 못했습니다.');
}

export function startDemandSubmission(input: { planMonth: string }) {
  return callCommand<string>('start_demand_submission', { p_plan_month: input.planMonth }, '수요 작성을 시작하지 못했습니다.');
}

export function saveDemandSubmissionLines(input: {
  submissionId: string;
  lines: Array<{ item_id: string; qty: string; need_month: string }>;
}) {
  return callCommand<Record<string, unknown>>('save_demand_submission_lines', {
    p_submission_id: input.submissionId,
    p_lines: input.lines,
  }, '제출 항목을 저장하지 못했습니다.');
}

export function submitDemandSubmission(input: { submissionId: string }) {
  return callCommand<Record<string, unknown>>('submit_demand_submission', {
    p_submission_id: input.submissionId,
  }, '제출하지 못했습니다.');
}

export function withdrawDemandSubmission(input: { submissionId: string; reason: string }) {
  return callCommand<Record<string, unknown>>('withdraw_demand_submission', {
    p_submission_id: input.submissionId,
    p_reason: input.reason,
  }, '회수하지 못했습니다.');
}

export function agreeDemandSubmission(input: { submissionId: string }) {
  return callCommand<Record<string, unknown>>('agree_demand_submission', {
    p_submission_id: input.submissionId,
  }, '합의를 확정하지 못했습니다.');
}
