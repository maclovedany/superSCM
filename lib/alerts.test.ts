import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALERT_TYPES,
  ALERT_TYPE_LABEL,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  alertAgeText,
  alertTypeLabel,
  normalizeAlert,
  normalizeAlertHistory,
  normalizeAlertKpi,
  toSeverity,
} from './alerts-model.ts';

// Alert Center — renew.prd 24장
//
// 여기서 지키는 것은 세 가지입니다.
//   ① 유형 13종이 core.alert_type_label()(최종 정의 sql/27-admin-ops.sql §7)과 정확히 같다
//   ② 계산 불가와 0 을 섞지 않는다 (AGENTS.md 규칙 5)
//   ③ 모르는 코드를 지어내지 않는다

// core.alert_type_label() 의 case 그대로입니다 (최종 정의는 sql/27-admin-ops.sql §7,
// 최초 정의는 sql/20-alert.sql §3). 이 목록이 어긋나면 화면과 API 가 같은 알림을
// 다르게 부릅니다.
const SQL_ALERT_TYPE_LABEL: [string, string][] = [
  ['STOCKOUT_RISK', '결품 위험'],
  ['ORDER_TOO_LATE', '발주 시점 초과'],
  ['EXCESS_INVENTORY', '과잉 재고'],
  ['DEMAND_SPIKE', '수요 급변'],
  ['FORECAST_OUTLIER', '예측 이상'],
  ['OPEN_PO_DELAY', '발주 지연'],
  ['LEADTIME_DETERIORATION', '리드타임 악화'],
  ['FORECAST_ACCURACY_DROP', '예측 정확도 하락'],
  ['EXCESSIVE_OVERRIDE', '반복 보정'],
  ['DELIVERY_PROMISE_RISK', '납기 약속 위험'],
  ['SOFT_ALLOC_EXPIRING', '가예약 만료 임박'],
  ['INQUIRY_SPIKE', '문의 급증'],
  // STEP 20 · renew.prd 8.6 — 스캔이 아니라 대량 적재 트리거가 만드는 시스템 알림
  ['BULK_DATA_CHANGE', '대량 데이터 변경'],
];

test('탐지 유형은 13종이고 SQL 의 alert_type_label 과 같다', () => {
  assert.equal(ALERT_TYPES.length, 13);
  assert.deepEqual(
    ALERT_TYPES.map((item) => [item.code, item.label]),
    SQL_ALERT_TYPE_LABEL,
  );
});

test('ALERT_TYPE_LABEL 은 13종 전부에 한국어 라벨을 갖는다', () => {
  for (const [code, label] of SQL_ALERT_TYPE_LABEL) {
    assert.equal(ALERT_TYPE_LABEL[code], label, `${code} 의 라벨이 다릅니다`);
  }
  assert.equal(Object.keys(ALERT_TYPE_LABEL).length, 13);
});

test('모르는 유형 코드는 지어내지 않고 원문을 돌려준다', () => {
  // 13번째 유형은 STEP 20 이 목록에 넣었으므로 이제 한국어 라벨이 나옵니다.
  assert.equal(alertTypeLabel('BULK_DATA_CHANGE'), '대량 데이터 변경');
  // 목록에 없는 코드는 지어내지 않고 원문 그대로입니다.
  assert.equal(alertTypeLabel('SUPPLIER_BANKRUPTCY'), 'SUPPLIER_BANKRUPTCY');
  assert.equal(alertTypeLabel('결품 위험'), '결품 위험');
  assert.equal(alertTypeLabel(null), null);
  assert.equal(alertTypeLabel('STOCKOUT_RISK'), '결품 위험');
});

test('심각도 3종의 톤과 라벨이 design.md 상태 토큰과 맞는다', () => {
  assert.deepEqual(SEVERITY_TONE, { CRITICAL: 'crit', WARNING: 'warn', INFO: 'info' });
  assert.deepEqual(SEVERITY_LABEL, { CRITICAL: '위험', WARNING: '주의', INFO: '정보' });
});

test('심각도 정규화 — 모르는 값은 INFO 로 내린다', () => {
  assert.equal(toSeverity('CRITICAL'), 'CRITICAL');
  assert.equal(toSeverity(' warning '), 'WARNING');
  assert.equal(toSeverity('info'), 'INFO');
  // 모르는 값을 위험으로 올리면 목록 맨 위가 오염됩니다.
  assert.equal(toSeverity('URGENT'), 'INFO');
  assert.equal(toSeverity(null), 'INFO');
  assert.equal(toSeverity(undefined), 'INFO');
});

test('알림 한 줄 정규화 — 뷰 컬럼을 화면 모양으로 바꾼다', () => {
  const row = normalizeAlert({
    alert_id: 12,
    type: 'ORDER_TOO_LATE',
    type_label: '발주 시점 초과',
    severity: 'CRITICAL',
    item_id: 'IT001',
    item_name: '베어링',
    supplier_id: 'SUP-1',
    supplier_name: '한국정밀',
    reason: '결품 예상일 2026-01-10',
    impact: '결품이 이미 예정된 상태입니다',
    recommended_action: '특급 운송을 검토하세요',
    metrics: { stockout_days: 3 },
    priority_score: '183.4',
    detected_at: '2026-01-02T00:00:00Z',
    last_seen_at: '2026-01-03T00:00:00Z',
    is_acknowledged: true,
    acknowledged_email: 'a@b.com',
    acknowledged_at: '2026-01-03T01:00:00Z',
    age_hours: '25.5',
  });

  assert.equal(row.alertId, 12);
  assert.equal(row.typeLabel, '발주 시점 초과');
  assert.equal(row.severity, 'CRITICAL');
  assert.equal(row.itemId, 'IT001');
  assert.equal(row.priorityScore, 183.4);
  assert.equal(row.ageHours, 25.5);
  assert.equal(row.isAcknowledged, true);
  assert.deepEqual(row.metrics, { stockout_days: 3 });
});

test('라벨이 비어 오면 코드로 다시 만든다', () => {
  const row = normalizeAlert({ alert_id: 1, type: 'DEMAND_SPIKE', type_label: '  ' });
  assert.equal(row.typeLabel, '수요 급변');
});

test('없는 값은 0 이 아니라 null 이다 (AGENTS.md 규칙 5)', () => {
  const row = normalizeAlert({ alert_id: 3, type: 'STOCKOUT_RISK' });
  assert.equal(row.priorityScore, null);
  assert.equal(row.ageHours, null);
  assert.equal(row.itemId, null);
  assert.equal(row.itemName, null);
  assert.equal(row.reason, null);
  assert.equal(row.metrics, null);
  assert.equal(row.isAcknowledged, false);
  // 숫자로 바꿀 수 없는 값도 0 이 아닙니다.
  assert.equal(normalizeAlert({ alert_id: 4, type: 'X', priority_score: '알 수 없음' }).priorityScore, null);
});

test('이력 한 줄은 해결 여부를 함께 갖는다', () => {
  const open = normalizeAlertHistory({ alert_id: 1, type: 'STOCKOUT_RISK', is_resolved: false });
  assert.equal(open.isResolved, false);
  assert.equal(open.resolvedAt, null);

  const closed = normalizeAlertHistory({
    alert_id: 2,
    type: 'STOCKOUT_RISK',
    is_resolved: true,
    resolved_at: '2026-02-01T00:00:00Z',
  });
  assert.equal(closed.isResolved, true);
  assert.equal(closed.resolvedAt, '2026-02-01T00:00:00Z');
});

test('KPI 는 건수를 0 으로, 시각을 null 로 채운다', () => {
  const empty = normalizeAlertKpi({});
  assert.deepEqual(empty, {
    open: 0,
    critical: 0,
    warning: 0,
    info: 0,
    unacknowledged: 0,
    // 스캔한 적이 없으면 시각은 없습니다. 지금 시각으로 채우지 않습니다.
    lastScanAt: null,
  });

  const filled = normalizeAlertKpi({
    n_open: 7,
    n_critical: 2,
    n_warning: 3,
    n_info: 2,
    n_unacknowledged: 5,
    last_scan_at: '2026-03-01T00:00:00Z',
  });
  assert.equal(filled.open, 7);
  assert.equal(filled.unacknowledged, 5);
  assert.equal(filled.lastScanAt, '2026-03-01T00:00:00Z');
});

test('경과 시간 문구 — 값이 없으면 지어내지 않는다', () => {
  assert.equal(alertAgeText(null), null);
  assert.equal(alertAgeText(0.4), '방금');
  assert.equal(alertAgeText(3.9), '3시간 전');
  assert.equal(alertAgeText(23.9), '23시간 전');
  assert.equal(alertAgeText(24), '1일 전');
  assert.equal(alertAgeText(75), '3일 전');
});
