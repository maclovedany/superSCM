// 자리 ④  품목별 출고 — analytics.v_shipment_monthly_item
//
// ★ 이 뷰는 **출고가 없는 달의 행 자체가 없다.** 실측(2026-09-13): 10,198 품목 중 6,612
//   품목에 내부 결측 달이 있고, 합계 93,984 달, 최대 62 달 연속. 행을 순서대로만 이으면
//   없는 달을 건너뛴 직선이 되어 **그 달에도 출고가 있었던 것처럼** 보인다.
//   그래서 먼저 월 축을 빠짐없이 만들고(densify) 없는 달을 null 자리로 벌린 뒤 끊는다.
// ★ 여기서 생기는 null 은 뷰가 준 사유 코드가 아니라 화면이 만든 자리다 — MONTH_ROW_ABSENT
//   로 따로 이름 붙여 뷰의 사유 코드와 섞지 않는다.
// ★ 품목코드는 선택 인자가 아니다 — getShipmentMonthlyByItem 이 애초에 필터 없는 조회를
//   제공하지 않는다(102,765행, PostgREST 1,000행 상한).

import {
  densify,
  extent,
  monthRange,
  segments,
  toYm,
  MONTH_ROW_ABSENT,
  type Nullable,
  type Segment,
} from './geometry.ts';
import { chartReasonLabel } from './reason-labels.ts';
import type { ShipmentMonthlyItemRow } from '../analytics/model.ts';

export type ShipmentItemChart = {
  itemCode: string;
  itemType: string | null;
  months: string[];
  qty: Nullable[];
  qtySegments: Segment[];
  valueRange: { min: number; max: number } | null;
  /** 행이 없는 달 — 몇 달인지와 그 설명 */
  absentMonths: { code: string; label: string; months: string[] };
  /** 한 대표코드에 합쳐진 원본 코드 수의 최대 — HOC 귀속을 화면이 드러내는 값 */
  maxSourceCodes: number | null;
};

export function buildShipmentItemChart(
  rows: readonly ShipmentMonthlyItemRow[],
  itemCode: string,
): ShipmentItemChart | null {
  const mine = rows.filter((row) => row.itemCode === itemCode && row.ym !== '');
  if (mine.length === 0) return null;

  const yms = mine.map((row) => toYm(row.ym)).sort();
  const months = monthRange(yms[0], yms[yms.length - 1]);
  if (months.length === 0) return null;

  const qty = densify(
    months,
    mine,
    (row) => row.ym,
    (row) => row.qty,
  );

  const present = new Set(mine.map((row) => toYm(row.ym)));
  const absent = months.filter((month) => !present.has(month));

  const sourceCodes = mine.map((row) => row.nSourceCodes).filter((value): value is number => value !== null);

  return {
    itemCode,
    itemType: mine.find((row) => row.itemType !== null)?.itemType ?? null,
    months,
    qty,
    qtySegments: segments(qty),
    valueRange: extent(qty),
    absentMonths: {
      code: MONTH_ROW_ABSENT,
      label: chartReasonLabel(MONTH_ROW_ABSENT) ?? MONTH_ROW_ABSENT,
      months: absent,
    },
    maxSourceCodes: sourceCodes.length === 0 ? null : Math.max(...sourceCodes),
  };
}
