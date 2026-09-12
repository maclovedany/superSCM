// 차트 데이터 저장소 — analytics.v_demand_series · v_shipment_monthly_rollup · v_shipment_monthly_item만
// 읽는다(chart-views 트랙, 20260912001000). 차트 컴포넌트는 다른 트랙이 만든다 — 이 파일은 그
// 컴포넌트가 부를 조회 함수만 제공한다.
//
// ★ raw · core를 직접 읽지 않는다. 실적 출처 확인(batch_id) · Champion 모델 선택 · XCN 대표코드
//   합산은 전부 뷰가 이미 적용해 둔 규칙이다.
// ★ 예외를 던지지 않는다. { rows, error }로 돌려주고 화면이 error를 그린다(lib/scm.ts와 같은 규칙).

import { createSupabaseServerClient } from '../supabase/server';
import {
  normalizeDemandSeriesPoint,
  normalizeShipmentMonthlyItemRow,
  normalizeShipmentMonthlyRollupRow,
  type DemandSeriesPoint,
  type ShipmentMonthlyItemRow,
  type ShipmentMonthlyRollupRow,
} from './model';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * 수요 실적 vs 예측(Champion 모델) 월별 시계열 — analytics.v_demand_series.
 * STOCK_VIEW_ALL이 없으면 RLS로 0행(오류가 아니다). 전체 품목이 합쳐 봐야 200행 안팎이라
 * PostgREST 1000행 상한에 걸리지 않는다 — 품목 선택은 화면이 반환된 행을 걸러 한다.
 */
export async function getDemandSeries(): Promise<{ rows: DemandSeriesPoint[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_demand_series')
      .select('*')
      .order('item_id')
      .order('period');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeDemandSeriesPoint(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '수요 시계열을 조회하지 못했습니다.') };
  }
}

/**
 * 출고 월별 총합(TOTAL) · 품목구분×월(ITEM_TYPE) 롤업 — analytics.v_shipment_monthly_rollup.
 * 238행 안팎(총합 79 + 품목구분×월 159) — 필터 없이 전체를 반환해도 1000행 상한 안이다.
 */
export async function getShipmentMonthlyRollup(): Promise<{ rows: ShipmentMonthlyRollupRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_shipment_monthly_rollup')
      .select('*')
      .order('level')
      .order('item_type', { nullsFirst: true })
      .order('ym');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeShipmentMonthlyRollupRow(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '출고 월별 롤업을 조회하지 못했습니다.') };
  }
}

/**
 * 출고 품목×월(HOC 대표코드 기준) — analytics.v_shipment_monthly_item.
 *
 * ★ itemCode는 선택 인자가 아니다 — 이 뷰는 실측 10만 행대라 필터 없이 부르면 PostgREST
 *   1000행 상한(실측: v_shipment_trend가 10,228행 중 1000행만 반환)에 곧바로 걸려 조용히
 *   잘린 데이터를 보여준다. 필터 없는 조회를 아예 만들지 않는다(뷰 머리 주석과 같은 이유).
 */
export async function getShipmentMonthlyByItem(itemCode: string): Promise<{ rows: ShipmentMonthlyItemRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_shipment_monthly_item')
      .select('*')
      .eq('item_code', itemCode)
      .order('ym');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeShipmentMonthlyItemRow(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '출고 품목별 월별 추이를 조회하지 못했습니다.') };
  }
}
