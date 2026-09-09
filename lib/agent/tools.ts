// STEP 16 ② Tool 과 Registry — 6회차 슬라이드 36 · 43~46 · 70 (프롬프트 2)
//
// 규칙은 하나입니다.
//
//   ★ Tool 은 화면이 쓰는 것과 **똑같은 lib/scm.ts 함수**를 부릅니다. 이 파일에 Supabase
//     질의문이 한 줄도 없습니다. 두 경로에서 다른 숫자가 나오면 시스템 신뢰가 무너집니다.
//
// 지금 만들 수 있는 Tool 은 4개입니다. 재고 전개 · 안전재고 · 발주 추천 · 알림은 아직
// 데이터 계층이 없으므로 이름만 먼저 만들지 않습니다 (슬라이드 31 · 78).
//
//   getShipmentTrend     출고 추이 · 최근 3/6/12개월 평균 · 추세 배수
//   getDemandProfile     수요 유형 · ADI · CV² · 무수요 비율
//   getOlAccuracy        영업 OL · SCM OL 의 WAPE 와 Bias
//   getBomRequirement    기종 1대에 필요한 CAP · Neutral · 필수옵션 · BOM
//
// 2026-09-10 실데이터 이관 — 재고·리드타임 툴은 없앴습니다. 실데이터에 그 입력이
// 없는데 툴이 남아 있으면, 모델이 폐기된 더미 숫자를 사실처럼 답합니다.
//
// 동적 import 를 쓰는 이유: 이 파일을 node --test 가 그대로 실행합니다. 맨 위에서
// lib/scm.ts 를 정적으로 부르면 서버 전용 Supabase 클라이언트가 딸려 들어와 테스트가
// 모듈 로딩 단계에서 죽습니다. run() 안에서만 부르면 목록 · 스키마 · 역할은 네트워크 없이
// 검사할 수 있습니다.

import type { AppRole } from '../menu.ts';

/** 툴 한 번의 결과 — 슬라이드 43 의 계약 */
export type ToolResult = {
  /** "답할 거리를 찾았는가". 조회 실패도, 행이 없는 것도 false 이고 reason 이 붙습니다 */
  ok: boolean;
  data: unknown;
  /**
   * ★ 이 툴이 돌려준 모든 수치의 평평한 사전입니다.
   *   Guardrail 은 여기 있는 값만 답변에 허용합니다 (슬라이드 59).
   *   값이 없으면 0 이 아니라 null 입니다.
   */
  numbers: Record<string, number | null>;
  /** 데이터 기준시각. 알 수 없으면 null */
  dataAsOf: string | null;
  reason?: string;
};

export type JsonSchemaObject = {
  type: 'object';
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: false;
};

export type AgentTool = {
  name: string;
  /** 한국어 설명. 모델은 이 문장만 보고 툴을 고릅니다 */
  description: string;
  parameters: JsonSchemaObject;
  roles: AppRole[];
  run: (args: Record<string, unknown>) => Promise<ToolResult>;
};

// ── 작은 도구들 ───────────────────────────────────────────────

function fail(reason: string): ToolResult {
  return { ok: false, data: null, numbers: {}, dataAsOf: null, reason };
}

function ok(
  data: unknown,
  numbers: Record<string, number | null>,
  dataAsOf: string | null = null,
): ToolResult {
  return { ok: true, data, numbers, dataAsOf };
}

function argText(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  if (value === null || value === undefined) return null;
  // ★ 숫자로 온 itemId 는 거절합니다. 품목코드는 문자열입니다 (슬라이드 44).
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 행들의 숫자 칸을 numbers 사전에 얹습니다 — `row0.wape` 처럼.
 *
 * 글자 안의 숫자도 함께 싣습니다. 'MA_3M' 같은 이름을 모델이 "이동평균 3개월" 로 풀어 쓰면
 * Guardrail 이 그 3 을 지어낸 값으로 보기 때문입니다.
 */
export function flatten(
  numbers: Record<string, number | null>,
  prefix: string,
  rows: Record<string, unknown>[],
): void {
  rows.forEach((row, index) => {
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'number') {
        numbers[`${prefix}${index}.${key}`] = value;
      } else if (typeof value === 'string' && value !== '') {
        if (/^-?\d+(\.\d+)?$/.test(value)) {
          numbers[`${prefix}${index}.${key}`] = Number(value);
          continue;
        }
        const found = value.match(/\d+(?:\.\d+)?/g) ?? [];
        found.forEach((token, i) => {
          numbers[`${prefix}${index}.${key}.txt${i}`] = Number(token);
        });
      }
    }
  });
}

// ── Tool 4종 ─────────────────────────────────────────────────

const ITEM_ARG: JsonSchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    itemCode: { type: 'string', description: '품목 코드. 비우면 전체 목록에서 상위 몇 건을 봅니다' },
  },
};

const MODEL_ARG: JsonSchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['modelBase'],
  properties: {
    modelBase: { type: 'string', description: '기종 이름 (model_base). 예: ApeosPort C3070' },
  },
};

const FY_ARG: JsonSchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    fySheet: { type: 'string', description: '회계연도. 예: FY25. 비우면 전체를 봅니다' },
    modelBase: { type: 'string', description: '기종 이름. 비우면 상위 몇 건을 봅니다' },
  },
};

/** 목록 툴이 한 번에 돌려줄 최대 행 수 — 모델에게 표를 통째로 넘기지 않습니다 */
const LIST_LIMIT = 10;

const getShipmentTrend: AgentTool = {
  name: 'getShipmentTrend',
  description:
    '품목의 출고 추이를 돌려줍니다 — 관측 개월 수 · 최근 출고량 · 3/6/12개월 이동평균 · 최근 3개월이 12개월 평균의 몇 배인가(추세). "요즘 얼마나 나가나", "출고가 늘었나 줄었나" 같은 질문에 씁니다. 이동평균은 출고가 없던 달을 0으로 포함해 계산된 값입니다.',
  parameters: ITEM_ARG,
  roles: ['ADMIN', 'USER'],
  async run(args) {
    const itemCode = argText(args, 'itemCode');
    const { getShipmentTrends } = await import('../scm.ts');
    const { rows, error } = await getShipmentTrends();
    if (error) return fail(`출고 추이를 조회하지 못했습니다: ${error}`);
    if (rows.length === 0) return fail('NO_SHIPMENT — 출고 실적이 없습니다.');

    const picked = itemCode ? rows.filter((row) => row.itemCode === itemCode) : rows.slice(0, LIST_LIMIT);
    if (itemCode && picked.length === 0) {
      return fail(`UNKNOWN_ITEM — ${itemCode} 은(는) 출고 목록에 없습니다.`);
    }

    const plain = picked.map((row) => ({
      itemCode: row.itemCode,
      description: row.description,
      itemType: row.itemType,
      firstYm: row.firstYm,
      lastYm: row.lastYm,
      nMonths: row.nMonths,
      monthsSinceLast: row.monthsSinceLast,
      totalQty: row.totalQty,
      latestQty: row.latestQty,
      avg3m: row.avg3m,
      avg6m: row.avg6m,
      avg12m: row.avg12m,
      trend3mVs12m: row.trend3mVs12m,
      reasonCode: row.reasonCode,
    }));

    const numbers: Record<string, number | null> = { matched: picked.length, total: rows.length };
    flatten(numbers, 'row', plain as unknown as Record<string, unknown>[]);
    return ok(
      { scope: itemCode ?? `출고량 상위 ${plain.length}건`, total: rows.length, rows: plain },
      numbers,
      picked[0]?.dataAsOf ?? null,
    );
  },
};

const getDemandProfile: AgentTool = {
  name: 'getDemandProfile',
  description:
    '품목의 수요 성격을 돌려줍니다 — 수요 유형(SMOOTH · INTERMITTENT · ERRATIC · LUMPY) · 수요 발생 간격(ADI) · 변동성(CV²) · 무수요 비율. "수요가 규칙적인가", "드물게 나가는 품목인가", "Croston 이 필요한가" 같은 질문에 씁니다. 관측 6개월 미만이면 유형 대신 사유를 돌려줍니다.',
  parameters: ITEM_ARG,
  roles: ['ADMIN', 'USER'],
  async run(args) {
    const itemCode = argText(args, 'itemCode');
    const { getItemDemandProfiles } = await import('../scm.ts');
    const { rows, error } = await getItemDemandProfiles();
    if (error) return fail(`수요 패턴을 조회하지 못했습니다: ${error}`);
    if (rows.length === 0) return fail('NO_SHIPMENT — 수요 패턴 데이터가 없습니다.');

    const picked = itemCode ? rows.filter((row) => row.itemCode === itemCode) : rows.slice(0, LIST_LIMIT);
    if (itemCode && picked.length === 0) {
      return fail(`UNKNOWN_ITEM — ${itemCode} 은(는) 수요 패턴 목록에 없습니다.`);
    }

    const plain = picked.map((row) => ({
      itemCode: row.itemCode,
      description: row.description,
      itemType: row.itemType,
      firstYm: row.firstYm,
      lastYm: row.lastYm,
      nPeriods: row.nPeriods,
      nNonzero: row.nNonzero,
      meanNonzeroQty: row.meanNonzeroQty,
      adi: row.adi,
      cvSquared: row.cvSquared,
      zeroDemandRate: row.zeroDemandRate,
      demandType: row.demandType,
      reasonCode: row.reasonCode,
    }));

    const numbers: Record<string, number | null> = { matched: picked.length, total: rows.length };
    flatten(numbers, 'row', plain as unknown as Record<string, unknown>[]);
    return ok(
      { scope: itemCode ?? `상위 ${plain.length}건`, total: rows.length, rows: plain },
      numbers,
      picked[0]?.dataAsOf ?? null,
    );
  },
};

const getOlAccuracy: AgentTool = {
  name: 'getOlAccuracy',
  description:
    '영업 OL 과 SCM OL 의 예측 정확도를 돌려줍니다 — 기종 × 회계연도별 WAPE(작을수록 정확)와 Bias(양수면 과대예측), 채점에 쓴 행 수. "예측이 얼마나 맞았나", "영업과 SCM 중 어느 쪽이 정확한가", "과대예측인가" 같은 질문에 씁니다. 실적이 없는 행은 채점에서 빠져 있습니다.',
  parameters: FY_ARG,
  roles: ['ADMIN', 'USER'],
  async run(args) {
    const fySheet = argText(args, 'fySheet');
    const modelBase = argText(args, 'modelBase');
    const { getOlAccuracy: readOlAccuracy } = await import('../scm.ts');
    const { rows, error } = await readOlAccuracy();
    if (error) return fail(`OL 정확도를 조회하지 못했습니다: ${error}`);
    if (rows.length === 0) return fail('NO_ACTUAL — 채점할 실적이 없습니다.');

    let matched = rows;
    if (fySheet) matched = matched.filter((row) => row.fySheet === fySheet);
    if (modelBase) matched = matched.filter((row) => row.modelBase === modelBase);
    if ((fySheet || modelBase) && matched.length === 0) {
      return fail(`UNKNOWN_SCOPE — ${[fySheet, modelBase].filter(Boolean).join(' · ')} 에 해당하는 행이 없습니다.`);
    }

    const picked = matched.slice(0, LIST_LIMIT);
    const plain = picked.map((row) => ({
      fySheet: row.fySheet,
      modelBase: row.modelBase,
      biz: row.biz,
      totalAct: row.totalAct,
      nScoredSales: row.nScoredSales,
      salesWape: row.salesWape,
      salesBias: row.salesBias,
      nScoredScm: row.nScoredScm,
      scmWape: row.scmWape,
      scmBias: row.scmBias,
      reasonCode: row.reasonCode,
    }));

    const numbers: Record<string, number | null> = { matched: matched.length, total: rows.length };
    flatten(numbers, 'row', plain as unknown as Record<string, unknown>[]);
    return ok(
      { scope: [fySheet, modelBase].filter(Boolean).join(' · ') || `상위 ${plain.length}건`, total: matched.length, rows: plain },
      numbers,
      picked[0]?.lastYm ?? null,
    );
  },
};

const getBomRequirement: AgentTool = {
  name: 'getBomRequirement',
  description:
    '기종 1대를 팔려면 무엇이 몇 개 필요한지 돌려줍니다 — CAP(판매 구성 단위) · NEUTRAL(본체) · MUST_OPTION(필수 투입 옵션) · SCC · BOM 구성. 복수 기종에 공용으로 쓰이는 부품에는 공용 표시가 붙습니다. "이 기종에 뭐가 들어가나", "옵션이 몇 개 필요한가" 같은 질문에 씁니다.',
  parameters: MODEL_ARG,
  roles: ['ADMIN', 'USER'],
  async run(args) {
    const modelBase = argText(args, 'modelBase');
    if (modelBase === null) return fail('기종 이름(modelBase)이 필요합니다.');

    const { getBomRequirements } = await import('../scm.ts');
    const { rows, error } = await getBomRequirements(modelBase);
    if (error) return fail(`BOM 소요를 조회하지 못했습니다: ${error}`);
    if (rows.length === 0) return fail(`UNKNOWN_MODEL — ${modelBase} 의 BOM 구성이 없습니다.`);

    const picked = rows.slice(0, LIST_LIMIT * 3);
    const plain = picked.map((row) => ({
      partRole: row.partRole,
      itemCode: row.itemCode,
      description: row.description,
      qty: row.qty,
      bomGroup: row.bomGroup,
      nModels: row.nModels,
      commonFlag: row.commonFlag,
    }));

    const numbers: Record<string, number | null> = { total: rows.length, listed: picked.length };
    flatten(numbers, 'row', plain as unknown as Record<string, unknown>[]);
    return ok({ modelBase, total: rows.length, rows: plain }, numbers);
  },
};

// ── Registry ─────────────────────────────────────────────────

export const AGENT_TOOLS: AgentTool[] = [
  getShipmentTrend,
  getDemandProfile,
  getOlAccuracy,
  getBomRequirement,
];

export const AGENT_TOOL_NAMES = AGENT_TOOLS.map((tool) => tool.name);

/**
 * 툴을 더합니다 — 슬라이드 78 의 "후속 확장 순서".
 *
 * ★ 데이터 기능 → 검증된 함수 → Tool 노출 순서를 지킵니다. 아직 없는 데이터를 읽는 툴을
 *   먼저 만들면 실행 오류이거나 환각입니다. 이름이 겹치면 더하지 않습니다.
 */
export function registerTool(tool: AgentTool): void {
  if (AGENT_TOOLS.some((existing) => existing.name === tool.name)) return;
  AGENT_TOOLS.push(tool);
}

/** 이 역할이 부를 수 있는 툴만. 1차 방어는 "보여주지 않는 것" 입니다 (슬라이드 46) */
export function toolsFor(role: AppRole): AgentTool[] {
  return AGENT_TOOLS.filter((tool) => tool.roles.includes(role));
}

export function findTool(name: string): AgentTool | null {
  return AGENT_TOOLS.find((tool) => tool.name === name) ?? null;
}

/** OpenAI 호환 형식으로 변환 — 모델에게는 이름 · 설명 · 인자 모양만 갑니다 */
export function toOpenAiTools(tools: AgentTool[]) {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}
