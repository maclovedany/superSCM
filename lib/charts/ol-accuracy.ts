// 자리 ③  OL 예측 정확도 — analytics.v_ol_accuracy
//
// 영업 OL 과 SCM OL 의 WAPE · Bias 를 회계연도별로 나란히 본다.
//
// ★ WAPE 가 null 인 것과 0 인 것은 정반대의 사실이다. 0 은 **완벽하게 맞혔다**는 뜻이고,
//   null 은 **채점할 실적이 없다**는 뜻이다. null 을 0 으로 그리면 최악의 칸이 최고의 칸으로
//   뒤집힌다 — 이 차트에서 `?? 0` 이 가장 위험한 자리다.
//   실측(2026-09-13): 117행 중 sales_wape null 8행 · scm_wape null 7행 · 둘 다 null 7행
//   (그 7행의 reason_code 는 NO_ACTUAL).
// ★ Bias 는 부호가 뜻을 가진다(양수 = 과대예측). 0 기준선을 기준으로 양쪽으로 그린다.

import { chartReasonLabel } from './reason-labels.ts';
import type { OlAccuracy } from '../scm-model.ts';

/** 막대 하나 — 값이 없으면 막대를 그리지 않고 사유만 남긴다. */
export type AccuracyBar = {
  value: number | null;
  reasonCode: string | null;
  reasonLabel: string | null;
};

export type AccuracyGroup = {
  key: string;
  modelBase: string;
  fySheet: string;
  biz: string | null;
  salesWape: AccuracyBar;
  scmWape: AccuracyBar;
  salesBias: AccuracyBar;
  scmBias: AccuracyBar;
};

export type OlAccuracyChart = {
  groups: AccuracyGroup[];
  /** WAPE 축의 최대값 — 값이 하나도 없으면 null */
  wapeMax: number | null;
  /** Bias 축은 0 을 가운데 두므로 절대값 최대가 필요하다 */
  biasAbsMax: number | null;
  /** 값이 없어 막대를 못 그린 칸 수 */
  missingBars: number;
};

function bar(value: number | null, reasonCode: string | null): AccuracyBar {
  // ★ 값이 없으면 null 그대로 둔다. 0 으로 바꾸면 "오차 0%"라는 정반대 사실이 된다.
  if (value === null) {
    const code = reasonCode ?? 'CALCULATION_UNAVAILABLE';
    return { value: null, reasonCode: code, reasonLabel: chartReasonLabel(code) };
  }
  return { value, reasonCode: null, reasonLabel: null };
}

export function buildOlAccuracyChart(rows: readonly OlAccuracy[], fySheet?: string): OlAccuracyChart | null {
  const mine = fySheet === undefined ? [...rows] : rows.filter((row) => row.fySheet === fySheet);
  if (mine.length === 0) return null;

  const groups: AccuracyGroup[] = mine.map((row) => ({
    key: `${row.fySheet}·${row.modelBase}`,
    modelBase: row.modelBase,
    fySheet: row.fySheet,
    biz: row.biz,
    salesWape: bar(row.salesWape, row.reasonCode),
    scmWape: bar(row.scmWape, row.reasonCode),
    salesBias: bar(row.salesBias, row.reasonCode),
    scmBias: bar(row.scmBias, row.reasonCode),
  }));

  let wapeMax = Number.NEGATIVE_INFINITY;
  let biasAbsMax = Number.NEGATIVE_INFINITY;
  let missingBars = 0;
  for (const group of groups) {
    for (const each of [group.salesWape, group.scmWape]) {
      if (each.value === null) missingBars += 1;
      else wapeMax = Math.max(wapeMax, each.value);
    }
    for (const each of [group.salesBias, group.scmBias]) {
      if (each.value === null) missingBars += 1;
      else biasAbsMax = Math.max(biasAbsMax, Math.abs(each.value));
    }
  }

  return {
    groups,
    wapeMax: Number.isFinite(wapeMax) ? wapeMax : null,
    biasAbsMax: Number.isFinite(biasAbsMax) ? biasAbsMax : null,
    missingBars,
  };
}

/** 회계연도 목록 — 화면의 선택지. */
export function accuracyFySheets(rows: readonly OlAccuracy[]): string[] {
  return Array.from(new Set(rows.map((row) => row.fySheet))).sort();
}
