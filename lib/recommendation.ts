// 발주 추천 · 안전재고 · SKU Detail 조회 — renew.prd 21장 · 22장 · 29장
//
// 계산은 SQL 이 끝냈습니다. 여기서는 조회와 정규화만 합니다 (AGENTS.md 규칙 2).
// 타입과 정규화 함수는 lib/recommendation-model.ts 에 있습니다 — Supabase 없이 테스트하려고 나눴습니다.
//
// PostgREST 는 한 번에 1,000행까지 돌려줍니다. 목록 조회는 limit 을 반드시 적습니다 (공통규칙 11).

import { createSupabaseServerClient } from './supabase/server';
import type { SupabaseServerClient } from './supabase/service';
import {
  normalizeConsensusRow,
  normalizeItemPolicy,
  normalizePurchaseRecommendation,
  normalizePurchaseRecommendationKpi,
  normalizeSafetyStock,
  normalizeServiceLevel,
  normalizeSkuDetail,
  type ConsensusRow,
  type ItemPolicy,
  type PurchaseRecommendation,
  type PurchaseRecommendationKpi,
  type SafetyStock,
  type ServiceLevel,
  type SkuDetail,
} from './recommendation-model';

function failure(error: unknown): string {
  return error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.';
}

/**
 * 발주 추천 목록 — renew.prd 22.3.
 *
 * 발주 권고일이 이른 순입니다. 권고일이 없는 품목(결품 예상일이 없거나 산출 불가)은 맨 뒤입니다.
 * 0 으로 취급해 앞에 두면 가장 급한 품목처럼 보입니다 (design.md §8.2).
 */
export async function getPurchaseRecommendations(): Promise<{
  rows: PurchaseRecommendation[];
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_purchase_recommendation')
      .select('*')
      .order('required_order_date', { ascending: true, nullsFirst: false })
      .limit(500);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) =>
      normalizePurchaseRecommendation(item as Record<string, unknown>),
    );
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/** 발주 추천 요약 한 줄 — analytics.v_purchase_recommendation_kpi */
export async function getPurchaseRecommendationKpi(): Promise<{
  data: PurchaseRecommendationKpi | null;
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_purchase_recommendation_kpi')
      .select('*')
      .maybeSingle();

    if (error) return { data: null, error: error.message };
    if (!data) return { data: null, error: null };

    return { data: normalizePurchaseRecommendationKpi(data as Record<string, unknown>), error: null };
  } catch (error) {
    return { data: null, error: failure(error) };
  }
}

/**
 * 품목 하나의 요약 — renew.prd 29장.
 *
 * 없는 품목이면 `data` 가 null 입니다. 화면은 그때 notFound() 를 부릅니다.
 */
export async function getSkuDetail(
  itemId: string,
): Promise<{ data: SkuDetail | null; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_sku_detail')
      .select('*')
      .eq('item_id', itemId)
      .maybeSingle();

    if (error) return { data: null, error: error.message };
    if (!data) return { data: null, error: null };

    return { data: normalizeSkuDetail(data as Record<string, unknown>), error: null };
  } catch (error) {
    return { data: null, error: failure(error) };
  }
}

/** 안전재고 근거 — renew.prd 21.1. 안전재고가 큰 순입니다 */
export async function getSafetyStocks(): Promise<{
  rows: SafetyStock[];
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_safety_stock')
      .select('*')
      .order('safety_stock', { ascending: false, nullsFirst: false })
      .limit(500);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => normalizeSafetyStock(item as Record<string, unknown>));
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/** 한 품목의 안전재고 근거 한 줄. SKU Detail §4 가 씁니다 */
export async function getSafetyStock(
  itemId: string,
  client?: SupabaseServerClient,
): Promise<{ data: SafetyStock | null; error: string | null }> {
  try {
    const supabase = client ?? (await createSupabaseServerClient());
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_safety_stock')
      .select('*')
      .eq('item_id', itemId)
      .maybeSingle();

    if (error) return { data: null, error: error.message };
    if (!data) return { data: null, error: null };

    return { data: normalizeSafetyStock(data as Record<string, unknown>), error: null };
  } catch (error) {
    return { data: null, error: failure(error) };
  }
}

/**
 * 등급별 서비스 수준의 적용 이력 — analytics.v_service_level.
 *
 * 관리자 화면이 core.service_level 에 새 값을 쌓고 과거 행을 지우지 않으므로,
 * "언제부터 이 값이었나" 를 그대로 보여줍니다. 어느 행이 지금 적용 중인지는
 * 뷰의 is_effective 가 DB 시간 기준으로 판정합니다 — 화면에서 다시 오늘과
 * 비교하면 앱 서버와 DB 의 시간대가 달라 자정 근처에서 하루가 밀립니다.
 */
export async function getServiceLevels(): Promise<{
  rows: ServiceLevel[];
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_service_level')
      .select('*')
      .order('effective_from', { ascending: false })
      .order('item_grade')
      .limit(200);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => normalizeServiceLevel(item as Record<string, unknown>));
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/** 품목 정책 — analytics.v_item_policy (MOQ · 포장 단위 · 등급 + 적용 중인 Z) */
export async function getItemPolicies(): Promise<{
  rows: ItemPolicy[];
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_item_policy')
      .select('*')
      .order('item_id')
      .limit(500);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => normalizeItemPolicy(item as Record<string, unknown>));
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/**
 * 한 품목의 기간별 Consensus — analytics.v_consensus_forecast.
 *
 * SKU Detail §2 가 읽습니다. Override 입력 폼은 STEP 12 가 이 표 아래에 붙입니다.
 */
export async function getConsensusForecast(
  itemId: string,
): Promise<{ rows: ConsensusRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_consensus_forecast')
      .select('*')
      .eq('item_id', itemId)
      .order('period')
      .limit(60);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => normalizeConsensusRow(item as Record<string, unknown>));
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/**
 * 품목 한 건의 발주 추천.
 *
 * ★ 목록을 받아 find 하지 않습니다. getPurchaseRecommendations 는 500행에서 잘리므로,
 *   그 뒤에 있는 품목이 "없음" 으로 보입니다 (STEP 19 리뷰 Important 7).
 */
export async function getPurchaseRecommendation(
  itemId: string,
  client?: SupabaseServerClient,
): Promise<{ data: PurchaseRecommendation | null; error: string | null }> {
  try {
    const supabase = client ?? (await createSupabaseServerClient());
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_purchase_recommendation')
      .select('*')
      .eq('item_id', itemId)
      .maybeSingle();

    if (error) return { data: null, error: error.message };
    if (!data) return { data: null, error: null };

    return { data: normalizePurchaseRecommendation(data as Record<string, unknown>), error: null };
  } catch (error) {
    return { data: null, error: failure(error) };
  }
}
