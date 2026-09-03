// What-If 시뮬레이션 — 타입 · 파라미터 검증 · 정규화 (renew.prd 25장)
//
// 이 파일은 순수 함수만 둡니다. Supabase 도 fetch 도 부르지 않습니다 —
// lib/what-if.test.ts 가 node --test 로 그대로 실행합니다.
// 상대 import 에 .ts 를 붙이는 이유는 error.md #17 입니다.
//
// ★ 여기서 계산하지 않습니다. 시나리오 숫자는 전부 sql/24-what-if.sql 의
//   core.simulate_scenario · core.simulate_scenario_summary 가 냅니다 (AGENTS.md 규칙 2).
//   이 파일이 하는 일은 셋뿐입니다 — 파라미터를 검사하고, URL 에 싣고, 결과를 읽습니다.

import { toReasonCode, toRiskStatus, type ReasonCode, type RiskStatus } from './status.ts';

// ── 파라미터 ──────────────────────────────────────────────────
//
// ★ 키 이름은 sql/24-what-if.sql 의 p_params 와 **글자까지 같아야 합니다.**
//   화면 · AI · URL · DB 가 같은 이름을 쓰는 것이 이 기능의 전부입니다.
//   여기서 이름을 바꾸면 SQL 이 그 키를 모르는 키로 보고 params_applied.ignored 에
//   담아 버립니다 — 오류는 나지 않고 시나리오만 조용히 Base 와 같아집니다.

/** renew.prd 25.1 의 7종을 표현하는 파라미터. 모두 선택입니다 */
export type WhatIfParams = {
  /** 수요 ±% (예: 20 · −20). 예측에 곱합니다 */
  demand_pct?: number;
  /** 리드타임 절대값 (일). lead_time_pct 보다 우선합니다 */
  lead_time_days?: number;
  /** 리드타임 ±% (예: 100 = 두 배) */
  lead_time_pct?: number;
  /** 입고예정 ETA 를 미루는 일수 */
  open_po_delay_days?: number;
  /** 서비스 수준 (0~1 비율). 95 처럼 들어오면 0.95 로 고칩니다 */
  service_level?: number;
  /** 공급처 사용 불가 — 입고예정 제거 + 신규 발주 불가 */
  supplier_unavailable?: boolean;
  /** 대형 계약 수량. 그 기간 적용수요에 더합니다 */
  extra_order_qty?: number;
  /** 대형 계약 기간 'YYYY-MM'. 없으면 모든 기간 */
  extra_order_period?: string;
  /** 프로모션 ±%. 그 기간 예측에 곱합니다 */
  promotion_pct?: number;
  /** 프로모션 기간 'YYYY-MM'. 없으면 모든 기간 */
  promotion_period?: string;
};

/** 숫자 키의 허용 범위. 밖이면 무시하고 ignored 에 담습니다 */
const NUMBER_RANGE: Record<string, { min: number; max: number }> = {
  // −100 이면 수요가 0 입니다. 그 아래는 "음수 수요" 라 뜻이 없습니다.
  demand_pct: { min: -100, max: 1000 },
  lead_time_days: { min: 0, max: 3650 },
  lead_time_pct: { min: -100, max: 1000 },
  open_po_delay_days: { min: 0, max: 3650 },
  // 비율입니다. 0.5 미만은 안전재고를 사실상 없애는 값이라 받지 않습니다.
  service_level: { min: 0.5, max: 0.9999 },
  extra_order_qty: { min: 0, max: 1_000_000_000 },
  promotion_pct: { min: -100, max: 1000 },
};

const PERIOD_KEYS = ['extra_order_period', 'promotion_period'] as const;
const BOOLEAN_KEYS = ['supplier_unavailable'] as const;

/** 이 순서로 화면 폼이 그려집니다 */
export const PARAM_KEYS: (keyof WhatIfParams)[] = [
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
];

export const PARAM_LABEL: Record<keyof WhatIfParams, string> = {
  demand_pct: '수요 증감 (%)',
  lead_time_days: '리드타임 (일)',
  lead_time_pct: '리드타임 증감 (%)',
  open_po_delay_days: '입고 지연 (일)',
  service_level: '서비스 수준',
  supplier_unavailable: '공급처 사용 불가',
  extra_order_qty: '대형 계약 수량',
  extra_order_period: '대형 계약 기간',
  promotion_pct: '프로모션 증감 (%)',
  promotion_period: '프로모션 기간',
};

function readNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || !/^[+-]?\d+(\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const lowered = value.trim().toLowerCase();
  if (lowered === 'true' || lowered === 't' || lowered === '1' || lowered === 'on') return true;
  if (lowered === 'false' || lowered === 'f' || lowered === '0' || lowered === '') return false;
  return null;
}

/** 'YYYY-MM' 만 받습니다. 'YYYY-MM-DD' 는 앞 7자를 씁니다 */
function readPeriod(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const hit = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(trimmed);
  if (!hit) return null;
  const month = Number(hit[2]);
  if (month < 1 || month > 12) return null;
  return `${hit[1]}-${hit[2]}`;
}

export type ParsedParams = {
  params: WhatIfParams;
  /** 알 수 없는 키 · 읽을 수 없는 값 · 범위 밖의 값. 화면이 그대로 보여 줍니다 */
  ignored: string[];
};

/**
 * 밖에서 온 값을 파라미터로 다듬습니다 — URL · 폼 · LLM 이 모두 이 문을 지납니다.
 *
 * ★ 모르는 키를 조용히 버리지 않습니다. 오타 하나로 아무 일도 일어나지 않았는데
 *   시나리오를 돌렸다고 믿는 것이 가장 나쁩니다. 같은 규칙이 SQL 에도 있습니다
 *   (sql/24 의 params_applied.ignored).
 */
export function parseParams(input: unknown): ParsedParams {
  const params: WhatIfParams = {};
  const ignored: string[] = [];

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { params, ignored };
  }

  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (raw === null || raw === undefined || raw === '') continue;

    if ((BOOLEAN_KEYS as readonly string[]).indexOf(key) !== -1) {
      const value = readBoolean(raw);
      if (value === null) ignored.push(key);
      // false 는 "Base 와 같음" 이므로 넣지 않습니다. 넣으면 params_applied 가 지저분해집니다.
      else if (value) params.supplier_unavailable = true;
      continue;
    }

    if ((PERIOD_KEYS as readonly string[]).indexOf(key) !== -1) {
      const value = readPeriod(raw);
      if (value === null) ignored.push(key);
      else if (key === 'extra_order_period') params.extra_order_period = value;
      else params.promotion_period = value;
      continue;
    }

    const range = NUMBER_RANGE[key];
    if (!range) {
      ignored.push(key);
      continue;
    }

    let value = readNumber(raw);
    if (value === null) {
      ignored.push(key);
      continue;
    }

    // 서비스 수준은 95 로도 0.95 로도 옵니다. 표는 비율로 저장됩니다 (core.z_table).
    // 같은 보정이 sql/24 의 fn_scenario_summary 에도 있습니다.
    if (key === 'service_level' && value > 1) value = value / 100;

    if (value < range.min || value > range.max) {
      ignored.push(key);
      continue;
    }

    (params as Record<string, number>)[key] = value;
  }

  return { params, ignored };
}

/** 손잡이를 하나도 쓰지 않았는가 — 그때 시나리오는 Base 와 같습니다 */
export function isEmptyParams(params: WhatIfParams): boolean {
  return Object.keys(params).length === 0;
}

// ── URL 에 싣기 ───────────────────────────────────────────────
//
// ★ 결과는 클라이언트 state 가 아니라 URL 에 있습니다.
//   그래야 시나리오를 그대로 공유할 수 있고 뒤로가기가 동작합니다 (STEP 18 지시서 §4).
//   base64url 을 쓰는 이유는 '+' '/' '=' 가 쿼리 문자열에서 다시 인코딩되지 않게 하려는 것입니다.

export function encodeParams(params: WhatIfParams): string {
  return Buffer.from(JSON.stringify(params), 'utf-8').toString('base64url');
}

/** 읽을 수 없으면 빈 파라미터입니다. 화면이 죽지 않습니다 */
export function decodeParams(encoded: string | null | undefined): ParsedParams {
  if (!encoded) return { params: {}, ignored: [] };
  try {
    return parseParams(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')));
  } catch {
    return { params: {}, ignored: [] };
  }
}

// ── 프리셋 7종 — renew.prd 25.1 ───────────────────────────────
//
// ★ 여기 적힌 숫자(60일 · 0.95 · 500개 · 20일 · 20%)는 **정책값이 아닙니다.**
//   renew.prd 25.1 이 예로 든 출발점이고, 화면의 폼에서 그대로 고칩니다.
//   계산에 쓰이는 정책값(검토 주기 · 여유일 · 기본 서비스 수준)은 코드에 적지 않고
//   core.policy_config 에서 읽습니다 (AGENTS.md 규칙 13 · renew.prd 32장).

export type ScenarioPreset = {
  key: string;
  label: string;
  description: string;
  params: WhatIfParams;
};

export const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    key: 'demand-up',
    label: '수요 +20%',
    description: '예측 수요를 20% 올립니다. 폼에 −20 을 넣으면 반대 방향입니다.',
    params: { demand_pct: 20 },
  },
  {
    key: 'lead-time',
    label: '리드타임 60일',
    description: '계획 리드타임을 60일로 놓습니다. 판정 · 발주 권고일 · 안전재고가 함께 움직입니다.',
    params: { lead_time_days: 60 },
  },
  {
    key: 'open-po-delay',
    label: '입고 90일 지연',
    // ★ 왜 20일(renew.prd 25.1 의 예)이 아니라 90일인가.
    //   재고 전개는 도착 예정일이 이미 지난 입고를 첫 기간으로 당겨 붙입니다
    //   (sql/15 의 greatest(date_trunc('month', eta), first_period)). 진행 중 선적은
    //   대개 그런 상태라, 20일을 미뤄도 여전히 첫 기간에 머물러 **아무것도 달라지지 않습니다.**
    //   기본값이 그러면 사용자는 "입고 지연" 배지와 똑같은 두 열을 보고 기능이 고장 났다고
    //   읽습니다. 달을 넘길 만한 값으로 시작하고, 그래도 흡수되면 화면이 그 사실을 말합니다
    //   (delayAbsorbed).
    description:
      '진행 중 선적의 도착을 90일 미룹니다. 도착 예정일이 이미 지난 선적은 첫 기간으로 ' +
      '당겨 붙으므로, 지연이 달을 넘겨야 전개가 달라집니다.',
    params: { open_po_delay_days: 90 },
  },
  {
    key: 'service-level',
    label: '서비스 수준 95%',
    description: '서비스 수준을 0.95 로 올립니다. Z 가 커져 안전재고와 발주 수량이 늘어납니다.',
    params: { service_level: 0.95 },
  },
  {
    key: 'supplier-unavailable',
    label: '공급처 사용 불가',
    description: '입고예정을 없애고 신규 발주도 불가로 봅니다. 읽을 값은 결품 예상일뿐입니다.',
    params: { supplier_unavailable: true },
  },
  {
    key: 'extra-order',
    label: '대형 계약 500개',
    description: '적용수요에 500개를 더합니다. 기간을 비우면 모든 기간에 더합니다.',
    params: { extra_order_qty: 500 },
  },
  {
    key: 'promotion',
    label: '프로모션 +30%',
    description: '그 기간 예측 수요를 30% 올립니다. 기간을 비우면 모든 기간에 겁니다.',
    params: { promotion_pct: 30 },
  },
];

export function presetOf(key: string | null | undefined): ScenarioPreset | null {
  if (!key) return null;
  return SCENARIO_PRESETS.find((preset) => preset.key === key) ?? null;
}

// ── 결과 읽기 ─────────────────────────────────────────────────

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

/** Base 와 시나리오가 **같은 키**를 씁니다. 화면이 두 열을 같은 코드로 그립니다 */
export type WhatIfSide = {
  stockoutDate: string | null;
  stockoutDays: number | null;
  risk: RiskStatus;
  reason: ReasonCode | null;
  safetyStock: number | null;
  orderQty: number | null;
  rawOrderQty: number | null;
  requiredOrderDate: string | null;
  leadTimeDays: number | null;
  reviewPeriodDays: number | null;
  safetyBufferDays: number | null;
  serviceLevel: number | null;
  zValue: number | null;
  windowDemandQty: number | null;
  dailyDemand: number | null;
  sigmaDlt: number | null;
  currentStock: number | null;
  incomingQty: number | null;
  moq: number | null;
  packSize: number | null;
};

export type WhatIfSummary = {
  itemId: string;
  itemName: string | null;
  supplierId: string | null;
  /** 품목을 찾지 못했으면 false. 다른 품목을 대신 보여 주지 않습니다 */
  found: boolean;
  base: WhatIfSide;
  scenario: WhatIfSide;
  /** DB 가 실제로 적용한 파라미터 */
  paramsApplied: WhatIfParams;
  /** DB 가 모르는 키. 화면이 경고 줄로 보여 줍니다 */
  ignored: string[];
  dataSnapshotAt: string | null;
};

/** core.simulate_scenario 한 줄 = 한 기간 */
export type WhatIfPoint = {
  /** YYYY-MM-DD (월 초) */
  period: string;
  baseClosing: number | null;
  scenarioClosing: number | null;
  baseReceipt: number | null;
  scenarioReceipt: number | null;
  baseDemand: number | null;
  scenarioDemand: number | null;
  baseOpening: number | null;
  scenarioOpening: number | null;
};

const EMPTY_SIDE: WhatIfSide = {
  stockoutDate: null,
  stockoutDays: null,
  risk: 'CALCULATION_UNAVAILABLE',
  reason: null,
  safetyStock: null,
  orderQty: null,
  rawOrderQty: null,
  requiredOrderDate: null,
  leadTimeDays: null,
  reviewPeriodDays: null,
  safetyBufferDays: null,
  serviceLevel: null,
  zValue: null,
  windowDemandQty: null,
  dailyDemand: null,
  sigmaDlt: null,
  currentStock: null,
  incomingQty: null,
  moq: null,
  packSize: null,
};

export function normalizeSide(raw: unknown): WhatIfSide {
  if (raw === null || typeof raw !== 'object') return { ...EMPTY_SIDE };
  const row = raw as Record<string, unknown>;
  return {
    stockoutDate: text(row.stockout_date),
    stockoutDays: num(row.stockout_days),
    risk: toRiskStatus(row.risk),
    reason: toReasonCode(row.reason),
    safetyStock: num(row.safety_stock),
    orderQty: num(row.order_qty),
    rawOrderQty: num(row.raw_order_qty),
    requiredOrderDate: text(row.required_order_date),
    leadTimeDays: num(row.lead_time_days),
    reviewPeriodDays: num(row.review_period_days),
    safetyBufferDays: num(row.safety_buffer_days),
    serviceLevel: num(row.service_level),
    zValue: num(row.z_value),
    windowDemandQty: num(row.window_demand_qty),
    dailyDemand: num(row.daily_demand),
    sigmaDlt: num(row.sigma_dlt),
    currentStock: num(row.current_stock),
    incomingQty: num(row.incoming_qty),
    moq: num(row.moq),
    packSize: num(row.pack_size),
  };
}

export function normalizeSummary(raw: unknown): WhatIfSummary | null {
  if (raw === null || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;

  const applied = (row.params_applied ?? {}) as Record<string, unknown>;
  const ignoredRaw = applied.ignored;
  const ignored = Array.isArray(ignoredRaw) ? ignoredRaw.map((key) => String(key)) : [];
  // ignored 는 파라미터가 아니라 안내입니다. 파라미터 목록에서 빼고 따로 듭니다.
  const appliedWithoutIgnored: Record<string, unknown> = { ...applied };
  delete appliedWithoutIgnored.ignored;

  return {
    itemId: String(row.item_id ?? ''),
    itemName: text(row.item_name),
    supplierId: text(row.supplier_id),
    found: row.found === true,
    base: normalizeSide(row.base),
    scenario: normalizeSide(row.scenario),
    paramsApplied: parseParams(appliedWithoutIgnored).params,
    ignored,
    dataSnapshotAt: text(row.data_snapshot_at),
  };
}

export function normalizePoint(raw: unknown): WhatIfPoint {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    period: String(row.period ?? ''),
    baseClosing: num(row.base_closing),
    scenarioClosing: num(row.scenario_closing),
    baseReceipt: num(row.base_receipt),
    scenarioReceipt: num(row.scenario_receipt),
    baseDemand: num(row.base_demand),
    scenarioDemand: num(row.scenario_demand),
    baseOpening: num(row.base_opening),
    scenarioOpening: num(row.scenario_opening),
  };
}

/**
 * 입고 지연이 **아무것도 바꾸지 못했는가** — 그렇다면 화면이 그 사실을 말해야 합니다.
 *
 * 재고 전개는 도착 예정일이 이미 지난 입고를 첫 기간으로 당겨 붙입니다
 * (sql/15 의 `greatest(date_trunc('month', eta), first_period)`). 그래서 지연이 달을
 * 넘기지 못하면 도착 달이 그대로이고, 두 열이 완전히 같아집니다.
 *
 * 그때 화면이 "입고 지연 90일" 배지와 `± 0일` 델타만 보여 주면, 사용자는 기능이 고장 났거나
 * 이 품목은 지연에 강하다고 읽습니다. 둘 다 사실이 아닙니다 — **바꿀 도착 시점이 없었을
 * 뿐**입니다. 그 둘을 구분해 돌려줍니다.
 *
 *   ETA_ALREADY_DUE  입고는 있는데 예정일이 이미 지나 있다
 *   NO_INBOUND       진행 중 선적 자체가 없다
 *
 * 공급처 사용 불가는 입고를 0 으로 만들어 두 열이 달라지므로 여기에 걸리지 않습니다.
 */
export type DelayAbsorbed = 'ETA_ALREADY_DUE' | 'NO_INBOUND' | null;

export function delayAbsorbed(params: WhatIfParams, series: WhatIfPoint[]): DelayAbsorbed {
  const days = params.open_po_delay_days;
  if (days === undefined || days === 0) return null;
  if (series.length === 0) return null;

  const moved = series.some((point) => point.scenarioReceipt !== point.baseReceipt);
  if (moved) return null;

  const hasInbound = series.some((point) => (point.baseReceipt ?? 0) > 0);
  return hasInbound ? 'ETA_ALREADY_DUE' : 'NO_INBOUND';
}

/** 화면 문구. 문장을 화면에 적지 않고 여기 한 곳에 둡니다 (design.md §12) */
export const DELAY_ABSORBED_MESSAGE: Record<'ETA_ALREADY_DUE' | 'NO_INBOUND', string> = {
  ETA_ALREADY_DUE:
    '이 품목의 입고 예정일이 이미 지나 있어 지연이 도착 시점을 바꾸지 않습니다. ' +
    '재고 전개가 그런 입고를 첫 기간에 넣기 때문입니다 — 지연이 달을 넘겨야 결과가 달라집니다.',
  NO_INBOUND: '이 품목에는 진행 중 선적이 없어 지연이 미룰 입고가 없습니다.',
};

/** 두 값의 차이. 한쪽이라도 없으면 null 입니다 (0 으로 채우지 않습니다) */
export function delta(base: number | null, scenario: number | null): number | null {
  if (base === null || scenario === null) return null;
  return scenario - base;
}

/** 두 날짜의 차이(일). 한쪽이라도 없으면 null 입니다 */
export function dayDelta(base: string | null, scenario: string | null): number | null {
  if (!base || !scenario) return null;
  const a = Date.parse(`${base}T00:00:00Z`);
  const b = Date.parse(`${scenario}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/** 2026-09-01 → 2026-09 */
export function monthOf(period: string): string {
  return period.slice(0, 7);
}
