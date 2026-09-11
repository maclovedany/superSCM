// 재고 저장소 — 화면 조회는 analytics.v_available_stock 만 씁니다.
//
// ★ raw · core 를 직접 읽지 않습니다. 정상 창고재고 분류, 조회 범위 제한, 가용재고
//   뺄셈은 모두 뷰가 이미 적용해 둔 규칙입니다 (SCHEMA.md).

import { createSupabaseServerClient } from '../supabase/server';
import { normalizeAvailableStockRow, type AvailableStockRow } from './model';

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
