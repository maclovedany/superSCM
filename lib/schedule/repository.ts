// 발주 일정 · 입고 차이 저장소 — Task 10b
//
// ★ 조회는 analytics 뷰만, 변경은 core 명령 함수(RPC)만 쓴다. 계산 · 권한 · 계산 가능 여부를 여기서
//   판정하지 않는다 — DB 함수가 스스로 판정한 결과와 오류 문구를 그대로 돌려준다.

import { createSupabaseServerClient } from '../supabase/server';
import {
  normalizeReceiptGapEntityRow,
  normalizeReceiptGapItemRow,
  normalizeReceiptGapMonthRow,
  normalizeScheduleRow,
  type ProcurementScheduleRow,
  type ReceiptGapEntityRow,
  type ReceiptGapItemRow,
  type ReceiptGapMonthRow,
} from './model';

export type ScheduleMutationResult<T> = { data: T | null; error: string | null };
type Rows<T> = { rows: T[]; error: string | null };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function toRows<T>(data: unknown[] | null, normalize: (row: Record<string, unknown>) => T): T[] {
  return (data ?? []).map((row) => normalize(row as Record<string, unknown>));
}

/**
 * 발주 일정 전체 — 기준월 · 묶음(ISO 주차) · 품목 순.
 *
 * ★ fix round 1 — 이 달의 더 최신 승인본이 대체한(superseded_at이 있는) 행은 뺀다. 그러지 않으면 같은
 *   달을 새 승인본으로 다시 만들 때마다 옛 행이 화면에 그대로 쌓여 같은 품목이 중복돼 보인다 — "지금
 *   유효한 일정"만 이 목록의 몫이다(옛 행 자체는 core에 남아 있으니 데이터를 잃지 않는다).
 */
export async function getProcurementSchedules(): Promise<Rows<ProcurementScheduleRow>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_procurement_schedule')
      .select('*')
      .is('superseded_at', null)
      .order('plan_month', { ascending: false })
      .order('bundle_key', { ascending: true, nullsFirst: false })
      .order('item_id');
    if (error) return { rows: [], error: error.message };
    return { rows: toRows(data, normalizeScheduleRow), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '발주 일정을 조회하지 못했습니다.') };
  }
}

export async function getProcurementScheduleByPlan(planId: string): Promise<Rows<ProcurementScheduleRow>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_procurement_schedule')
      .select('*')
      .eq('plan_id', planId)
      .order('item_id');
    if (error) return { rows: [], error: error.message };
    return { rows: toRows(data, normalizeScheduleRow), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '발주 일정을 조회하지 못했습니다.') };
  }
}

export type ApprovedPlanOption = { planId: string; planMonth: string; version: number };

function normalizeApprovedPlanOption(row: Record<string, unknown>): ApprovedPlanOption {
  return {
    planId: String(row.plan_id ?? ''),
    planMonth: String(row.plan_month ?? ''),
    version: Number(row.version ?? 0),
  };
}

/** 일정 생성 폼의 선택지 — 각 월의 최신 승인본만(브리프 규칙: 최신 승인 계획만 대상) */
export async function getApprovedPlanOptions(): Promise<Rows<ApprovedPlanOption>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_procurement_plan')
      .select('plan_id, plan_month, version')
      .eq('is_latest_approved', true)
      .order('plan_month', { ascending: false });
    if (error) return { rows: [], error: error.message };
    return { rows: toRows(data, normalizeApprovedPlanOption), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '승인된 발주계획을 조회하지 못했습니다.') };
  }
}

export type BuildScheduleSummary = { scheduleId: string; itemId: string; calculationStatus: string; reasonCode: string | null };

/** SCM 품목담당자(PLAN_CONFIRM) — 승인된 계획의 발주 일정을 만든다(재실행해도 안전) */
export async function buildProcurementSchedule(planId: string): Promise<ScheduleMutationResult<BuildScheduleSummary[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('build_procurement_schedule', { p_plan_id: planId });
    if (error) return { data: null, error: error.message };
    const rows = (Array.isArray(data) ? data : []).map((row) => {
      const record = row as Record<string, unknown>;
      return {
        scheduleId: String(record.schedule_id ?? ''),
        itemId: String(record.item_id ?? ''),
        calculationStatus: String(record.calculation_status ?? ''),
        reasonCode: record.reason_code === null || record.reason_code === undefined ? null : String(record.reason_code),
      };
    });
    return { data: rows, error: null };
  } catch (error) {
    return { data: null, error: errorMessage(error, '발주 일정을 만들지 못했습니다.') };
  }
}

/** SCM 품목담당자(PLAN_CONFIRM) — 실제 입고일 입력 · 수정(null이면 지운다) */
export async function recordActualReceiptDate(input: {
  scheduleId: string;
  actualReceiptDate: string | null;
  note: string | null;
}): Promise<ScheduleMutationResult<true>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.schema('core').rpc('record_actual_receipt_date', {
      p_schedule_id: input.scheduleId,
      p_actual_receipt_date: input.actualReceiptDate,
      p_note: input.note,
    });
    if (error) return { data: null, error: error.message };
    return { data: true, error: null };
  } catch (error) {
    return { data: null, error: errorMessage(error, '실제 입고일을 저장하지 못했습니다.') };
  }
}

export async function getReceiptGapByEntity(): Promise<Rows<ReceiptGapEntityRow>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('analytics').from('v_receipt_gap_entity').select('*').order('entity_id');
    if (error) return { rows: [], error: error.message };
    return { rows: toRows(data, normalizeReceiptGapEntityRow), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '법인별 입고 차이를 조회하지 못했습니다.') };
  }
}

export async function getReceiptGapByItem(): Promise<Rows<ReceiptGapItemRow>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('analytics').from('v_receipt_gap_item').select('*').order('item_id');
    if (error) return { rows: [], error: error.message };
    return { rows: toRows(data, normalizeReceiptGapItemRow), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '품목별 입고 차이를 조회하지 못했습니다.') };
  }
}

export async function getReceiptGapByMonth(): Promise<Rows<ReceiptGapMonthRow>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('analytics').from('v_receipt_gap_month').select('*').order('target_month');
    if (error) return { rows: [], error: error.message };
    return { rows: toRows(data, normalizeReceiptGapMonthRow), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '월별 입고 차이를 조회하지 못했습니다.') };
  }
}
