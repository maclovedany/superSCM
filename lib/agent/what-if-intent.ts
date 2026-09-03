// 자연어 → What-If 파라미터 — renew.prd 25.2 마지막 줄
//
//   "자연어 요청도 지원한다. 'A공급처 리드타임이 두 배가 되면?' 같은 질의를
//    파라미터로 변환해 실행한다."
//
// ★★ LLM 은 **파라미터만** 만듭니다. 숫자를 계산하지 않습니다 (renew.prd 26.1).
//    "두 배" 를 lead_time_pct: 100 으로 옮기는 것이 여기서 하는 전부이고,
//    그 파라미터로 무엇이 나오는지는 sql/24 의 함수가 계산합니다.
//    그래서 이 파일은 runAgent(오케스트레이터)를 쓰지 않습니다 — 툴 호출도, Guardrail 도
//    필요 없습니다. chatCompletion 을 JSON 스키마로 **한 번** 부르고 끝입니다.
//
// ★ 실패하거나 설정되지 않았으면 { error } 를 돌려줍니다. 화면은 수동 폼으로 그대로 돕니다
//   (renew.prd 31.4 — LLM 이 죽어도 나머지는 돌아야 합니다).
//
// 상대 import 에 .ts 를 붙이는 이유는 error.md #17 입니다.

import { chatCompletion, readLlmConfig, type ResponseFormat } from './llm.ts';
import { parseParams, type WhatIfParams } from '../what-if-model.ts';

export type WhatIfIntent = {
  /** 찾아낸 품목코드. 못 찾으면 null 이고 화면이 칩으로 고르게 합니다 */
  itemId: string | null;
  /** 모델이 말한 품목 표현 그대로 (코드일 수도 이름일 수도 있습니다) */
  itemHint: string | null;
  params: WhatIfParams;
  /** 모델이 만든 값 중 받지 못한 것 */
  ignored: string[];
};

/**
 * Structured Outputs 스키마.
 *
 * strict 모드는 모든 property 를 required 로 요구하고 additionalProperties 를 금지합니다.
 * "선택" 은 타입에 null 을 더해 표현합니다 (lib/agent/schema.ts 와 같은 규칙).
 */
export const WHAT_IF_JSON_SCHEMA = {
  name: 'what_if_intent',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['item', 'params'],
    properties: {
      item: {
        type: ['string', 'null'],
        description: '품목코드(ITEM012) 또는 품목명. 질문에 없으면 null',
      },
      params: {
        type: 'object',
        additionalProperties: false,
        required: [
          'demand_pct',
          'lead_time_days',
          'lead_time_pct',
          'open_po_delay_days',
          'service_level',
          'supplier_unavailable',
          'extra_order_qty',
          'extra_order_period',
          'promotion_pct',
          'promotion_period',
        ],
        properties: {
          demand_pct: { type: ['number', 'null'], description: '수요 증감 %. +20 / -20' },
          lead_time_days: { type: ['number', 'null'], description: '리드타임 절대값(일). 60' },
          lead_time_pct: { type: ['number', 'null'], description: '리드타임 증감 %. 두 배면 100' },
          open_po_delay_days: { type: ['number', 'null'], description: '입고예정 지연(일). 20' },
          service_level: { type: ['number', 'null'], description: '서비스 수준 비율. 95% 면 0.95' },
          supplier_unavailable: {
            type: ['boolean', 'null'],
            description: '공급처를 쓸 수 없으면 true',
          },
          extra_order_qty: { type: ['number', 'null'], description: '추가 계약 수량. 500' },
          extra_order_period: { type: ['string', 'null'], description: "기간 'YYYY-MM'" },
          promotion_pct: { type: ['number', 'null'], description: '프로모션 증감 %. 30' },
          promotion_period: { type: ['string', 'null'], description: "기간 'YYYY-MM'" },
        },
      },
    },
  },
};

/**
 * ★ 캐스팅에 대하여.
 *
 * lib/agent/llm.ts 의 ResponseFormat 은 STEP 16 의 답변 스키마 하나에 묶여 있습니다
 * (`json_schema: typeof ANSWER_JSON_SCHEMA`). 그 타입을 넓히려면 STEP 16 파일을
 * 고쳐야 하므로, 여기서 한 번만 좁혀서 넘깁니다. llm.ts 는 이 값을 그대로
 * response_format 에 실어 보낼 뿐이고, 서버가 400 을 주면 json_object 로 한 번
 * 낮춰 다시 겁니다 — 그때는 아래 시스템 프롬프트의 설명이 스키마 역할을 합니다.
 */
const WHAT_IF_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: WHAT_IF_JSON_SCHEMA,
} as unknown as ResponseFormat;

const SYSTEM_PROMPT = [
  '당신은 SCM 시나리오 질문을 파라미터로 옮기는 변환기입니다.',
  '',
  '★ 숫자를 계산하지 마세요. 결품일 · 안전재고 · 발주 수량은 전부 시스템이 계산합니다.',
  '  당신이 하는 일은 질문에 적힌 가정을 아래 키로 옮기는 것뿐입니다.',
  '',
  '키',
  '  demand_pct            수요 증감 %.  "수요가 20% 늘면" → 20,  "20% 줄면" → -20',
  '  lead_time_days        리드타임 절대값(일).  "리드타임이 60일이 되면" → 60',
  '  lead_time_pct         리드타임 증감 %.      "두 배가 되면" → 100,  "절반" → -50',
  '  open_po_delay_days    입고예정 지연(일).    "배가 20일 늦으면" → 20',
  '  service_level         서비스 수준 비율.     "95%로 올리면" → 0.95',
  '  supplier_unavailable  공급처를 쓸 수 없으면 true',
  '  extra_order_qty       추가 계약 수량.       "500개 계약이 들어오면" → 500',
  '  extra_order_period    그 계약의 기간 YYYY-MM (없으면 null)',
  '  promotion_pct         프로모션 증감 %.      "프로모션으로 30% 더 팔리면" → 30',
  '  promotion_period      그 프로모션의 기간 YYYY-MM (없으면 null)',
  '',
  '규칙',
  '  · 질문에 없는 키는 반드시 null 로 두세요. 짐작해서 채우지 마세요.',
  '  · "두 배" 처럼 배율로 말하면 lead_time_pct 를 쓰고, 일수를 말하면 lead_time_days 를 쓰세요.',
  '  · item 에는 질문에 나온 품목코드나 품목명을 그대로 적으세요. 없으면 null 입니다.',
  '  · 설명 문장을 쓰지 말고 JSON 만 돌려주세요.',
].join('\n');

/** 품목 목록에서 코드나 이름으로 찾습니다. 순수 함수라 테스트가 그대로 실행합니다 */
export function resolveItemId(
  hint: string | null,
  items: { itemId: string; itemName: string | null }[],
): string | null {
  if (!hint) return null;
  const needle = hint.trim();
  if (needle === '') return null;

  const normalized = needle.toUpperCase().replace(/[\s\-_]/g, '');
  const byCode = items.find((item) => item.itemId.toUpperCase() === normalized);
  if (byCode) return byCode.itemId;

  const byName = items.find((item) => (item.itemName ?? '').trim() === needle);
  if (byName) return byName.itemId;

  // 부분 일치는 딱 하나일 때만 받습니다. 둘 이상이면 고르지 않고 화면에 넘깁니다 —
  // 엉뚱한 품목의 시나리오를 말없이 보여 주는 것이 가장 나쁩니다.
  const partial = items.filter((item) => (item.itemName ?? '').includes(needle));
  return partial.length === 1 ? partial[0].itemId : null;
}

export type IntentOptions = {
  /** 테스트용 주입 */
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
  /** 품목 목록을 밖에서 넘기면 조회하지 않습니다 */
  items?: { itemId: string; itemName: string | null }[];
};

/**
 * 자연어 한 줄을 { item_id, params } 로 옮깁니다. LLM 을 한 번만 부릅니다.
 *
 * 품목 목록은 analytics.v_projection_item 에서 읽습니다. core.v_item_master 가 아니라
 * analytics 뷰를 보는 이유는 AGENTS.md 규칙 3 입니다 — 화면 경로는 analytics 만 읽습니다.
 * 그 뷰는 analytics.v_stockout_risk 에서 나오므로 활성 품목 전부가 들어 있습니다.
 */
export async function extractWhatIfIntent(
  question: string,
  options: IntentOptions = {},
): Promise<{ intent: WhatIfIntent | null; error: string | null }> {
  const asked = (question ?? '').trim();
  if (asked === '') return { intent: null, error: '질문을 입력해주세요.' };

  const config = readLlmConfig(options.env);
  if (!config.configured) {
    return {
      intent: null,
      error:
        `AI 가 설정되지 않았습니다 (${config.missing.join(' · ')}). ` +
        '아래 폼에서 직접 파라미터를 넣어 시나리오를 돌릴 수 있습니다.',
    };
  }

  const result = await chatCompletion({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: asked },
    ],
    responseFormat: WHAT_IF_RESPONSE_FORMAT,
    temperature: 0,
    fetchImpl: options.fetchImpl,
    env: options.env,
    signal: options.signal,
  });

  if (result.error) return { intent: null, error: result.error };

  const content = result.message.content;
  if (!content) return { intent: null, error: 'AI 가 빈 응답을 돌려주었습니다.' };

  let payload: unknown;
  try {
    payload = JSON.parse(content);
  } catch {
    return { intent: null, error: 'AI 응답을 JSON 으로 읽지 못했습니다.' };
  }

  if (payload === null || typeof payload !== 'object') {
    return { intent: null, error: 'AI 응답의 모양이 예상과 다릅니다.' };
  }

  const row = payload as Record<string, unknown>;
  const hint = typeof row.item === 'string' && row.item.trim() !== '' ? row.item.trim() : null;
  const parsed = parseParams(row.params);

  if (Object.keys(parsed.params).length === 0) {
    // ★ 모델이 값을 내긴 했는데 전부 범위 밖이면 "찾지 못했습니다" 는 사실과 다릅니다.
    //   무엇이 왜 빠졌는지 말해야 사용자가 폼에서 고쳐 넣을 수 있습니다
    //   (app/(user)/what-if/actions.ts 의 rejectedMessage 와 같은 취지).
    if (parsed.ignored.length > 0) {
      return {
        intent: null,
        error:
          `AI 가 옮긴 값을 받을 수 없습니다: ${parsed.ignored.join(' · ')}. ` +
          '범위를 확인해 아래 폼에서 직접 넣어 주세요.',
      };
    }
    return {
      intent: null,
      error:
        '질문에서 바꿀 가정을 찾지 못했습니다. ' +
        '"리드타임이 두 배가 되면?" 처럼 무엇을 어떻게 바꿀지 적어주세요.',
    };
  }

  let items = options.items;
  if (!items && hint) {
    const { getProjectionItems } = await import('../inventory.ts');
    const loaded = await getProjectionItems();
    items = loaded.rows.map((item) => ({ itemId: item.itemId, itemName: item.itemName }));
  }

  return {
    intent: {
      itemId: resolveItemId(hint, items ?? []),
      itemHint: hint,
      params: parsed.params,
      ignored: parsed.ignored,
    },
    error: null,
  };
}
