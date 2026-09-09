// 화면과 Agent 툴이 쓰는 조회 함수 모음.
//
// ★ 여기 있는 모든 함수는 analytics 스키마의 뷰만 읽습니다. raw · core 를 직접 읽지
//   않습니다. 뷰가 업무 규칙을 이미 한 번 적용해 두었기 때문입니다.
// ★ 예외를 던지지 않습니다. { rows, error } 로 돌려주고 화면이 error 를 그립니다.
//
// 2026-09-10 실데이터 이관 — 5회차 더미 뷰(v_sku_demand_profile · v_stockout_risk ·
// v_leadtime_gap)는 더 이상 읽지 않습니다. 실데이터에는 재고와 리드타임이 없고,
// 수요 프로파일은 v_item_demand_profile 이 대신합니다 (07-deprecate-and-agent.sql).

import { createSupabaseServerClient } from './supabase';
import {
  normalizeBomRequirement,
  normalizeItemDemandKpi,
  normalizeItemDemandProfile,
  normalizeOlAccuracy,
  normalizeOlAccuracyFy,
  normalizeShipmentTrend,
  type BomRequirement,
  type ItemDemandKpi,
  type ItemDemandProfile,
  type OlAccuracy,
  type OlAccuracyFy,
  type ShipmentTrend,
} from './scm-model';

/** 수요 성격 — Syntetos-Boylan 분류. 6개월 미만은 유형 null + reason_code */
export async function getItemDemandProfiles(): Promise<{ rows: ItemDemandProfile[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_item_demand_profile')
      .select('*')
      .order('item_code');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeItemDemandProfile(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : '수요 프로파일을 조회하지 못했습니다.' };
  }
}

/** 품목 구분별 수요 유형 분포 */
export async function getItemDemandKpi(): Promise<{ rows: ItemDemandKpi[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('analytics').from('v_item_demand_kpi').select('*').order('item_type');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeItemDemandKpi(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : '수요 유형 요약을 조회하지 못했습니다.' };
  }
}

/** 출고 추이 — XCN 합산 기준. 이동평균은 0인 달을 포함해 계산된 값입니다 */
export async function getShipmentTrends(): Promise<{ rows: ShipmentTrend[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_shipment_trend')
      .select('*')
      .order('total_qty', { ascending: false, nullsFirst: false });
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeShipmentTrend(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : '출고 추이를 조회하지 못했습니다.' };
  }
}

/** OL 예측 정확도 — 기종 × 회계연도 */
export async function getOlAccuracy(): Promise<{ rows: OlAccuracy[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_ol_accuracy')
      .select('*')
      .order('fy_sheet')
      .order('model_base');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeOlAccuracy(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'OL 정확도를 조회하지 못했습니다.' };
  }
}

/** OL 예측 정확도 — 회계연도 합 */
export async function getOlAccuracyFy(): Promise<{ rows: OlAccuracyFy[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('analytics').from('v_ol_accuracy_fy').select('*').order('fy_sheet');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeOlAccuracyFy(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'OL 정확도 요약을 조회하지 못했습니다.' };
  }
}

/** BOM 소요 — 기종 1대를 팔려면 무엇이 몇 개 필요한가 */
export async function getBomRequirements(modelBase: string): Promise<{ rows: BomRequirement[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_bom_requirement_x')
      .select('*')
      .eq('model_base', modelBase)
      .order('part_role')
      .order('item_code');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeBomRequirement(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'BOM 소요를 조회하지 못했습니다.' };
  }
}
