// 자리 ②  출고 월별 추이 — analytics.v_shipment_monthly_rollup
//
// TOTAL 선 + ITEM_TYPE 누적막대.
//
// ★ 품목 구분은 달마다 **있는 것만** 쌓는다. 실측(2026-09-13): 79개월 중 OPTION 은 79개월,
//   PART·SUPPLY 는 각각 40개월에만 행이 있다. 없는 구분을 0 높이로 쌓으면 "그 달 PART 출고가
//   0이었다"가 되는데, 뷰가 말한 것은 "그 달 PART 행이 없다"뿐이다.
// ★ level 이 알 수 없는 값이면 TOTAL 로 떨어뜨리지 않는다 — 그러면 ITEM_TYPE 행이 총합에
//   섞인다. 제외하고 사유로 드러낸다(lib/analytics/model.ts 의 UNKNOWN_ROLLUP_LEVEL 과 같은 판단).

import { extent, monthRange, segments, toYm, type Nullable, type Segment } from './geometry.ts';
import { chartReasonLabel } from './reason-labels.ts';
import type { ShipmentMonthlyRollupRow } from '../analytics/model.ts';

/** 한 달의 누적막대 — 행이 있는 구분만 들어간다. */
export type StackedMonth = {
  ym: string;
  entries: { itemType: string; qty: number }[];
  /** 이 달 누적막대의 높이(있는 구분만 더한 값) */
  stackTotal: number;
};

export type ShipmentRollupChart = {
  months: string[];
  /** TOTAL 계열 — 값이 없는 달은 null */
  total: Nullable[];
  totalSegments: Segment[];
  /** 범례 순서 — 실제로 등장하는 구분만 */
  itemTypes: string[];
  stacks: StackedMonth[];
  valueRange: { min: number; max: number } | null;
  /** 추세 배수를 못 낸 달의 설명 */
  trendReasons: { code: string; label: string; months: string[] }[];
  /** level 을 못 읽어 제외한 행 수 — 0 이면 숨긴다 */
  excludedUnknownLevel: number;
};

export function buildShipmentRollupChart(rows: readonly ShipmentMonthlyRollupRow[]): ShipmentRollupChart | null {
  const usable = rows.filter((row) => row.ym !== '');
  if (usable.length === 0) return null;

  const yms = usable.map((row) => toYm(row.ym)).sort();
  const months = monthRange(yms[0], yms[yms.length - 1]);
  if (months.length === 0) return null;

  // ★ level 이 null(UNKNOWN_ROLLUP_LEVEL)인 행은 어느 계열에도 넣지 않는다.
  const excludedUnknownLevel = usable.filter((row) => row.level === null).length;

  const totalByMonth = new Map<string, Nullable>();
  for (const row of usable) {
    if (row.level !== 'TOTAL') continue;
    totalByMonth.set(toYm(row.ym), row.qty);
  }
  const total = months.map((month) => (totalByMonth.has(month) ? (totalByMonth.get(month) as Nullable) : null));

  const itemTypeSet = new Set<string>();
  const byMonthType = new Map<string, Map<string, number>>();
  for (const row of usable) {
    if (row.level !== 'ITEM_TYPE' || row.itemType === null) continue;
    // ★ qty 가 null 이면 쌓지 않는다 — 0 으로 쌓으면 "그 달 0이었다"가 된다.
    if (row.qty === null) continue;
    itemTypeSet.add(row.itemType);
    const month = toYm(row.ym);
    const bucket = byMonthType.get(month) ?? new Map<string, number>();
    bucket.set(row.itemType, row.qty);
    byMonthType.set(month, bucket);
  }

  const itemTypes = Array.from(itemTypeSet).sort();
  const stacks: StackedMonth[] = months.map((ym) => {
    const bucket = byMonthType.get(ym);
    // ★ 있는 구분만 넣는다. 없는 구분은 entries 에 아예 없다(0 짜리 칸을 만들지 않는다).
    const entries = bucket === undefined ? [] : itemTypes.filter((type) => bucket.has(type)).map((type) => ({ itemType: type, qty: bucket.get(type) as number }));
    return { ym, entries, stackTotal: entries.reduce((sum, entry) => sum + entry.qty, 0) };
  });

  const trendByCode = new Map<string, string[]>();
  for (const row of usable) {
    if (row.level !== 'TOTAL' || row.trendReasonCode === null) continue;
    const bucket = trendByCode.get(row.trendReasonCode) ?? [];
    bucket.push(toYm(row.ym));
    trendByCode.set(row.trendReasonCode, bucket);
  }

  return {
    months,
    total,
    totalSegments: segments(total),
    itemTypes,
    stacks,
    valueRange: extent(total, stacks.map((stack) => (stack.entries.length === 0 ? null : stack.stackTotal))),
    trendReasons: Array.from(trendByCode.entries()).map(([code, monthList]) => ({
      code,
      label: chartReasonLabel(code) ?? code,
      months: monthList,
    })),
    excludedUnknownLevel,
  };
}
