// 1,000행 상한에 걸리는 큰 뷰 다섯 조회 — lib/scm.ts 가 그대로 다시 내보냅니다.
//
// ★ 이 파일은 supabase 를 **정적으로 부르지 않습니다.** 기본 클라이언트는 함수 안에서 동적
//   import 로 가져옵니다(lib/agent/tools.ts 가 lib/scm.ts 를 부르는 것과 같은 이유). 그래야
//   node --test 가 이 파일을 import 할 수 있고, **가짜 클라이언트를 끼워 질의가 실제로
//   무엇을 요청하고 무엇을 돌려주는지** 시험할 수 있습니다.
//
//   왜 따로 떼었나 (2026-09-13 실측) — lib/scm.ts 는 `./supabase` 를 정적으로 부르고, 게다가
//   `./inventory/repository` 를 다시 내보내는데 그 파일도 `../supabase/server` 를 정적으로
//   부릅니다. 그 끝에 'next/headers' 가 있고, node --test 에서 **ERR_MODULE_NOT_FOUND 로 아예
//   해석되지 않습니다**(Next 가 exports 조건으로만 노출해 node 평 ESM resolver 가 못 만족시킵니다).
//   정적 경로가 하나라도 남아 있으면 시험이 모듈 적재 단계에서 죽으므로, 이 다섯만 옮겼습니다.
//
// ── 1,000행 상한을 다루는 규칙 ────────────────────────────────────────────────
//
// v_item_demand_profile · v_shipment_trend 는 각각 10,198행, v_bom_requirement_x 는 7,546행
// (기종 23개 중 2개가 1,000행 초과 — MDL227 3,285 · MDL213 1,978)이라 **필터 없이 부르면
// 조용히 잘립니다.** 그래서 셋을 지킵니다.
//
//   ① 품목 하나를 묻는 경로는 `.eq()` 로 **DB 에서** 거릅니다. 잘린 배열을 훑지 않습니다
//      (getShipmentMonthlyByItem 의 선례와 같은 모양). 그래야 "목록에 없다" 가
//      "존재하지 않는다" 를 뜻하게 됩니다.
//   ② `count: 'exact'` 로 **전수**를 따로 받습니다. 반환 행이 잘려도 total 은 참입니다 —
//      전수는 반환 행 수와 다른 질문이기 때문입니다.
//   ③ count 를 받지 못하면 total 은 `rows.length` 가 아니라 **null** 입니다. 모르는 수를
//      반환 행 수로 채우면 그 순간 거짓이 사실 채널로 들어갑니다 (AGENTS.md 규칙 5).

import {
  normalizeBomRequirement,
  normalizeItemDemandProfile,
  normalizeShipmentTrend,
  type BomRequirement,
  type ItemDemandProfile,
  type ShipmentTrend,
} from './scm-model.ts';

/** 표가 한 번에 받는 최대 행 수 — 상한을 서버 기본값에 맡기지 않고 여기서 못박습니다.
 *  전량을 받으려면 가상화가 함께 와야 합니다(components/ui/data-table.tsx 는 전 행을 DOM 에
 *  그립니다). 가상화가 없는 동안에는 이 상한이 화면을 지킵니다. */
const TABLE_FETCH_LIMIT = 1000;

/** 목록 조회 결과 — total 은 잘림과 무관한 전수이고, 알 수 없으면 null 입니다 */
export type ListResult<T> = { rows: T[]; total: number | null; error: string | null };

/** PostgREST 한 번의 응답 — count 는 `{ count: 'exact' }` 를 요청했을 때만 채워집니다 */
type QueryResult = { data: unknown[] | null; error: { message: string } | null; count: number | null };

/** 시험이 가짜를 끼울 수 있을 만큼만 좁힌 질의 빌더 */
export type BigViewQuery = PromiseLike<QueryResult> & {
  select: (columns: string, options?: { count?: 'exact' }) => BigViewQuery;
  eq: (column: string, value: string) => BigViewQuery;
  order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => BigViewQuery;
  limit: (count: number) => BigViewQuery;
};

export type BigViewClient = { schema: (name: string) => { from: (table: string) => BigViewQuery } };

/** 클라이언트를 만드는 방법 — 실제 실행에서는 아무도 넘기지 않습니다 */
export type BigViewClientFactory = () => Promise<BigViewClient>;

/** 기본값 — 동적 import 라 이 파일을 import 하는 것만으로는 supabase 가 딸려 오지 않습니다 */
async function defaultClient(): Promise<BigViewClient> {
  const { createSupabaseServerClient } = await import('./supabase.ts');
  return (await createSupabaseServerClient()) as unknown as BigViewClient;
}

/**
 * 수요 성격 — Syntetos-Boylan 분류. 6개월 미만은 유형 null + reason_code.
 *
 * ★ 10,198행(2026-09-13 실측)이라 반환 행은 TABLE_FETCH_LIMIT 에서 잘립니다. total 은
 *   잘림과 무관한 전수입니다 — 화면은 이 둘을 구분해 보여야 합니다.
 * ★ 품목 하나를 찾을 때 이 함수를 부른 뒤 배열을 훑지 마세요. getItemDemandProfileByItem 을
 *   씁니다(잘린 배열에는 90% 의 품목이 없습니다).
 */
export async function getItemDemandProfiles(
  createClient: BigViewClientFactory = defaultClient,
): Promise<ListResult<ItemDemandProfile>> {
  try {
    const supabase = await createClient();
    const { data, error, count } = await supabase
      .schema('analytics')
      .from('v_item_demand_profile')
      .select('*', { count: 'exact' })
      .order('item_code')
      .limit(TABLE_FETCH_LIMIT);
    if (error) return { rows: [], total: null, error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeItemDemandProfile(row as Record<string, unknown>)),
      total: count ?? null,
      error: null,
    };
  } catch (error) {
    return { rows: [], total: null, error: error instanceof Error ? error.message : '수요 프로파일을 조회하지 못했습니다.' };
  }
}

/**
 * 품목 하나의 수요 성격 — analytics.v_item_demand_profile.
 *
 * ★ itemCode 는 선택 인자가 아닙니다. 거르기를 DB 에서 하기 때문에 0행은 "잘려서 안 보인다"
 *   가 아니라 **"이 뷰에 그 품목이 없다"** 를 뜻합니다 — 부르는 쪽이 UNKNOWN_ITEM 을
 *   사실로 말할 수 있는 유일한 모양입니다 (getShipmentMonthlyByItem 과 같은 이유).
 * ★ 품목당 1행이라 `rows.length` 도 오늘은 맞지만, 그것은 **우연한 정확성**입니다 — 방금
 *   고친 결함과 정확히 같은 모양이라 여기서도 count 로 셉니다. 뷰가 품목당 여러 행을 내는
 *   날이 와도 이 함수는 틀리지 않습니다.
 */
export async function getItemDemandProfileByItem(
  itemCode: string,
  createClient: BigViewClientFactory = defaultClient,
): Promise<ListResult<ItemDemandProfile>> {
  try {
    const supabase = await createClient();
    const { data, error, count } = await supabase
      .schema('analytics')
      .from('v_item_demand_profile')
      .select('*', { count: 'exact' })
      .eq('item_code', itemCode)
      .order('item_code');
    if (error) return { rows: [], total: null, error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeItemDemandProfile(row as Record<string, unknown>)),
      total: count ?? null,
      error: null,
    };
  } catch (error) {
    return { rows: [], total: null, error: error instanceof Error ? error.message : '수요 프로파일을 조회하지 못했습니다.' };
  }
}

/**
 * 출고 추이 — XCN 합산 기준. 이동평균은 0인 달을 포함해 계산된 값입니다.
 *
 * ★ 10,198행(2026-09-13 실측)이라 반환 행은 출고량 상위 TABLE_FETCH_LIMIT 건에서 잘립니다.
 *   total 은 잘림과 무관한 전수입니다.
 * ★ 품목 하나를 찾을 때는 getShipmentTrendByItem 을 씁니다.
 */
export async function getShipmentTrends(
  createClient: BigViewClientFactory = defaultClient,
): Promise<ListResult<ShipmentTrend>> {
  try {
    const supabase = await createClient();
    const { data, error, count } = await supabase
      .schema('analytics')
      .from('v_shipment_trend')
      .select('*', { count: 'exact' })
      .order('total_qty', { ascending: false, nullsFirst: false })
      .limit(TABLE_FETCH_LIMIT);
    if (error) return { rows: [], total: null, error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeShipmentTrend(row as Record<string, unknown>)),
      total: count ?? null,
      error: null,
    };
  } catch (error) {
    return { rows: [], total: null, error: error instanceof Error ? error.message : '출고 추이를 조회하지 못했습니다.' };
  }
}

/**
 * 품목 하나의 출고 추이 — analytics.v_shipment_trend.
 *
 * ★ 거르기를 DB 에서 합니다. 출고량 상위 1,000건 밖의 품목(실측 9,198개, 90.2%)은 목록
 *   조회로는 영영 보이지 않습니다 — 예: 589K39896 은 출고량 7.0 이라 상위 1,000건 밖입니다
 *   (7.0 동률이 229품목이라 순위는 4,894~5,122 구간이고 한 값으로 말할 수 없습니다).
 * ★ 품목당 1행이라 `rows.length` 도 오늘은 맞지만 그것은 **우연한 정확성**입니다 —
 *   getItemDemandProfileByItem 과 같은 이유로 여기서도 count 로 셉니다.
 */
export async function getShipmentTrendByItem(
  itemCode: string,
  createClient: BigViewClientFactory = defaultClient,
): Promise<ListResult<ShipmentTrend>> {
  try {
    const supabase = await createClient();
    const { data, error, count } = await supabase
      .schema('analytics')
      .from('v_shipment_trend')
      .select('*', { count: 'exact' })
      .eq('item_code', itemCode)
      .order('total_qty', { ascending: false, nullsFirst: false });
    if (error) return { rows: [], total: null, error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeShipmentTrend(row as Record<string, unknown>)),
      total: count ?? null,
      error: null,
    };
  } catch (error) {
    return { rows: [], total: null, error: error instanceof Error ? error.message : '출고 추이를 조회하지 못했습니다.' };
  }
}

/**
 * BOM 소요 — 기종 1대를 팔려면 무엇이 몇 개 필요한가.
 *
 * ★ 이미 model_base 로 거르지만 그것만으로는 부족합니다 — 기종 23개 중 2개가 1,000행을
 *   넘습니다(2026-09-13 실측: MDL227 3,285 · MDL213 1,978). 그 둘에서는 반환 행이 잘리므로
 *   total 을 `rows.length` 로 세면 틀립니다. count 로 따로 받습니다.
 */
export async function getBomRequirements(
  modelBase: string,
  createClient: BigViewClientFactory = defaultClient,
): Promise<ListResult<BomRequirement>> {
  try {
    const supabase = await createClient();
    const { data, error, count } = await supabase
      .schema('analytics')
      .from('v_bom_requirement_x')
      .select('*', { count: 'exact' })
      .eq('model_base', modelBase)
      .order('part_role')
      .order('item_code')
      .limit(TABLE_FETCH_LIMIT);
    if (error) return { rows: [], total: null, error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeBomRequirement(row as Record<string, unknown>)),
      total: count ?? null,
      error: null,
    };
  } catch (error) {
    return { rows: [], total: null, error: error instanceof Error ? error.message : 'BOM 소요를 조회하지 못했습니다.' };
  }
}
