import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getBomRequirements,
  getItemDemandProfileByItem,
  getItemDemandProfiles,
  getShipmentTrendByItem,
  getShipmentTrends,
  type BigViewClient,
  type BigViewClientFactory,
  type BigViewQuery,
} from './scm-big-views.ts';

// 큰 뷰 다섯 조회의 **동작**을 시험한다 — 정합성 라운드 M5·M6 (2026-09-13)
//
// 앞선 시험들은 저장소 함수를 통째로 스텁으로 갈아끼웠다. 그래서 질의 구성 코드가 한 번도
// 실행되지 않았고, `count: 'exact'` 를 지워도 전부 통과했다. 여기서는 **진짜 함수를 실행**하고
// 가짜 클라이언트만 끼운다.
//
// ★ 가짜가 정직해야 한다 — `{ count: 'exact' }` 가 넘어오지 않으면 **count 는 null** 이다.
//   진짜 supabase-js 가 그렇게 굴기 때문이고, 이것이 단언 하나로 두 변조를 다 덮는 이유다:
//
//     M5 (요청 자체를 제거)        → count 가 null → total 이 null   → total===99 실패 ✔
//     M6 (요청은 두고 매핑만 바꿈) → total 이 data.length(=1)        → total===99 실패 ✔
//
//   가짜가 요청과 무관하게 99 를 돌려주면 M5 가 빠져나간다. 그 경우 "시험을 늘렸는데 M5 가
//   통과"하고, 그것이 바로 구멍의 신호다.

/** 전수는 99, 돌려주는 행은 1개 — 둘이 다르므로 total 이 어디서 왔는지 갈린다 */
const EXACT_COUNT = 99;

type Recorded = {
  schema: string | null;
  from: string | null;
  select: { columns: string; options?: { count?: 'exact' } } | null;
  eq: [string, string][];
  limit: number | null;
};

function fakeClient(
  rows: Record<string, unknown>[],
  options: { countUnavailable?: boolean } = {},
): { factory: BigViewClientFactory; seen: Recorded } {
  const seen: Recorded = { schema: null, from: null, select: null, eq: [], limit: null };
  let exactRequested = false;

  const query = {
    select(columns: string, options?: { count?: 'exact' }) {
      seen.select = { columns, options };
      // ★ 진짜처럼 군다. 요청하지 않았으면 count 를 주지 않는다.
      exactRequested = options?.count === 'exact';
      return query;
    },
    eq(column: string, value: string) {
      seen.eq.push([column, value]);
      return query;
    },
    order() {
      return query;
    },
    limit(count: number) {
      seen.limit = count;
      return query;
    },
    then(onfulfilled: (value: { data: unknown[] | null; error: null; count: number | null }) => unknown) {
      // 요청하지 않았으면 null. 요청했어도 서버가 못 내주는 상황(countUnavailable)이면 역시 null.
      const count = !exactRequested || options.countUnavailable ? null : EXACT_COUNT;
      return Promise.resolve(onfulfilled({ data: rows, error: null, count }));
    },
  } as unknown as BigViewQuery;

  const client: BigViewClient = {
    schema(name: string) {
      seen.schema = name;
      return {
        from(table: string) {
          seen.from = table;
          return query;
        },
      };
    },
  };

  return { factory: async () => client, seen };
}

const PROFILE_ROW = { item_code: '796L51508', description: '부품', n_periods: 12, n_nonzero: 3 };
const TREND_ROW = { item_code: '589K39896', description: '부품', total_qty: 7.0, n_months: 12 };
const BOM_ROW = { model_base: 'MDL227', part_role: 'BOM', item_code: 'P1', description: '부품', qty: 1 };

// ── 자리별로 하나씩 ───────────────────────────────────────────────
// 다섯 자리를 한 시험에 몰지 않는다. 몰면 한 자리만 덮여도 시험이 통과해서
// "전부 덮였다" 와 "하나만 덮였다" 를 구별하지 못한다.

test('getItemDemandProfiles — total 은 전수 count 이지 받아 온 행 수가 아니다', async () => {
  const { factory, seen } = fakeClient([PROFILE_ROW]);
  const result = await getItemDemandProfiles(factory);

  assert.equal(result.error, null);
  assert.equal(result.rows.length, 1, '돌려준 행은 1개다');
  assert.equal(result.total, EXACT_COUNT, 'total 이 1 이면 매핑이, null 이면 요청이 빠진 것이다');
  assert.deepEqual(seen.select?.options, { count: 'exact' });
  assert.equal(seen.from, 'v_item_demand_profile');
  assert.equal(seen.limit, 1000, '상한을 서버 기본값에 맡기지 않는다');
});

test('getItemDemandProfileByItem — total 은 전수 count 이고, DB 에서 거른다', async () => {
  const { factory, seen } = fakeClient([PROFILE_ROW]);
  const result = await getItemDemandProfileByItem('796L51508', factory);

  assert.equal(result.total, EXACT_COUNT);
  assert.deepEqual(seen.select?.options, { count: 'exact' });
  assert.deepEqual(seen.eq, [['item_code', '796L51508']], '거르기를 DB 가 해야 한다');
});

test('getShipmentTrends — total 은 전수 count 이지 받아 온 행 수가 아니다', async () => {
  const { factory, seen } = fakeClient([TREND_ROW]);
  const result = await getShipmentTrends(factory);

  assert.equal(result.total, EXACT_COUNT);
  assert.deepEqual(seen.select?.options, { count: 'exact' });
  assert.equal(seen.from, 'v_shipment_trend');
  assert.equal(seen.limit, 1000);
});

test('getShipmentTrendByItem — total 은 전수 count 이고, DB 에서 거른다', async () => {
  const { factory, seen } = fakeClient([TREND_ROW]);
  const result = await getShipmentTrendByItem('589K39896', factory);

  assert.equal(result.total, EXACT_COUNT);
  assert.deepEqual(seen.select?.options, { count: 'exact' });
  assert.deepEqual(seen.eq, [['item_code', '589K39896']]);
});

test('getBomRequirements — total 은 전수 count 이지 받아 온 행 수가 아니다', async () => {
  const { factory, seen } = fakeClient([BOM_ROW]);
  const result = await getBomRequirements('MDL227', factory);

  assert.equal(result.total, EXACT_COUNT, '1,000행을 넘는 기종에서 rows.length 는 틀린다');
  assert.deepEqual(seen.select?.options, { count: 'exact' });
  assert.deepEqual(seen.eq, [['model_base', 'MDL227']]);
  assert.equal(seen.limit, 1000);
});

test('count 를 받지 못하면 total 은 0 도 행 수도 아니라 null 이다', async () => {
  // 요청은 했지만 서버가 count 를 내주지 못한 상황. 행은 1개 왔지만 전수는 여전히 모른다.
  const { factory, seen } = fakeClient([PROFILE_ROW], { countUnavailable: true });
  const result = await getItemDemandProfiles(factory);

  assert.deepEqual(seen.select?.options, { count: 'exact' }, '요청은 했어야 한다');
  assert.equal(result.rows.length, 1);
  assert.equal(result.total, null, '모르는 수를 행 수로 채우지 않는다');
});
