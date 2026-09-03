// 승인 · 결정 이력의 타입과 정규화 — renew.prd 23장 · 31.2 · 32
//
// 계산은 SQL 이 끝냈습니다. 여기서는 뷰 한 줄을 화면이 쓰는 모양으로 바꾸기만 합니다
// (AGENTS.md 규칙 2).
//
// 조회 함수는 lib/approval.ts 에 있습니다. 이 파일을 나눈 이유는
// lib/override-model.ts 를 나눈 이유와 같습니다.
//   ① 순수 함수만 모아 두면 Supabase 클라이언트 없이 테스트할 수 있습니다
//   ② 사유 코드 목록을 클라이언트 컴포넌트(승인 폼)가 import 합니다.
//      조회 함수가 있는 파일을 'use client' 파일이 부르면 서버 전용 모듈이
//      클라이언트 번들로 끌려 들어옵니다.
//
// 상대 import 에는 .ts 를 붙입니다. npm test 는 node --test 로 이 파일을 그대로
// 실행하므로 확장자를 보완해 주지 않습니다 (error.md #17).

import {
  normalizeConsensusRow,
  normalizePurchaseRecommendation,
  normalizeSafetyStock,
  normalizeSkuDetail,
  type ConsensusRow,
  type PurchaseRecommendation,
  type SafetyStock,
  type SkuDetail,
} from './recommendation-model.ts';

// ── 코드 체계 ─────────────────────────────────────────────────

/**
 * 승인 사유 코드 7종 — renew.prd 23.1.
 *
 * 코드와 순서는 core.approval.reason_code 의 check 제약(sql/19)과 같고,
 * 라벨은 core.approval_reason_label() 과 같은 문구입니다.
 * 제약에 없는 코드를 여기 두면 저장될 수 없는 값을 화면이 아는 척하게 되고,
 * 제약에 있는 코드를 빠뜨리면 실제로 저장된 값이 영문 원문으로 표에 나옵니다.
 *
 * lib/approval.test.ts 가 sql/19-approval.sql 의 라벨과 이 목록을 대조합니다.
 */
export const APPROVAL_REASON_CODES = [
  { code: 'AS_RECOMMENDED', label: '추천대로' },
  { code: 'BUDGET', label: '예산 제약' },
  { code: 'SUPPLIER_CAPACITY', label: '공급처 생산능력' },
  { code: 'LEAD_TIME', label: '리드타임 변동' },
  { code: 'DEMAND_INFO', label: '현장 수요 정보' },
  { code: 'DATA_ERROR', label: '데이터 오류' },
  { code: 'OTHER', label: '기타' },
] as const;

export type ApprovalReasonCode = (typeof APPROVAL_REASON_CODES)[number]['code'];

/** 사유를 직접 적어야 하는 코드 — renew.prd 23.1 */
export const APPROVAL_REASON_TEXT_REQUIRED: ApprovalReasonCode = 'OTHER';

/** 추천 수량을 그대로 승인했을 때만 고를 수 있는 코드 */
export const AS_RECOMMENDED: ApprovalReasonCode = 'AS_RECOMMENDED';

/** renew.prd 23 — 사람이 내리는 세 가지 결정 */
export const DECISIONS = ['APPROVED', 'REJECTED', 'DEFERRED'] as const;

export type Decision = (typeof DECISIONS)[number];

/** core.decision_label() 과 같은 문구여야 합니다 */
export const DECISION_LABEL: Record<Decision, string> = {
  APPROVED: '승인',
  REJECTED: '반려',
  DEFERRED: '보류',
};

/** design.md §6.6 — 배지 색. 결정마다 뜻이 다르므로 색도 다릅니다 */
export const DECISION_TONE: Record<Decision, 'safe' | 'crit' | 'warn'> = {
  APPROVED: 'safe',
  REJECTED: 'crit',
  DEFERRED: 'warn',
};

/** analytics.v_decision_history.kind — 사람이 시스템에 남긴 결정의 종류 */
export const DECISION_KINDS = ['APPROVAL', 'OVERRIDE', 'CHAMPION', 'LEADTIME'] as const;

export type DecisionKind = (typeof DECISION_KINDS)[number];

export const KIND_LABEL: Record<DecisionKind, string> = {
  APPROVAL: '승인',
  OVERRIDE: '보정',
  CHAMPION: 'Champion',
  LEADTIME: '리드타임',
};

export const KIND_TONE: Record<DecisionKind, 'info' | 'warn' | 'plain'> = {
  APPROVAL: 'info',
  OVERRIDE: 'warn',
  CHAMPION: 'plain',
  LEADTIME: 'plain',
};

export function isApprovalReasonCode(value: unknown): value is ApprovalReasonCode {
  return APPROVAL_REASON_CODES.some((item) => item.code === value);
}

export function isDecision(value: unknown): value is Decision {
  return DECISIONS.some((item) => item === value);
}

/**
 * 코드 → 한국어 라벨.
 *
 * 모르는 코드는 지어내지 않고 원문을 그대로 돌려줍니다 (lib/override-model.ts 와 같은 이유).
 */
export function approvalReasonLabel(code: string | null): string | null {
  if (code === null) return null;
  return APPROVAL_REASON_CODES.find((item) => item.code === code)?.label ?? code;
}

export function decisionLabel(decision: string | null): string | null {
  if (decision === null) return null;
  return isDecision(decision) ? DECISION_LABEL[decision] : decision;
}

export function kindLabel(kind: string | null): string | null {
  if (kind === null) return null;
  return isDecisionKind(kind) ? KIND_LABEL[kind] : kind;
}

export function isDecisionKind(value: unknown): value is DecisionKind {
  return DECISION_KINDS.some((item) => item === value);
}

/** 사유 텍스트가 반드시 필요한가 (기타 를 골랐을 때) */
export function requiresApprovalReasonText(code: string | null): boolean {
  return code === APPROVAL_REASON_TEXT_REQUIRED;
}

/**
 * '추천대로' 를 고를 수 있는가 — core.approve_recommendation() 의 판정과 같은 규칙입니다.
 *
 * renew.prd 23 은 "추천 확인 → 필요시 수정 → 수정 사유 입력" 순서입니다.
 * 수량을 바꿨는데 '추천대로' 를 고르면 왜 바꿨는지가 기록에서 사라집니다.
 *
 * 추천 수량을 산출하지 못한 품목은 "추천대로" 라고 말할 대상이 없으므로 false 입니다.
 * 화면과 액션이 같은 판정을 쓰되, 최종 판정은 DB 함수가 합니다 —
 * 추천 수량을 화면이 보낸 값으로 믿지 않기 위해서입니다.
 */
export function canUseAsRecommended(
  decision: string | null,
  approvedQty: number | null,
  recommendedQty: number | null,
): boolean {
  if (decision !== 'APPROVED') return false;
  if (recommendedQty === null || approvedQty === null) return false;
  return approvedQty === recommendedQty;
}

// ── 타입 ──────────────────────────────────────────────────────

/** analytics.v_approval 한 줄 = 결정 한 건 (snapshot 제외) */
export type ApprovalRow = {
  approvalId: number;
  itemId: string;
  itemName: string | null;
  supplierId: string | null;
  recommendationRunId: string | null;
  /** 승인 시점의 AI 추천 수량. 산출 불가였다면 null 입니다 */
  recommendedQty: number | null;
  approvedQty: number | null;
  /** 승인 − 추천. 추천을 모르면 조정량도 null 입니다 (0 이 아닙니다) */
  adjustment: number | null;
  decision: Decision | null;
  reasonCode: string | null;
  reasonText: string | null;
  approvedEmail: string | null;
  approvedAt: string | null;
  status: string | null;
  /** 지금 유효한 결정인가. 한 품목에 하나뿐입니다 */
  isActive: boolean;
};

/** analytics.v_decision_history 한 줄 = 사람이 남긴 결정 하나 */
export type DecisionHistoryRow = {
  kind: DecisionKind | null;
  /** 승인이면 approval_id · 보정이면 override id · 리드타임이면 이력 id */
  refId: string | null;
  itemId: string | null;
  itemName: string | null;
  /** 리드타임 변경은 품목이 아니라 공급처에 붙습니다 */
  supplierId: string | null;
  actorEmail: string | null;
  at: string | null;
  /** 승인 행에만 있습니다 */
  decision: Decision | null;
  adjustment: number | null;
  reasonCode: string | null;
  /** SQL 이 조립한 한국어 한 줄. 화면 · CSV · AI 가 같은 문장을 씁니다 */
  summary: string | null;
};

/** analytics.v_approval_kpi — 항상 1행 */
export type ApprovalKpi = {
  activeCount: number;
  approvedCount: number;
  rejectedCount: number;
  deferredCount: number;
  /** 추천을 그대로 승인하지 않고 수량을 고친 건수 */
  adjustedCount: number;
  /** 발주가 필요한데 유효한 결정이 없는 품목 수 */
  pendingCount: number;
  thisMonthCount: number;
};

/** analytics.v_purchase_recommendation_with_approval — 발주 추천 + 유효한 결정 */
export type RecommendationWithApproval = PurchaseRecommendation & {
  approvalId: number | null;
  approvalStatus: Decision | null;
  approvedQty: number | null;
  adjustment: number | null;
  approvedEmail: string | null;
  approvedAt: string | null;
  hasActiveApproval: boolean;
  /**
   * 발주가 필요한데 아직 결정하지 않았는가.
   *
   * 뷰가 판정합니다. 추천 수량을 산출하지 못한 품목은 발주가 필요한지도 모르므로
   * false 가 아니라 null 입니다 (AGENTS.md 규칙 5).
   */
  isPending: boolean | null;
};

/** Snapshot 안의 재고 전개 한 줄. 승인 시점에 저장된 값입니다 */
export type SnapshotProjectionRow = {
  period: string;
  openingQty: number | null;
  receiptQty: number | null;
  demandQty: number | null;
  closingQty: number | null;
};

/** Snapshot 안의 리드타임 정책 (analytics.v_leadtime_policy 한 행) */
export type SnapshotLeadtime = {
  supplierId: string | null;
  supplierName: string | null;
  plannedLeadTime: number | null;
  effectiveLeadTime: number | null;
  p50Days: number | null;
  p80Days: number | null;
  p90Days: number | null;
  stdDays: number | null;
  sampleCount: number | null;
  confidence: string | null;
  source: string | null;
};

/** Snapshot 안의 Champion (analytics.v_champion_model 한 행) */
export type SnapshotChampion = {
  championModelId: string | null;
  modelName: string | null;
  modelVersion: string | null;
  championMetric: string | null;
  metricValue: number | null;
  wape: number | null;
  bias: number | null;
  selectionMethod: string | null;
};

/**
 * analytics.v_approval_snapshot.snapshot — renew.prd 23.2.
 *
 * 승인 시점의 계산 근거 전부입니다. 데이터가 바뀐 뒤에도 그때의 값을 그대로 돌려줍니다.
 * 어느 항목이든 그때 없었으면 null 입니다 — 지금 값으로 채우면 재현이 아니게 됩니다.
 */
export type ApprovalSnapshot = {
  approvalId: number;
  recommendation: PurchaseRecommendation | null;
  skuDetail: SkuDetail | null;
  projection: SnapshotProjectionRow[];
  consensus: ConsensusRow[];
  safetyStock: SafetyStock | null;
  leadtime: SnapshotLeadtime | null;
  champion: SnapshotChampion | null;
  runId: string | null;
  modelVersion: string | null;
  /** 그 계산이 본 데이터의 기준 시각 */
  dataSnapshotAt: string | null;
  /** Snapshot 을 뜬 시각 */
  capturedAt: string | null;
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
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

export function toDecision(value: unknown): Decision | null {
  return isDecision(value) ? value : null;
}

export function toDecisionKind(value: unknown): DecisionKind | null {
  return isDecisionKind(value) ? value : null;
}

export function normalizeApproval(row: Record<string, unknown>): ApprovalRow {
  return {
    approvalId: num(row.approval_id) ?? 0,
    itemId: String(row.item_id ?? ''),
    itemName: text(row.item_name),
    supplierId: text(row.supplier_id),
    recommendationRunId: text(row.recommendation_run_id),
    recommendedQty: num(row.recommended_qty),
    approvedQty: num(row.approved_qty),
    adjustment: num(row.adjustment),
    decision: toDecision(row.decision),
    reasonCode: text(row.reason_code),
    reasonText: text(row.reason_text),
    approvedEmail: text(row.approved_email),
    approvedAt: text(row.approved_at),
    status: text(row.status),
    // 뷰가 is_active 를 내지만, 없더라도 status 로 판정할 수 있습니다.
    isActive: bool(row.is_active) ?? row.status === 'ACTIVE',
  };
}

export function normalizeDecisionHistory(row: Record<string, unknown>): DecisionHistoryRow {
  return {
    kind: toDecisionKind(row.kind),
    refId: text(row.ref_id),
    itemId: text(row.item_id),
    itemName: text(row.item_name),
    supplierId: text(row.supplier_id),
    actorEmail: text(row.actor_email),
    at: text(row.at),
    decision: toDecision(row.decision),
    adjustment: num(row.adjustment),
    reasonCode: text(row.reason_code),
    summary: text(row.summary),
  };
}

export function normalizeApprovalKpi(row: Record<string, unknown>): ApprovalKpi {
  return {
    activeCount: count(row.n_active),
    approvedCount: count(row.n_approved),
    rejectedCount: count(row.n_rejected),
    deferredCount: count(row.n_deferred),
    adjustedCount: count(row.n_adjusted),
    pendingCount: count(row.pending),
    thisMonthCount: count(row.this_month),
  };
}

export function normalizeRecommendationWithApproval(
  row: Record<string, unknown>,
): RecommendationWithApproval {
  return {
    ...normalizePurchaseRecommendation(row),
    approvalId: num(row.approval_id),
    approvalStatus: toDecision(row.approval_status),
    approvedQty: num(row.approved_qty),
    adjustment: num(row.adjustment),
    approvedEmail: text(row.approved_email),
    approvedAt: text(row.approved_at),
    hasActiveApproval: bool(row.has_active_approval) ?? row.approval_id !== null,
    isPending: bool(row.is_pending),
  };
}

/** jsonb 의 한 항목을 객체로 봅니다. 배열·문자열·null 은 전부 null 입니다 */
function objectOf(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** jsonb 의 한 항목을 배열로 봅니다. 없으면 빈 배열입니다 */
function arrayOf(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => objectOf(item) !== null);
}

export function normalizeSnapshotProjection(row: Record<string, unknown>): SnapshotProjectionRow {
  return {
    period: String(row.period ?? ''),
    openingQty: num(row.opening_qty),
    receiptQty: num(row.receipt_qty),
    demandQty: num(row.demand_qty),
    closingQty: num(row.closing_qty),
  };
}

export function normalizeSnapshotLeadtime(row: Record<string, unknown>): SnapshotLeadtime {
  return {
    supplierId: text(row.supplier_id),
    supplierName: text(row.supplier_name),
    plannedLeadTime: num(row.planned_lead_time),
    effectiveLeadTime: num(row.effective_lead_time),
    p50Days: num(row.p50_days),
    p80Days: num(row.p80_days),
    p90Days: num(row.p90_days),
    stdDays: num(row.std_days),
    sampleCount: num(row.n_samples),
    confidence: text(row.confidence),
    source: text(row.source),
  };
}

export function normalizeSnapshotChampion(row: Record<string, unknown>): SnapshotChampion {
  return {
    championModelId: text(row.champion_model_id),
    modelName: text(row.model_name),
    modelVersion: text(row.model_version),
    championMetric: text(row.champion_metric),
    metricValue: num(row.metric_value),
    wape: num(row.wape),
    bias: num(row.bias),
    selectionMethod: text(row.selection_method),
  };
}

/**
 * analytics.v_approval_snapshot 한 행을 화면이 쓰는 모양으로.
 *
 * 뷰의 컬럼이 아니라 저장된 jsonb 를 펴는 것이므로, 항목이 통째로 없을 수 있습니다.
 * 그때는 그 절을 그리지 않습니다 — 지금 값을 다시 조회해 채우지 않습니다 (renew.prd 31.3).
 */
export function normalizeApprovalSnapshot(row: Record<string, unknown>): ApprovalSnapshot {
  const snapshot = objectOf(row.snapshot) ?? {};
  const recommendation = objectOf(snapshot.recommendation);
  const skuDetail = objectOf(snapshot.sku_detail);
  const safetyStock = objectOf(snapshot.safety_stock);
  const leadtime = objectOf(snapshot.leadtime);
  const champion = objectOf(snapshot.champion);

  return {
    approvalId: num(row.approval_id) ?? 0,
    recommendation: recommendation === null ? null : normalizePurchaseRecommendation(recommendation),
    skuDetail: skuDetail === null ? null : normalizeSkuDetail(skuDetail),
    projection: arrayOf(snapshot.projection).map(normalizeSnapshotProjection),
    consensus: arrayOf(snapshot.consensus).map(normalizeConsensusRow),
    safetyStock: safetyStock === null ? null : normalizeSafetyStock(safetyStock),
    leadtime: leadtime === null ? null : normalizeSnapshotLeadtime(leadtime),
    champion: champion === null ? null : normalizeSnapshotChampion(champion),
    runId: text(snapshot.run_id),
    modelVersion: text(snapshot.model_version),
    dataSnapshotAt: text(snapshot.data_snapshot_at),
    capturedAt: text(snapshot.captured_at),
  };
}
