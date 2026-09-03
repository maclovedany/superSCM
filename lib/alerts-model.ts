// Alert Center 의 타입과 정규화 — renew.prd 24장
//
// 계산은 SQL 이 끝냈습니다 (core.scan_alerts · analytics.v_alert).
// 여기서는 뷰 한 줄을 화면이 쓰는 모양으로 바꾸기만 합니다 (AGENTS.md 규칙 2).
//
// 조회 함수는 lib/alerts.ts 에 있습니다. 이 파일을 나눈 이유는 두 가지입니다.
//   ① 순수 함수만 모아 두면 Supabase 클라이언트 없이 테스트할 수 있습니다
//      (lib/override-model.ts 와 같은 이유).
//   ② 유형 라벨을 클라이언트 컴포넌트가 import 해도 서버 전용 모듈이
//      클라이언트 번들로 끌려 들어오지 않습니다.
//
// 상대 import 에는 .ts 를 붙입니다. npm test 는 node --test 로 이 파일을 그대로
// 실행하므로 확장자를 보완해 주지 않습니다 (error.md #17).

import type { Tone } from './status.ts';

/**
 * 탐지 유형 13종 — renew.prd 24.1 + 8.6.
 *
 * 코드와 라벨은 core.alert_type_label()(최종 정의는 sql/27-admin-ops.sql §7)과
 * 같아야 합니다. 두 곳이 어긋나면 화면과 API 가 같은 알림을 다르게 부릅니다.
 *
 * ★ 유형을 늘릴 때는 이 배열에 한 줄, SQL 의 case 에 한 줄입니다.
 *
 * ★★ 13번째 BULK_DATA_CHANGE 만 성격이 다릅니다. 앞 12종은
 *    core.scan_alerts() 가 주기적으로 훑어 만드는 **공급망 탐지**이고,
 *    이것은 대량 적재가 확정되는 순간 트리거(core.notify_bulk_change)가 만드는
 *    **시스템 알림**입니다 (renew.prd 8.6 — 별도 통지 채널이 없어 Alert 로 보냅니다).
 */
export const ALERT_TYPES = [
  { code: 'STOCKOUT_RISK', label: '결품 위험' },
  { code: 'ORDER_TOO_LATE', label: '발주 시점 초과' },
  { code: 'EXCESS_INVENTORY', label: '과잉 재고' },
  { code: 'DEMAND_SPIKE', label: '수요 급변' },
  { code: 'FORECAST_OUTLIER', label: '예측 이상' },
  { code: 'OPEN_PO_DELAY', label: '발주 지연' },
  { code: 'LEADTIME_DETERIORATION', label: '리드타임 악화' },
  { code: 'FORECAST_ACCURACY_DROP', label: '예측 정확도 하락' },
  { code: 'EXCESSIVE_OVERRIDE', label: '반복 보정' },
  { code: 'DELIVERY_PROMISE_RISK', label: '납기 약속 위험' },
  { code: 'SOFT_ALLOC_EXPIRING', label: '가예약 만료 임박' },
  { code: 'INQUIRY_SPIKE', label: '문의 급증' },
  // 시스템 알림 — 스캔이 아니라 적재 트리거가 만듭니다 (STEP 20)
  { code: 'BULK_DATA_CHANGE', label: '대량 데이터 변경' },
] as const;

export type AlertType = (typeof ALERT_TYPES)[number]['code'];

/**
 * 유형 코드 → 한국어 라벨.
 *
 * ALERT_TYPES 하나에서 만듭니다. 목록과 사전을 따로 적으면 한쪽만 늘어납니다.
 */
export const ALERT_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  ALERT_TYPES.map((item) => [item.code, item.label]),
);

/**
 * 코드 → 라벨. 모르는 코드는 지어내지 않고 원문을 그대로 돌려줍니다.
 *
 * DB 의 유형이 늘었는데 이 목록을 못 따라온 경우, 영문 코드가 보이는 편이
 * 조용히 빈칸이 되는 것보다 낫습니다 (lib/override-model.ts 의 reasonLabel 과 같은 취지).
 */
export function alertTypeLabel(code: string | null): string | null {
  if (code === null) return null;
  const label = ALERT_TYPE_LABEL[code];
  return label === undefined ? code : label;
}

/** renew.prd 24.2 — core.alert.severity 의 check 제약 3종 */
export type AlertSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export const SEVERITY_TONE: Record<AlertSeverity, Tone> = {
  CRITICAL: 'crit',
  WARNING: 'warn',
  INFO: 'info',
};

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  CRITICAL: '위험',
  WARNING: '주의',
  INFO: '정보',
};

/**
 * 심각도 정규화.
 *
 * DB 의 check 제약이 세 값만 허용하지만, 뷰를 거치는 사이 대소문자나 공백이 섞여도
 * 화면이 색을 잃지 않도록 여기서 한 번 거릅니다. 모르는 값은 INFO 입니다 —
 * 모르는 것을 위험으로 올리면 목록 맨 위가 오염됩니다.
 */
export function toSeverity(value: unknown): AlertSeverity {
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (text === 'CRITICAL' || text === 'WARNING' || text === 'INFO') return text;
  return 'INFO';
}

export function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

/** analytics.v_alert 한 줄 */
export type AlertItem = {
  alertId: number;
  type: string;
  typeLabel: string;
  severity: AlertSeverity;
  itemId: string | null;
  itemName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  reason: string | null;
  impact: string | null;
  recommendedAction: string | null;
  metrics: Record<string, unknown> | null;
  priorityScore: number | null;
  detectedAt: string | null;
  lastSeenAt: string | null;
  isAcknowledged: boolean;
  acknowledgedEmail: string | null;
  acknowledgedAt: string | null;
  ageHours: number | null;
};

/** analytics.v_alert_history 한 줄 — 해결된 것까지 */
export type AlertHistoryItem = AlertItem & {
  resolvedAt: string | null;
  isResolved: boolean;
};

/** analytics.v_alert_kpi 한 줄 */
export type AlertKpi = {
  open: number;
  critical: number;
  warning: number;
  info: number;
  unacknowledged: number;
  lastScanAt: string | null;
};

function metricsOf(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return null;
  if (Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function normalizeAlert(row: Record<string, unknown>): AlertItem {
  const type = String(row.type ?? '');
  // 뷰가 라벨을 함께 내리지만, 라벨이 비어 오면 코드로 다시 만듭니다.
  const label = text(row.type_label);
  return {
    alertId: num(row.alert_id) ?? 0,
    type,
    typeLabel: label === null ? (alertTypeLabel(type) ?? type) : label,
    severity: toSeverity(row.severity),
    itemId: text(row.item_id),
    itemName: text(row.item_name),
    supplierId: text(row.supplier_id),
    supplierName: text(row.supplier_name),
    reason: text(row.reason),
    impact: text(row.impact),
    recommendedAction: text(row.recommended_action),
    metrics: metricsOf(row.metrics),
    priorityScore: num(row.priority_score),
    detectedAt: text(row.detected_at),
    lastSeenAt: text(row.last_seen_at),
    isAcknowledged: row.is_acknowledged === true,
    acknowledgedEmail: text(row.acknowledged_email),
    acknowledgedAt: text(row.acknowledged_at),
    ageHours: num(row.age_hours),
  };
}

export function normalizeAlertHistory(row: Record<string, unknown>): AlertHistoryItem {
  return {
    ...normalizeAlert(row),
    resolvedAt: text(row.resolved_at),
    isResolved: row.is_resolved === true,
  };
}

export function normalizeAlertKpi(row: Record<string, unknown>): AlertKpi {
  return {
    open: num(row.n_open) ?? 0,
    critical: num(row.n_critical) ?? 0,
    warning: num(row.n_warning) ?? 0,
    info: num(row.n_info) ?? 0,
    unacknowledged: num(row.n_unacknowledged) ?? 0,
    lastScanAt: text(row.last_scan_at),
  };
}

/**
 * 경과 시간 문구 — design.md §6.9 의 알림 행 시각 자리.
 *
 * 값이 없으면 숫자를 지어내지 않고 null 입니다. 화면이 시각 자리를 비웁니다.
 */
export function alertAgeText(ageHours: number | null): string | null {
  if (ageHours === null) return null;
  if (ageHours < 1) return '방금';
  if (ageHours < 24) return `${Math.floor(ageHours)}시간 전`;
  return `${Math.floor(ageHours / 24)}일 전`;
}
