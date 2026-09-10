// Phase 1 마스터 조회 — 화면이 쓰는 유일한 통로입니다.
//
// ★ analytics 뷰만 읽습니다. core 를 직접 읽지 않습니다.
// ★ 예외를 던지지 않고 { rows, error } 로 돌려줍니다.

import { createSupabaseServerClient } from './supabase';
import {
  normalizeItemPolicy,
  normalizeMasterReadiness,
  normalizeSupplier,
  normalizeSupplierDeparture,
  normalizeSupplyEntity,
  type ItemPolicy,
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
