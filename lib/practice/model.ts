// 실습용(practice) 데이터 표식 모델 — Task 15
//
// ★ 판정은 DB가 한다. analytics.v_practice_data_status가 이미 "어떤 화면이 실습 데이터의 영향을
//   받는가"를 계산해 두었고, 이 파일은 그 값을 화면 모델로 옮기고 문구를 고르기만 한다.
//   화면이 스스로 "실습인지" 추론하면 DB와 답이 갈라진다(lib/kpi/model.ts와 같은 원칙).
// ★ 이 배너는 장식이 아니라 안전장치다. 실습 데이터는 진짜 적재 경로로 들어오기 때문에 발주계획
//   계산까지 정상적으로 통과한다 — 화면이 말해 주지 않으면 학생도 관리자도 그 숫자를 실적으로
//   읽는다. 그래서 "숫자가 보이는 화면"에는 반드시 이 배너가 함께 있어야 한다.

export const PRACTICE_SURFACES = ['INVENTORY', 'PROCUREMENT_PLAN', 'MONTH_END_KPI', 'DASHBOARD'] as const;
export type PracticeSurface = (typeof PRACTICE_SURFACES)[number];

export const PRACTICE_OBJECT_KINDS = [
  'ITEM', 'SUPPLY_ENTITY', 'SUPPLIER', 'SUPPLIER_DEPARTURE',
  'BUSINESS_CALENDAR', 'CALENDAR_READINESS',
  'ITEM_POLICY', 'ITEM_POLICY_REVISION',
  'UPLOAD_BATCH', 'FORECAST_SETTING', 'FORECAST_RUN', 'BACKTEST_RUN',
  'PLANNING_CYCLE', 'DEMAND_SUBMISSION', 'PROCUREMENT_PLAN',
] as const;
export type PracticeObjectKind = (typeof PRACTICE_OBJECT_KINDS)[number];

export const PRACTICE_OBJECT_KIND_LABELS: Record<PracticeObjectKind, string> = {
  ITEM: '품목',
  SUPPLY_ENTITY: '해외법인',
  SUPPLIER: '공급처',
  SUPPLIER_DEPARTURE: '출항일 규칙',
  BUSINESS_CALENDAR: '공휴일',
  CALENDAR_READINESS: '달력 준비 상태',
  ITEM_POLICY: '품목 정책',
  ITEM_POLICY_REVISION: '품목 정책 변경안',
  UPLOAD_BATCH: '적재 배치',
  FORECAST_SETTING: 'Forecast 설정',
  FORECAST_RUN: 'Forecast 실행',
  BACKTEST_RUN: 'Backtest 실행',
  PLANNING_CYCLE: '취합 주기',
  DEMAND_SUBMISSION: '수요 제출본',
  PROCUREMENT_PLAN: '발주계획',
};

export function practiceObjectKindLabel(kind: string): string {
  return (PRACTICE_OBJECT_KIND_LABELS as Record<string, string>)[kind] ?? kind;
}

export type PracticeDataStatus = {
  datasetId: string | null;
  label: string | null;
  /** 묶음이 아직 제거되지 않았는가. 제거된 뒤에도 지우지 못한 객체가 남으면 affects_* 는 true다 */
  active: boolean;
  hasPracticeData: boolean;
  nItems: number;
  nBatches: number;
  nObjects: number;
  affectsInventory: boolean;
  affectsProcurementPlan: boolean;
  affectsMonthEndKpi: boolean;
  reasonCode: string | null;
};

export type PracticeDataset = {
  datasetId: string;
  label: string;
  note: string | null;
  active: boolean;
  createdAt: string | null;
  removedAt: string | null;
  nObjects: number;
};

export type PracticeObject = {
  objectId: string;
  label: string;
  active: boolean;
  objectKind: string;
  objectKey: string;
  note: string | null;
  registeredAt: string | null;
};

/**
 * 정리해 보관 중인 5회차 더미 사용 이력 — analytics.v_practice_retired_usage.
 *
 * ★ 사용자가 만들지 않은 기존 데이터를 옮겨 둔 상태다. 관리자 화면이 "몇 행을 언제 옮겼고 언제
 *   돌아오는지"를 분명히 보여 줘야 한다 — 보이지 않으면 사라진 것처럼 읽힌다.
 */
export type PracticeRetiredUsage = {
  label: string;
  active: boolean;
  retiredRows: number;
  minUseDate: string | null;
  maxUseDate: string | null;
  retiredAt: string | null;
};

export function normalizePracticeRetiredUsage(row: Record<string, unknown>): PracticeRetiredUsage {
  return {
    label: String(row.label ?? ''),
    active: row.active === true,
    retiredRows: toNumber(row.retired_rows),
    minUseDate: toText(row.min_use_date),
    maxUseDate: toText(row.max_use_date),
    retiredAt: toText(row.retired_at),
  };
}

function toNumber(value: unknown): number {
  // count(*)는 bigint라 PostgREST가 문자열로 돌려줄 수 있다.
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toText(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : String(value);
}

export function normalizePracticeDataStatus(row: Record<string, unknown>): PracticeDataStatus {
  return {
    datasetId: toText(row.dataset_id),
    label: toText(row.label),
    active: row.active === true,
    hasPracticeData: row.has_practice_data === true,
    nItems: toNumber(row.n_items),
    nBatches: toNumber(row.n_batches),
    nObjects: toNumber(row.n_objects),
    affectsInventory: row.affects_inventory === true,
    affectsProcurementPlan: row.affects_procurement_plan === true,
    affectsMonthEndKpi: row.affects_month_end_kpi === true,
    reasonCode: toText(row.reason_code),
  };
}

export function normalizePracticeDataset(row: Record<string, unknown>): PracticeDataset {
  return {
    datasetId: String(row.dataset_id),
    label: String(row.label ?? ''),
    note: toText(row.note),
    active: row.active === true,
    createdAt: toText(row.created_at),
    removedAt: toText(row.removed_at),
    nObjects: toNumber(row.n_objects),
  };
}

export function normalizePracticeObject(row: Record<string, unknown>): PracticeObject {
  return {
    objectId: String(row.object_id),
    label: String(row.label ?? ''),
    active: row.active === true,
    objectKind: String(row.object_kind ?? ''),
    objectKey: String(row.object_key ?? ''),
    note: toText(row.note),
    registeredAt: toText(row.registered_at),
  };
}

/**
 * 이 화면에 "실습용 데이터 기반" 배너를 띄워야 하는가.
 *
 * ★ 조회에 실패했으면(status === null) 띄우지 않는다. 배너를 못 띄우는 것과 "실습 데이터가 없다"는
 *   다른 사실이지만, 여기서 추측해 띄우면 실데이터만 있는 화면에 거짓 경고가 붙는다. 조회 실패
 *   자체는 각 화면이 이미 error로 따로 보여준다.
 * ★ 대시보드는 여러 도메인 요약을 한 화면에 모으므로 어느 하나라도 실습이면 띄운다.
 */
export function showsPracticeBanner(status: PracticeDataStatus | null, surface: PracticeSurface): boolean {
  if (status === null || !status.hasPracticeData) return false;
  switch (surface) {
    case 'INVENTORY':
      return status.affectsInventory;
    case 'PROCUREMENT_PLAN':
      return status.affectsProcurementPlan;
    case 'MONTH_END_KPI':
      return status.affectsMonthEndKpi;
    case 'DASHBOARD':
      return status.affectsInventory || status.affectsProcurementPlan || status.affectsMonthEndKpi;
  }
}

export const PRACTICE_BANNER_TITLE = '이 화면의 숫자는 실습용 데이터 기반입니다';

/** 배너 본문 — 라벨과 "제거된 뒤 남은 것"인지를 구분해서 말한다 */
export function practiceBannerMessage(status: PracticeDataStatus): string {
  const label = status.label ?? '실습 데이터';
  if (!status.active) {
    return `실습 데이터 묶음 "${label}"은 제거되었지만, 삭제할 수 없는 기록(승인된 발주계획 등)이 남아 이 화면에 계속 반영됩니다. 실제 실적으로 읽지 마세요.`;
  }
  return `실습 데이터 묶음 "${label}"이 적용되어 있습니다. 수업 실습을 위해 넣은 값이며 실제 실적이 아닙니다. 관리자 화면(데이터 관리 · 마스터 · 품목 정책)에서 바꿀 수 있고, 문서화된 한 번의 명령으로 제거합니다.`;
}
