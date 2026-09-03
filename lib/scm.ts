import { createSupabaseServerClient } from './supabase';
import type { SupabaseServerClient } from './supabase/service';
import {
  normalizeLeadtimeGap,
  normalizeStockoutKpi,
  normalizeStockoutRisk,
  type LeadtimeGap,
  type StockoutKpi,
  type StockoutRisk,
} from './scm-model';

export async function getLeadtimeGap(): Promise<{ rows: LeadtimeGap[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('analytics').from('v_leadtime_gap').select('*');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeLeadtimeGap(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}

export async function getStockoutKpi() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('analytics').from('v_stockout_kpi').select('*').maybeSingle();
    if (error) return { data: null, error: error.message };
    return {
      data: data ? normalizeStockoutKpi(data as Record<string, unknown>) : null,
      error: null,
    };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}

export async function getStockoutRisks(): Promise<{ rows: StockoutRisk[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_stockout_risk')
      .select('*')
      // PostgREST 기본 상한이 1,000행입니다. 목록 조회는 상한을 명시합니다.
      .order('stockout_days', { ascending: true, nullsFirst: false })
      .limit(1000);

    if (error) return { rows: [], error: error.message };

    return {
      rows: (data ?? []).map((row) => normalizeStockoutRisk(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}

/**
 * 품목 한 건의 결품 위험.
 *
 * ★ 목록을 받아 find 하지 않습니다. getStockoutRisks 는 1,000행에서 잘리므로,
 *   그 뒤에 있는 품목이 "없음" 으로 보입니다 (STEP 19 리뷰 Important 7).
 */
export async function getStockoutRisk(
  itemId: string,
  client?: SupabaseServerClient,
): Promise<{ data: StockoutRisk | null; error: string | null }> {
  try {
    const supabase = client ?? (await createSupabaseServerClient());
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_stockout_risk')
      .select('*')
      .eq('item_id', itemId)
      .maybeSingle();

    if (error) return { data: null, error: error.message };
    if (!data) return { data: null, error: null };

    return { data: normalizeStockoutRisk(data as Record<string, unknown>), error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}
