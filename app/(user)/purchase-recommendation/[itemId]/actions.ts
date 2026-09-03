'use server';

// Forecast Override 입력과 해제 — renew.prd 17장
//
// AI 예측 원본(core.forecast_result)은 건드리지 않습니다. 증감만 따로 쌓아
// Consensus 를 만들고, 그 Consensus 가 재고 전개와 발주 추천에 들어갑니다.
//
// 권한은 서버에서 봅니다 (AGENTS.md 규칙 8). 관리자 전용이 아닙니다 —
// 담당자(USER)도 보정할 수 있어야 합니다 (renew.prd 4.3).
// 값 검증은 DB 함수가 한 번 더 합니다. 여기서 거르는 것은 사용자에게 빨리 알려주기 위해서입니다.
//
// ★ 로그인 확인에 requireUser() 를 쓰지 않습니다. 그 함수는 redirect() 를 호출하고
//   redirect 는 NEXT_REDIRECT 를 throw 하는데, 액션의 try/catch 가 그것을 삼켜 버립니다.
//   그러면 세션이 만료된 사용자가 /login 으로 가지 못하고 표 셀 안의 오류 문구만 봅니다.
//   getSessionUser() 는 null 을 돌려주므로 액션이 그 사실을 직접 다룰 수 있습니다.

import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isOverrideReasonCode, requiresReasonText } from '@/lib/override-model';
import {
  isApprovalReasonCode,
  isDecision,
  requiresApprovalReasonText,
} from '@/lib/approval-model';
import type { ApprovalActionState, OverrideActionState } from './state';

/** 보정을 저장한 뒤 다시 그려야 하는 화면들. Consensus 가 이 화면들의 재료입니다 */
function revalidateOverridePaths(): void {
  revalidatePath('/purchase-recommendation/[itemId]', 'page');
  revalidatePath('/purchase-recommendation');
  revalidatePath('/inventory-projection');
  revalidatePath('/forecast-override');
}

export async function setOverride(
  _prev: OverrideActionState,
  formData: FormData,
): Promise<OverrideActionState> {
  const actor = await getSessionUser();
  if (!actor) return { error: '로그인이 필요합니다.', message: null };

  const itemId = String(formData.get('itemId') ?? '').trim();
  const period = String(formData.get('period') ?? '').trim();
  const rawQty = String(formData.get('overrideQty') ?? '').trim();
  const reasonCode = String(formData.get('reasonCode') ?? '').trim();
  const reasonText = String(formData.get('reasonText') ?? '').trim();

  if (!itemId || !period) return { error: '품목과 기간을 확인해주세요.', message: null };

  if (rawQty === '') return { error: '증감 수량을 입력해주세요.', message: null };

  // 증감이므로 음수가 정상 입력입니다 (renew.prd 17.1 의 +300 / −300).
  const overrideQty = Number(rawQty);
  if (!Number.isFinite(overrideQty)) {
    return { error: '증감 수량은 숫자로 입력해주세요.', message: null };
  }

  if (!isOverrideReasonCode(reasonCode)) {
    return { error: '사유를 선택해주세요.', message: null };
  }

  // renew.prd 17.2 — "OTHER 기타 (텍스트 필수)"
  if (requiresReasonText(reasonCode) && reasonText === '') {
    return { error: '기타 를 고르면 사유를 직접 적어야 합니다.', message: null };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('set_forecast_override', {
      p_item_id: itemId,
      p_period: period,
      p_override_qty: overrideQty,
      p_reason_code: reasonCode,
      p_reason_text: reasonText === '' ? null : reasonText,
    });

    if (error) return { error: `저장에 실패했습니다: ${error.message}`, message: null };

    const row = (Array.isArray(data) ? data[0] : data) as
      | {
          ok?: boolean;
          message?: string;
          prev_override_qty?: number | string | null;
          prev_consensus_forecast?: number | string | null;
        }
      | null;

    if (row?.ok !== true) return { error: row?.message ?? '저장하지 못했습니다.', message: null };

    // 대체한 값이 있으면 before 로 남깁니다 (renew.prd 31.1 — 무엇을 무엇으로 바꿨나).
    // 함수가 supersede 하기 직전에 읽은 값을 그대로 돌려줍니다. 처음 저장이면 null 이고,
    // 그때는 before 를 아예 넣지 않습니다 — 빈 객체는 "이전 값이 0이었다" 로 읽힙니다.
    const hadPrevious =
      row.prev_override_qty !== null && row.prev_override_qty !== undefined;

    await writeAuditLog(actor, {
      action: 'FORECAST_OVERRIDE_SET',
      targetType: 'core.forecast_override',
      targetId: `${itemId} ${period}`,
      before: hadPrevious
        ? {
            override_qty: Number(row.prev_override_qty),
            consensus_forecast:
              row.prev_consensus_forecast === null || row.prev_consensus_forecast === undefined
                ? null
                : Number(row.prev_consensus_forecast),
          }
        : undefined,
      after: {
        override_qty: overrideQty,
        reason_code: reasonCode,
        reason_text: reasonText === '' ? null : reasonText,
      },
    });

    revalidateOverridePaths();
    return { error: null, message: row?.message ?? '저장했습니다.' };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : '저장에 실패했습니다.',
      message: null,
    };
  }
}

export async function clearOverride(
  _prev: OverrideActionState,
  formData: FormData,
): Promise<OverrideActionState> {
  const actor = await getSessionUser();
  if (!actor) return { error: '로그인이 필요합니다.', message: null };

  const itemId = String(formData.get('itemId') ?? '').trim();
  const period = String(formData.get('period') ?? '').trim();

  if (!itemId || !period) return { error: '품목과 기간을 확인해주세요.', message: null };

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('clear_forecast_override', {
      p_item_id: itemId,
      p_period: period,
    });

    if (error) return { error: `해제에 실패했습니다: ${error.message}`, message: null };

    const row = (Array.isArray(data) ? data[0] : data) as
      | { ok?: boolean; message?: string }
      | null;

    if (row?.ok !== true) return { error: row?.message ?? '해제하지 못했습니다.', message: null };

    await writeAuditLog(actor, {
      action: 'FORECAST_OVERRIDE_CLEAR',
      targetType: 'core.forecast_override',
      targetId: `${itemId} ${period}`,
    });

    revalidateOverridePaths();
    return { error: null, message: row?.message ?? '해제했습니다.' };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : '해제에 실패했습니다.',
      message: null,
    };
  }
}

// ── STEP 13 · 발주 승인 (renew.prd 23장) ────────────────────────
//
// "추천 확인 → 필요시 수정 → 수정 사유 입력 → 승인".
// 승인 시점의 계산 근거 전체를 Snapshot 으로 함께 저장합니다 (renew.prd 23.2).
//
// ★ 관리자 전용이 아닙니다. 담당자(USER)가 승인합니다 (renew.prd 4.3 · 32).
//
// ★ 추천 수량은 화면이 보내지 않습니다. DB 함수가 승인 시점에 직접 읽어 저장합니다.
//   화면이 보낸 숫자를 그대로 믿으면 "AI 는 1,000 을 추천했다" 는 기록이 조작될 수
//   있습니다. 그래서 여기서는 '추천대로' 와 수량이 맞는지 검사하지 않고 DB 에 맡깁니다 —
//   폼이 미리 막아 주고, 뚫려도 함수가 한국어 안내로 거절합니다.

/** 결정을 저장한 뒤 다시 그려야 하는 화면들 */
function revalidateApprovalPaths(): void {
  revalidatePath('/purchase-recommendation/[itemId]', 'page');
  revalidatePath('/purchase-recommendation');
  revalidatePath('/decision-history');
}

export async function approveRecommendation(
  _prev: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const actor = await getSessionUser();
  if (!actor) return { error: '로그인이 필요합니다.', message: null };

  const itemId = String(formData.get('itemId') ?? '').trim();
  const decision = String(formData.get('decision') ?? '').trim();
  const rawQty = String(formData.get('approvedQty') ?? '').trim();
  const reasonCode = String(formData.get('reasonCode') ?? '').trim();
  const reasonText = String(formData.get('reasonText') ?? '').trim();

  if (!itemId) return { error: '품목을 확인해주세요.', message: null };

  if (!isDecision(decision)) return { error: '결정을 선택해주세요.', message: null };

  if (!isApprovalReasonCode(reasonCode)) {
    return { error: '사유를 선택해주세요.', message: null };
  }

  // renew.prd 23.1 — 기타 를 고르면 무엇이 기타인지 적어야 집계가 가능합니다.
  if (requiresApprovalReasonText(reasonCode) && reasonText === '') {
    return { error: '기타 를 고르면 사유를 직접 적어야 합니다.', message: null };
  }

  // ★ 반려 · 보류는 "이만큼 승인했다" 가 없는 결정입니다. 폼이 무엇을 보냈든 0 으로 보냅니다.
  //   추천 수량이 그대로 넘어가면 1,000 을 반려했는데 approved_qty 1,000 · adjustment 0 으로
  //   남아, 이력이 '반려 · 수량 1,000' 으로 읽히고 ACTIVE 행의 수량을 합산하는 뒤 단계가
  //   아무도 승인하지 않은 수량을 셉니다. 폼이 칸을 비우고 잠그고, 여기서 한 번 더 막고,
  //   DB 함수가 마지막으로 0 을 강제합니다.
  let approvedQty = 0;
  if (decision === 'APPROVED') {
    if (rawQty === '') return { error: '승인 수량을 입력해주세요.', message: null };

    approvedQty = Number(rawQty);
    if (!Number.isFinite(approvedQty)) {
      return { error: '승인 수량은 숫자로 입력해주세요.', message: null };
    }
    if (approvedQty < 0) {
      return { error: '승인 수량은 0 보다 작을 수 없습니다.', message: null };
    }
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('approve_recommendation', {
      p_item_id: itemId,
      p_approved_qty: approvedQty,
      p_decision: decision,
      p_reason_code: reasonCode,
      p_reason_text: reasonText === '' ? null : reasonText,
    });

    if (error) return { error: `저장에 실패했습니다: ${error.message}`, message: null };

    const row = (Array.isArray(data) ? data[0] : data) as
      | { ok?: boolean; approval_id?: number | string | null; message?: string }
      | null;

    if (row?.ok !== true) return { error: row?.message ?? '저장하지 못했습니다.', message: null };

    // renew.prd 31.1 — 무엇을 결정했는지 감사 로그에도 남깁니다.
    // 추천 수량은 여기서 알 수 없습니다(함수가 직접 읽어 저장합니다).
    // 그 값은 core.approval 행과 Snapshot 에 남아 있으므로 targetId 로 되짚습니다.
    await writeAuditLog(actor, {
      action: 'RECOMMENDATION_APPROVED',
      targetType: 'core.approval',
      targetId:
        row.approval_id === null || row.approval_id === undefined
          ? itemId
          : `${itemId} #${row.approval_id}`,
      after: {
        item_id: itemId,
        decision,
        approved_qty: approvedQty,
        reason_code: reasonCode,
        reason_text: reasonText === '' ? null : reasonText,
      },
    });

    revalidateApprovalPaths();
    return { error: null, message: row?.message ?? '저장했습니다.' };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : '저장에 실패했습니다.',
      message: null,
    };
  }
}
