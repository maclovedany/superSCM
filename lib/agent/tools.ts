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
//   getDemandProfile     수요 유형 · ADI · CV² · 무수요 비율
//   getForecastAccuracy  Champion 모델 · WAPE · Bias · 표본 수
//   getStockoutRisk      가용재고 · 일평균 사용량 · 소진 예상일 · 리드타임 · 위험 상태
//   getLeadtimeStats     계획 리드타임 · 실제 평균 · P80 · 격차
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
    itemId: { type: 'string', description: '품목 코드. 비우면 전체 목록에서 상위 몇 건을 봅니다' },
  },
};

/** 목록 툴이 한 번에 돌려줄 최대 행 수 — 모델에게 표를 통째로 넘기지 않습니다 */
const LIST_LIMIT = 10;

const getDemandProfile: AgentTool = {
  name: 'getDemandProfile',
  description:
    '품목의 수요 특성을 돌려줍니다 — 수요 유형(SMOOTH · INTERMITTENT · ERRATIC · LUMPY) · 수요 발생 간격(ADI) · 변동성(CV²) · 무수요 비율 · 추세. "수요가 규칙적인가", "드물게 나가는 품목인가" 같은 질문에 씁니다.',
  parameters: ITEM_ARG,
  roles: ['ADMIN', 'USER'],
  async run(args) {
    const itemId = argText(args, 'itemId');
    const { getDemandProfiles } = await import('../scm.ts');
    const { rows, error } = await getDemandProfiles();
    if (error) return fail(`수요 패턴을 조회하지 못했습니다: ${error}`);
    if (rows.length === 0) return fail('NO_USAGE — 수요 패턴 데이터가 없습니다.');

    const picked = itemId ? rows.filter((row) => row.itemId === itemId) : rows.slice(0, LIST_LIMIT);
    if (itemId && picked.length === 0) {
      return fail(`UNKNOWN_ITEM — ${itemId} 은(는) 수요 패턴 목록에 없습니다.`);
    }

    const plain = picked.map((row) => ({
      itemId: row.itemId,
      itemName: row.itemName,
      demandType: row.demandType,
      adi: row.adi,
      cvSquared: row.cvSquared,
      zeroDemandRate: row.zeroDemandRate,
      nPeriods: row.nPeriods,
      nNonzeroPeriods: row.nNonzeroPeriods,
      recentChangeRate: row.recentChangeRate,
      reasonCode: row.reasonCode,
    }));
    const numbers: Record<string, number | null> = { matched: picked.length, total: rows.length };
    flatten(numbers, 'row', plain as unknown as Record<string, unknown>[]);
    return ok({ scope: itemId ?? `상위 ${plain.length}건`, total: rows.length, rows: plain }, numbers);
  },
};

const getForecastAccuracy: AgentTool = {
  name: 'getForecastAccuracy',
  description:
    '예측 정확도를 돌려줍니다 — 품목별 Champion 모델과 WAPE(오차율) · Bias(치우침) · 표본 수. "예측을 믿을 만한가", "어떤 모델이 뽑혔나" 같은 질문에 씁니다. Bias 가 양수면 과대예측입니다.',
  parameters: ITEM_ARG,
  roles: ['ADMIN', 'USER'],
  async run(args) {
    const itemId = argText(args, 'itemId');
    const { getModelComparison } = await import('../scm.ts');
    const { champions, performance, runs, error } = await getModelComparison();
    if (error) return fail(`예측 검증 결과를 조회하지 못했습니다: ${error}`);
    if (champions.length === 0) {
      return fail('INSUFFICIENT_SAMPLE — 아직 검증(Backtest) 실행 결과가 없습니다.');
    }

    const rows = (itemId
      ? champions.filter((row) => String(row.item_id) === itemId)
      : champions.slice(0, LIST_LIMIT)
    ).map((row) => ({
      itemId: String(row.item_id),
      championModelId: row.champion_model_id === null || row.champion_model_id === undefined ? null : String(row.champion_model_id),
      metric: String(row.champion_metric ?? ''),
      wape: num(row.wape),
      mape: num(row.mape),
      bias: num(row.bias),
      rmse: num(row.rmse),
      selectionMethod: String(row.selection_method ?? ''),
      // 표본 수는 성능 표에서 같은 품목 · 같은 모델의 행에서 가져옵니다 (여기서 계산하지 않습니다).
      nPeriods: num(
        performance.find(
          (p) => String(p.item_id) === String(row.item_id) && String(p.model_id) === String(row.champion_model_id),
        )?.n_periods,
      ),
    }));

    if (itemId && rows.length === 0) {
      return fail(`UNKNOWN_ITEM — ${itemId} 은(는) 채점된 품목 목록에 없습니다.`);
    }

    const latestRun = runs.length > 0 ? runs[0] : null;
    const numbers: Record<string, number | null> = { matched: rows.length, total: champions.length };
    flatten(numbers, 'row', rows as unknown as Record<string, unknown>[]);
    return ok(
      { scope: itemId ?? `상위 ${rows.length}건`, total: champions.length, rows, backtestRunAt: latestRun?.started_at ?? null },
      numbers,
      latestRun?.started_at ? String(latestRun.started_at) : null,
    );
  },
};

const getStockoutRisk: AgentTool = {
  name: 'getStockoutRisk',
  description:
    '재고 소진 위험을 돌려줍니다 — 가용재고 · 일평균 사용량 · 소진 예상 일수와 날짜 · 계획 리드타임 · 위험 상태. "언제 떨어지나", "지금 위험한 품목이 뭔가" 같은 질문에 씁니다. 사용 이력이나 리드타임이 없으면 숫자 대신 사유를 돌려줍니다.',
  parameters: ITEM_ARG,
  roles: ['ADMIN', 'USER'],
  async run(args) {
    const itemId = argText(args, 'itemId');
    const { getStockoutRisks } = await import('../scm.ts');
    const { rows, error } = await getStockoutRisks();
    if (error) return fail(`재고 소진 위험을 조회하지 못했습니다: ${error}`);
    if (rows.length === 0) return fail('NO_USAGE — 재고 소진 분석 대상이 없습니다.');

    const picked = itemId ? rows.filter((row) => row.itemId === itemId) : rows.slice(0, LIST_LIMIT);
    if (itemId && picked.length === 0) {
      return fail(`UNKNOWN_ITEM — ${itemId} 은(는) 재고 목록에 없습니다.`);
    }

    const plain = picked.map((row) => ({
      itemId: row.itemId,
      itemName: row.itemName,
      supplierId: row.supplierId,
      availableQty: row.availableQty,
      dailyUsageAvg: row.dailyUsageAvg,
      stockoutDays: row.stockoutDays,
      stockoutDate: row.stockoutDate,
      plannedLeadTime: row.plannedLeadTime,
      riskStatus: row.riskStatus,
      reason: row.reason,
    }));
    const numbers: Record<string, number | null> = { matched: picked.length, total: rows.length };
    flatten(numbers, 'row', plain as unknown as Record<string, unknown>[]);
    return ok({ scope: itemId ?? `상위 ${plain.length}건`, total: rows.length, rows: plain }, numbers);
  },
};

const getLeadtimeStats: AgentTool = {
  name: 'getLeadtimeStats',
  description:
    '공급처별 리드타임 통계를 돌려줍니다 — 계획(마스터) 리드타임 · 실제 평균 · P80 · 격차 · 표본 수. "납기가 계획보다 늦나", "어느 공급처가 문제인가" 같은 질문에 씁니다. P80 은 과거 납품의 80%가 그 일수 안에 도착했다는 뜻입니다.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: [],
    properties: {
      supplier: { type: 'string', description: '공급처 이름. 비우면 전체' },
    },
  },
  roles: ['ADMIN', 'USER'],
  async run(args) {
    const supplier = argText(args, 'supplier');
    const { getLeadtimeGap } = await import('../scm.ts');
    const { rows, error } = await getLeadtimeGap();
    if (error) return fail(`리드타임 격차를 조회하지 못했습니다: ${error}`);
    if (rows.length === 0) return fail('NO_LEADTIME — 리드타임 실적이 없습니다.');

    const needle = supplier ? supplier.toLowerCase() : null;
    const picked = needle
      ? rows.filter((row) => row.supplier.toLowerCase().includes(needle))
      : rows.slice(0, LIST_LIMIT);
    if (needle && picked.length === 0) {
      return fail(`UNKNOWN_SUPPLIER — ${supplier} 에 맞는 공급처가 없습니다.`);
    }

    const plain = picked.map((row) => ({
      supplier: row.supplier,
      country: row.country,
      masterLeadTime: row.masterLeadTime,
      actualAverage: row.actualAverage,
      p80: row.p80,
      gap: row.gap,
      sampleCount: row.sampleCount,
    }));
    const numbers: Record<string, number | null> = { matched: picked.length, total: rows.length };
    flatten(numbers, 'row', plain as unknown as Record<string, unknown>[]);
    return ok({ scope: supplier ?? `상위 ${plain.length}건`, total: rows.length, rows: plain }, numbers);
  },
};

// ── Registry ─────────────────────────────────────────────────

export const AGENT_TOOLS: AgentTool[] = [
  getDemandProfile,
  getForecastAccuracy,
  getStockoutRisk,
  getLeadtimeStats,
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
