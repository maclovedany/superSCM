import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEMAND_SUBMISSION_STATUSES,
  buildDemandLineDrafts,
  demandLineIssueCount,
  demandLineSeverity,
  normalizeDemandSubmissionLineRow,
  normalizeDemandSubmissionRow,
  submissionActionsFor,
  submissionDeadline,
  submissionStatusTone,
  validateOpenPlanningCycle,
  validateSubmissionId,
  validateWithdrawSubmission,
} from './model.ts';

// ★ 제출 마감일 계산 — stage1.md §3 "월간 수요 자료 제출 마감일은 전월 말일의 하루 전으로 한다."
// 대상월 1일에서 이틀을 빼면 "전월 말일 - 1일"과 같다 (전월 말일 = 대상월 1일 - 1일).
test('제출 마감일 — 31일 말일(3월) → stage1 예시와 동일하게 3월 30일', () => {
  // 대상월 4월. 전월(3월)은 31일 말일 → 마감일은 3월 30일.
  assert.equal(submissionDeadline('2026-04'), '2026-03-30');
  assert.equal(submissionDeadline('2026-04-01'), '2026-03-30');
});

test('제출 마감일 — 30일 말일(4월) → 4월 29일', () => {
  // 대상월 5월. 전월(4월)은 30일 말일 → 마감일은 4월 29일.
  assert.equal(submissionDeadline('2026-05'), '2026-04-29');
});

test('제출 마감일 — 28일 말일(평년 2월) → 2월 27일', () => {
  // 대상월 3월(2026, 평년). 전월(2월)은 28일 말일 → 마감일은 2월 27일.
  assert.equal(submissionDeadline('2026-03'), '2026-02-27');
});

test('제출 마감일 — 29일 말일(윤년 2월) → 2월 28일', () => {
  // 대상월 3월(2028, 윤년). 전월(2월)은 29일 말일 → 마감일은 2월 28일.
  assert.equal(submissionDeadline('2028-03'), '2028-02-28');
});

test('제출 마감일 — 연도 경계(1월 대상월)도 전년 12월 기준으로 계산한다', () => {
  assert.equal(submissionDeadline('2026-01'), '2025-12-30');
});

test('제출 마감일 — 형식이 올바르지 않으면 null', () => {
  assert.equal(submissionDeadline('bad-month'), null);
  assert.equal(submissionDeadline(''), null);
});

test('제출 상태 목록에 4단계가 모두 있다', () => {
  assert.deepEqual(DEMAND_SUBMISSION_STATUSES, ['DRAFT', 'SUBMITTED', 'WITHDRAWN', 'AGREED']);
});

test('취합 주기 개설 입력 검증 — 월 형식이 아니면 거절', () => {
  const result = validateOpenPlanningCycle({ planMonth: '2026/04' });
  assert.equal(result.ok, false);
});

test('취합 주기 개설 입력 검증 — YYYY-MM 형식은 YYYY-MM-01로 정규화', () => {
  const result = validateOpenPlanningCycle({ planMonth: '2026-04' });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.planMonth, '2026-04-01');
});

test('제출 ID 검증 — UUID가 아니면 거절', () => {
  assert.equal(validateSubmissionId('not-a-uuid').ok, false);
  assert.equal(validateSubmissionId('11111111-1111-4111-8111-111111111111').ok, true);
});

test('회수 검증 — 사유가 없으면 거절', () => {
  const result = validateWithdrawSubmission({
    submissionId: '11111111-1111-4111-8111-111111111111',
    reason: '  ',
  });
  assert.equal(result.ok, false);
});

test('제출본 행 정규화 — 뷰 컬럼을 화면 타입으로 옮긴다', () => {
  const row = normalizeDemandSubmissionRow({
    submission_id: 's1',
    cycle_id: 'c1',
    plan_month: '2026-04-01',
    department: 'MARKETING',
    status: 'SUBMITTED',
    submission_deadline: '2026-03-30',
    total_line_count: 5,
    error_line_count: 0,
    submitted_by_name: '홍길동',
    submitted_at: '2026-03-20T00:00:00Z',
    last_modified_by_name: '홍길동',
    last_modified_at: '2026-03-20T00:00:00Z',
    version: 2,
  });
  assert.equal(row.submissionId, 's1');
  assert.equal(row.status, 'SUBMITTED');
  assert.equal(row.statusLabel, '제출완료');
  assert.equal(row.totalLineCount, 5);
  assert.equal(row.errorLineCount, 0);
});

test('제출 라인 행 정규화 — 알 수 없는 품목·null 수량을 조용히 지우지 않는다', () => {
  const row = normalizeDemandSubmissionLineRow({
    line_id: 'l1',
    line_no: 1,
    raw_item_code: 'unknown-item',
    item_id: null,
    qty: null,
    need_month: null,
    issues: [{ field_name: 'item_id', code: 'UNKNOWN_ITEM', message: '품목 마스터에 없습니다.' }],
  });
  assert.equal(row.itemId, null);
  assert.equal(row.qty, null);
  assert.equal(row.issues.length, 1);
  assert.equal(row.issues[0].code, 'UNKNOWN_ITEM');
});

test('라인 오류 건수와 severity 판정', () => {
  const okLine = { issues: [] };
  const errorLine = { issues: [{ field_name: 'item_id', code: 'UNKNOWN_ITEM', message: 'x' }] };
  assert.equal(demandLineSeverity(okLine), 'OK');
  assert.equal(demandLineSeverity(errorLine), 'ERROR');
  assert.equal(demandLineIssueCount([okLine, errorLine, errorLine]), 2);
});

test('제출본 화면 명령 — DRAFT/WITHDRAWN만 편집·제출 가능, SUBMITTED만 회수·합의 가능', () => {
  const draft = submissionActionsFor({ status: 'DRAFT', errorLineCount: 0, totalLineCount: 1 });
  assert.equal(draft.canEdit, true);
  assert.equal(draft.canSubmit, true);
  assert.equal(draft.canWithdraw, false);

  const submitted = submissionActionsFor({ status: 'SUBMITTED', errorLineCount: 0, totalLineCount: 1 });
  assert.equal(submitted.canEdit, false);
  assert.equal(submitted.canWithdraw, true);
  assert.equal(submitted.canAgree, true);

  const withErrors = submissionActionsFor({ status: 'DRAFT', errorLineCount: 1, totalLineCount: 2 });
  assert.equal(withErrors.canSubmit, false);

  const empty = submissionActionsFor({ status: 'DRAFT', errorLineCount: 0, totalLineCount: 0 });
  assert.equal(empty.canSubmit, false);
});

test('상태 배지 색', () => {
  assert.equal(submissionStatusTone('DRAFT'), 'gray');
  assert.equal(submissionStatusTone('SUBMITTED'), 'blue');
  assert.equal(submissionStatusTone('WITHDRAWN'), 'amber');
  assert.equal(submissionStatusTone('AGREED'), 'green');
});

test('직접 입력 초안을 raw 행으로 변환 — 빈 줄은 제외한다', () => {
  const rows = buildDemandLineDrafts({
    itemIds: ['ITEM001', '', 'ITEM002'],
    quantities: ['10', '', '5'],
    needMonths: ['2026-04', '', '2026-05'],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].item_id, 'ITEM001');
  assert.equal(rows[1].need_month, '2026-05');
});
