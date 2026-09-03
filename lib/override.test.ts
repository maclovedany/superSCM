import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REASON_CODES,
  bool,
  count,
  isOverrideReasonCode,
  normalizeOverrideExcess,
  normalizeOverrideRow,
  normalizeValueAddByReason,
  normalizeValueAddRow,
  normalizeValueAddSummary,
  num,
  reasonLabel,
  requiresReasonText,
} from './override-model.ts';

// Forecast Override — renew.prd 17장
//
// 여기서 지키는 것은 두 가지입니다.
//   ① 사유 코드 목록이 DB 의 check 제약과 정확히 같다 (sql/15 core.forecast_override)
//   ② 계산 불가와 0 을 섞지 않는다 (AGENTS.md 규칙 5)

// core.forecast_override.reason_code 의 check 제약 그대로입니다.
// 이 목록이 어긋나면 화면에서 고른 사유가 DB 에서 거절되거나,
// 저장된 사유가 표에 영문 원문으로 나옵니다.
const DB_CHECK_CONSTRAINT = [
  'NEW_CONTRACT',
  'PROMOTION',
  'NEW_PRODUCT',
  'DISCONTINUED',
  'PROJECT',
  'MARKET_CHANGE',
  'DATA_ERROR',
  'OTHER',
];

test('사유 코드는 8종이고 DB check 제약과 같다', () => {
  assert.equal(REASON_CODES.length, 8);
  assert.deepEqual(
    REASON_CODES.map((item) => item.code),
    DB_CHECK_CONSTRAINT,
  );
});

test('사유 코드에 중복이 없고 라벨이 전부 한국어로 채워져 있다', () => {
  const codes = REASON_CODES.map((item) => item.code);
  assert.equal(new Set(codes).size, codes.length);

  for (const item of REASON_CODES) {
    assert.ok(item.label.trim().length > 0, `${item.code} 라벨이 비어 있습니다`);
    assert.ok(/[가-힣]/.test(item.label), `${item.code} 라벨이 한국어가 아닙니다`);
  }
});

test('라벨은 renew.prd 17.2 의 문구 그대로다', () => {
  assert.equal(reasonLabel('NEW_CONTRACT'), '신규 계약');
  assert.equal(reasonLabel('PROMOTION'), '프로모션');
  assert.equal(reasonLabel('NEW_PRODUCT'), '신제품 출시');
  assert.equal(reasonLabel('DISCONTINUED'), '단종');
  assert.equal(reasonLabel('PROJECT'), '프로젝트성 수요');
  assert.equal(reasonLabel('MARKET_CHANGE'), '시장 변화');
  assert.equal(reasonLabel('DATA_ERROR'), '데이터 오류 보정');
  assert.equal(reasonLabel('OTHER'), '기타');
});

test('모르는 사유 코드는 지어내지 않고 원문을 그대로 보여준다', () => {
  assert.equal(reasonLabel('SUPPLY_ISSUE'), 'SUPPLY_ISSUE');
  assert.equal(reasonLabel(null), null);
  assert.equal(isOverrideReasonCode('SUPPLY_ISSUE'), false);
  assert.equal(isOverrideReasonCode('PROMOTION'), true);
  assert.equal(isOverrideReasonCode(null), false);
});

test('OTHER 만 사유 텍스트가 필수다 — renew.prd 17.2', () => {
  assert.equal(requiresReasonText('OTHER'), true);
  for (const item of REASON_CODES) {
    if (item.code === 'OTHER') continue;
    assert.equal(requiresReasonText(item.code), false, `${item.code} 는 텍스트 필수가 아닙니다`);
  }
  assert.equal(requiresReasonText(null), false);
});

test('num 은 빈 값과 숫자가 아닌 값을 null 로 둔다', () => {
  assert.equal(num(0), 0);
  assert.equal(num('-300'), -300);
  assert.equal(num(''), null);
  assert.equal(num(null), null);
  assert.equal(num(undefined), null);
  assert.equal(num('없음'), null);
});

test('count 는 건수라서 없으면 0 이다 — 수량과 다르다', () => {
  assert.equal(count(null), 0);
  assert.equal(count(undefined), 0);
  assert.equal(count('3'), 3);
});

test('bool 은 모르는 값을 false 로 접지 않는다', () => {
  assert.equal(bool(true), true);
  assert.equal(bool(false), false);
  assert.equal(bool(null), null);
  assert.equal(bool(undefined), null);
});

test('Override 는 증감이라 음수를 그대로 싣는다 — renew.prd 17.1', () => {
  const row = normalizeOverrideRow({
    id: 7,
    item_id: 'ITEM001',
    item_name: '부품 A',
    period: '2026-03-01',
    run_id: 'RUN-20260301',
    model_id: 'ETS',
    ai_forecast: 800,
    override_qty: -300,
    consensus_forecast: 500,
    reason_code: 'DISCONTINUED',
    reason_text: null,
    created_email: 'planner@example.com',
    created_at: '2026-03-02T01:00:00Z',
    superseded_at: null,
    is_active: true,
  });

  assert.equal(row.overrideQty, -300);
  assert.equal(row.consensusForecast, 500);
  assert.equal(row.isActive, true);
  assert.equal(row.reasonText, null);
});

test('대체된 행은 is_active 가 false 다', () => {
  const row = normalizeOverrideRow({
    item_id: 'ITEM001',
    period: '2026-03-01',
    superseded_at: '2026-03-05T01:00:00Z',
    is_active: false,
  });

  assert.equal(row.isActive, false);
  assert.equal(row.supersededAt, '2026-03-05T01:00:00Z');
});

test('is_active 가 없어도 superseded_at 으로 판정한다', () => {
  const active = normalizeOverrideRow({ item_id: 'ITEM001', period: '2026-03-01' });
  assert.equal(active.isActive, true);

  const superseded = normalizeOverrideRow({
    item_id: 'ITEM001',
    period: '2026-03-01',
    superseded_at: '2026-03-05T01:00:00Z',
  });
  assert.equal(superseded.isActive, false);
});

test('AI 예측이 없는 행은 오차를 0 으로 채우지 않는다', () => {
  const row = normalizeValueAddRow({
    item_id: 'ITEM002',
    period: '2026-01-01',
    actual: 1000,
    ai_forecast: null,
    consensus_forecast: null,
    ai_abs_error: null,
    consensus_abs_error: null,
    improved: null,
    reason_code: 'PROMOTION',
  });

  assert.equal(row.aiAbsError, null);
  assert.equal(row.consensusAbsError, null);
  assert.equal(row.improved, null);
});

test('오차가 같은 기간은 개선도 악화도 아니다', () => {
  const row = normalizeValueAddRow({
    item_id: 'ITEM003',
    period: '2026-01-01',
    actual: 900,
    ai_forecast: 800,
    consensus_forecast: 800,
    ai_abs_error: 100,
    consensus_abs_error: 100,
    improved: false,
  });

  assert.equal(row.improved, false);
  assert.equal(row.aiAbsError, row.consensusAbsError);
});

test('실적이 없으면 요약의 WAPE 는 0 이 아니라 null 이다', () => {
  const summary = normalizeValueAddSummary({
    n_periods: 0,
    ai_wape: null,
    consensus_wape: null,
    n_improved: 0,
    n_worsened: 0,
    improvement_pct: null,
  });

  assert.equal(summary.nPeriods, 0);
  assert.equal(summary.aiWape, null);
  assert.equal(summary.consensusWape, null);
  assert.equal(summary.improvementPct, null);
});

test('요약은 SQL 이 낸 개선률을 그대로 싣는다 — 화면이 다시 나누지 않는다', () => {
  const summary = normalizeValueAddSummary({
    n_periods: 12,
    ai_wape: '0.2400',
    consensus_wape: '0.1800',
    n_improved: 9,
    n_worsened: 2,
    improvement_pct: '0.2500',
  });

  assert.equal(summary.aiWape, 0.24);
  assert.equal(summary.consensusWape, 0.18);
  assert.equal(summary.nImproved, 9);
  assert.equal(summary.nWorsened, 2);
  assert.equal(summary.improvementPct, 0.25);
});

test('사유별 집계는 개선률이 음수일 수 있다 — 보정이 오히려 나쁠 때', () => {
  const row = normalizeValueAddByReason({
    reason_code: 'MARKET_CHANGE',
    n: 4,
    ai_wape: '0.1000',
    consensus_wape: '0.1500',
    improvement_pct: '-0.5000',
  });

  assert.equal(row.n, 4);
  assert.equal(row.improvementPct, -0.5);
});

test('보정 반복 품목은 건수가 없으면 0 이다', () => {
  const row = normalizeOverrideExcess({
    item_id: 'ITEM004',
    item_name: '부품 D',
    n_active: 2,
    n_recent_90d: null,
    last_override_at: null,
  });

  assert.equal(row.nActive, 2);
  assert.equal(row.nRecent90d, 0);
  assert.equal(row.lastOverrideAt, null);
});
