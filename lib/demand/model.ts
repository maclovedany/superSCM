// 부서별 월간 수요 제출 화면 모델 — Task 7
//
// ★ 여기서 취합·합의를 판정하지 않습니다. 마감일 계산(순수 함수)과 DB 결과를 화면 타입으로 옮기는
//   일만 합니다. 실제 허용 여부·권한·잠금은 core 명령 함수가 판정합니다.
// ★ 알 수 없는 값을 임의 값으로 채우지 않습니다. null 과 issues(오류 사유)를 그대로 둡니다
//   (AGENTS.md 5번).

export const DEMAND_SUBMISSION_STATUSES = ['DRAFT', 'SUBMITTED', 'WITHDRAWN', 'AGREED'] as const;
export type DemandSubmissionStatus = (typeof DEMAND_SUBMISSION_STATUSES)[number];

export const DEMAND_SUBMISSION_STATUS_LABELS: Record<DemandSubmissionStatus, string> = {
  DRAFT: '작성 중',
  SUBMITTED: '제출완료',
  WITHDRAWN: '회수됨',
  AGREED: '합의완료',
};

export const DEMAND_SUBMISSION_EVENT_LABELS: Record<string, string> = {
  CREATED: '작성 시작',
  SUBMITTED: '제출',
  WITHDRAWN: '회수',
  EDITED: '수정',
  AGREED: '합의 확정',
};

export type DemandLineIssue = { fieldName: string; code: string; message: string };

export type DemandSubmissionLine = {
  lineId: string;
  lineNo: number | null;
  rawItemCode: string | null;
  itemId: string | null;
  itemName: string | null;
  qty: number | null;
  needMonth: string | null;
  issues: DemandLineIssue[];
};

export type DemandSubmission = {
  submissionId: string;
  cycleId: string | null;
  planMonth: string | null;
  department: string | null;
  status: DemandSubmissionStatus | null;
  statusLabel: string;
  submissionDeadline: string | null;
  totalLineCount: number | null;
  errorLineCount: number | null;
  submittedByName: string | null;
  submittedAt: string | null;
  withdrawnAt: string | null;
  agreedByName: string | null;
  agreedAt: string | null;
  lastModifiedByName: string | null;
  lastModifiedAt: string | null;
  version: number | null;
};

type Failure<Code extends string> = { ok: false; reasonCode: Code; message: string };
type Result<T, Code extends string> = { ok: true; value: T } | Failure<Code>;

function fail<Code extends string>(reasonCode: Code, message: string): Failure<Code> {
  return { ok: false, reasonCode, message };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YEAR_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const YEAR_MONTH_DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function trimmed(input: unknown): string {
  if (typeof input === 'string') return input.trim();
  if (typeof input === 'number' && Number.isFinite(input)) return String(input);
  return '';
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * 'YYYY-MM' 또는 'YYYY-MM-DD' 입력을 연·월로 파싱합니다. 형식이 아니면 null.
 * 실제 존재하는 달인지(1~12)까지 확인합니다.
 */
function parseYearMonth(input: string): { year: number; month: number } | null {
  const monthMatch = YEAR_MONTH_PATTERN.exec(input) ?? YEAR_MONTH_DAY_PATTERN.exec(input);
  if (!monthMatch) return null;
  const year = Number(monthMatch[1]);
  const month = Number(monthMatch[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

/**
 * core.submission_deadline(p_plan_month) 와 같은 규칙 — stage1.md §3.
 * "대상월 전월 말일의 하루 전" = "대상월 1일 - 2일" 과 같습니다.
 * (전월 말일 = 대상월 1일 - 1일, 거기서 다시 하루를 뺍니다.)
 */
export function submissionDeadline(planMonth: unknown): string | null {
  const parsed = parseYearMonth(trimmed(planMonth));
  if (!parsed) return null;
  // UTC 고정 — 시간대에 따라 날짜가 밀리지 않도록 달력 계산만 합니다.
  const firstOfMonth = Date.UTC(parsed.year, parsed.month - 1, 1);
  const deadline = new Date(firstOfMonth - 2 * 24 * 60 * 60 * 1000);
  return `${deadline.getUTCFullYear()}-${pad2(deadline.getUTCMonth() + 1)}-${pad2(deadline.getUTCDate())}`;
}

export function validateOpenPlanningCycle(input: { planMonth: unknown }):
  Result<{ planMonth: string }, 'PLAN_MONTH_INVALID'> {
  const raw = trimmed(input.planMonth);
  const parsed = parseYearMonth(raw);
  if (!parsed) return fail('PLAN_MONTH_INVALID', '기준월은 YYYY-MM 형식이어야 합니다.');
  return { ok: true, value: { planMonth: `${parsed.year}-${pad2(parsed.month)}-01` } };
}

export function validateSubmissionId(input: unknown): Result<{ submissionId: string }, 'SUBMISSION_ID_INVALID'> {
  const submissionId = trimmed(input);
  if (!UUID_PATTERN.test(submissionId)) return fail('SUBMISSION_ID_INVALID', '올바른 제출본 ID가 필요합니다.');
  return { ok: true, value: { submissionId } };
}

export function validateWithdrawSubmission(input: { submissionId: unknown; reason: unknown }):
  Result<{ submissionId: string; reason: string }, 'SUBMISSION_ID_INVALID' | 'WITHDRAW_REASON_REQUIRED'> {
  const idResult = validateSubmissionId(input.submissionId);
  if (!idResult.ok) return idResult;
  const reason = trimmed(input.reason);
  if (reason === '') return fail('WITHDRAW_REASON_REQUIRED', '회수 사유를 입력하세요.');
  return { ok: true, value: { submissionId: idResult.value.submissionId, reason } };
}

function value(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (row[key] !== undefined) return row[key];
  return undefined;
}

function nullableText(input: unknown): string | null {
  return input === null || input === undefined || input === '' ? null : String(input);
}

function numberValue(input: unknown): number | null {
  if (input === null || input === undefined || input === '') return null;
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : null;
}

function statusOrNull(input: unknown): DemandSubmissionStatus | null {
  return typeof input === 'string' && (DEMAND_SUBMISSION_STATUSES as readonly string[]).includes(input)
    ? (input as DemandSubmissionStatus)
    : null;
}

function issuesOf(input: unknown): DemandLineIssue[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
    .map((item) => ({
      fieldName: String(value(item, ['field_name', 'fieldName']) ?? ''),
      code: String(value(item, ['code']) ?? ''),
      message: String(value(item, ['message']) ?? ''),
    }));
}

export function normalizeDemandSubmissionRow(row: Record<string, unknown>): DemandSubmission {
  const status = statusOrNull(value(row, ['status']));
  return {
    submissionId: String(value(row, ['submission_id']) ?? ''),
    cycleId: nullableText(value(row, ['cycle_id'])),
    planMonth: nullableText(value(row, ['plan_month'])),
    department: nullableText(value(row, ['department'])),
    status,
    statusLabel: status ? DEMAND_SUBMISSION_STATUS_LABELS[status] : '알 수 없음',
    submissionDeadline: nullableText(value(row, ['submission_deadline'])),
    totalLineCount: numberValue(value(row, ['total_line_count'])),
    errorLineCount: numberValue(value(row, ['error_line_count'])),
    submittedByName: nullableText(value(row, ['submitted_by_name'])),
    submittedAt: nullableText(value(row, ['submitted_at'])),
    withdrawnAt: nullableText(value(row, ['withdrawn_at'])),
    agreedByName: nullableText(value(row, ['agreed_by_name'])),
    agreedAt: nullableText(value(row, ['agreed_at'])),
    lastModifiedByName: nullableText(value(row, ['last_modified_by_name'])),
    lastModifiedAt: nullableText(value(row, ['last_modified_at'])),
    version: numberValue(value(row, ['version'])),
  };
}

export function normalizeDemandSubmissionLineRow(row: Record<string, unknown>): DemandSubmissionLine {
  return {
    lineId: String(value(row, ['line_id']) ?? ''),
    lineNo: numberValue(value(row, ['line_no'])),
    rawItemCode: nullableText(value(row, ['raw_item_code'])),
    itemId: nullableText(value(row, ['item_id'])),
    itemName: nullableText(value(row, ['item_name'])),
    qty: numberValue(value(row, ['qty'])),
    needMonth: nullableText(value(row, ['need_month'])),
    issues: issuesOf(value(row, ['issues'])),
  };
}

export function demandLineSeverity(line: { issues: unknown[] }): 'OK' | 'ERROR' {
  return line.issues.length > 0 ? 'ERROR' : 'OK';
}

export function demandLineIssueCount(lines: Array<{ issues: unknown[] }>): number {
  return lines.filter((line) => demandLineSeverity(line) === 'ERROR').length;
}

export function submissionActionsFor(submission: {
  status: DemandSubmissionStatus | null;
  errorLineCount: number | null;
  totalLineCount: number | null;
}) {
  const status = submission.status;
  const editable = status === 'DRAFT' || status === 'WITHDRAWN';
  const hasErrors = (submission.errorLineCount ?? 0) > 0;
  const hasLines = (submission.totalLineCount ?? 0) > 0;
  return {
    canEdit: editable,
    canSubmit: editable && !hasErrors && hasLines,
    canWithdraw: status === 'SUBMITTED',
    canAgree: status === 'SUBMITTED',
  };
}

export type StatusTone = 'green' | 'amber' | 'red' | 'gray' | 'blue';

export function submissionStatusTone(status: DemandSubmissionStatus | null): StatusTone {
  switch (status) {
    case 'AGREED': return 'green';
    case 'SUBMITTED': return 'blue';
    case 'WITHDRAWN': return 'amber';
    default: return 'gray';
  }
}

/** 한국 시간 일시. 값이 없거나 날짜가 아니면 null — 화면이 '—' 등으로 표시합니다 */
export function formatDemandDateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** 직접 입력 폼의 나란한 배열(item_id[]/qty[]/need_month[])을 lib/import 검증 입력 행으로 바꿉니다. 빈 줄은 제외합니다 */
export function buildDemandLineDrafts(input: { itemIds: unknown[]; quantities: unknown[]; needMonths: unknown[] }) {
  const rowCount = Math.max(input.itemIds.length, input.quantities.length, input.needMonths.length);
  const rows: Array<{ item_id: string; qty: string; need_month: string }> = [];
  for (let index = 0; index < rowCount; index += 1) {
    const itemId = trimmed(input.itemIds[index]);
    const qty = trimmed(input.quantities[index]);
    const needMonth = trimmed(input.needMonths[index]);
    if (itemId === '' && qty === '' && needMonth === '') continue;
    rows.push({ item_id: itemId, qty, need_month: needMonth });
  }
  return rows;
}
