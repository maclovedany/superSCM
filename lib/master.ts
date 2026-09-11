// Phase 1 마스터 조회 — 화면이 쓰는 유일한 통로입니다.
//
// ★ analytics 뷰만 읽습니다. core 를 직접 읽지 않습니다.
// ★ 예외를 던지지 않고 { rows, error } 로 돌려줍니다.

import { createSupabaseServerClient } from './supabase';
import {
  normalizeCalendarReadiness,
  normalizeItemPolicy,
  normalizeMasterHistoryEntry,
  normalizeMasterReadiness,
  normalizeSupplier,
  normalizeSupplierDeparture,
  normalizeSupplyEntity,
  type CalendarReadiness,
  type ItemPolicy,
  type MasterHistoryEntry,
  type MasterReadiness,
  type Supplier,
  type SupplierDeparture,
  type SupplyEntity,
} from './master-model';

export async function getSupplyEntities(): Promise<{ rows: SupplyEntity[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('analytics').from('v_supply_entity').select('*').order('entity_id');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeSupplyEntity(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : '해외법인을 조회하지 못했습니다.' };
  }
}

export async function getSuppliers(): Promise<{ rows: Supplier[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('analytics').from('v_supplier').select('*').order('supplier_id');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeSupplier(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : '공급처를 조회하지 못했습니다.' };
  }
}

export async function getSupplierDepartures(): Promise<{ rows: SupplierDeparture[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_supplier_departure')
      .select('*')
      .order('supplier_id')
      .order('departure_id');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeSupplierDeparture(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : '출항일 규칙을 조회하지 못했습니다.' };
  }
}

export async function getItemPolicies(): Promise<{ rows: ItemPolicy[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('analytics').from('v_item_policy').select('*').order('item_id');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeItemPolicy(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : '품목 정책을 조회하지 못했습니다.' };
  }
}

export async function getMasterReadiness(): Promise<{ data: MasterReadiness | null; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('analytics').from('v_master_readiness').select('*').maybeSingle();
    if (error) return { data: null, error: error.message };
    return { data: data ? normalizeMasterReadiness(data as Record<string, unknown>) : null, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : '마스터 준비 상태를 조회하지 못했습니다.' };
  }
}

// ══ Task 10a — 달력 준비 상태 · 변경 이력 조회 ═══════════════════

export async function getCalendarReadiness(): Promise<{ rows: CalendarReadiness[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_calendar_readiness')
      .select('*')
      .order('country_code')
      .order('cal_year')
      .order('cal_month');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeCalendarReadiness(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : '달력 준비 상태를 조회하지 못했습니다.' };
  }
}

/** 마스터 변경 이력 최근 N건 — analytics.v_master_change_history */
export async function getMasterHistory(limit = 50): Promise<{ rows: MasterHistoryEntry[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_master_change_history')
      .select('*')
      .order('at', { ascending: false })
      .limit(limit);
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeMasterHistoryEntry(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : '마스터 변경 이력을 조회하지 못했습니다.' };
  }
}

// ══ Task 10a — 마스터 편집 RPC 래퍼 ══════════════════════════════
//
// ★ 여기서 권한·검증을 판정하지 않는다. core.upsert_supply_entity 등 DB 명령 함수가 ADMIN
//   여부와 입력값을 스스로 다시 확인한다. 이 파일은 RPC 호출 결과를 { data, error } 로 그대로 돌려준다.

export type MasterMutationResult<T> = { data: T | null; error: string | null };

function mutationErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function upsertSupplyEntity(input: {
  entityId: string;
  entityName: string;
  countryCode: string;
  prepDays: number;
  active: boolean;
  validFrom: string | null;
  validTo: string | null;
  note: string | null;
  reason: string;
}): Promise<MasterMutationResult<string>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('upsert_supply_entity', {
      p_entity_id: input.entityId,
      p_entity_name: input.entityName,
      p_country_code: input.countryCode,
      p_prep_days: input.prepDays,
      p_active: input.active,
      p_valid_from: input.validFrom,
      p_valid_to: input.validTo,
      p_note: input.note,
      p_reason: input.reason,
    });
    if (error) return { data: null, error: error.message };
    return { data: data ? String(data) : null, error: null };
  } catch (error) {
    return { data: null, error: mutationErrorMessage(error, '해외법인 정보를 저장하지 못했습니다.') };
  }
}

export async function upsertSupplier(input: {
  supplierId: string;
  supplierName: string;
  entityId: string;
  leadTimeDays: number | null;
  active: boolean;
  validFrom: string | null;
  validTo: string | null;
  note: string | null;
  reason: string;
}): Promise<MasterMutationResult<string>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('upsert_supplier', {
      p_supplier_id: input.supplierId,
      p_supplier_name: input.supplierName,
      p_entity_id: input.entityId,
      p_lead_time_days: input.leadTimeDays,
      p_active: input.active,
      p_valid_from: input.validFrom,
      p_valid_to: input.validTo,
      p_note: input.note,
      p_reason: input.reason,
    });
    if (error) return { data: null, error: error.message };
    return { data: data ? String(data) : null, error: null };
  } catch (error) {
    return { data: null, error: mutationErrorMessage(error, '공급처 정보를 저장하지 못했습니다.') };
  }
}

export async function setSupplierDepartureRule(input: {
  departureId: number | null;
  supplierId: string;
  weekday: number | null;
  weekOfMonth: number | null;
  dayOfMonth: number | null;
  validFrom: string | null;
  validTo: string | null;
  note: string | null;
  reason: string;
}): Promise<MasterMutationResult<number>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('set_supplier_departure_rule', {
      p_departure_id: input.departureId,
      p_supplier_id: input.supplierId,
      p_weekday: input.weekday,
      p_week_of_month: input.weekOfMonth,
      p_day_of_month: input.dayOfMonth,
      p_valid_from: input.validFrom,
      p_valid_to: input.validTo,
      p_note: input.note,
      p_reason: input.reason,
    });
    if (error) return { data: null, error: error.message };
    return { data: data === null || data === undefined ? null : Number(data), error: null };
  } catch (error) {
    return { data: null, error: mutationErrorMessage(error, '출항일 규칙을 저장하지 못했습니다.') };
  }
}

export async function deactivateSupplierDepartureRule(input: { departureId: number; reason: string }): Promise<MasterMutationResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.schema('core').rpc('deactivate_supplier_departure_rule', {
      p_departure_id: input.departureId,
      p_reason: input.reason,
    });
    if (error) return { data: null, error: error.message };
    return { data: null, error: null };
  } catch (error) {
    return { data: null, error: mutationErrorMessage(error, '출항일 규칙을 비활성화하지 못했습니다.') };
  }
}

export async function addBusinessHoliday(input: {
  countryCode: string;
  calendarDate: string;
  holidayName: string;
  reason: string;
}): Promise<MasterMutationResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.schema('core').rpc('add_business_holiday', {
      p_country_code: input.countryCode,
      p_calendar_date: input.calendarDate,
      p_holiday_name: input.holidayName,
      p_reason: input.reason,
    });
    if (error) return { data: null, error: error.message };
    return { data: null, error: null };
  } catch (error) {
    return { data: null, error: mutationErrorMessage(error, '공휴일을 저장하지 못했습니다.') };
  }
}

export async function removeBusinessHoliday(input: { countryCode: string; calendarDate: string; reason: string }): Promise<MasterMutationResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.schema('core').rpc('remove_business_holiday', {
      p_country_code: input.countryCode,
      p_calendar_date: input.calendarDate,
      p_reason: input.reason,
    });
    if (error) return { data: null, error: error.message };
    return { data: null, error: null };
  } catch (error) {
    return { data: null, error: mutationErrorMessage(error, '공휴일을 제거하지 못했습니다.') };
  }
}

export async function setCalendarMonthReady(input: {
  countryCode: string;
  calYear: number;
  calMonth: number;
  ready: boolean;
  reason: string;
}): Promise<MasterMutationResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.schema('core').rpc('set_calendar_month_ready', {
      p_country_code: input.countryCode,
      p_cal_year: input.calYear,
      p_cal_month: input.calMonth,
      p_ready: input.ready,
      p_reason: input.reason,
    });
    if (error) return { data: null, error: error.message };
    return { data: null, error: null };
  } catch (error) {
    return { data: null, error: mutationErrorMessage(error, '달력 준비 상태를 저장하지 못했습니다.') };
  }
}
