import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOG_KINDS,
  LOG_KIND_LABEL,
  OUTLIER_REASONS,
  RUN_MODES,
  RUN_MODE_LABEL,
  bool,
  count,
  detailSummary,
  isIsoDate,
  isOutlierReason,
  logKindLabel,
  normalizeForecastRunDetail,
  normalizeModelVersion,
  normalizeOutlierExclusion,
  normalizeOutlierRule,
  normalizeStaleSummary,
  normalizeSystemLog,
  num,
  outlierReasonLabel,
  parameterSummary,
  record,
  runModeLabel,
  staleSentence,
  stringArray,
  text,
  toLogKind,
  toRunMode,
} from './admin-ops-model.ts';

// STEP 20 — 관리자 운영 모니터링 (renew.prd 30.1 · 31.1 · 31.5 · 8.6)
//
// 여기서 지키는 것은 넷입니다.
//   ① 계산 불가와 0 을 섞지 않는다 (AGENTS.md 규칙 5)
//   ② 모르는 코드를 지어내지 않는다
//   ③ 실행 모드 2종이 SQL 의 check 제약과 정확히 같다
//   ④ 배너 문장이 SQL 이 판정한 두 boolean 만 옮긴다 — 화면이 다시 판정하지 않는다

// ══ 정규화 ═════════════════════════════════════════════════════

test('num 은 못 읽은 값을 0 이 아니라 null 로 둔다', () => {
  assert.equal(num(0), 0);
  assert.equal(num('12.5'), 12.5);
  assert.equal(num(null), null);
  assert.equal(num(undefined), null);
  assert.equal(num('열두 개'), null);
  assert.equal(num(Number.NaN), null);
});

test('count 는 정수로 자른다', () => {
  assert.equal(count('3'), 3);
  assert.equal(count(3.9), 3);
  assert.equal(count(null), null);
});

test('text 는 공백만 남은 셀을 값으로 보지 않는다', () => {
  assert.equal(text(' ITEM003 '), 'ITEM003');
  assert.equal(text('   '), null);
  assert.equal(text(''), null);
  assert.equal(text(null), null);
});

test('bool 은 3상태를 유지한다 — null 을 false 로 접지 않는다', () => {
  assert.equal(bool(true), true);
  assert.equal(bool('false'), false);
  assert.equal(bool(null), null);
  assert.equal(bool('아마도'), null);
});

test('record 는 배열과 스칼라를 객체로 받지 않는다', () => {
  assert.deepEqual(record({ a: 1 }), { a: 1 });
  assert.equal(record([1, 2]), null);
  assert.equal(record('{}'), null);
  assert.equal(record(null), null);
});

test('stringArray 는 배열이 아니면 빈 배열이다 — 화면이 map 을 돌리기 때문', () => {
  assert.deepEqual(stringArray(['/forecast', '/dashboard']), ['/forecast', '/dashboard']);
  assert.deepEqual(stringArray(null), []);
  assert.deepEqual(stringArray('/forecast'), []);
});

// ══ 실행 모드 ══════════════════════════════════════════════════

test('실행 모드는 2종이고 core.forecast_run.mode 의 check 제약과 같다', () => {
  // sql/27-admin-ops.sql §1-2 의 forecast_run_mode_chk 그대로입니다.
  assert.deepEqual([...RUN_MODES], ['VALIDATION', 'PRODUCTION']);
  assert.equal(RUN_MODE_LABEL.VALIDATION, '검증 실행');
  assert.equal(RUN_MODE_LABEL.PRODUCTION, '운영 실행');
});

test('모드 정규화 — 모르는 값은 검증으로 단정하지 않고 null 이다', () => {
  assert.equal(toRunMode('PRODUCTION'), 'PRODUCTION');
  assert.equal(toRunMode(' production '), 'PRODUCTION');
  assert.equal(toRunMode('VALIDATION'), 'VALIDATION');
  // 두 모드는 쓰임이 정반대입니다. 모르는 값을 한쪽으로 접으면 화면이 거짓말을 합니다.
  assert.equal(toRunMode('BACKTEST'), null);
  assert.equal(toRunMode(null), null);
  // sql/27 을 아직 적용하지 않은 DB 는 mode 컬럼 자체가 없습니다.
  assert.equal(toRunMode(undefined), null);
});

test('모드 라벨 — 모르는 코드는 원문을 그대로 돌려준다', () => {
  assert.equal(runModeLabel('PRODUCTION'), '운영 실행');
  assert.equal(runModeLabel('SANDBOX'), 'SANDBOX');
  assert.equal(runModeLabel(null), null);
});

// ══ 모델 버전 ══════════════════════════════════════════════════

test('모델 버전 한 줄을 화면 모양으로 옮긴다', () => {
  const row = normalizeModelVersion({
    id: 7,
    model_id: 'MA_3M',
    model_name: '3개월 이동평균',
    family: 'BASELINE',
    engine: 'SQL',
    version: 'v1',
    definition: { model_name: '3개월 이동평균', parameters: { window: 3 } },
    parameters: { window: 3 },
    created_at: '2026-09-03T10:00:00+09:00',
    run_count: 3,
    last_used_at: '2026-09-03T16:36:08+09:00',
    is_current: true,
    model_enabled: true,
  });

  assert.equal(row.id, 7);
  assert.equal(row.modelId, 'MA_3M');
  assert.equal(row.runCount, 3);
  assert.equal(row.isCurrent, true);
  assert.deepEqual(row.parameters, { window: 3 });
});

test('버전이 한 번도 안 쓰였으면 run_count 는 0 이고, 못 읽었으면 null 이다', () => {
  assert.equal(normalizeModelVersion({ run_count: 0 }).runCount, 0);
  assert.equal(normalizeModelVersion({}).runCount, null);
});

test('파라미터 요약 — 비어 있으면 빈 문자열이 아니라 null', () => {
  assert.equal(parameterSummary({ window: 3, alpha: 0.2 }), 'window=3 · alpha=0.2');
  assert.equal(parameterSummary({}), null);
  assert.equal(parameterSummary(null), null);
});

// ══ 실행 상세 ══════════════════════════════════════════════════

test('실패한 실행은 모델 컬럼이 비어도 한 줄이 나온다', () => {
  const row = normalizeForecastRunDetail({
    run_id: 'run_20260903163608_549',
    mode: 'PRODUCTION',
    status: 'FAILED',
    run_items: 0,
    run_models: 0,
    run_rows: 0,
    has_backtest: false,
    has_simulation: false,
    is_stale: false,
    message: 'column "wape" of relation "model_performance" does not exist',
    model_id: null,
    n_rows: null,
  });

  assert.equal(row.runId, 'run_20260903163608_549');
  assert.equal(row.mode, 'PRODUCTION');
  assert.equal(row.status, 'FAILED');
  // 실행 수준 값은 0, 모델 수준 값은 null 입니다. 둘은 다른 뜻입니다.
  assert.equal(row.runRows, 0);
  assert.equal(row.modelId, null);
  assert.equal(row.nRows, null);
  assert.equal(row.hasBacktest, false);
});

test('성공한 실행은 실행 수준 값이 모든 줄에 실려 온다', () => {
  const row = normalizeForecastRunDetail({
    run_id: 'run_x',
    mode: 'VALIDATION',
    status: 'SUCCESS',
    run_items: 19,
    run_models: 5,
    run_rows: 1102,
    run_first_period: '2026-02-01',
    run_last_period: '2027-01-01',
    has_backtest: true,
    backtest_run_id: 'bt_x',
    has_simulation: false,
    simulation_id: null,
    is_stale: true,
    model_id: 'MA_3M',
    n_items: 19,
    n_rows: 228,
    n_with_interval: 228,
  });

  assert.equal(row.runItems, 19);
  assert.equal(row.backtestRunId, 'bt_x');
  assert.equal(row.simulationId, null);
  assert.equal(row.isStale, true);
  assert.equal(row.nWithInterval, 228);
});

// ══ 통합 로그 ══════════════════════════════════════════════════

test('로그 갈래는 3종이고 전부 한국어 라벨을 갖는다', () => {
  assert.deepEqual([...LOG_KINDS], ['AUDIT', 'API', 'AGENT']);
  for (const kind of LOG_KINDS) {
    assert.equal(typeof LOG_KIND_LABEL[kind], 'string');
    assert.notEqual(LOG_KIND_LABEL[kind], '');
  }
});

test('모르는 갈래는 지어내지 않는다', () => {
  assert.equal(toLogKind('audit'), 'AUDIT');
  assert.equal(toLogKind('CRON'), null);
  assert.equal(logKindLabel('AGENT'), 'AI 답변');
  assert.equal(logKindLabel('CRON'), 'CRON');
  assert.equal(logKindLabel(null), null);
});

test('로그 한 줄 — log_id 는 갈래와 원본 id 를 붙인 값이라 세 표를 합쳐도 겹치지 않는다', () => {
  const row = normalizeSystemLog({
    kind: 'AUDIT',
    log_id: 'AUDIT:1',
    at: '2026-09-03T16:37:00+09:00',
    actor: 'admin@example.invalid',
    action: 'OUTLIER_RULE_TOGGLE',
    target: 'core.outlier_rule 1',
    detail: { before: { active: true }, after: { active: false } },
  });

  assert.equal(row.logId, 'AUDIT:1');
  assert.equal(row.kind, 'AUDIT');
  assert.deepEqual(row.detail, { before: { active: true }, after: { active: false } });
});

test('detail 요약은 jsonb 를 통째로 붓지 않고 한 줄로 줄인다', () => {
  assert.equal(detailSummary({ status: 200, duration_ms: 12 }), 'status: 200 · duration_ms: 12');
  // 객체는 키만, 배열은 건수만 보여 줍니다. 전문은 갈래별 화면에서 봅니다.
  assert.equal(detailSummary({ before: { active: true } }), 'before: active');
  assert.equal(detailSummary({ tools: ['a', 'b'] }), 'tools: 2건');
  // null 만 든 객체는 보여 줄 것이 없습니다.
  assert.equal(detailSummary({ before: null, after: null }), null);
  assert.equal(detailSummary(null), null);
  assert.equal(detailSummary({ note: 'x'.repeat(200) }, 20)?.endsWith('…'), true);
});

// ══ stale 요약 ═════════════════════════════════════════════════

test('stale 요약 한 줄 — 영향 화면 목록은 SQL 이 준 배열 그대로다', () => {
  const row = normalizeStaleSummary({
    forecast_run_id: 'run_x',
    forecast_mode: 'PRODUCTION',
    data_snapshot_at: '2026-09-03T16:36:21+09:00',
    data_loaded_at: '2026-09-03T16:36:21+09:00',
    data_end: '2026-08-21',
    production_train_end: '2026-08-21',
    last_batch_id: 'batch_1',
    last_batch_rows: 5000,
    is_stale: false,
    needs_production_run: false,
    affected_screens: ['/dashboard', '/forecast'],
  });

  assert.equal(row.forecastMode, 'PRODUCTION');
  assert.equal(row.isStale, false);
  assert.equal(row.lastBatchRows, 5000);
  assert.deepEqual(row.affectedScreens, ['/dashboard', '/forecast']);
});

test('배너 문장 — 최신이면 아무 말도 하지 않는다', () => {
  const fresh = normalizeStaleSummary({
    forecast_run_id: 'run_x',
    forecast_mode: 'PRODUCTION',
    is_stale: false,
    needs_production_run: false,
  });
  assert.equal(staleSentence(fresh), null);
  // 조회에 실패했을 때도 조용합니다. 모르는 것을 경고로 올리지 않습니다.
  assert.equal(staleSentence(null), null);
});

test('배너 문장 — 성공한 실행이 하나도 없으면 그것부터 말한다', () => {
  const none = normalizeStaleSummary({
    forecast_run_id: null,
    is_stale: true,
    needs_production_run: true,
  });
  const sentence = staleSentence(none);
  assert.notEqual(sentence, null);
  assert.match(sentence ?? '', /성공한 예측 실행이 아직 없습니다/);
});

test('배너 문장 — 두 사유가 겹치면 운영 실행을 먼저 말한다', () => {
  const both = normalizeStaleSummary({
    forecast_run_id: 'run_x',
    forecast_mode: 'VALIDATION',
    is_stale: true,
    needs_production_run: true,
  });
  assert.match(staleSentence(both) ?? '', /검증 실행/);

  const onlyStale = normalizeStaleSummary({
    forecast_run_id: 'run_x',
    forecast_mode: 'PRODUCTION',
    is_stale: true,
    needs_production_run: false,
  });
  assert.match(staleSentence(onlyStale) ?? '', /이후 바뀌었습니다/);

  const onlyValidation = normalizeStaleSummary({
    forecast_run_id: 'run_x',
    forecast_mode: 'VALIDATION',
    is_stale: false,
    needs_production_run: true,
  });
  assert.match(staleSentence(onlyValidation) ?? '', /검증 실행/);
});

// ══ 이상치 ═════════════════════════════════════════════════════

test('제외 사유 4종은 core.outlier_exclusion.reason_code 와 같다', () => {
  assert.deepEqual([...OUTLIER_REASONS], ['RETURN', 'PROJECT', 'DUPLICATE', 'MANUAL']);
  for (const code of OUTLIER_REASONS) assert.equal(isOutlierReason(code), true);
  assert.equal(isOutlierReason('RANGE'), false);
});

test('사유 라벨 — 모르는 코드는 원문을 그대로 돌려준다', () => {
  assert.equal(outlierReasonLabel('RETURN'), '반품(음수 출고)');
  assert.equal(outlierReasonLabel('WEIRD'), 'WEIRD');
  assert.equal(outlierReasonLabel(null), null);
});

test('규칙 한 줄 — 놀고 있는 규칙은 0 건, 못 읽었으면 null', () => {
  const active = normalizeOutlierRule({
    rule_id: 1,
    rule_type: 'RETURN',
    scope: 'GLOBAL',
    threshold: 0,
    active: true,
    exclusion_count: 0,
  });
  assert.equal(active.ruleId, 1);
  assert.equal(active.threshold, 0);
  assert.equal(active.exclusionCount, 0);
  assert.equal(normalizeOutlierRule({}).exclusionCount, null);
});

test('제외 행 — 원본 수량이 없으면 0 이 아니라 null 이다', () => {
  const row = normalizeOutlierExclusion({
    item_id: 'ITEM003',
    use_date: '2026-05-11',
    reason_code: 'MANUAL',
    reason_label: '수동 제외',
    excluded_qty: null,
  });
  // "0개를 뺐다" 와 "그날 실적이 없다" 는 다릅니다 (design.md §8).
  assert.equal(row.excludedQty, null);
  assert.equal(row.reasonLabel, '수동 제외');
});

// ══ 날짜 ═══════════════════════════════════════════════════════

test('날짜 검사 — 달력에 없는 날은 통과시키지 않는다', () => {
  assert.equal(isIsoDate('2026-08-21'), true);
  assert.equal(isIsoDate('2026-02-30'), false);
  assert.equal(isIsoDate('2026-13-01'), false);
  assert.equal(isIsoDate('2026-8-21'), false);
  assert.equal(isIsoDate('2026-08-21T00:00:00Z'), false);
  assert.equal(isIsoDate(''), false);
});
