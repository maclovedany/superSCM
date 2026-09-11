'use server';

// Task 10a — 관리자 마스터 편집 서버 액션.
//
// ★ 메뉴 노출과 무관하게 첫 줄에서 requireAdmin() 을 다시 확인한다(레이아웃의 확인은 1차 방어일
//   뿐이다). 실제 쓰기는 core.upsert_supply_entity 등 security definer 함수가 다시 ADMIN 여부와
//   입력값을 확인하고, 이곳과 같은 사유(reason)를 core.audit_log 에 before/after 와 함께 남긴다.

import { revalidatePath } from 'next/cache';
import { requireAdmin } from './auth';
import {
  validateAddHolidayInput,
  validateCalendarReadinessInput,
  validateDeactivateDepartureRuleInput,
  validateDepartureRuleInput,
  validateRemoveHolidayInput,
  validateSupplierInput,
  validateSupplyEntityInput,
} from './master-model';
import {
  addBusinessHoliday,
  deactivateSupplierDepartureRule,
  removeBusinessHoliday,
  setCalendarMonthReady,
  setSupplierDepartureRule,
  upsertSupplier,
  upsertSupplyEntity,
} from './master';

export type MasterActionState = { error: string | null; success: string | null };
export const initialMasterActionState: MasterActionState = { error: null, success: null };

function revalidateMasterScreen() {
  revalidatePath('/admin/master');
}

export async function upsertSupplyEntityAction(_prev: MasterActionState, formData: FormData): Promise<MasterActionState> {
  await requireAdmin();
  const validation = validateSupplyEntityInput({
    entityId: formData.get('entityId'),
    entityName: formData.get('entityName'),
    countryCode: formData.get('countryCode'),
    prepDays: formData.get('prepDays'),
    active: formData.get('active'),
    validFrom: formData.get('validFrom'),
    validTo: formData.get('validTo'),
    note: formData.get('note'),
    reason: formData.get('reason'),
  });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await upsertSupplyEntity(validation.value);
  if (result.error) return { error: result.error, success: null };

  revalidateMasterScreen();
  return { error: null, success: `해외법인 ${validation.value.entityId} 정보를 저장했습니다.` };
}

export async function upsertSupplierAction(_prev: MasterActionState, formData: FormData): Promise<MasterActionState> {
  await requireAdmin();
  const validation = validateSupplierInput({
    supplierId: formData.get('supplierId'),
    supplierName: formData.get('supplierName'),
    entityId: formData.get('entityId'),
    leadTimeDays: formData.get('leadTimeDays'),
    active: formData.get('active'),
    validFrom: formData.get('validFrom'),
    validTo: formData.get('validTo'),
    note: formData.get('note'),
    reason: formData.get('reason'),
  });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await upsertSupplier(validation.value);
  if (result.error) return { error: result.error, success: null };

  revalidateMasterScreen();
  return { error: null, success: `공급처 ${validation.value.supplierId} 정보를 저장했습니다.` };
}

export async function setSupplierDepartureRuleAction(_prev: MasterActionState, formData: FormData): Promise<MasterActionState> {
  await requireAdmin();
  const validation = validateDepartureRuleInput({
    departureId: formData.get('departureId'),
    supplierId: formData.get('supplierId'),
    ruleType: formData.get('ruleType'),
    weekday: formData.get('weekday'),
    weekOfMonth: formData.get('weekOfMonth'),
    dayOfMonth: formData.get('dayOfMonth'),
    validFrom: formData.get('validFrom'),
    validTo: formData.get('validTo'),
    note: formData.get('note'),
    reason: formData.get('reason'),
  });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await setSupplierDepartureRule(validation.value);
  if (result.error) return { error: result.error, success: null };

  revalidateMasterScreen();
  return { error: null, success: validation.value.departureId ? '출항일 규칙을 변경했습니다.' : '출항일 규칙을 추가했습니다.' };
}

export async function deactivateSupplierDepartureRuleAction(_prev: MasterActionState, formData: FormData): Promise<MasterActionState> {
  await requireAdmin();
  const validation = validateDeactivateDepartureRuleInput({
    departureId: formData.get('departureId'),
    reason: formData.get('reason'),
  });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await deactivateSupplierDepartureRule(validation.value);
  if (result.error) return { error: result.error, success: null };

  revalidateMasterScreen();
  return { error: null, success: '출항일 규칙을 비활성화했습니다.' };
}

export async function addBusinessHolidayAction(_prev: MasterActionState, formData: FormData): Promise<MasterActionState> {
  await requireAdmin();
  const validation = validateAddHolidayInput({
    countryCode: formData.get('countryCode'),
    calendarDate: formData.get('calendarDate'),
    holidayName: formData.get('holidayName'),
    reason: formData.get('reason'),
  });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await addBusinessHoliday(validation.value);
  if (result.error) return { error: result.error, success: null };

  revalidateMasterScreen();
  return { error: null, success: `${validation.value.calendarDate} 공휴일을 등록했습니다.` };
}

export async function removeBusinessHolidayAction(_prev: MasterActionState, formData: FormData): Promise<MasterActionState> {
  await requireAdmin();
  const validation = validateRemoveHolidayInput({
    countryCode: formData.get('countryCode'),
    calendarDate: formData.get('calendarDate'),
    reason: formData.get('reason'),
  });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await removeBusinessHoliday(validation.value);
  if (result.error) return { error: result.error, success: null };

  revalidateMasterScreen();
  return { error: null, success: `${validation.value.calendarDate} 공휴일을 제거했습니다.` };
}

export async function setCalendarMonthReadyAction(_prev: MasterActionState, formData: FormData): Promise<MasterActionState> {
  await requireAdmin();
  const validation = validateCalendarReadinessInput({
    countryCode: formData.get('countryCode'),
    calYear: formData.get('calYear'),
    calMonth: formData.get('calMonth'),
    ready: formData.get('ready'),
    reason: formData.get('reason'),
  });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await setCalendarMonthReady(validation.value);
  if (result.error) return { error: result.error, success: null };

  revalidateMasterScreen();
  return { error: null, success: `${validation.value.countryCode} ${validation.value.calYear}-${validation.value.calMonth} 준비 상태를 저장했습니다.` };
}
