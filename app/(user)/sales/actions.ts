'use server';

// 영업 수급 조회의 Server Action — renew.prd 27장
//
// 권한 규칙 (공통규칙 §3-4)
//   전부 로그인 사용자용입니다 → getSessionUser().
//   requireUser() 는 redirect() 를 던지므로(NEXT_REDIRECT) 액션의 try/catch 가 삼킵니다.
//
// ★ 영업만 부를 수 있게 막지 않습니다. SCM 담당자도 "지금 팔 수 있는 수량" 을 묻습니다.
//   막아야 하는 것은 반대 방향입니다 — 영업이 단가·정확도를 보는 것 (renew.prd 4.5).
//   그쪽은 뷰에 컬럼이 없고 lib/agent/redact.ts 가 한 번 더 훑습니다.
//
// ★ 수량 비교는 여기서 하지 않습니다. core.create_soft_allocation 이 현재 ATP 와
//   견줍니다. 앱에서 견주면 그 사이에 다른 사람이 예약한 분이 빠져 이중 약속이 생깁니다.

import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import {
  checkOrderFeasibility,
  confirmSoftAllocation,
  createSoftAllocation,
  releaseSoftAllocation,
  recordSalesInquiry,
} from '@/lib/atp';
import {
  EMPTY_FEASIBILITY,
  type AllocationActionState,
  type FeasibilityState,
} from './state';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 빠른 확인 — renew.prd 27.5.
 *
 * 읽기 전용입니다. 여러 번 눌러도 재고가 잠기지 않습니다.
 * 문의 이력은 남깁니다 (27.7) — 실패해도 결과는 그대로 보여 줍니다.
 */
export async function checkFeasibility(
  _prev: FeasibilityState,
  formData: FormData,
): Promise<FeasibilityState> {
  const user = await getSessionUser();
  if (!user) return { ...EMPTY_FEASIBILITY, error: '로그인이 필요합니다.' };

  const itemId = String(formData.get('itemId') ?? '').trim();
  if (!itemId) return { ...EMPTY_FEASIBILITY, error: '품목을 고르세요.' };

  const qty = Number(String(formData.get('qty') ?? '').trim());
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ...EMPTY_FEASIBILITY, error: '수량을 0보다 큰 숫자로 적어주세요.' };
  }

  const rawDate = String(formData.get('targetDate') ?? '').trim();
  const targetDate = DATE_PATTERN.test(rawDate) ? rawDate : today();

  try {
    const { data, error } = await checkOrderFeasibility(itemId, qty, targetDate);
    if (error) return { ...EMPTY_FEASIBILITY, error: `판정에 실패했습니다: ${error}` };
    if (!data) return { ...EMPTY_FEASIBILITY, error: '판정 결과를 받지 못했습니다.' };

    await recordSalesInquiry({
      itemId,
      requestedQty: qty,
      requestedDate: targetDate,
      question: `${itemId} ${qty} · ${targetDate}`,
      answerStatus: data.status,
      answer: data,
    });

    return {
      error: null,
      result: data,
      input: { itemId, qty, targetDate },
      allocationMessage: null,
    };
  } catch (error) {
    return {
      ...EMPTY_FEASIBILITY,
      error: error instanceof Error ? error.message : '판정에 실패했습니다.',
    };
  }
}

/**
 * 가예약 — renew.prd 27.6. ★ 실제로 재고를 잡습니다.
 *
 * 이 수량은 즉시 ATP 에서 빠져 다른 영업이 같은 재고를 약속할 수 없게 됩니다.
 * 그래서 감사 로그를 남깁니다 (renew.prd 31.1).
 */
export async function reserveAllocation(
  _prev: FeasibilityState,
  formData: FormData,
): Promise<FeasibilityState> {
  const user = await getSessionUser();
  if (!user) return { ...EMPTY_FEASIBILITY, error: '로그인이 필요합니다.' };

  const itemId = String(formData.get('itemId') ?? '').trim();
  const qty = Number(String(formData.get('qty') ?? '').trim());
  const customer = String(formData.get('customer') ?? '').trim() || null;

  if (!itemId) return { ...EMPTY_FEASIBILITY, error: '품목을 고르세요.' };
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ...EMPTY_FEASIBILITY, error: '수량을 0보다 큰 숫자로 적어주세요.' };
  }

  try {
    const result = await createSoftAllocation(itemId, qty, null, customer);
    if (result.error) {
      return { ...EMPTY_FEASIBILITY, error: `가예약에 실패했습니다: ${result.error}` };
    }
    if (!result.ok) return { ...EMPTY_FEASIBILITY, error: result.message };

    await writeAuditLog(user, {
      action: 'SOFT_ALLOCATION_CREATE',
      targetType: 'core.soft_allocation',
      targetId: String(result.allocationId ?? ''),
      after: { item_id: itemId, qty, customer, valid_until: result.validUntil },
    });

    revalidatePath('/sales');
    return {
      error: null,
      result: null,
      input: null,
      allocationMessage: result.message,
    };
  } catch (error) {
    return {
      ...EMPTY_FEASIBILITY,
      error: error instanceof Error ? error.message : '가예약에 실패했습니다.',
    };
  }
}

async function changeAllocation(
  formData: FormData,
  run: (id: number) => Promise<{ ok: boolean; message: string; error: string | null }>,
  action: 'SOFT_ALLOCATION_CONFIRM' | 'SOFT_ALLOCATION_RELEASE',
): Promise<AllocationActionState> {
  const user = await getSessionUser();
  if (!user) return { error: '로그인이 필요합니다.', message: null };

  const raw = String(formData.get('allocationId') ?? '').trim();
  const allocationId = Number(raw);
  if (!raw || !Number.isFinite(allocationId)) {
    return { error: '가예약을 찾을 수 없습니다.', message: null };
  }

  try {
    const result = await run(allocationId);
    if (result.error) return { error: `처리에 실패했습니다: ${result.error}`, message: null };
    if (!result.ok) return { error: result.message, message: null };

    await writeAuditLog(user, {
      action,
      targetType: 'core.soft_allocation',
      targetId: String(allocationId),
      after: { message: result.message },
    });

    revalidatePath('/sales');
    return { error: null, message: result.message };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : '처리에 실패했습니다.',
      message: null,
    };
  }
}

/** 수주 확정 — RESERVED → CONFIRMED. 본인 또는 관리자만 (DB 함수가 판정합니다) */
export async function confirmAllocation(
  _prev: AllocationActionState,
  formData: FormData,
): Promise<AllocationActionState> {
  return changeAllocation(formData, confirmSoftAllocation, 'SOFT_ALLOCATION_CONFIRM');
}

/** 가예약 해제 — → RELEASED. 본인 또는 관리자만 (DB 함수가 판정합니다) */
export async function releaseAllocation(
  _prev: AllocationActionState,
  formData: FormData,
): Promise<AllocationActionState> {
  return changeAllocation(formData, releaseSoftAllocation, 'SOFT_ALLOCATION_RELEASE');
}
