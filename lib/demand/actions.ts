'use server';

// 부서별 월간 수요 제출 서버 액션 — Task 7
//
// ★ 모든 액션은 첫 줄에서 업무 권한을 다시 검사한다(메뉴 숨김은 1차 방어일 뿐이다). 그다음 입력을
//   검증하고, 실제 허용 여부·마감·부서 소유권은 DB 명령 함수가 판정한 결과를 그대로 돌려준다.
// ★ 파일 업로드·직접 입력 모두 STEP 4와 같은 lib/import/schema.ts · validate.ts를 재사용한다
//   ('demand_line' import type). 최종 저장 값의 품목코드는 core.save_demand_submission_lines가
//   core.v_item_master로 다시 확인한다(DB측 매칭, 컨트롤러 판정 4).

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { AuthorizationError, getPermissions, requirePermission, requireSignedIn } from '../auth';
import { importReferences } from '../import/repository';
import { parseCsv, parseExcel } from '../import/parse';
import { suggestColumnMapping } from '../import/schema';
import { validateRows } from '../import/validate';
import type { ImportRow } from '../import/types';
import { buildDemandLineDrafts, validateOpenPlanningCycle, validateSubmissionId, validateWithdrawSubmission } from './model';
import { validateRequestEventDemand, validateSetSupplyMeetingResult } from './approved-model';
import {
  agreeDemandSubmission,
  closePlanningCycle,
  openPlanningCycle,
  requestEventDemand,
  saveDemandSubmissionLines,
  setSupplyMeetingResult,
  startDemandSubmission,
  submitDemandSubmission,
  withdrawDemandSubmission,
} from './repository';

export type DemandActionState = { error: string | null; success: string | null };

/**
 * core.open_planning_cycle · core.close_planning_cycle · core.agree_demand_submission은
 * "SCM 품목담당자(PLAN_CONFIRM) 또는 ADMIN"을 함께 허용한다(컨트롤러 판정 3·5). ADMIN은 업무
 * 권한을 자동으로 갖지 않으므로(lib/permission.ts) requirePermission 하나로는 부족해 여기서 직접
 * 두 경로를 함께 확인한다.
 */
async function requirePlanConfirmOrAdmin() {
  const current = await requireSignedIn();
  if (current.profile.role === 'ADMIN') return current;
  const permissions = await getPermissions();
  if (!permissions.has('PLAN_CONFIRM')) {
    throw new AuthorizationError('SCM 품목담당자 또는 관리자 권한이 필요합니다.', 403);
  }
  return current;
}

function revalidateDemandScreens(submissionId?: string) {
  revalidatePath('/demand-submissions');
  if (submissionId) revalidatePath(`/demand-submissions/${submissionId}`);
  revalidatePath('/admin/demand');
}

/** 파일·직접 입력 공통 저장 경로 — lib/import의 검증을 재사용한 뒤 DB 명령 함수로 저장한다 */
async function persistDemandLines(submissionId: string, rows: ImportRow[]): Promise<DemandActionState> {
  if (rows.length === 0) return { error: '저장할 항목이 없습니다.', success: null };

  const references = await importReferences();
  const validated = validateRows('demand_line', rows, references);

  const lines = validated.rows.map((row) => ({
    item_id: row.data.item_id === null || row.data.item_id === undefined ? '' : String(row.data.item_id),
    qty: row.data.qty === null || row.data.qty === undefined ? '' : String(row.data.qty),
    need_month: row.data.need_month === null || row.data.need_month === undefined ? '' : String(row.data.need_month),
  }));

  const result = await saveDemandSubmissionLines({ submissionId, lines });
  if (result.error) return { error: result.error, success: null };

  revalidateDemandScreens(submissionId);
  return {
    error: null,
    success: `${rows.length}건을 저장했습니다(사전 점검 정상 ${validated.summary.successRows}건 · 오류 ${validated.summary.errorRows}건). `
      + '최종 오류 건수는 저장 결과에서 다시 확인하세요.',
  };
}

export async function openPlanningCycleAction(_previous: DemandActionState, formData: FormData): Promise<DemandActionState> {
  await requirePlanConfirmOrAdmin();
  const validation = validateOpenPlanningCycle({ planMonth: formData.get('planMonth') });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await openPlanningCycle(validation.value);
  if (result.error) return { error: result.error, success: null };
  revalidateDemandScreens();
  return { error: null, success: '취합 주기를 열었습니다.' };
}

export async function closePlanningCycleAction(_previous: DemandActionState, formData: FormData): Promise<DemandActionState> {
  await requirePlanConfirmOrAdmin();
  const cycleId = String(formData.get('cycleId') ?? '').trim();
  if (cycleId === '') return { error: '취합 주기 ID가 필요합니다.', success: null };

  const result = await closePlanningCycle({ cycleId });
  if (result.error) return { error: result.error, success: null };
  revalidateDemandScreens();
  return { error: null, success: '취합 주기를 닫았습니다.' };
}

export async function startDemandSubmissionAction(_previous: DemandActionState, formData: FormData): Promise<DemandActionState> {
  await requirePermission('DEMAND_SUBMIT');
  const validation = validateOpenPlanningCycle({ planMonth: formData.get('planMonth') });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await startDemandSubmission(validation.value);
  if (result.error || !result.data) return { error: result.error ?? '제출본 ID를 받지 못했습니다.', success: null };
  revalidateDemandScreens();
  redirect(`/demand-submissions/${result.data}`);
}

export async function uploadDemandLinesAction(_previous: DemandActionState, formData: FormData): Promise<DemandActionState> {
  await requirePermission('DEMAND_SUBMIT');
  const submissionId = String(formData.get('submissionId') ?? '').trim();
  const idValidation = validateSubmissionId(submissionId);
  if (!idValidation.ok) return { error: idValidation.message, success: null };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: '업로드할 파일을 선택하세요.', success: null };

  let columns: string[];
  let parsedRows: ImportRow[];
  try {
    if (file.name.toLowerCase().endsWith('.xlsx')) {
      ({ columns, rows: parsedRows } = parseExcel(await file.arrayBuffer()));
    } else {
      ({ columns, rows: parsedRows } = parseCsv(await file.text()));
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : '파일을 읽지 못했습니다.', success: null };
  }

  // STEP 4의 열 별칭 매핑(suggestColumnMapping)을 그대로 재사용해 "품목코드/수량/필요월" 같은
  // 한글 헤더도 item_id/qty/need_month로 맞춘 뒤 검증한다. 별도의 매핑 검토 화면은 두지 않는다.
  const mapping = suggestColumnMapping('demand_line', columns);
  const rows: ImportRow[] = parsedRows.map((row) => {
    const mapped: ImportRow = {};
    for (const [target, source] of Object.entries(mapping)) {
      if (source) mapped[target] = row[source];
    }
    return mapped;
  });

  return persistDemandLines(idValidation.value.submissionId, rows);
}

export async function saveDemandLinesAction(_previous: DemandActionState, formData: FormData): Promise<DemandActionState> {
  await requirePermission('DEMAND_SUBMIT');
  const submissionId = String(formData.get('submissionId') ?? '').trim();
  const idValidation = validateSubmissionId(submissionId);
  if (!idValidation.ok) return { error: idValidation.message, success: null };

  const drafts = buildDemandLineDrafts({
    itemIds: formData.getAll('itemId'),
    quantities: formData.getAll('qty'),
    needMonths: formData.getAll('needMonth'),
  });

  return persistDemandLines(idValidation.value.submissionId, drafts);
}

export async function submitDemandSubmissionAction(_previous: DemandActionState, formData: FormData): Promise<DemandActionState> {
  await requirePermission('DEMAND_SUBMIT');
  const validation = validateSubmissionId(formData.get('submissionId'));
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await submitDemandSubmission({ submissionId: validation.value.submissionId });
  if (result.error) return { error: result.error, success: null };
  revalidateDemandScreens(validation.value.submissionId);
  return { error: null, success: '제출을 완료했습니다. 미제출 반복 알림이 있었다면 중단됩니다.' };
}

export async function withdrawDemandSubmissionAction(_previous: DemandActionState, formData: FormData): Promise<DemandActionState> {
  await requirePermission('DEMAND_SUBMIT');
  const validation = validateWithdrawSubmission({
    submissionId: formData.get('submissionId'),
    reason: formData.get('reason'),
  });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await withdrawDemandSubmission(validation.value);
  if (result.error) return { error: result.error, success: null };
  revalidateDemandScreens(validation.value.submissionId);
  return { error: null, success: '제출을 회수했습니다. 마감일이 지났다면 미제출 알림이 다시 시작됩니다.' };
}

export async function agreeDemandSubmissionAction(_previous: DemandActionState, formData: FormData): Promise<DemandActionState> {
  await requirePlanConfirmOrAdmin();
  const validation = validateSubmissionId(formData.get('submissionId'));
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await agreeDemandSubmission({ submissionId: validation.value.submissionId });
  if (result.error) return { error: result.error, success: null };
  revalidateDemandScreens(validation.value.submissionId);
  return { error: null, success: '합의를 확정했습니다. 해당 부서는 더 이상 이 제출본을 수정할 수 없습니다.' };
}

// ══ Task 8 — 확정 수요 구성과 이벤트 추가 수요 승인 ══════════════════════

function revalidateApprovedDemandScreens() {
  revalidatePath('/demand-submissions/consolidation');
  revalidatePath('/approvals');
}

/** SUPPLY_MEETING_INPUT — 수급회의 결과 입력·수정. 팀장 승인 없이 approved 플래그가 최종 판단이다 */
export async function setSupplyMeetingResultAction(_previous: DemandActionState, formData: FormData): Promise<DemandActionState> {
  await requirePermission('SUPPLY_MEETING_INPUT');
  const validation = validateSetSupplyMeetingResult({
    planMonth: formData.get('planMonth'),
    itemId: formData.get('itemId'),
    qty: formData.get('qty'),
    approved: formData.get('approved'),
    basisSubmissionLineId: formData.get('basisSubmissionLineId'),
    reason: formData.get('reason'),
  });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await setSupplyMeetingResult(validation.value);
  if (result.error) return { error: result.error, success: null };
  revalidateApprovedDemandScreens();
  return { error: null, success: '수급회의 결과를 저장했습니다.' };
}

/** DEMAND_CONSOLIDATE — 이벤트 추가 수요 등록. 저장과 동시에 SCM팀장에게 승인을 요청한다(EVENT_ORDER) */
export async function requestEventDemandAction(_previous: DemandActionState, formData: FormData): Promise<DemandActionState> {
  await requirePermission('DEMAND_CONSOLIDATE');
  const validation = validateRequestEventDemand({
    planMonth: formData.get('planMonth'),
    itemId: formData.get('itemId'),
    customerName: formData.get('customerName'),
    qty: formData.get('qty'),
    reason: formData.get('reason'),
  });
  if (!validation.ok) return { error: validation.message, success: null };

  const result = await requestEventDemand(validation.value);
  if (result.error) return { error: result.error, success: null };
  revalidateApprovedDemandScreens();
  return { error: null, success: '이벤트 추가 수요를 등록하고 SCM팀장에게 승인을 요청했습니다. 승인 전까지는 발주 수요에 반영되지 않습니다.' };
}
