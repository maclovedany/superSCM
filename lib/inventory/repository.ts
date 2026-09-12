// 재고 저장소 — 화면 조회는 analytics.v_available_stock · v_order_available_stock만 씁니다.
//
// ★ raw · core 를 직접 읽지 않습니다. 정상 창고재고 분류, 조회 범위 제한, 가용재고
//   뺄셈은 모두 뷰가 이미 적용해 둔 규칙입니다 (SCHEMA.md).

import { createSupabaseServerClient } from '../supabase/server';
import {
  normalizeAvailableStockRow,
  normalizeOpenPoDataStatus,
  normalizeOrderAvailableStockRow,
  type AvailableStockRow,
  type OpenPoDataStatus,
  type OrderAvailableStockRow,
} from './model';

export async function getAvailableStock(): Promise<{ rows: AvailableStockRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_available_stock')
      .select('*')
      .order('item_id');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeAvailableStockRow(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : '가용재고를 조회하지 못했습니다.' };
  }
}

/** 영업(ATP_VIEW) 전용 — 재고 상세 없이 주문 가능 수량만 조회합니다 */
export async function getOrderAvailableStock(): Promise<{ rows: OrderAvailableStockRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_order_available_stock')
      .select('*')
      .order('item_id');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeOrderAvailableStockRow(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : '주문 가능 수량을 조회하지 못했습니다.' };
  }
}

/**
 * Open PO 참고 열이 출처 미확인 또는 파싱 불가 데이터에 걸려 있는지 한 번만 안내하기 위한
 * 상태(2026-09-12 보정). 조회 권한이 없거나 걸리는 데이터가 없으면 행이 0개다 — 그때는
 * null을 돌려주고 배너를 띄우지 않는다.
 */
export async function getOpenPoDataStatus(): Promise<OpenPoDataStatus | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('analytics').from('v_open_po_data_status').select('*').maybeSingle();
    if (error || !data) return null;
    return normalizeOpenPoDataStatus(data as Record<string, unknown>);
  } catch {
    return null;
  }
}
