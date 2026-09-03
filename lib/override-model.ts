// Forecast Override 의 타입과 정규화 — renew.prd 17장
//
// 계산은 SQL 이 끝냈습니다. 여기서는 뷰 한 줄을 화면이 쓰는 모양으로 바꾸기만 합니다
// (AGENTS.md 규칙 2).
//
// 조회 함수는 lib/override.ts 에 있습니다. 이 파일을 나눈 이유는 두 가지입니다.
//   ① 순수 함수만 모아 두면 Supabase 클라이언트 없이 테스트할 수 있습니다
//      (lib/recommendation-model.ts 와 같은 이유).
//   ② 사유 코드 목록을 클라이언트 컴포넌트(Override 입력 폼)가 import 합니다.
//      조회 함수가 있는 파일을 'use client' 파일이 부르면 서버 전용 모듈이
//      클라이언트 번들로 끌려 들어옵니다.
//
// 상대 import 에는 .ts 를 붙입니다. npm test 는 node --test 로 이 파일을 그대로
// 실행하므로 확장자를 보완해 주지 않습니다 (error.md #17).

/**
 * Override 사유 코드 8종 — renew.prd 17.2.
 *
 * 코드와 순서는 core.forecast_override.reason_code 의 check 제약(sql/15)과 같고,
 * 라벨은 renew.prd 17.2 의 문구 그대로입니다. 제약에 없는 코드를 여기 두면
 * 저장될 수 없는 값을 화면이 아는 척하게 되고, 제약에 있는 코드를 빠뜨리면
 * 실제로 저장된 값이 영문 원문으로 표에 나옵니다.
 *
 * core.set_forecast_override() 도 같은 목록으로 한 번 더 거릅니다.
 */
export const REASON_CODES = [
  { code: 'NEW_CONTRACT', label: '신규 계약' },
  { code: 'PROMOTION', label: '프로모션' },
  { code: 'NEW_PRODUCT', label: '신제품 출시' },
  { code: 'DISCONTINUED', label: '단종' },
  { code: 'PROJECT', label: '프로젝트성 수요' },
  { code: 'MARKET_CHANGE', label: '시장 변화' },
  { code: 'DATA_ERROR', label: '데이터 오류 보정' },
  { code: 'OTHER', label: '기타' },
] as const;

export type OverrideReasonCode = (typeof REASON_CODES)[number]['code'];

/** 사유를 직접 적어야 하는 코드 — renew.prd 17.2 "OTHER 기타 (텍스트 필수)" */
export const REASON_TEXT_REQUIRED: OverrideReasonCode = 'OTHER';

export function isOverrideReasonCode(value: unknown): value is OverrideReasonCode {
  return REASON_CODES.some((item) => item.code === value);
}

/**
 * 코드 → 한국어 라벨.
 *
 * 모르는 코드는 지어내지 않고 원문을 그대로 돌려줍니다. DB 의 check 제약이 늘었는데
 * 이 목록을 못 따라온 경우, 화면에 영문이 보이는 편이 조용히 빈칸이 되는 것보다 낫습니다.
 */
export function reasonLabel(code: string | null): string | null {
  if (code === null) return null;
  return REASON_CODES.find((item) => item.code === code)?.label ?? code;
}

/** 사유 텍스트가 반드시 필요한가 (OTHER 를 골랐을 때) */
export function requiresReasonText(code: string | null): boolean {
  return code === REASON_TEXT_REQUIRED;
}

// ── 타입 ──────────────────────────────────────────────────────

/** analytics.v_forecast_override 한 줄 = Override 입력 한 건 (유효 + 이력) */
export type OverrideRow = {
  id: number | null;
  itemId: string;
  itemName: string | null;
  /** 'YYYY-MM-DD' */
  period: string;
  runId: string | null;
  modelId: string | null;
  aiForecast: number | null;
  /** 증감입니다. 음수일 수 있습니다 (renew.prd 17.1 의 +300 / −300) */
  overrideQty: number | null;
  consensusForecast: number | null;
  reasonCode: string | null;
  reasonText: string | null;
  createdEmail: string | null;
  createdAt: string | null;
  supersededAt: string | null;
  /** superseded_at 이 비어 있으면 지금 유효한 보정입니다 */
  isActive: boolean;
};

/** analytics.v_forecast_value_add 한 줄 = 실적이 확정된 (품목 × 기간) 하나 */
export type ValueAddRow = {
  itemId: string;
  itemName: string | null;
  period: string;
  actual: number | null;
  aiForecast: number | null;
  consensusForecast: number | null;
  overrideQty: number | null;
  aiAbsError: number | null;
  consensusAbsError: number | null;
  /** 오차를 못 구하면 null 입니다. "개선하지 못했다" 와 "모른다" 는 다릅니다 */
  improved: boolean | null;
  reasonCode: string | null;
  reasonText: string | null;
  overrideEmail: string | null;
};

/** analytics.v_forecast_value_add_summary — 항상 1행 */
export type ValueAddSummary = {
  nPeriods: number;
  aiWape: number | null;
  consensusWape: number | null;
  nImproved: number;
  nWorsened: number;
  /** (AI WAPE − Consensus WAPE) / AI WAPE. 0.12 면 12% 개선 */
  improvementPct: number | null;
};

/** analytics.v_forecast_value_add_by_reason 한 줄 */
export type ValueAddByReason = {
  reasonCode: string | null;
  n: number;
  aiWape: number | null;
  consensusWape: number | null;
  improvementPct: number | null;
};

/** analytics.v_override_excess 한 줄 = 품목 하나 */
export type OverrideExcess = {
  itemId: string;
  itemName: string | null;
  nActive: number;
  nRecent90d: number;
  lastOverrideAt: string | null;
};

// ── 정규화 ────────────────────────────────────────────────────
//
// 값이 없으면 지어내지 않고 null 로 둡니다 (AGENTS.md 규칙 5).

export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function text(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : String(value);
}

/** 건수는 없으면 0 입니다 — 세어 봤더니 0건인 것이지 "모른다" 가 아닙니다 */
export function count(value: unknown): number {
  return num(value) ?? 0;
}

/** 3상태 boolean. "모른다" 를 false 로 접지 않습니다 */
export function bool(value: unknown): boolean | null {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

export function normalizeOverrideRow(row: Record<string, unknown>): OverrideRow {
  return {
    id: num(row.id),
    itemId: String(row.item_id ?? ''),
    itemName: text(row.item_name),
    period: String(row.period ?? ''),
    runId: text(row.run_id),
    modelId: text(row.model_id),
    aiForecast: num(row.ai_forecast),
    overrideQty: num(row.override_qty),
    consensusForecast: num(row.consensus_forecast),
    reasonCode: text(row.reason_code),
    reasonText: text(row.reason_text),
    createdEmail: text(row.created_email),
    createdAt: text(row.created_at),
    supersededAt: text(row.superseded_at),
    // 뷰가 is_active 를 내지만, 없더라도 superseded_at 으로 판정할 수 있습니다.
    isActive:
      bool(row.is_active) ?? (row.superseded_at === null || row.superseded_at === undefined),
  };
}

export function normalizeValueAddRow(row: Record<string, unknown>): ValueAddRow {
  return {
    itemId: String(row.item_id ?? ''),
    itemName: text(row.item_name),
    period: String(row.period ?? ''),
    actual: num(row.actual),
    aiForecast: num(row.ai_forecast),
    consensusForecast: num(row.consensus_forecast),
    overrideQty: num(row.override_qty),
    aiAbsError: num(row.ai_abs_error),
    consensusAbsError: num(row.consensus_abs_error),
    improved: bool(row.improved),
    reasonCode: text(row.reason_code),
    reasonText: text(row.reason_text),
    overrideEmail: text(row.override_email),
  };
}

export function normalizeValueAddSummary(row: Record<string, unknown>): ValueAddSummary {
  return {
    nPeriods: count(row.n_periods),
    aiWape: num(row.ai_wape),
    consensusWape: num(row.consensus_wape),
    nImproved: count(row.n_improved),
    nWorsened: count(row.n_worsened),
    improvementPct: num(row.improvement_pct),
  };
}

export function normalizeValueAddByReason(row: Record<string, unknown>): ValueAddByReason {
  return {
    reasonCode: text(row.reason_code),
    n: count(row.n),
    aiWape: num(row.ai_wape),
    consensusWape: num(row.consensus_wape),
    improvementPct: num(row.improvement_pct),
  };
}

export function normalizeOverrideExcess(row: Record<string, unknown>): OverrideExcess {
  return {
    itemId: String(row.item_id ?? ''),
    itemName: text(row.item_name),
    nActive: count(row.n_active),
    nRecent90d: count(row.n_recent_90d),
    lastOverrideAt: text(row.last_override_at),
  };
}
