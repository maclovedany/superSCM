// 재고 전개와 리드타임 정책 조회 — renew.prd 18장 · 19장
//
// 계산은 SQL 이 끝냈습니다. 여기서는 조회와 정규화만 합니다 (AGENTS.md 규칙 2).

import { createSupabaseServerClient } from './supabase/server';
import type { SupabaseServerClient } from './supabase/service';
import { toReasonCode, toRiskStatus, type ReasonCode, type RiskStatus } from './status';

/** analytics.v_inventory_projection 한 줄 = 한 품목의 한 기간 */
export type ProjectionRow = {
  itemId: string;
  itemName: string | null;
  supplierId: string | null;
  /** YYYY-MM-DD (월 초) */
  period: string;
  periodIndex: number;
  openingQty: number | null;
  receiptQty: number | null;
  forecastQty: number | null;
  committedSoQty: number | null;
  softAllocationQty: number | null;
  demandQty: number | null;
  closingQty: number | null;
  cumulativeDemandQty: number | null;
  /** CHAMPION | DEFAULT */
  forecastSource: string | null;
  runId: string | null;
  dataSnapshotAt: string | null;
};

/** analytics.v_projection_item — 품목 선택 칩용 요약 */
export type ProjectionItem = {
  itemId: string;
  itemName: string | null;
  riskStatus: RiskStatus;
  stockoutDate: string | null;
  stockoutDays: number | null;
  reason: ReasonCode | null;
};

/** analytics.v_leadtime_policy — 공급처별 실적 분위수와 적용 중인 값 */
export type LeadtimePolicy = {
  supplierId: string;
  supplierName: string | null;
  country: string | null;
  stdLeadTime: number | null;
  sampleCount: number | null;
  p50Days: number | null;
  p80Days: number | null;
  p90Days: number | null;
  stdDays: number | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  plannedLeadTime: number | null;
  effectiveLeadTime: number | null;
  /** '확정값' | '실적 P80' */
  source: string | null;
  confirmedReason: string | null;
  confirmedAt: string | null;
  lastChangedAt: string | null;
};

/** analytics.v_leadtime_plan_history — 변경 이력 */
export type LeadtimePlanHistory = {
  id: number;
  supplierId: string;
  supplierName: string | null;
  leadTimeBefore: number | null;
  leadTimeAfter: number | null;
  basis: string | null;
  reason: string;
  changedEmail: string | null;
  changedAt: string | null;
};

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** 표본 수 기준 신뢰도. 모르는 값은 지어내지 않고 null 로 둡니다 (renew.prd 18.2) */
function confidenceOf(value: unknown): LeadtimePolicy['confidence'] {
  switch (value) {
    case 'HIGH':
    case 'MEDIUM':
    case 'LOW':
      return value;
    default:
      return null;
  }
}

/** 한 품목의 기간별 재고 전개. period 순으로 돌려줍니다 */
export async function getInventoryProjection(
  itemId: string,
  client?: SupabaseServerClient,
): Promise<{ rows: ProjectionRow[]; error: string | null }> {
  try {
    const supabase = client ?? (await createSupabaseServerClient());
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_inventory_projection')
      .select('*')
      .eq('item_id', itemId)
      .order('period')
      .limit(60);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => {
      const row = item as Record<string, unknown>;
      return {
        itemId: String(row.item_id ?? ''),
        itemName: text(row.item_name),
        supplierId: text(row.supplier_id),
        period: String(row.period ?? ''),
        periodIndex: num(row.period_index) ?? 0,
        openingQty: num(row.opening_qty),
        receiptQty: num(row.receipt_qty),
        forecastQty: num(row.forecast_qty),
        committedSoQty: num(row.committed_so_qty),
        softAllocationQty: num(row.soft_allocation_qty),
        demandQty: num(row.demand_qty),
        closingQty: num(row.closing_qty),
        cumulativeDemandQty: num(row.cumulative_demand_qty),
        forecastSource: text(row.forecast_source),
        runId: text(row.run_id),
        dataSnapshotAt: text(row.data_snapshot_at),
      };
    });
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}

/**
 * 품목 선택 칩 목록. 위험 순으로 돌려줍니다.
 *
 * 산출 불가 품목은 맨 뒤입니다. 0 으로 취급하면 가장 급한 품목처럼 보입니다
 * (design.md §8.2).
 */
export async function getProjectionItems(): Promise<{
  rows: ProjectionItem[];
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_projection_item')
      .select('*')
      .order('stockout_days', { ascending: true, nullsFirst: false })
      .limit(200);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => {
      const row = item as Record<string, unknown>;
      return {
        itemId: String(row.item_id ?? ''),
        itemName: text(row.item_name),
        riskStatus: toRiskStatus(row.risk_status),
        stockoutDate: text(row.stockout_date),
        stockoutDays: num(row.stockout_days),
        reason: toReasonCode(row.reason),
      };
    });
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}

/** 공급처별 리드타임 정책 — renew.prd 18.3 */
function normalizeLeadtimePolicy(row: Record<string, unknown>): LeadtimePolicy {
  return {
    supplierId: String(row.supplier_id ?? ''),
    supplierName: text(row.supplier_name),
    country: text(row.country),
    stdLeadTime: num(row.std_lead_time),
    sampleCount: num(row.n_samples),
    p50Days: num(row.p50_days),
    p80Days: num(row.p80_days),
    p90Days: num(row.p90_days),
    stdDays: num(row.std_days),
    confidence: confidenceOf(row.confidence),
    plannedLeadTime: num(row.planned_lead_time),
    effectiveLeadTime: num(row.effective_lead_time),
    source: text(row.source),
    confirmedReason: text(row.confirmed_reason),
    confirmedAt: text(row.confirmed_at),
    lastChangedAt: text(row.last_changed_at),
  };
}

/**
 * 공급처 한 곳의 리드타임 정책.
 *
 * ★ 목록을 받아 find 하지 않습니다. getLeadtimePolicies 는 200행에서 잘리므로,
 *   그 뒤에 있는 공급처가 "없음" 으로 보입니다 (STEP 19 리뷰 Important 7).
 */
export async function getLeadtimePolicy(
  supplierId: string,
  client?: SupabaseServerClient,
): Promise<{ data: LeadtimePolicy | null; error: string | null }> {
  try {
    const supabase = client ?? (await createSupabaseServerClient());
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_leadtime_policy')
      .select('*')
      .eq('supplier_id', supplierId)
      .maybeSingle();

    if (error) return { data: null, error: error.message };
    if (!data) return { data: null, error: null };

    return { data: normalizeLeadtimePolicy(data as Record<string, unknown>), error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}

export async function getLeadtimePolicies(): Promise<{
  rows: LeadtimePolicy[];
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_leadtime_policy')
      .select('*')
      .order('supplier_id')
      .limit(200);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => normalizeLeadtimePolicy(item as Record<string, unknown>));
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}

/** 리드타임 확정 이력 — renew.prd 11.4 "변경 이력을 남긴다" */
export async function getLeadtimePlanHistory(
  limit = 50,
): Promise<{ rows: LeadtimePlanHistory[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_leadtime_plan_history')
      .select('*')
      .order('changed_at', { ascending: false })
      .limit(limit);

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => {
      const row = item as Record<string, unknown>;
      return {
        id: num(row.id) ?? 0,
        supplierId: String(row.supplier_id ?? ''),
        supplierName: text(row.supplier_name),
        leadTimeBefore: num(row.lead_time_before),
        leadTimeAfter: num(row.lead_time_after),
        basis: text(row.basis),
        reason: String(row.reason ?? ''),
        changedEmail: text(row.changed_email),
        changedAt: text(row.changed_at),
      };
    });
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}
