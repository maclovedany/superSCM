'use server';

// 서비스 수준과 품목 정책 저장 — renew.prd 21.2 · 22.1 · 11.4
//
// 여기서 바꾼 값은 코드를 한 줄도 고치지 않고 안전재고와 발주 추천에 즉시 반영됩니다.
//   core.service_level  → core.v_item_service_level → analytics.v_safety_stock
//   core.item_policy    → 같은 경로 + MOQ · 포장 단위
//
// 쓰기는 RLS 가 관리자만 허용합니다. 그래도 서버에서 한 번 더 검증합니다 (AGENTS.md 규칙 8).

import { revalidatePath } from 'next/cache';
import { requireAdminOrThrow } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { PolicyActionState } from './state';
import { refreshPlanningCacheAfterResponse } from '@/lib/planning-cache';

/** 정책값이 달라지면 판정도 달라집니다. 관련 화면을 함께 갱신합니다 */
async function revalidateAll() {
  refreshPlanningCacheAfterResponse();   // 서비스 수준 · Z 가 안전재고 캐시에 들어갑니다 (sql/37)
  revalidatePath('/admin/policies/service-level');
  revalidatePath('/admin/policies/safety-stock');
  revalidatePath('/purchase-recommendation');
}

/** 오늘 날짜(YYYY-MM-DD). core.service_level 의 effective_from 으로 씁니다 */
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * 빈 입력은 null 입니다. 0 으로 채우지 않습니다.
 *
 * MOQ 가 null 이면 "최소 주문 수량 제약 없음", 0 이면 "0개부터 주문 가능" 입니다.
 * 둘은 다른 뜻이고, sql/06 의 core.item_policy 주석이 그 구분을 요구합니다.
 */
function optionalNumber(
  formData: FormData,
  key: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const raw = String(formData.get(key) ?? '').trim();
  if (!raw) return { ok: true, value: null };
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return { ok: false, error: `${key} 는 숫자여야 합니다.` };
  return { ok: true, value: parsed };
}

/**
 * 등급별 서비스 수준을 오늘 자로 적용합니다 — renew.prd 21.2.
 *
 * 과거 행을 덮어쓰지 않고 (등급, 오늘) 로 한 행을 더 쌓습니다.
 * 그래야 "그때 왜 이 안전재고였나" 를 나중에 설명할 수 있습니다.
 */
export async function saveServiceLevel(
  _prev: PolicyActionState,
  formData: FormData,
): Promise<PolicyActionState> {
  let actor;
  try {
    actor = await requireAdminOrThrow();
  } catch {
    return { error: '관리자 권한이 필요합니다.', message: null };
  }

  const itemGrade = String(formData.get('itemGrade') ?? '').trim();
  if (!itemGrade) return { error: '등급을 찾을 수 없습니다.', message: null };

  const serviceLevelRaw = String(formData.get('serviceLevel') ?? '').trim();
  if (!serviceLevelRaw) return { error: '서비스 수준을 입력해주세요.', message: null };

  const serviceLevel = Number(serviceLevelRaw);
  if (!Number.isFinite(serviceLevel) || serviceLevel <= 0 || serviceLevel >= 1) {
    return { error: '서비스 수준은 0 과 1 사이의 비율입니다 (예: 0.95).', message: null };
  }

  const zParsed = optionalNumber(formData, 'zValue');
  if (!zParsed.ok) return { error: 'Z 는 숫자여야 합니다.', message: null };

  try {
    const supabase = await createSupabaseServerClient();

    let zValue = zParsed.value;

    // Z 를 비워 두면 core.z_table 에서 같은 서비스 수준의 행을 찾아 씁니다.
    // 표에 없으면 계산으로 지어내지 않고 사람에게 묻습니다 (AGENTS.md 규칙 2 · 5).
    if (zValue === null) {
      const { data: zRow } = await supabase
        .schema('core')
        .from('z_table')
        .select('z_value')
        .eq('service_level', serviceLevel)
        .maybeSingle();

      const found = (zRow as { z_value: number | string } | null)?.z_value;
      zValue = found === undefined || found === null ? null : Number(found);
    }

    if (zValue === null || !Number.isFinite(zValue) || zValue <= 0) {
      return {
        error: `서비스 수준 ${serviceLevel} 은 core.z_table 에 없습니다. Z 값을 직접 입력해주세요.`,
        message: null,
      };
    }

    const effectiveFrom = today();

    // 같은 날 두 번 고치면 그날 행을 덮어씁니다. 날짜가 다르면 새 행이 쌓입니다.
    const { data: before } = await supabase
      .schema('core')
      .from('service_level')
      .select('item_grade, service_level, z_value, effective_from')
      .eq('item_grade', itemGrade)
      .eq('effective_from', effectiveFrom)
      .maybeSingle();

    const { error } = await supabase
      .schema('core')
      .from('service_level')
      .upsert(
        {
          item_grade: itemGrade,
          service_level: serviceLevel,
          z_value: zValue,
          effective_from: effectiveFrom,
          updated_by: actor.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'item_grade,effective_from' },
      );

    if (error) return { error: `저장에 실패했습니다: ${error.message}`, message: null };

    await writeAuditLog(actor, {
      action: 'SERVICE_LEVEL_SET',
      targetType: 'core.service_level',
      targetId: `${itemGrade}@${effectiveFrom}`,
      before: before ?? null,
      after: { item_grade: itemGrade, service_level: serviceLevel, z_value: zValue, effective_from: effectiveFrom },
    });

    await revalidateAll();

    return {
      error: null,
      message: `${itemGrade} 등급을 서비스 수준 ${serviceLevel} · Z ${zValue} 로 ${effectiveFrom} 부터 적용합니다.`,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : '저장에 실패했습니다.',
      message: null,
    };
  }
}

/**
 * 품목 정책(등급 · MOQ · 포장 단위 · 개별 서비스 수준)을 고칩니다 — renew.prd 7.5 · 21.2 · 22.1.
 *
 * 빈 칸은 null 로 저장합니다. "제약 없음" 과 "0" 은 다른 뜻입니다.
 */
export async function saveItemPolicy(
  _prev: PolicyActionState,
  formData: FormData,
): Promise<PolicyActionState> {
  let actor;
  try {
    actor = await requireAdminOrThrow();
  } catch {
    return { error: '관리자 권한이 필요합니다.', message: null };
  }

  const itemId = String(formData.get('itemId') ?? '').trim();
  if (!itemId) return { error: '대상 품목을 찾을 수 없습니다.', message: null };

  const gradeRaw = String(formData.get('itemGrade') ?? '').trim().toUpperCase();
  const itemGrade = gradeRaw === '' ? null : gradeRaw;

  const moq = optionalNumber(formData, 'moq');
  if (!moq.ok) return { error: 'MOQ 는 숫자여야 합니다.', message: null };
  if (moq.value !== null && moq.value < 0) {
    return { error: 'MOQ 는 0 이상이어야 합니다.', message: null };
  }

  const packSize = optionalNumber(formData, 'packSize');
  if (!packSize.ok) return { error: '포장 단위는 숫자여야 합니다.', message: null };
  if (packSize.value !== null && packSize.value <= 0) {
    return { error: '포장 단위는 0 보다 커야 합니다. 올림이 필요 없으면 비워 두세요.', message: null };
  }

  const serviceLevel = optionalNumber(formData, 'serviceLevel');
  if (!serviceLevel.ok) return { error: '서비스 수준은 숫자여야 합니다.', message: null };
  if (serviceLevel.value !== null && (serviceLevel.value <= 0 || serviceLevel.value >= 1)) {
    return { error: '서비스 수준은 0 과 1 사이의 비율입니다 (예: 0.98).', message: null };
  }

  try {
    const supabase = await createSupabaseServerClient();

    const { data: before } = await supabase
      .schema('core')
      .from('item_policy')
      .select('item_id, item_grade, moq, pack_size, service_level')
      .eq('item_id', itemId)
      .maybeSingle();

    const after = {
      item_grade: itemGrade,
      moq: moq.value,
      pack_size: packSize.value,
      service_level: serviceLevel.value,
      updated_by: actor.userId,
      updated_at: new Date().toISOString(),
    };

    // 품목 행은 sql/06 이 미리 깔아 두었습니다. 없으면 upsert 로 만들어 줍니다.
    const { error } = await supabase
      .schema('core')
      .from('item_policy')
      .upsert({ item_id: itemId, ...after }, { onConflict: 'item_id' });

    if (error) return { error: `저장에 실패했습니다: ${error.message}`, message: null };

    await writeAuditLog(actor, {
      action: 'ITEM_POLICY_SET',
      targetType: 'core.item_policy',
      targetId: itemId,
      before: before ?? null,
      after,
    });

    await revalidateAll();

    return { error: null, message: `${itemId} 의 정책을 저장했습니다.` };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : '저장에 실패했습니다.',
      message: null,
    };
  }
}
