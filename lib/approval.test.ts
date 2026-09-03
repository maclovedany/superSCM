// 승인 · 결정 이력의 라벨과 정규화 — STEP 13
//
// 이 테스트가 지키는 것은 두 가지입니다.
//   ① 화면이 쓰는 사유 코드 · 결정 라벨이 SQL(sql/19-approval.sql)과 같은 문구인가.
//      다르면 표에는 '예산 제약' 이, CSV 에는 'BUDGET' 이 나갑니다.
//   ② 값이 없을 때 숫자를 지어내지 않는가 (AGENTS.md 규칙 5).
//
// 상대 import 에는 .ts 를 붙입니다 (error.md #17).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  APPROVAL_REASON_CODES,
  DECISIONS,
  DECISION_LABEL,
  DECISION_TONE,
  KIND_LABEL,
  approvalReasonLabel,
  canUseAsRecommended,
  decisionLabel,
  isApprovalReasonCode,
  isDecision,
  isDecisionKind,
  kindLabel,
  normalizeApproval,
  normalizeApprovalKpi,
  normalizeApprovalSnapshot,
  normalizeDecisionHistory,
  normalizeRecommendationWithApproval,
  requiresApprovalReasonText,
} from './approval-model.ts';
import { REASON_CODES } from './override-model.ts';

const SQL = readFileSync('sql/19-approval.sql', 'utf-8');

/**
 * SQL 라벨 함수 하나의 `when '<코드>' then '<라벨>'` 짝을 뽑습니다.
 *
 * 화면과 DB 가 같은 문구를 쓰는지 검사하려고 파일을 읽습니다. DB 에 붙을 수 없으므로
 * (공통규칙 §4) 정의 원문을 대조하는 것이 지금 할 수 있는 가장 가까운 검증입니다.
 */
function sqlLabels(functionName: string): Map<string, string> {
  const start = SQL.indexOf(`create or replace function core.${functionName}(`);
  assert.notEqual(start, -1, `sql/19-approval.sql 에 core.${functionName} 이 없습니다`);
  const end = SQL.indexOf('$$;', start);
  assert.notEqual(end, -1, `core.${functionName} 의 본문이 닫히지 않았습니다`);

  const body = SQL.slice(start, end);
  const labels = new Map<string, string>();
  // tsconfig 의 target 이 낮아 matchAll 의 반복자를 for…of 로 돌 수 없습니다. 배열로 받습니다.
  for (const match of Array.from(body.matchAll(/when '([A-Z_]+)'\s+then '([^']+)'/g))) {
    labels.set(match[1], match[2]);
  }
  return labels;
}

// ── 사유 코드 ─────────────────────────────────────────────────

test('승인 사유 코드는 7종이고 코드가 겹치지 않는다', () => {
  assert.equal(APPROVAL_REASON_CODES.length, 7);
  const codes = APPROVAL_REASON_CODES.map((item) => item.code);
  assert.equal(new Set(codes).size, 7);
});

test('승인 사유 라벨이 core.approval_reason_label() 과 같다', () => {
  const labels = sqlLabels('approval_reason_label');
  assert.equal(labels.size, 7, '사유 코드 수가 SQL 과 다릅니다');

  for (const item of APPROVAL_REASON_CODES) {
    assert.equal(labels.get(item.code), item.label, `${item.code} 의 라벨이 SQL 과 다릅니다`);
  }
});

test('결정 라벨이 core.decision_label() 과 같다', () => {
  const labels = sqlLabels('decision_label');
  assert.equal(labels.size, 3);

  for (const decision of DECISIONS) {
    assert.equal(labels.get(decision), DECISION_LABEL[decision]);
  }
});

test('보정 사유 라벨이 core.override_reason_label() 과 같다', () => {
  // 결정 이력의 요약 문장을 SQL 이 조립하므로, 두 목록이 어긋나면 같은 보정이
  // 화면에서는 '프로모션', 이력에서는 다른 말로 보입니다.
  const labels = sqlLabels('override_reason_label');
  assert.equal(labels.size, REASON_CODES.length);

  for (const item of REASON_CODES) {
    assert.equal(labels.get(item.code), item.label, `${item.code} 의 라벨이 SQL 과 다릅니다`);
  }
});

test('모르는 코드는 지어내지 않고 원문을 돌려준다', () => {
  assert.equal(approvalReasonLabel('BUDGET'), '예산 제약');
  assert.equal(approvalReasonLabel('WHAT_IS_THIS'), 'WHAT_IS_THIS');
  assert.equal(approvalReasonLabel(null), null);

  assert.equal(decisionLabel('APPROVED'), '승인');
  assert.equal(decisionLabel('SOMETHING'), 'SOMETHING');
  assert.equal(decisionLabel(null), null);

  assert.equal(kindLabel('OVERRIDE'), KIND_LABEL.OVERRIDE);
  assert.equal(kindLabel('MYSTERY'), 'MYSTERY');
});

test('기타 를 골랐을 때만 사유 텍스트가 필수다', () => {
  assert.equal(requiresApprovalReasonText('OTHER'), true);
  for (const item of APPROVAL_REASON_CODES) {
    if (item.code === 'OTHER') continue;
    assert.equal(requiresApprovalReasonText(item.code), false);
  }
  assert.equal(requiresApprovalReasonText(null), false);
});

test('타입 가드는 목록에 있는 값만 통과시킨다', () => {
  assert.equal(isApprovalReasonCode('BUDGET'), true);
  assert.equal(isApprovalReasonCode('NEW_CONTRACT'), false);
  assert.equal(isApprovalReasonCode(null), false);

  assert.equal(isDecision('DEFERRED'), true);
  assert.equal(isDecision('APPROVE'), false);

  assert.equal(isDecisionKind('LEADTIME'), true);
  assert.equal(isDecisionKind('SOMETHING'), false);
});

test('결정마다 색이 다르다', () => {
  const tones = DECISIONS.map((decision) => DECISION_TONE[decision]);
  assert.equal(new Set(tones).size, DECISIONS.length);
});

// ── '추천대로' 판정 ───────────────────────────────────────────

test("'추천대로' 는 추천 수량을 그대로 승인했을 때만 고를 수 있다", () => {
  assert.equal(canUseAsRecommended('APPROVED', 500, 500), true);
  // 수량을 바꿨으면 왜 바꿨는지를 남겨야 합니다 (renew.prd 23).
  assert.equal(canUseAsRecommended('APPROVED', 800, 500), false);
  assert.equal(canUseAsRecommended('APPROVED', 0, 500), false);
  // 반려 · 보류는 "추천대로" 가 아닙니다.
  assert.equal(canUseAsRecommended('REJECTED', 500, 500), false);
  assert.equal(canUseAsRecommended('DEFERRED', 500, 500), false);
  // 추천을 산출하지 못한 품목은 "추천대로" 라고 말할 대상이 없습니다.
  assert.equal(canUseAsRecommended('APPROVED', 500, null), false);
  assert.equal(canUseAsRecommended('APPROVED', null, 500), false);
});

test('반려 · 보류는 승인 수량을 0 으로 강제한다 (SQL)', () => {
  // 화면이 추천 수량을 담아 보내도 그대로 저장되면 안 됩니다.
  // '1,000 을 반려했는데 approved_qty 1,000 · adjustment 0' 이 되어
  // 이력이 '반려 · 수량 1,000' 으로 읽히고, ACTIVE 행의 수량을 합산하는 뒤 단계가
  // 아무도 승인하지 않은 수량을 셉니다.
  const start = SQL.indexOf('create or replace function core.approve_recommendation(');
  const end = SQL.indexOf('$$;', start);
  // 주석을 걷어내고 봅니다. 이 규칙을 설명하는 주석 자체가 금지 패턴을 인용하고 있어서,
  // 원문 그대로 검사하면 주석에 걸립니다.
  const body = SQL.slice(start, end).replace(/--[^\n]*/g, '');

  assert.ok(
    /else\s+v_approved\s*:=\s*0;/.test(body),
    '반려 · 보류 분기가 v_approved := 0 을 강제해야 합니다',
  );
  assert.ok(
    !/coalesce\(\s*p_approved_qty\s*,\s*0\s*\)/.test(body),
    'coalesce(p_approved_qty, 0) 은 값이 없을 때만 0 으로 만듭니다 — 보낸 값이 그대로 저장됩니다',
  );
});

test("'수정 승인' 집계는 승인 행만 센다 (SQL)", () => {
  // 반려 · 보류는 승인 수량이 0 이라 조정량이 −추천값으로 남습니다.
  // 그것을 "수량을 고쳤다" 로 세면 반려가 전부 수정 승인으로 잡힙니다.
  const start = SQL.indexOf('create view analytics.v_approval_kpi as');
  const end = SQL.indexOf('as n_adjusted', start);
  const clause = SQL.slice(start, end);

  assert.ok(
    clause.lastIndexOf("a.decision = 'APPROVED'") > clause.lastIndexOf('as n_deferred'),
    'n_adjusted 의 filter 에 decision = APPROVED 조건이 있어야 합니다',
  );
});

// ── 정규화 ────────────────────────────────────────────────────

test('승인 한 줄을 정규화한다', () => {
  const row = normalizeApproval({
    approval_id: '12',
    item_id: 'ITEM001',
    item_name: '품목 하나',
    supplier_id: 'SUP01',
    recommendation_run_id: 'RUN-2024-01',
    recommended_qty: '500',
    approved_qty: '800',
    adjustment: '300',
    decision: 'APPROVED',
    reason_code: 'BUDGET',
    reason_text: '분기 예산',
    approved_email: 'a@b.c',
    approved_at: '2026-01-02T03:04:05Z',
    status: 'ACTIVE',
    is_active: true,
  });

  assert.equal(row.approvalId, 12);
  assert.equal(row.recommendedQty, 500);
  assert.equal(row.approvedQty, 800);
  assert.equal(row.adjustment, 300);
  assert.equal(row.decision, 'APPROVED');
  assert.equal(row.isActive, true);
});

test('조정량 0 과 "조정량을 모른다" 를 구분한다', () => {
  const asRecommended = normalizeApproval({ adjustment: 0, recommended_qty: 500 });
  assert.equal(asRecommended.adjustment, 0);

  // 추천을 산출하지 못한 품목은 조정량도 모릅니다. 0 으로 채우면 "추천대로 승인" 으로 읽힙니다.
  const unknown = normalizeApproval({ adjustment: null, recommended_qty: null });
  assert.equal(unknown.adjustment, null);
  assert.equal(unknown.recommendedQty, null);
});

test('is_active 가 없으면 status 로 판정한다', () => {
  assert.equal(normalizeApproval({ status: 'ACTIVE' }).isActive, true);
  assert.equal(normalizeApproval({ status: 'SUPERSEDED' }).isActive, false);
});

test('모르는 결정 문자열은 null 로 좁힌다', () => {
  assert.equal(normalizeApproval({ decision: 'MAYBE' }).decision, null);
  assert.equal(normalizeDecisionHistory({ kind: 'UNKNOWN_KIND' }).kind, null);
});

test('결정 이력 한 줄을 정규화한다', () => {
  const row = normalizeDecisionHistory({
    kind: 'LEADTIME',
    ref_id: '7',
    item_id: null,
    item_name: null,
    supplier_id: 'SUP01',
    actor_email: 'a@b.c',
    at: '2026-01-02T03:04:05Z',
    decision: null,
    adjustment: null,
    reason_code: null,
    summary: '계획 리드타임 변경 · 공급처 SUP01 · 30 → 45일',
  });

  // 리드타임 변경은 품목이 아니라 공급처에 붙습니다.
  assert.equal(row.itemId, null);
  assert.equal(row.supplierId, 'SUP01');
  assert.equal(row.kind, 'LEADTIME');
  assert.equal(row.decision, null);
});

test('KPI 는 없는 값을 0 으로 센다', () => {
  const kpi = normalizeApprovalKpi({});
  assert.equal(kpi.activeCount, 0);
  assert.equal(kpi.pendingCount, 0);
  assert.equal(kpi.thisMonthCount, 0);

  const filled = normalizeApprovalKpi({ n_active: '3', pending: 5, this_month: '2' });
  assert.equal(filled.activeCount, 3);
  assert.equal(filled.pendingCount, 5);
  assert.equal(filled.thisMonthCount, 2);
});

test('발주 추천 + 승인 한 줄에서 is_pending 은 3상태로 남는다', () => {
  const pending = normalizeRecommendationWithApproval({
    item_id: 'ITEM001',
    final_recommended_qty: 300,
    approval_id: null,
    is_pending: true,
    has_active_approval: false,
  });
  assert.equal(pending.isPending, true);
  assert.equal(pending.hasActiveApproval, false);
  assert.equal(pending.approvalStatus, null);

  // 추천 수량을 산출하지 못하면 발주가 필요한지도 모릅니다 — false 가 아니라 null 입니다.
  const unknown = normalizeRecommendationWithApproval({
    item_id: 'ITEM002',
    final_recommended_qty: null,
    is_pending: null,
  });
  assert.equal(unknown.isPending, null);
  assert.equal(unknown.finalRecommendedQty, null);

  const decided = normalizeRecommendationWithApproval({
    item_id: 'ITEM003',
    approval_id: 9,
    approval_status: 'REJECTED',
    approved_qty: 0,
    has_active_approval: true,
    is_pending: false,
  });
  assert.equal(decided.approvalStatus, 'REJECTED');
  assert.equal(decided.approvedQty, 0);
  assert.equal(decided.hasActiveApproval, true);
});

// ── 근거 Snapshot ─────────────────────────────────────────────

test('Snapshot 의 항목을 펴고, 없는 절은 null 로 둔다', () => {
  const snapshot = normalizeApprovalSnapshot({
    approval_id: 3,
    snapshot: {
      recommendation: { item_id: 'ITEM001', final_recommended_qty: '500', risk: 'CRITICAL' },
      sku_detail: { item_id: 'ITEM001', n_overrides: 2, last_decision: 'APPROVED' },
      projection: [
        { period: '2026-01-01', opening_qty: '100', receipt_qty: 0, demand_qty: '80', closing_qty: '20' },
      ],
      consensus: [{ item_id: 'ITEM001', period: '2026-01-01', consensus_qty: '80' }],
      safety_stock: { item_id: 'ITEM001', safety_stock: '40' },
      leadtime: null,
      champion: { champion_model_id: 'ARIMA', model_name: 'ARIMA', wape: '0.21' },
      run_id: 'RUN-1',
      model_version: 'v3',
      data_snapshot_at: '2026-01-01T00:00:00Z',
      captured_at: '2026-01-02T00:00:00Z',
    },
  });

  assert.equal(snapshot.approvalId, 3);
  assert.equal(snapshot.recommendation?.finalRecommendedQty, 500);
  assert.equal(snapshot.recommendation?.risk, 'CRITICAL');
  assert.equal(snapshot.skuDetail?.overrideCount, 2);
  assert.equal(snapshot.skuDetail?.lastDecision, 'APPROVED');
  assert.equal(snapshot.projection.length, 1);
  assert.equal(snapshot.projection[0].closingQty, 20);
  assert.equal(snapshot.consensus.length, 1);
  assert.equal(snapshot.safetyStock?.safetyStock, 40);
  // 승인 당시 공급처를 몰랐으면 리드타임 절이 통째로 없습니다.
  // 지금 값을 다시 조회해 채우지 않습니다 (renew.prd 31.3).
  assert.equal(snapshot.leadtime, null);
  assert.equal(snapshot.champion?.wape, 0.21);
  assert.equal(snapshot.runId, 'RUN-1');
  assert.equal(snapshot.modelVersion, 'v3');
});

test('Snapshot 이 비어 있어도 화면이 그릴 수 있는 모양으로 돌려준다', () => {
  const empty = normalizeApprovalSnapshot({ approval_id: 1, snapshot: null });

  assert.equal(empty.recommendation, null);
  assert.equal(empty.skuDetail, null);
  assert.equal(empty.safetyStock, null);
  assert.deepEqual(empty.projection, []);
  assert.deepEqual(empty.consensus, []);
  assert.equal(empty.runId, null);
  assert.equal(empty.capturedAt, null);
});

test('배열이어야 할 항목이 배열이 아니면 빈 배열로 둔다', () => {
  const odd = normalizeApprovalSnapshot({
    approval_id: 2,
    snapshot: { projection: null, consensus: '알 수 없음' },
  });
  assert.deepEqual(odd.projection, []);
  assert.deepEqual(odd.consensus, []);
});
