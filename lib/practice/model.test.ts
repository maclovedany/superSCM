import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRACTICE_BANNER_TITLE,
  PRACTICE_OBJECT_KINDS,
  normalizePracticeDataStatus,
  normalizePracticeDataset,
  normalizePracticeObject,
  practiceBannerMessage,
  practiceObjectKindLabel,
  showsPracticeBanner,
  type PracticeDataStatus,
} from './model.ts';

// ★ 이 테스트가 고정하는 것은 "실습 데이터가 있을 때 화면이 반드시 그렇게 말한다"는 규칙이다.
//   실습 데이터는 진짜 적재 경로로 들어와 발주계획 계산까지 통과하므로, 배너가 빠지면 학생도
//   관리자도 그 숫자를 실적으로 읽는다 — 이 프로젝트에서 가장 비싼 실패다.

function status(overrides: Partial<PracticeDataStatus> = {}): PracticeDataStatus {
  return {
    datasetId: '11111111-1111-4111-8111-111111111111',
    label: 'PRACTICE-2026-09',
    active: true,
    hasPracticeData: true,
    nItems: 11,
    nBatches: 3,
    nObjects: 40,
    affectsInventory: true,
    affectsProcurementPlan: true,
    affectsMonthEndKpi: true,
    reasonCode: null,
    ...overrides,
  };
}

test('normalizePracticeDataStatus — count(*)가 문자열로 와도 숫자로 정규화한다', () => {
  // PostgREST는 bigint를 문자열로 돌려줄 수 있다. 그대로 두면 화면에서 "11" + 1 = "111"이 된다.
  const row = {
    dataset_id: 'abc', label: 'PRACTICE-2026-09', active: true, has_practice_data: true,
    n_items: '11', n_batches: '3', n_objects: '40',
    affects_inventory: true, affects_procurement_plan: false, affects_month_end_kpi: true,
    reason_code: null,
  };
  const parsed = normalizePracticeDataStatus(row);
  assert.equal(parsed.nItems, 11);
  assert.equal(parsed.nBatches, 3);
  assert.equal(parsed.nObjects, 40);
  assert.equal(parsed.affectsProcurementPlan, false);
  assert.equal(parsed.reasonCode, null);
});

test('normalizePracticeDataStatus — 실습 데이터가 없으면 NO_PRACTICE_DATA와 null 라벨', () => {
  const parsed = normalizePracticeDataStatus({
    dataset_id: null, label: null, active: null, has_practice_data: false,
    n_items: 0, n_batches: 0, n_objects: 0,
    affects_inventory: false, affects_procurement_plan: false, affects_month_end_kpi: false,
    reason_code: 'NO_PRACTICE_DATA',
  });
  assert.equal(parsed.hasPracticeData, false);
  assert.equal(parsed.label, null);
  assert.equal(parsed.reasonCode, 'NO_PRACTICE_DATA');
});

test('showsPracticeBanner — 화면별로 해당 도메인이 영향받을 때만 띄운다', () => {
  const inventoryOnly = status({ affectsProcurementPlan: false, affectsMonthEndKpi: false });
  assert.equal(showsPracticeBanner(inventoryOnly, 'INVENTORY'), true);
  assert.equal(showsPracticeBanner(inventoryOnly, 'PROCUREMENT_PLAN'), false);
  assert.equal(showsPracticeBanner(inventoryOnly, 'MONTH_END_KPI'), false);
  // 대시보드는 여러 도메인을 한 화면에 모으므로 하나라도 실습이면 띄운다.
  assert.equal(showsPracticeBanner(inventoryOnly, 'DASHBOARD'), true);
});

test('showsPracticeBanner — 실습 데이터가 없으면 어떤 화면에도 띄우지 않는다', () => {
  const none = status({ hasPracticeData: false, affectsInventory: false, affectsProcurementPlan: false, affectsMonthEndKpi: false });
  for (const surface of ['INVENTORY', 'PROCUREMENT_PLAN', 'MONTH_END_KPI', 'DASHBOARD'] as const) {
    assert.equal(showsPracticeBanner(none, surface), false);
  }
});

test('showsPracticeBanner — 조회 실패(null)는 배너를 띄우지 않는다', () => {
  // 실데이터만 있는 화면에 거짓 경고를 붙이지 않는다. 조회 실패 자체는 각 화면이 error로 보여준다.
  assert.equal(showsPracticeBanner(null, 'INVENTORY'), false);
  assert.equal(showsPracticeBanner(null, 'DASHBOARD'), false);
});

test('practiceBannerMessage — 활성 묶음은 라벨과 변경·제거 경로를 함께 말한다', () => {
  const message = practiceBannerMessage(status());
  assert.ok(message.includes('PRACTICE-2026-09'));
  assert.ok(message.includes('실제 실적이 아닙니다'));
});

test('practiceBannerMessage — 제거됐지만 남은 기록은 그 사실을 말한다', () => {
  // 승인된 발주계획은 설계상 삭제할 수 없다. 제거 뒤에도 화면에 남으므로 문구가 달라야 한다.
  const message = practiceBannerMessage(status({ active: false }));
  assert.ok(message.includes('제거되었지만'));
  assert.ok(message.includes('실제 실적으로 읽지 마세요'));
});

test('배너 제목은 사용자가 요구한 문장을 그대로 쓴다', () => {
  assert.equal(PRACTICE_BANNER_TITLE, '이 화면의 숫자는 실습용 데이터 기반입니다');
});

test('practiceObjectKindLabel — 등기 종류는 모두 한국어 라벨이 있다', () => {
  for (const kind of PRACTICE_OBJECT_KINDS) {
    const label = practiceObjectKindLabel(kind);
    assert.notEqual(label, kind, `${kind} 의 한국어 라벨이 없습니다`);
  }
  // 모르는 종류는 코드를 그대로 보여준다(빈 칸으로 만들지 않는다).
  assert.equal(practiceObjectKindLabel('SOMETHING_NEW'), 'SOMETHING_NEW');
});

test('normalizePracticeDataset · normalizePracticeObject — 빈 문자열은 null로 떨어진다', () => {
  const dataset = normalizePracticeDataset({
    dataset_id: 'd1', label: 'PRACTICE-2026-09', note: '', active: false,
    created_at: '2026-09-12T00:00:00Z', removed_at: '2026-09-20T00:00:00Z', n_objects: '7',
  });
  assert.equal(dataset.note, null);
  assert.equal(dataset.active, false);
  assert.equal(dataset.nObjects, 7);

  const object = normalizePracticeObject({
    object_id: 12, dataset_id: 'd1', label: 'PRACTICE-2026-09', active: true,
    object_kind: 'UPLOAD_BATCH', object_key: 'b1', note: null, registered_at: '2026-09-12T00:00:00Z',
  });
  assert.equal(object.objectId, '12');
  assert.equal(object.objectKind, 'UPLOAD_BATCH');
  assert.equal(object.note, null);
});
