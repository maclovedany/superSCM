// 관리자 운영 모니터링의 타입과 정규화 — renew.prd 30.1 · 31.5 · 8.6
//
// 계산은 SQL 이 끝냈습니다 (sql/27-admin-ops.sql). 여기서는 뷰 한 줄을 화면이 쓰는
// 모양으로 바꾸기만 합니다 (AGENTS.md 규칙 2). 합계도 평균도 내지 않습니다.
//
// 조회 함수는 lib/admin-ops.ts 에 있습니다. 파일을 나눈 이유는 lib/alerts-model.ts 와 같습니다.
//   ① 순수 함수만 모아 두면 Supabase 클라이언트 없이 테스트할 수 있습니다
//   ② 클라이언트 컴포넌트가 타입·라벨을 import 해도 서버 전용 모듈이 번들로 끌려오지 않습니다
//
// 상대 import 에는 .ts 를 붙입니다. npm test 는 node --test 로 이 파일을 그대로
// 실행하므로 확장자를 보완해 주지 않습니다 (error.md #17).

/** 숫자. 못 읽으면 0 이 아니라 null 입니다 — "0" 과 "모른다" 는 다릅니다 */
export function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 정수 전용. 뷰가 count 로 만든 값입니다 */
export function count(value: unknown): number | null {
  const parsed = num(value);
  if (parsed === null) return null;
  return Math.trunc(parsed);
}

/** 빈 문자열은 값이 아닙니다. 공백만 남은 셀을 화면에 흘리지 않습니다 */
export function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

/** 3상태. null 을 false 로 접지 않습니다 */
export function bool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

/** jsonb 컬럼. 객체가 아니면 null 입니다 */
export function record(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** text[] 컬럼. 배열이 아니면 빈 배열입니다 — 화면이 map 을 돌리기 때문입니다 */
export function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter((item) => item !== '');
}

// ══ 실행 모드 ══════════════════════════════════════════════════
//
// core.forecast_run.mode 의 check 제약 2종 (sql/27 §1-2).
//   VALIDATION  train_end 까지 학습 → 검증 구간을 예측합니다. 백테스트가 채점합니다
//   PRODUCTION  production_train_end 까지 학습 → 오늘 이후를 예측합니다. 화면이 씁니다

export type RunMode = 'VALIDATION' | 'PRODUCTION';

export const RUN_MODES = ['VALIDATION', 'PRODUCTION'] as const;

export const RUN_MODE_LABEL: Record<RunMode, string> = {
  VALIDATION: '검증 실행',
  PRODUCTION: '운영 실행',
};

export const RUN_MODE_DESC: Record<RunMode, string> = {
  VALIDATION: '학습 종료일까지만 학습해 검증 구간을 예측합니다. 백테스트가 채점하는 실행입니다.',
  PRODUCTION:
    '운영 학습 종료일까지 학습해 오늘 이후를 예측합니다. 재고 전개 · 발주 추천 · 대시보드가 쓰는 실행입니다.',
};

/**
 * 모드 정규화. 모르는 값은 지어내지 않고 null 입니다.
 *
 * mode 컬럼은 not null 이지만, 뷰를 거치는 사이 사라져도 화면이 '검증' 으로
 * 단정하지 않아야 합니다 — 두 모드는 쓰임이 정반대입니다.
 */
export function toRunMode(value: unknown): RunMode | null {
  const raw = text(value);
  if (raw === null) return null;
  const upper = raw.toUpperCase();
  return (RUN_MODES as readonly string[]).includes(upper) ? (upper as RunMode) : null;
}

export function runModeLabel(value: unknown): string | null {
  const mode = toRunMode(value);
  if (mode !== null) return RUN_MODE_LABEL[mode];
  // 모르는 코드는 원문 그대로. 조용히 빈칸이 되는 것보다 낫습니다.
  return text(value);
}

// ══ 모델 버전 ══════════════════════════════════════════════════

/** analytics.v_model_version 한 줄 — renew.prd 31.2 */
export type ModelVersionRow = {
  id: number | null;
  modelId: string | null;
  modelName: string | null;
  family: string | null;
  engine: string | null;
  version: string | null;
  definition: Record<string, unknown> | null;
  parameters: Record<string, unknown> | null;
  createdAt: string | null;
  /** 이 버전으로 돌린 실행 수. core.forecast_run.models 를 되짚은 값입니다 */
  runCount: number | null;
  lastUsedAt: string | null;
  /** 지금 model_config 에 걸려 있는 버전인가 */
  isCurrent: boolean | null;
  modelEnabled: boolean | null;
};

export function normalizeModelVersion(row: Record<string, unknown>): ModelVersionRow {
  return {
    id: count(row.id),
    modelId: text(row.model_id),
    modelName: text(row.model_name),
    family: text(row.family),
    engine: text(row.engine),
    version: text(row.version),
    definition: record(row.definition),
    parameters: record(row.parameters),
    createdAt: text(row.created_at),
    runCount: count(row.run_count),
    lastUsedAt: text(row.last_used_at),
    isCurrent: bool(row.is_current),
    modelEnabled: bool(row.model_enabled),
  };
}

/**
 * 파라미터 jsonb 를 한 줄로 요약합니다.
 *
 * 표 한 칸에 jsonb 를 통째로 붓지 않습니다. 키가 없으면 지어내지 않고 null 입니다.
 */
export function parameterSummary(value: Record<string, unknown> | null): string | null {
  if (value === null) return null;
  const entries = Object.entries(value);
  if (entries.length === 0) return null;
  return entries
    .map(([key, item]) => `${key}=${item === null ? '—' : String(item)}`)
    .join(' · ');
}

// ══ 실행 상세 ══════════════════════════════════════════════════

/** analytics.v_forecast_run_detail 한 줄 = 실행 하나 × 모델 하나 */
export type ForecastRunDetailRow = {
  runId: string | null;
  mode: RunMode | null;
  status: string | null;
  granularity: string | null;
  trainStart: string | null;
  trainEnd: string | null;
  horizon: number | null;
  championMetric: string | null;
  dataSnapshotAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  triggeredEmail: string | null;
  note: string | null;
  message: string | null;
  /** 실행 수준 값. 모든 줄에 같은 값이 실려 있습니다 */
  runItems: number | null;
  runModels: number | null;
  runRows: number | null;
  runFirstPeriod: string | null;
  runLastPeriod: string | null;
  hasBacktest: boolean | null;
  backtestRunId: string | null;
  hasSimulation: boolean | null;
  simulationId: string | null;
  isStale: boolean | null;
  /** 모델 수준 값. 결과가 한 행도 없는 실패 실행은 여기가 전부 null 입니다 */
  modelId: string | null;
  modelName: string | null;
  family: string | null;
  engine: string | null;
  modelVersion: string | null;
  nItems: number | null;
  nRows: number | null;
  firstPeriod: string | null;
  lastPeriod: string | null;
  /** P80 · P90 을 낼 수 있었던 행 수. 잔차를 못 구하면 예측만 남습니다 */
  nWithInterval: number | null;
};

export function normalizeForecastRunDetail(row: Record<string, unknown>): ForecastRunDetailRow {
  return {
    runId: text(row.run_id),
    mode: toRunMode(row.mode),
    status: text(row.status),
    granularity: text(row.granularity),
    trainStart: text(row.train_start),
    trainEnd: text(row.train_end),
    horizon: count(row.horizon),
    championMetric: text(row.champion_metric),
    dataSnapshotAt: text(row.data_snapshot_at),
    startedAt: text(row.started_at),
    finishedAt: text(row.finished_at),
    durationMs: count(row.duration_ms),
    triggeredEmail: text(row.triggered_email),
    note: text(row.note),
    message: text(row.message),
    runItems: count(row.run_items),
    runModels: count(row.run_models),
    runRows: count(row.run_rows),
    runFirstPeriod: text(row.run_first_period),
    runLastPeriod: text(row.run_last_period),
    hasBacktest: bool(row.has_backtest),
    backtestRunId: text(row.backtest_run_id),
    hasSimulation: bool(row.has_simulation),
    simulationId: text(row.simulation_id),
    isStale: bool(row.is_stale),
    modelId: text(row.model_id),
    modelName: text(row.model_name),
    family: text(row.family),
    engine: text(row.engine),
    modelVersion: text(row.model_version),
    nItems: count(row.n_items),
    nRows: count(row.n_rows),
    firstPeriod: text(row.first_period),
    lastPeriod: text(row.last_period),
    nWithInterval: count(row.n_with_interval),
  };
}

// ══ 통합 로그 ══════════════════════════════════════════════════

export type LogKind = 'AUDIT' | 'API' | 'AGENT';

export const LOG_KINDS = ['AUDIT', 'API', 'AGENT'] as const;

export const LOG_KIND_LABEL: Record<LogKind, string> = {
  AUDIT: '감사 로그',
  API: '외부 API',
  AGENT: 'AI 답변',
};

export function toLogKind(value: unknown): LogKind | null {
  const raw = text(value);
  if (raw === null) return null;
  const upper = raw.toUpperCase();
  return (LOG_KINDS as readonly string[]).includes(upper) ? (upper as LogKind) : null;
}

export function logKindLabel(value: unknown): string | null {
  const kind = toLogKind(value);
  if (kind !== null) return LOG_KIND_LABEL[kind];
  return text(value);
}

/** analytics.v_system_log 한 줄 — renew.prd 31.1 */
export type SystemLogRow = {
  /** 'AUDIT:12' 처럼 갈래와 원본 id 를 붙인 값. 세 표를 합쳤으므로 id 만으로는 겹칩니다 */
  logId: string;
  kind: LogKind | null;
  at: string | null;
  actor: string | null;
  action: string | null;
  target: string | null;
  detail: Record<string, unknown> | null;
};

export function normalizeSystemLog(row: Record<string, unknown>): SystemLogRow {
  return {
    logId: String(row.log_id ?? ''),
    kind: toLogKind(row.kind),
    at: text(row.at),
    actor: text(row.actor),
    action: text(row.action),
    target: text(row.target),
    detail: record(row.detail),
  };
}

/**
 * detail jsonb 를 한 줄로 줄입니다.
 *
 * 표 한 칸에 jsonb 를 통째로 붓지 않습니다. 값이 객체면 키만 보여 주고,
 * 전문은 갈래별 화면(감사 로그 · API 로그 · 대화)에서 봅니다.
 */
export function detailSummary(value: Record<string, unknown> | null, limit = 120): string | null {
  if (value === null) return null;
  const parts: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (item === null || item === undefined) continue;
    if (typeof item === 'object') {
      const keys = Array.isArray(item) ? `${item.length}건` : Object.keys(item).join(', ');
      if (keys === '') continue;
      parts.push(`${key}: ${keys}`);
    } else {
      parts.push(`${key}: ${String(item)}`);
    }
  }
  if (parts.length === 0) return null;
  const joined = parts.join(' · ');
  return joined.length > limit ? `${joined.slice(0, limit)}…` : joined;
}

// ══ stale 요약 ═════════════════════════════════════════════════

/** analytics.v_stale_summary 한 줄 — 항상 한 줄입니다 (renew.prd 8.6) */
export type StaleSummary = {
  forecastRunId: string | null;
  forecastMode: RunMode | null;
  dataSnapshotAt: string | null;
  forecastRunAt: string | null;
  forecastTrainEnd: string | null;
  dataLoadedAt: string | null;
  /** 데이터의 마지막 날. 운영 학습 종료일의 기본값이기도 합니다 */
  dataEnd: string | null;
  settingTrainEnd: string | null;
  productionTrainEnd: string | null;
  lastBatchId: string | null;
  lastBatchDataType: string | null;
  lastBatchRows: number | null;
  lastBatchAt: string | null;
  /** 데이터가 들어온 뒤 아직 다시 돌리지 않았는가 */
  isStale: boolean | null;
  /** 화면이 쓰는 실행이 운영 실행이 아닌가 */
  needsProductionRun: boolean | null;
  affectedScreens: string[];
};

export function normalizeStaleSummary(row: Record<string, unknown>): StaleSummary {
  return {
    forecastRunId: text(row.forecast_run_id),
    forecastMode: toRunMode(row.forecast_mode),
    dataSnapshotAt: text(row.data_snapshot_at),
    forecastRunAt: text(row.forecast_run_at),
    forecastTrainEnd: text(row.forecast_train_end),
    dataLoadedAt: text(row.data_loaded_at),
    dataEnd: text(row.data_end),
    settingTrainEnd: text(row.setting_train_end),
    productionTrainEnd: text(row.production_train_end),
    lastBatchId: text(row.last_batch_id),
    lastBatchDataType: text(row.last_batch_data_type),
    lastBatchRows: count(row.last_batch_rows),
    lastBatchAt: text(row.last_batch_at),
    isStale: bool(row.is_stale),
    needsProductionRun: bool(row.needs_production_run),
    affectedScreens: stringArray(row.affected_screens),
  };
}

/**
 * 배너에 쓸 한 문장. SQL 이 판정한 두 boolean 을 문장으로만 옮깁니다.
 *
 * 두 사유가 겹칠 수 있어 순서를 정해 둡니다 — 재실행이 먼저입니다.
 * 데이터가 바뀐 채로 운영 실행이 없으면, 먼저 할 일은 운영 실행 한 번이기 때문입니다.
 * 배너를 띄울 일이 없으면 null 입니다.
 */
export function staleSentence(summary: StaleSummary | null): string | null {
  if (summary === null) return null;

  if (summary.forecastRunId === null) {
    return '성공한 예측 실행이 아직 없습니다. 아래 숫자는 예측 없이 만든 것이라 비어 보입니다.';
  }
  if (summary.isStale === true && summary.needsProductionRun === true) {
    return '데이터가 들어온 뒤 다시 돌리지 않았고, 화면이 쓰는 예측이 검증 실행입니다. 검증 실행의 예측은 과거 구간이라 오늘 이후를 덮지 못합니다.';
  }
  if (summary.isStale === true) {
    return '기준 데이터가 예측 실행 이후 바뀌었습니다. 아래 숫자는 이전 데이터로 만든 예측을 씁니다.';
  }
  if (summary.needsProductionRun === true) {
    return '화면이 쓰는 예측이 검증 실행입니다. 검증 실행은 과거 구간을 예측하므로 오늘 이후 숫자가 비어 보일 수 있습니다.';
  }
  return null;
}

// ══ 이상치 ═════════════════════════════════════════════════════

/** core.outlier_rule.rule_type — sql/06 의 4종 */
export const OUTLIER_REASONS = ['RETURN', 'PROJECT', 'DUPLICATE', 'MANUAL'] as const;

export type OutlierReason = (typeof OUTLIER_REASONS)[number];

export const OUTLIER_REASON_LABEL: Record<string, string> = {
  RETURN: '반품(음수 출고)',
  PROJECT: '프로젝트성 대량 출고',
  DUPLICATE: '중복 입력',
  MANUAL: '수동 제외',
  RANGE: '범위 밖',
};

export function outlierReasonLabel(code: string | null): string | null {
  if (code === null) return null;
  const label = OUTLIER_REASON_LABEL[code];
  return label === undefined ? code : label;
}

export function isOutlierReason(value: string): value is OutlierReason {
  return (OUTLIER_REASONS as readonly string[]).includes(value);
}

/** analytics.v_outlier_rule 한 줄 — renew.prd 12.3 */
export type OutlierRuleRow = {
  ruleId: number | null;
  ruleType: string | null;
  scope: string | null;
  itemId: string | null;
  itemName: string | null;
  threshold: number | null;
  active: boolean | null;
  note: string | null;
  createdAt: string | null;
  /** 이 유형으로 실제 제외된 행 수. 규칙이 놀고 있는지 보이게 합니다 */
  exclusionCount: number | null;
};

export function normalizeOutlierRule(row: Record<string, unknown>): OutlierRuleRow {
  return {
    ruleId: count(row.rule_id),
    ruleType: text(row.rule_type),
    scope: text(row.scope),
    itemId: text(row.item_id),
    itemName: text(row.item_name),
    threshold: num(row.threshold),
    active: bool(row.active),
    note: text(row.note),
    createdAt: text(row.created_at),
    exclusionCount: count(row.exclusion_count),
  };
}

/** analytics.v_outlier_exclusion 한 줄 — 학습에서 실제로 뺀 행 */
export type OutlierExclusionRow = {
  itemId: string | null;
  itemName: string | null;
  useDate: string | null;
  reasonCode: string | null;
  reasonLabel: string | null;
  note: string | null;
  excludedAt: string | null;
  excludedEmail: string | null;
  /** 그날 그 품목의 원본 수량. 무엇을 뺐는지 눈으로 확인합니다 */
  excludedQty: number | null;
};

export function normalizeOutlierExclusion(row: Record<string, unknown>): OutlierExclusionRow {
  return {
    itemId: text(row.item_id),
    itemName: text(row.item_name),
    useDate: text(row.use_date),
    reasonCode: text(row.reason_code),
    reasonLabel: text(row.reason_label),
    note: text(row.note),
    excludedAt: text(row.excluded_at),
    excludedEmail: text(row.excluded_email),
    excludedQty: num(row.excluded_qty),
  };
}

/** 'YYYY-MM-DD' 인가. Server Action 이 날짜 문자열을 그대로 DB 에 넘기기 전에 봅니다 */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}
