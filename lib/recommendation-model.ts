// 발주 추천 · 안전재고의 타입과 정규화 — renew.prd 21장 · 22장 · 29장
//
// 계산은 SQL 이 끝냈습니다. 여기서는 뷰 한 줄을 화면이 쓰는 모양으로 바꾸기만 합니다
// (AGENTS.md 규칙 2 · 코드 구조 2번).
//
// 조회 함수는 lib/recommendation.ts 에 있습니다. 이 파일을 나눈 이유는
// lib/scm-model.ts 와 lib/scm.ts 를 나눈 이유와 같습니다 — 순수 함수만 모아 두면
// Supabase 클라이언트 없이 테스트할 수 있습니다.

import { toReasonCode, toRiskStatus, type ReasonCode, type RiskStatus } from './status.ts';

/** renew.prd 18.2 — 표본 수 기준 신뢰도 */
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | null;

/** 서비스 수준을 어디서 가져왔는가 (core.v_item_service_level.source) */
export type ServiceLevelSource = 'ITEM' | 'GRADE' | 'DEFAULT' | null;

/** 안전재고의 σ_d 출처 (analytics.v_safety_stock.sigma_source) */
export type SigmaSource = 'BACKTEST' | 'IN_SAMPLE' | null;

/** analytics.v_purchase_recommendation 한 줄 = 한 품목 (renew.prd 22.3) */
export type PurchaseRecommendation = {
  itemId: string;
  itemName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  currentInventory: number | null;
  incomingQty: number | null;
  availableQty: number | null;
  incomingEta: string | null;
  /** 리드타임+검토주기 창의 순수 예측 합 */
  forecastQty: number | null;
  /** 같은 창의 확정 수주 합 */
  committedQty: number | null;
  /** 같은 창의 적용수요 = max(예측, 확정수주) 기간별 적용 */
  consensusForecast: number | null;
  leadTime: number | null;
  leadTimeConfidence: Confidence;
  reviewPeriodDays: number | null;
  safetyBufferDays: number | null;
  safetyStock: number | null;
  stockoutDate: string | null;
  /** 결품 예상일 − 리드타임 − 여유일 (renew.prd 22.2) */
  requiredOrderDate: string | null;
  /**
   * 발주 권고일이 오늘 이전인가.
   *
   * 뷰가 판정합니다. 화면에서 다시 오늘과 비교하면 앱 서버와 DB 의 시간대가 달라
   * 하루가 어긋나고, KPI 카드 숫자와 목록 건수가 맞지 않게 됩니다.
   * 권고일이 없으면 긴급 여부도 모릅니다 — false 가 아니라 null 입니다.
   */
  isUrgent: boolean | null;
  rawRecommendedQty: number | null;
  moq: number | null;
  packSize: number | null;
  /** MOQ · 포장 단위를 반영한 최종 추천 수량 */
  finalRecommendedQty: number | null;
  unitPrice: number | null;
  recommendedAmount: number | null;
  risk: RiskStatus;
  reasonCode: ReasonCode | null;
  /** SQL 이 조립한 한국어 근거 문장 */
  explanation: string | null;
  runId: string | null;
  dataSnapshotAt: string | null;
};

/** analytics.v_purchase_recommendation_kpi */
export type PurchaseRecommendationKpi = {
  itemCount: number;
  orderNeededCount: number;
  urgentCount: number;
  criticalCount: number;
  warningCount: number;
  unknownCount: number;
  totalRecommendedQty: number | null;
  totalRecommendedAmount: number | null;
  /** 추천 수량은 있는데 단가가 없어 금액 합계에서 빠진 품목 수 */
  missingPriceCount: number;
};

/** analytics.v_safety_stock (renew.prd 21.1) */
export type SafetyStock = {
  itemId: string;
  itemName: string | null;
  supplierId: string | null;
  itemGrade: string | null;
  serviceLevel: number | null;
  zValue: number | null;
  serviceLevelSource: ServiceLevelSource;
  /** L */
  leadTimeDays: number | null;
  /** σ_L */
  leadTimeSd: number | null;
  leadTimeConfidence: Confidence;
  /** d */
  dailyDemand: number | null;
  sigmaDMonthly: number | null;
  /** σ_d (일 단위) */
  sigmaD: number | null;
  sigmaSource: SigmaSource;
  sigmaDlt: number | null;
  safetyStock: number | null;
  reason: ReasonCode | null;
};

/** analytics.v_sku_detail — 품목 하나의 요약 한 줄 (renew.prd 29장) */
export type SkuDetail = {
  itemId: string;
  itemName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  country: string | null;
  demandType: string | null;
  championModelId: string | null;
  championModelName: string | null;
  championWape: number | null;
  championBias: number | null;
  championSelectionMethod: 'AUTO' | 'MANUAL' | null;
  forecastRunId: string | null;
  forecastSource: string | null;
  dataSnapshotAt: string | null;
  isStale: boolean;
  currentInventory: number | null;
  /** 진행 중 선적 전량. 창 밖에 도착하는 물량까지 포함합니다 (KPI 카드가 쓰는 값) */
  incomingQty: number | null;
  incomingEta: string | null;
  // ── 입고예정의 창(리드타임 + 검토 주기) 분해 — renew.prd 22.1 · sql/16 ──
  //
  // 발주 식이 실제로 빼는 값은 incomingQty 전량이 아니라 창 안에 도착하는 몫입니다.
  // 수요는 창 안에서 세면서 공급은 창 밖까지 세면 식의 두 변이 다른 기간을 말합니다.
  //
  // 세 컬럼 모두 sql/16 · sql/19 를 아직 실행하지 않은 DB 에는 없습니다.
  // 그때 num()/text() 가 null 을 내는데, 그 null 을 0 으로 접으면 안 됩니다 —
  // "빼지 않았다" 와 "얼마를 뺐는지 모른다" 는 다른 말이고, 근거 표의 뺄셈이
  // 맞는 것처럼 보이게 됩니다 (AGENTS.md 규칙 5).
  /**
   * 창의 끝 날짜. 화면이 오늘 날짜로 다시 계산하면 앱 서버와 DB 의 시간대가 달라
   * 하루가 어긋나므로(isUrgent 와 같은 이유) 뷰가 날짜로 내려 줍니다.
   */
  incomingWindowEnd: string | null;
  /** renew.prd 22.1 의 Confirmed Incoming Qty — 식에서 빼는 값 */
  incomingInWindowQty: number | null;
  /** 창 뒤 도착 또는 ETA 미상 — 식에서 빼지 않은 몫 */
  incomingAfterWindowQty: number | null;
  /** 리드타임+검토주기 창의 적용수요. 추천 근거 표의 첫 항입니다 */
  consensusForecast: number | null;
  stockoutDate: string | null;
  stockoutDays: number | null;
  firstNegativePeriod: string | null;
  leadTime: number | null;
  /** '확정값' | '실적 P80' */
  leadTimeSource: string | null;
  leadTimeConfidence: Confidence;
  safetyStock: number | null;
  serviceLevel: number | null;
  zValue: number | null;
  sigmaDlt: number | null;
  requiredOrderDate: string | null;
  /** 발주 권고일이 오늘 이전인가. 뷰가 판정합니다 (위 PurchaseRecommendation.isUrgent 와 같은 이유) */
  isUrgent: boolean | null;
  rawRecommendedQty: number | null;
  finalRecommendedQty: number | null;
  moq: number | null;
  packSize: number | null;
  unitPrice: number | null;
  recommendedAmount: number | null;
  risk: RiskStatus;
  reasonCode: ReasonCode | null;
  explanation: string | null;
  /** 유효한 Human Override 수 */
  overrideCount: number;
  // ── STEP 13 이 더한 승인 컬럼 (sql/19) ──
  //
  // 한 품목의 유효한 결정은 하나뿐입니다. 아직 결정하지 않았으면 전부 null 이고
  // hasActiveApproval 만 false 입니다 — "모른다" 가 아니라 "아직 결정하지 않았다" 입니다.
  //
  // 결정 문자열을 여기서 Decision 으로 좁히지 않습니다. lib/approval-model.ts 가
  // 이 파일을 import 하므로, 반대 방향 import 를 만들면 순환이 됩니다.
  // 라벨이 필요한 화면이 decisionLabel() 을 부릅니다.
  /** 'APPROVED' | 'REJECTED' | 'DEFERRED' */
  lastDecision: string | null;
  lastApprovedQty: number | null;
  lastApprovedAt: string | null;
  lastApprovedEmail: string | null;
  /**
   * 지금 유효한 결정이 있는가. 3상태입니다 (AGENTS.md 규칙 5).
   *
   * `null` 은 "승인 컬럼 자체를 읽지 못했다" 입니다 — sql/19 를 실행하지 않아 뷰에
   * 컬럼이 없는 경우입니다. 그때 `false` 로 접으면 결정이 있는 품목을 두고
   * "아직 결정하지 않았습니다" 라고 단정하게 됩니다. 승인은 거버넌스 기록이라
   * 없다고 잘못 말하는 것이 모른다고 말하는 것보다 나쁩니다.
   */
  hasActiveApproval: boolean | null;
};

/** analytics.v_service_level — 등급별 서비스 수준의 적용 이력 (renew.prd 21.2) */
export type ServiceLevel = {
  itemGrade: string;
  serviceLevel: number | null;
  zValue: number | null;
  effectiveFrom: string | null;
  updatedAt: string | null;
  /** 오늘 적용 중인 행인가. 뷰가 DB 시간 기준으로 판정합니다 */
  isEffective: boolean;
  /** 미래 날짜로 미리 넣어 둔 행인가 */
  isScheduled: boolean;
};

/** analytics.v_item_policy — 품목별 MOQ · 포장 단위 · 등급 */
export type ItemPolicy = {
  itemId: string;
  itemName: string | null;
  supplierId: string | null;
  itemGrade: string | null;
  moq: number | null;
  packSize: number | null;
  /** 품목이 직접 지정한 서비스 수준. null 이면 등급/기본값을 씁니다 */
  itemServiceLevel: number | null;
  appliedServiceLevel: number | null;
  appliedZValue: number | null;
  serviceLevelSource: ServiceLevelSource;
  updatedAt: string | null;
};

/** analytics.v_consensus_forecast — 기간별 AI 예측 + Override */
export type ConsensusRow = {
  itemId: string;
  period: string;
  aiQty: number | null;
  overrideQty: number | null;
  consensusQty: number | null;
  p80: number | null;
  p90: number | null;
  hasOverride: boolean;
  reasonCode: string | null;
  reasonText: string | null;
  overrideEmail: string | null;
};

// ── 정규화 ────────────────────────────────────────────────────
//
// 컬럼 이름이 달라져도 화면이 조용히 빈 값이 되지 않도록, 뷰의 실제 이름을 씁니다.
// 값이 없으면 지어내지 않고 null 로 둡니다 (AGENTS.md 규칙 5).

export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function text(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : String(value);
}

/**
 * 3상태 boolean. "모른다" 를 false 로 접지 않습니다 (AGENTS.md 규칙 5).
 *
 * PostgREST 는 boolean 을 true/false 로 주지만, 뷰가 null 을 내면 그대로 null 입니다.
 */
export function bool(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

/**
 * enum 성격의 컬럼은 작은 함수로 좁힙니다.
 * 삼항으로 좁히면 `.map()` 콜백 안에서 타입이 string 으로 넓어집니다 (error.md #12).
 */
export function toConfidence(value: unknown): Confidence {
  switch (value) {
    case 'HIGH':
    case 'MEDIUM':
    case 'LOW':
      return value;
    default:
      return null;
  }
}

export function toServiceLevelSource(value: unknown): ServiceLevelSource {
  switch (value) {
    case 'ITEM':
    case 'GRADE':
    case 'DEFAULT':
      return value;
    default:
      return null;
  }
}

export function toSigmaSource(value: unknown): SigmaSource {
  switch (value) {
    case 'BACKTEST':
    case 'IN_SAMPLE':
      return value;
    default:
      return null;
  }
}

export function normalizePurchaseRecommendation(
  row: Record<string, unknown>,
): PurchaseRecommendation {
  return {
    itemId: String(row.item_id ?? ''),
    itemName: text(row.item_name),
    supplierId: text(row.supplier_id),
    supplierName: text(row.supplier_name),
    currentInventory: num(row.current_inventory),
    incomingQty: num(row.incoming_qty),
    availableQty: num(row.available_qty),
    incomingEta: text(row.incoming_eta),
    forecastQty: num(row.forecast_qty),
    committedQty: num(row.committed_qty),
    consensusForecast: num(row.consensus_forecast),
    leadTime: num(row.lead_time),
    leadTimeConfidence: toConfidence(row.lead_time_confidence),
    reviewPeriodDays: num(row.review_period_days),
    safetyBufferDays: num(row.safety_buffer_days),
    safetyStock: num(row.safety_stock),
    stockoutDate: text(row.stockout_date),
    requiredOrderDate: text(row.required_order_date),
    isUrgent: bool(row.is_urgent),
    rawRecommendedQty: num(row.raw_recommended_qty),
    moq: num(row.moq),
    packSize: num(row.pack_size),
    finalRecommendedQty: num(row.final_recommended_qty),
    unitPrice: num(row.unit_price),
    recommendedAmount: num(row.recommended_amount),
    risk: toRiskStatus(row.risk),
    reasonCode: toReasonCode(row.reason_code),
    explanation: text(row.explanation),
    runId: text(row.run_id),
    dataSnapshotAt: text(row.data_snapshot_at),
  };
}

export function normalizePurchaseRecommendationKpi(
  row: Record<string, unknown>,
): PurchaseRecommendationKpi {
  return {
    itemCount: num(row.n_items) ?? 0,
    orderNeededCount: num(row.n_order_needed) ?? 0,
    urgentCount: num(row.n_urgent) ?? 0,
    criticalCount: num(row.n_critical) ?? 0,
    warningCount: num(row.n_warning) ?? 0,
    unknownCount: num(row.n_unknown) ?? 0,
    totalRecommendedQty: num(row.total_recommended_qty),
    totalRecommendedAmount: num(row.total_recommended_amount),
    missingPriceCount: num(row.n_missing_price) ?? 0,
  };
}

export function normalizeSafetyStock(row: Record<string, unknown>): SafetyStock {
  return {
    itemId: String(row.item_id ?? ''),
    itemName: text(row.item_name),
    supplierId: text(row.supplier_id),
    itemGrade: text(row.item_grade),
    serviceLevel: num(row.service_level),
    zValue: num(row.z_value),
    serviceLevelSource: toServiceLevelSource(row.service_level_source),
    leadTimeDays: num(row.lead_time_days),
    leadTimeSd: num(row.lead_time_sd),
    leadTimeConfidence: toConfidence(row.lead_time_confidence),
    dailyDemand: num(row.daily_demand),
    sigmaDMonthly: num(row.sigma_d_monthly),
    sigmaD: num(row.sigma_d),
    sigmaSource: toSigmaSource(row.sigma_source),
    sigmaDlt: num(row.sigma_dlt),
    safetyStock: num(row.safety_stock),
    reason: toReasonCode(row.reason),
  };
}

export function normalizeSkuDetail(row: Record<string, unknown>): SkuDetail {
  return {
    itemId: String(row.item_id ?? ''),
    itemName: text(row.item_name),
    supplierId: text(row.supplier_id),
    supplierName: text(row.supplier_name),
    country: text(row.country),
    demandType: text(row.demand_type),
    championModelId: text(row.champion_model_id),
    championModelName: text(row.champion_model_name),
    championWape: num(row.champion_wape),
    championBias: num(row.champion_bias),
    championSelectionMethod:
      row.champion_selection_method === 'MANUAL'
        ? 'MANUAL'
        : row.champion_selection_method === 'AUTO'
          ? 'AUTO'
          : null,
    forecastRunId: text(row.forecast_run_id),
    forecastSource: text(row.forecast_source),
    dataSnapshotAt: text(row.data_snapshot_at),
    isStale: row.is_stale === true,
    currentInventory: num(row.current_inventory),
    incomingQty: num(row.incoming_qty),
    incomingEta: text(row.incoming_eta),
    // 컬럼이 없으면(sql/16 · sql/19 미실행) num()/text() 가 null 을 냅니다.
    // 0 으로 채우지 않습니다 — "창 안 입고예정이 0" 이 아니라 "모른다" 입니다.
    incomingWindowEnd: text(row.incoming_window_end),
    incomingInWindowQty: num(row.incoming_in_window_qty),
    incomingAfterWindowQty: num(row.incoming_after_window_qty),
    consensusForecast: num(row.consensus_forecast),
    stockoutDate: text(row.stockout_date),
    stockoutDays: num(row.stockout_days),
    firstNegativePeriod: text(row.first_negative_period),
    leadTime: num(row.lead_time),
    leadTimeSource: text(row.lead_time_source),
    leadTimeConfidence: toConfidence(row.lead_time_confidence),
    safetyStock: num(row.safety_stock),
    serviceLevel: num(row.service_level),
    zValue: num(row.z_value),
    sigmaDlt: num(row.sigma_dlt),
    requiredOrderDate: text(row.required_order_date),
    isUrgent: bool(row.is_urgent),
    rawRecommendedQty: num(row.raw_recommended_qty),
    finalRecommendedQty: num(row.final_recommended_qty),
    moq: num(row.moq),
    packSize: num(row.pack_size),
    unitPrice: num(row.unit_price),
    recommendedAmount: num(row.recommended_amount),
    risk: toRiskStatus(row.risk),
    reasonCode: toReasonCode(row.reason_code),
    explanation: text(row.explanation),
    overrideCount: num(row.n_overrides) ?? 0,
    lastDecision: text(row.last_decision),
    lastApprovedQty: num(row.last_approved_qty),
    lastApprovedAt: text(row.last_approved_at),
    lastApprovedEmail: text(row.last_approved_email),
    // 뷰가 has_active_approval 을 내면 그 값을 씁니다.
    // 컬럼이 아예 없으면(sql/19 미실행) "결정이 없다" 가 아니라 "모른다" 입니다 — null.
    hasActiveApproval:
      bool(row.has_active_approval) ??
      (row.last_decision === undefined ? null : row.last_decision !== null),
  };
}

export function normalizeServiceLevel(row: Record<string, unknown>): ServiceLevel {
  return {
    itemGrade: String(row.item_grade ?? ''),
    serviceLevel: num(row.service_level),
    zValue: num(row.z_value),
    effectiveFrom: text(row.effective_from),
    updatedAt: text(row.updated_at),
    // 뷰가 coalesce 로 확정 boolean 을 내므로 여기서 접어도 뜻이 바뀌지 않습니다.
    isEffective: bool(row.is_effective) === true,
    isScheduled: bool(row.is_scheduled) === true,
  };
}

export function normalizeItemPolicy(row: Record<string, unknown>): ItemPolicy {
  return {
    itemId: String(row.item_id ?? ''),
    itemName: text(row.item_name),
    supplierId: text(row.supplier_id),
    itemGrade: text(row.item_grade),
    moq: num(row.moq),
    packSize: num(row.pack_size),
    itemServiceLevel: num(row.item_service_level),
    appliedServiceLevel: num(row.applied_service_level),
    appliedZValue: num(row.applied_z_value),
    serviceLevelSource: toServiceLevelSource(row.service_level_source),
    updatedAt: text(row.updated_at),
  };
}

export function normalizeConsensusRow(row: Record<string, unknown>): ConsensusRow {
  return {
    itemId: String(row.item_id ?? ''),
    period: String(row.period ?? ''),
    aiQty: num(row.ai_qty),
    overrideQty: num(row.override_qty),
    consensusQty: num(row.consensus_qty),
    p80: num(row.p80),
    p90: num(row.p90),
    hasOverride: row.has_override === true,
    reasonCode: text(row.reason_code),
    reasonText: text(row.reason_text),
    overrideEmail: text(row.override_email),
  };
}

// ── CSV ───────────────────────────────────────────────────────
//
// renew.prd 22.3 의 출력 필드를 전부 내보냅니다.
// 값이 없는 칸은 빈 칸으로 둡니다. 0 으로 채우면 "발주 불필요" 와 구분되지 않습니다.

export const RECOMMENDATION_CSV_HEADER = [
  '품목코드',
  '품목명',
  '공급처코드',
  '공급처',
  '현재고',
  '입고예정',
  '가용재고',
  '입고 ETA',
  '예측 수요',
  '확정 수주',
  '적용 수요',
  '리드타임(일)',
  '리드타임 신뢰도',
  '검토 주기(일)',
  '여유일',
  '안전재고',
  '결품 예상일',
  '발주 권고일',
  '필요량',
  'MOQ',
  '포장 단위',
  '추천 수량',
  '단가',
  '추천 금액',
  '판정',
  '사유 코드',
  '설명',
  '예측 실행',
  '기준 시각',
] as const;

/** 뷰 한 줄을 CSV 한 줄로. 숫자 서식은 넣지 않습니다 — Excel 이 다시 계산할 수 있어야 합니다 */
export function recommendationCsvRow(row: PurchaseRecommendation): (string | number | null)[] {
  return [
    row.itemId,
    row.itemName,
    row.supplierId,
    row.supplierName,
    row.currentInventory,
    row.incomingQty,
    row.availableQty,
    row.incomingEta,
    row.forecastQty,
    row.committedQty,
    row.consensusForecast,
    row.leadTime,
    row.leadTimeConfidence,
    row.reviewPeriodDays,
    row.safetyBufferDays,
    row.safetyStock,
    row.stockoutDate,
    row.requiredOrderDate,
    row.rawRecommendedQty,
    row.moq,
    row.packSize,
    row.finalRecommendedQty,
    row.unitPrice,
    row.recommendedAmount,
    row.risk,
    row.reasonCode,
    row.explanation,
    row.runId,
    row.dataSnapshotAt,
  ];
}
