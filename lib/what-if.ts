// What-If 시뮬레이션 조회 — renew.prd 25장
//
// 계산은 SQL 이 끝냈습니다. 여기서는 rpc 두 번과 정규화만 합니다 (AGENTS.md 규칙 2).
// 타입 · 파라미터 검증 · 프리셋은 lib/what-if-model.ts 에 있습니다 (테스트가 그쪽만 봅니다).
//
// ★ 실제 데이터를 바꾸지 않습니다 (renew.prd 25.2).
//   두 함수 모두 core 의 `stable` 함수라 본문에서 쓰기가 불가능합니다.
//   실행 기록(core.what_if_log)은 화면의 Server Action 이 따로 남깁니다.

import { createSupabaseServerClient } from './supabase/server';
import {
  normalizePoint,
  normalizeSummary,
  type WhatIfParams,
  type WhatIfPoint,
  type WhatIfSummary,
} from './what-if-model';

export type {
  DelayAbsorbed,
  ParsedParams,
  ScenarioPreset,
  WhatIfParams,
  WhatIfPoint,
  WhatIfSide,
  WhatIfSummary,
} from './what-if-model';

export {
  DELAY_ABSORBED_MESSAGE,
  PARAM_KEYS,
  PARAM_LABEL,
  SCENARIO_PRESETS,
  dayDelta,
  decodeParams,
  delayAbsorbed,
  delta,
  encodeParams,
  isEmptyParams,
  monthOf,
  parseParams,
  presetOf,
} from './what-if-model';

export type WhatIfResult = {
  series: WhatIfPoint[];
  summary: WhatIfSummary | null;
  error: string | null;
};

/**
 * 한 품목의 Base 와 시나리오를 함께 가져옵니다.
 *
 * rpc 두 번입니다 — 기간별(차트 · 표)과 요약(KPI 카드). 한 번에 합치지 않는 이유는
 * 요약이 jsonb 한 덩이고 기간별은 행 집합이라, 합치면 화면이 다시 풀어야 하기 때문입니다.
 *
 * 조회 실패와 빈 결과를 구분합니다 (AGENTS.md 규칙 3).
 * 영업 사용자가 부르면 DB 가 예외를 던집니다 — 그 문장을 그대로 error 로 올립니다.
 */
export async function runWhatIf(
  itemId: string,
  params: WhatIfParams,
): Promise<WhatIfResult> {
  if (!itemId || itemId.trim() === '') {
    return { series: [], summary: null, error: '품목을 선택해주세요.' };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const args = { p_item_id: itemId, p_params: params };

    const [series, summary] = await Promise.all([
      supabase.schema('core').rpc('simulate_scenario', args),
      supabase.schema('core').rpc('simulate_scenario_summary', args),
    ]);

    if (series.error) {
      return { series: [], summary: null, error: `시뮬레이션에 실패했습니다: ${series.error.message}` };
    }
    if (summary.error) {
      return { series: [], summary: null, error: `시뮬레이션에 실패했습니다: ${summary.error.message}` };
    }

    return {
      series: (Array.isArray(series.data) ? series.data : []).map((row) => normalizePoint(row)),
      summary: normalizeSummary(summary.data),
      error: null,
    };
  } catch (error) {
    return {
      series: [],
      summary: null,
      error: error instanceof Error ? error.message : '시뮬레이션에 실패했습니다.',
    };
  }
}

/**
 * 실행 기록 한 줄 — core.what_if_log.
 *
 * ★ 계산 안에서 쓰지 않습니다 (renew.prd 25.2). 이 함수만 씁니다.
 *   기록에 실패해도 시뮬레이션을 막지 않습니다. 감사 로그와 같은 태도입니다 (lib/audit.ts).
 *   asked_by 는 RLS 의 with check 가 auth.uid() 와 대조하므로 남의 이름으로 심을 수 없습니다.
 */
export async function logWhatIf(entry: {
  itemId: string;
  params: WhatIfParams;
  askedBy: string;
  askedEmail: string;
  naturalLanguage?: string | null;
}): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .schema('core')
      .from('what_if_log')
      .insert({
        item_id: entry.itemId,
        params: entry.params,
        natural_language: entry.naturalLanguage ?? null,
        asked_by: entry.askedBy,
        asked_email: entry.askedEmail,
      });

    if (error) console.error('[what-if] 실행 기록 실패:', error.message, entry.itemId);
  } catch (error) {
    console.error('[what-if] 실행 기록 실패:', error);
  }
}
