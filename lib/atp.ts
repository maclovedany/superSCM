// ATP · 가예약 · 영업 문의 조회 — renew.prd 27장 · 28.3
//
// 계산은 SQL 이 끝냈습니다 (sql/23-atp-sales.sql). 여기서는 조회와 정규화만 합니다.
// 타입 · 라벨 · 정규화 함수는 lib/atp-model.ts 에 있습니다.
//
// ★ 필드 차단 (renew.prd 4.5)
//   이 파일이 읽는 뷰에는 단가 · 발주 금액 · 공급처 상세 · 리드타임 통계 · 정확도
//   컬럼이 **아예 없습니다** (sql/23 §9). 그래서 여기서 골라낼 것이 없습니다 —
//   "select 하지 않는다" 쪽을 택했습니다. 그래도 lib/agent/redact.ts 가 툴 결과를
//   한 번 더 훑습니다 (이중 방어).
//
// ★ 클라이언트 컴포넌트는 이 파일을 import 하지 마세요. 서버 전용 Supabase 클라이언트가
//   따라 들어옵니다. 라벨이 필요하면 lib/atp-model.ts 에서 직접 가져오세요.
//
// PostgREST 는 한 번에 1,000행까지 돌려줍니다. 목록 조회는 limit 을 반드시 적습니다 (공통규칙 11).

import { createSupabaseServerClient } from './supabase/server';
import {
  normalizeAtp,
  normalizeFeasibility,
  normalizePromiseRisk,
  normalizeSalesInquiry,
  normalizeSoftAllocation,
  normalizeSupplyStatus,
  type AtpRow,
  type Feasibility,
  type FeasibilityStatus,
  type SalesInquiry,
  type SalesPromiseRisk,
  type SalesSupplyStatus,
  type SoftAllocation,
} from './atp-model';

// 라벨과 톤은 모델 파일에 있습니다. 서버 코드가 한 곳에서 가져다 쓰도록 다시 내보냅니다.
export {
  ALLOCATION_LABEL,
  ALLOCATION_TONE,
  BUCKET_LABEL,
  FEASIBILITY_LABEL,
  FEASIBILITY_TONE,
  SUPPLY_TONE,
  isExpiringSoon,
  type AllocationStatus,
  type AtpBucket,
  type AtpRow,
  type Feasibility,
  type FeasibilityStatus,
  type SalesInquiry,
  type SalesPromiseRisk,
  type SalesSupplyStatus,
  type SoftAllocation,
} from './atp-model';

/** 대체품 한 줄 (core.v_item_substitute). 단가 · 공급처를 담지 않습니다 */
export type AlternativeItem = {
  itemId: string;
  itemName: string | null;
  substituteItemId: string;
  substituteItemName: string | null;
  substituteIsActive: string | null;
  priority: number | null;
  note: string | null;
};

/** 쓰기 함수의 공통 반환. ok 가 false 면 message 에 사유가 있습니다 */
export type WriteResult = {
  ok: boolean;
  message: string;
  error: string | null;
};

function failure(error: unknown): string {
  return error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.';
}

/** 품목코드를 core 뷰와 같은 규칙으로 정규화합니다 (sql/23 의 regexp 와 같은 규칙) */
function normalizeItemId(itemId: string): string {
  return itemId.replace(/[\s\-_]/g, '').toUpperCase();
}

/** PostgREST 의 rpc 응답은 returns table 이면 배열, 스칼라면 값입니다 */
function firstRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === 'object' ? (row as Record<string, unknown>) : null;
}

// ── 조회 ──────────────────────────────────────────────────────

/**
 * 한 품목의 4구간 ATP — renew.prd 27.3.
 *
 * 구간 순서(NOW · 2W · 1M · BEYOND)로 돌려줍니다. 뷰의 bucket_ord 가 그 순서입니다.
 */
export async function getAtp(itemId: string): Promise<{ rows: AtpRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_atp')
      .select('*')
      .eq('item_id', normalizeItemId(itemId))
      .order('bucket_ord')
      .limit(8);

    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeAtp(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/**
 * 수주 가능 판정 — renew.prd 27.5.
 *
 * 읽기 전용입니다. 여러 번 물어도 재고가 잠기지 않습니다.
 */
export async function checkOrderFeasibility(
  itemId: string,
  qty: number,
  targetDate: string,
): Promise<{ data: Feasibility | null; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('check_order_feasibility', {
      p_item_id: normalizeItemId(itemId),
      p_qty: qty,
      p_target_date: targetDate,
    });

    if (error) return { data: null, error: error.message };
    // 이 함수는 jsonb 하나를 돌려줍니다 (returns table 이 아닙니다).
    if (!data || typeof data !== 'object') return { data: null, error: null };
    return { data: normalizeFeasibility(data as Record<string, unknown>), error: null };
  } catch (error) {
    return { data: null, error: failure(error) };
  }
}

/** 품목별 수급 상태 — renew.prd 28.3. 단가 · 공급처 · 정확도 컬럼이 없습니다 */
export async function getSalesSupplyStatus(
  limit = 500,
): Promise<{ rows: SalesSupplyStatus[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_sales_supply_status')
      .select('*')
      .order('item_id')
      .limit(limit);

    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeSupplyStatus(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/** 납기 위험 수주 — renew.prd 28.3. 납기가 이른 것부터 */
export async function getSalesPromiseRisk(
  limit = 200,
): Promise<{ rows: SalesPromiseRisk[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_sales_promise_risk')
      .select('*')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(limit);

    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizePromiseRisk(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/** 내 가예약 — renew.prd 27.6. 뷰가 본인 것만 냅니다 (관리자는 전부) */
export async function getSoftAllocations(
  limit = 200,
): Promise<{ rows: SoftAllocation[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_soft_allocation')
      .select('*')
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeSoftAllocation(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/** 내 문의 이력 — renew.prd 27.7. 뷰가 본인 것만 냅니다 (관리자는 전부) */
export async function getSalesInquiries(
  limit = 100,
): Promise<{ rows: SalesInquiry[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_sales_inquiry')
      .select('*')
      .order('asked_at', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeSalesInquiry(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/** 대체품 — renew.prd 26.2 getAlternativeItems · 27.2 "대체품 있어?" */
export async function getAlternativeItems(
  itemId: string,
): Promise<{ rows: AlternativeItem[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('core')
      .from('v_item_substitute')
      .select('*')
      .eq('item_id', normalizeItemId(itemId))
      .order('priority', { ascending: true, nullsFirst: false })
      .limit(50);

    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((raw) => {
        const row = raw as Record<string, unknown>;
        const priority = Number(row.priority);
        return {
          itemId: String(row.item_id ?? ''),
          itemName: (row.item_name as string | null) ?? null,
          substituteItemId: String(row.substitute_item_id ?? ''),
          substituteItemName: (row.substitute_item_name as string | null) ?? null,
          substituteIsActive: (row.substitute_is_active as string | null) ?? null,
          priority: Number.isFinite(priority) ? priority : null,
          note: (row.note as string | null) ?? null,
        };
      }),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

// ── 쓰기 ──────────────────────────────────────────────────────

/**
 * 가예약 — renew.prd 27.6. ★ ATP 를 줄이는 유일한 쓰기입니다.
 *
 * 현재 ATP 를 넘으면 DB 함수가 거부합니다. 여기서 다시 비교하지 않습니다 —
 * 앱에서 견주면 그 사이에 다른 사람이 예약한 분이 빠져 이중 약속이 생깁니다.
 */
export async function createSoftAllocation(
  itemId: string,
  qty: number,
  validDays: number | null = null,
  customer: string | null = null,
): Promise<WriteResult & { allocationId: number | null; validUntil: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('create_soft_allocation', {
      p_item_id: normalizeItemId(itemId),
      p_qty: qty,
      p_valid_days: validDays,
      p_customer: customer,
    });

    if (error) {
      return { ok: false, allocationId: null, validUntil: null, message: '', error: error.message };
    }

    const row = firstRow(data);
    const allocationId = row?.allocation_id === null || row?.allocation_id === undefined
      ? null
      : Number(row.allocation_id);

    return {
      ok: row?.ok === true,
      allocationId: allocationId !== null && Number.isFinite(allocationId) ? allocationId : null,
      validUntil: (row?.valid_until as string | null) ?? null,
      message: String(row?.message ?? '가예약을 만들지 못했습니다.'),
      error: null,
    };
  } catch (error) {
    return { ok: false, allocationId: null, validUntil: null, message: '', error: failure(error) };
  }
}

async function callAllocationRpc(fn: string, allocationId: number): Promise<WriteResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('core')
      .rpc(fn, { p_allocation_id: allocationId });

    if (error) return { ok: false, message: '', error: error.message };

    const row = firstRow(data);
    return {
      ok: row?.ok === true,
      message: String(row?.message ?? '처리하지 못했습니다.'),
      error: null,
    };
  } catch (error) {
    return { ok: false, message: '', error: failure(error) };
  }
}

/** 수주 확정 — RESERVED → CONFIRMED (본인 또는 관리자) */
export async function confirmSoftAllocation(allocationId: number): Promise<WriteResult> {
  return callAllocationRpc('confirm_soft_allocation', allocationId);
}

/** 가예약 해제 — → RELEASED (본인 또는 관리자) */
export async function releaseSoftAllocation(allocationId: number): Promise<WriteResult> {
  return callAllocationRpc('release_soft_allocation', allocationId);
}

/**
 * 유효기간이 지난 가예약을 일괄 해제합니다 — renew.prd 27.6 "유효기간 경과 시 자동 해제".
 *
 * 스케줄러(app/api/cron/scan-alerts)가 알림 스캔 전에 부릅니다. 그 요청에는 로그인
 * 세션이 없으므로 비밀값을 넘깁니다 — DB 함수는 "관리자이거나 p_secret 이
 * app.cron_secret 과 같은가" 를 봅니다 (core.scan_alerts 와 같은 구조 · sql/23 §7).
 *
 * 관리자 세션에서는 secret 없이 불러도 통과합니다.
 */
export async function releaseExpiredAllocations(
  secret: string | null = null,
): Promise<WriteResult & { released: number }> {
  try {
    const supabase = await createSupabaseServerClient();
    // 키를 아예 빼면 PostgREST 가 기본값으로 함수를 찾아야 합니다. null 을 명시하면
    // 시그니처가 하나로 정해집니다 (app/(user)/alerts/actions.ts 의 scan_alerts 와 같은 이유).
    const { data, error } = await supabase
      .schema('core')
      .rpc('release_expired_allocations', { p_secret: secret });

    if (error) return { ok: false, released: 0, message: '', error: error.message };

    const row = firstRow(data);
    const released = Number(row?.n_released ?? 0);
    // ok 는 함수가 돌려줍니다. 0건 해제와 권한 거부를 건수로 구별할 수 없기 때문입니다 —
    // 비밀값 설정이 빠진 것을 "만료된 예약이 없다" 로 읽으면 조용히 넘어갑니다.
    return {
      ok: row?.ok === true,
      released: Number.isFinite(released) ? released : 0,
      message: String(row?.message ?? ''),
      error: null,
    };
  } catch (error) {
    return { ok: false, released: 0, message: '', error: failure(error) };
  }
}

/**
 * 문의 한 건을 기록합니다 — renew.prd 27.7.
 *
 * 영업 툴이 불릴 때마다 남깁니다. 실패해도 툴 응답을 막지 않습니다 —
 * 기록이 없는 것보다 답을 못 주는 쪽이 나쁩니다 (renew.prd 31.4 와 같은 취지).
 */
export async function recordSalesInquiry(input: {
  itemId: string | null;
  requestedQty?: number | null;
  requestedDate?: string | null;
  question?: string | null;
  answerStatus?: FeasibilityStatus | null;
  answer?: unknown;
  softAllocationId?: number | null;
}): Promise<WriteResult & { inquiryId: number | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('record_sales_inquiry', {
      p_item_id: input.itemId === null ? null : normalizeItemId(input.itemId),
      p_requested_qty: input.requestedQty ?? null,
      p_requested_date: input.requestedDate ?? null,
      p_question: input.question ?? null,
      p_answer_status: input.answerStatus ?? null,
      p_answer: input.answer ?? null,
      p_soft_allocation_id: input.softAllocationId ?? null,
    });

    if (error) return { ok: false, inquiryId: null, message: '', error: error.message };

    const row = firstRow(data);
    const inquiryId = Number(row?.inquiry_id ?? NaN);
    return {
      ok: row?.ok === true,
      inquiryId: Number.isFinite(inquiryId) ? inquiryId : null,
      message: String(row?.message ?? ''),
      error: null,
    };
  } catch (error) {
    return { ok: false, inquiryId: null, message: '', error: failure(error) };
  }
}
