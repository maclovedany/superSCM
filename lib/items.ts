// 품목 검색 · 조회 · 데이터 가용성 — 서버 전용 (실데이터 전환 Plan 3)
//
// ★ 클라이언트 컴포넌트는 이 파일을 import 하지 마세요. 타입은 lib/items-model.ts 에서.
// 품목이 11,000개라 목록을 통째로 내리지 않고 서버에서 검색합니다. 구코드(XCN)로도 찾습니다.

import { createSupabaseServerClient } from './supabase/server';
import {
  normalizeDataAvailability,
  normalizeItemHit,
  normalizeQuery,
  type DataAvailability,
  type ItemHit,
} from './items-model';

function failure(error: unknown): string {
  return error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.';
}

/** 대표코드 · 이름 · 구코드로 검색. 정규화한 검색어의 부분 일치, 상위 limit */
export async function searchItems(
  q: string,
  limit = 30,
  options: { machinesOnly?: boolean } = {},
): Promise<{ rows: ItemHit[]; error: string | null }> {
  const needle = normalizeQuery(q);
  if (needle.length < 2) return { rows: [], error: null };
  try {
    const supabase = await createSupabaseServerClient();
    let direct = supabase
      .schema('core')
      .from('v_item_master')
      .select('item_id, item_name, item_type, family, is_machine')
      .or(`item_id.ilike.%${needle}%,item_name.ilike.%${q.trim()}%`)
      .order('item_id', { ascending: true })
      .limit(limit);
    if (options.machinesOnly) direct = direct.eq('is_machine', true);
    const [{ data, error }, alias] = await Promise.all([
      direct,
      options.machinesOnly
        ? Promise.resolve({ data: [], error: null })
        : supabase
            .schema('core')
            .from('v_item_alias')
            .select('alias_id, alias_name, item_id')
            .ilike('alias_id', `%${needle}%`)
            .limit(limit),
    ]);
    if (error) return { rows: [], error: error.message };
    const hits = (data ?? []).map((row) => normalizeItemHit(row as Record<string, unknown>));
    const seen = new Set(hits.map((h) => h.itemId));
    // 구코드로 찾은 대표코드 — 직접 검색에 없던 것만 덧붙입니다.
    const aliasRows = ((alias.data ?? []) as Record<string, unknown>[]).filter(
      (row) => row.alias_id !== row.item_id && !seen.has(String(row.item_id)),
    );
    if (aliasRows.length > 0) {
      const ids = Array.from(new Set(aliasRows.map((row) => String(row.item_id)))).slice(0, limit);
      const { data: masters } = await supabase
        .schema('core')
        .from('v_item_master')
        .select('item_id, item_name, item_type, family, is_machine')
        .in('item_id', ids)
        .limit(limit);
      for (const m of (masters ?? []) as Record<string, unknown>[]) {
        const via = aliasRows.find((row) => row.item_id === m.item_id);
        hits.push(normalizeItemHit({ ...m, matched_alias: via?.alias_name ?? via?.alias_id ?? null }));
      }
    }
    return { rows: hits.slice(0, limit), error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/** 대표코드 하나. 구코드로 물어도 대표코드를 돌려줍니다. 없으면 null */
export async function getItem(itemId: string): Promise<{ data: ItemHit | null; error: string | null }> {
  const code = normalizeQuery(itemId);
  if (!code) return { data: null, error: null };
  try {
    const supabase = await createSupabaseServerClient();
    const { data: alias } = await supabase
      .schema('core')
      .from('v_item_alias')
      .select('alias_id, alias_name, item_id')
      .eq('alias_id', code)
      .maybeSingle();
    const target = (alias as Record<string, unknown> | null)?.item_id ?? code;
    const { data, error } = await supabase
      .schema('core')
      .from('v_item_master')
      .select('item_id, item_name, item_type, family, is_machine')
      .eq('item_id', String(target))
      .maybeSingle();
    if (error) return { data: null, error: error.message };
    if (!data) return { data: null, error: null };
    const matched = alias && (alias as Record<string, unknown>).alias_id !== target
      ? ((alias as Record<string, unknown>).alias_name as string | null)
      : null;
    return { data: normalizeItemHit({ ...(data as Record<string, unknown>), matched_alias: matched }), error: null };
  } catch (error) {
    return { data: null, error: failure(error) };
  }
}

/** analytics.v_data_availability — 데이터 종류별 행수. 배너의 재료 */
export async function getDataAvailability(): Promise<{ rows: DataAvailability[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_data_availability')
      .select('*')
      .limit(20);
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeDataAvailability(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}
