// Python 예측 서비스 연동 — renew.prd 31.4 · 33.1
//
//   "Python 예측 서버가 중단되어도 이미 저장된 예측 결과는 계속 조회된다."
//
// ★ 이 파일의 함수는 **절대 throw 하지 않습니다.** 서비스가 없어도, 꺼져 있어도,
//   느려도 화면은 그대로 돕니다. 실패는 반환값의 error 로만 알립니다.
//
// 환경변수 (없으면 configured: false)
//   FORECAST_SERVICE_URL     예: https://superscm-forecast.up.railway.app
//   FORECAST_SERVICE_TOKEN   서비스의 SERVICE_TOKEN 과 같은 값

/** 서비스 상태. 화면 칩은 이 세 가지로 나뉩니다 */
export type ServiceState = 'CONFIGURED' | 'UNCONFIGURED' | 'UNREACHABLE';

export const SERVICE_STATE_LABEL: Record<ServiceState, string> = {
  CONFIGURED: '연결됨',
  UNCONFIGURED: '미설정',
  UNREACHABLE: '응답 없음',
};

export const SERVICE_STATE_TONE: Record<ServiceState, 'safe' | 'unknown' | 'crit'> = {
  CONFIGURED: 'safe',
  UNCONFIGURED: 'unknown',
  UNREACHABLE: 'crit',
};

export type ServiceHealth = {
  /** 환경변수가 설정되어 있는가 */
  configured: boolean;
  /** 화면이 그대로 쓰는 상태값 */
  state: ServiceState;
  /** 서비스가 응답했는가 */
  ok: boolean;
  /** 서비스가 DB 에 접속되어 있는가 */
  db: boolean;
  /** 서비스에 등록된 모델 */
  models: string[];
  /** 등록하지 못한 모듈과 사유 (선택 의존성 미설치 등) */
  skipped: Record<string, string>;
  error: string | null;
};

export type ServiceRunResult = {
  ok: boolean;
  runId: string | null;
  status: string | null;
  models: string[];
  message: string | null;
  error: string | null;
};

export type ServiceRunStatus = {
  ok: boolean;
  runId: string;
  status: string | null;
  nModels: number | null;
  nItems: number | null;
  nRows: number | null;
  message: string | null;
  error: string | null;
};

/** 조회는 짧게, 실행 트리거는 조금 더 길게 기다립니다 (실행 자체는 서비스가 백그라운드로 합니다) */
const HEALTH_TIMEOUT_MS = 4_000;
const RUN_TIMEOUT_MS = 15_000;

function baseUrl(): string | null {
  const url = process.env.FORECAST_SERVICE_URL?.trim();
  if (!url) return null;
  return url.replace(/\/+$/, '');
}

function token(): string | null {
  const value = process.env.FORECAST_SERVICE_TOKEN?.trim();
  return value ? value : null;
}

export function isServiceConfigured(): boolean {
  return baseUrl() !== null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function reason(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return '서비스가 응답하지 않습니다';
    return error.message;
  }
  return '서비스 호출에 실패했습니다';
}

/** 실패해도 throw 하지 않는 fetch. { data } 또는 { error } 를 돌려줍니다 */
async function call(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs: number },
): Promise<{ data: Record<string, unknown> | null; error: string | null }> {
  const url = baseUrl();
  if (!url) return { data: null, error: 'FORECAST_SERVICE_URL 이 설정되지 않았습니다' };

  const headers: Record<string, string> = { Accept: 'application/json' };
  const secret = token();
  if (secret) headers.Authorization = `Bearer ${secret}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  try {
    const response = await fetch(`${url}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
      signal: AbortSignal.timeout(init.timeoutMs),
    });

    const text = await response.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const detail = typeof parsed?.detail === 'string' ? parsed.detail : text.slice(0, 200);
      return { data: parsed, error: `${response.status} ${detail || response.statusText}` };
    }
    return { data: parsed, error: null };
  } catch (error) {
    return { data: null, error: reason(error) };
  }
}

const UNCONFIGURED: ServiceHealth = {
  configured: false,
  state: 'UNCONFIGURED',
  ok: false,
  db: false,
  models: [],
  skipped: {},
  error: null,
};

/** GET /health — 인증 없이 뜨는 엔드포인트입니다. DB 가 없어도 200 을 돌려줍니다 */
export async function getServiceHealth(): Promise<ServiceHealth> {
  if (!isServiceConfigured()) return UNCONFIGURED;

  const { data, error } = await call('/health', { timeoutMs: HEALTH_TIMEOUT_MS });
  if (error || !data) {
    return { ...UNCONFIGURED, configured: true, state: 'UNREACHABLE', error: error ?? '응답이 비어 있습니다' };
  }

  return {
    configured: true,
    state: data.ok === true ? 'CONFIGURED' : 'UNREACHABLE',
    ok: data.ok === true,
    db: data.db === true,
    models: Array.isArray(data.models) ? data.models.map(String) : [],
    skipped:
      data.skipped && typeof data.skipped === 'object'
        ? (data.skipped as Record<string, string>)
        : {},
    error: null,
  };
}

/**
 * POST /forecast/run — SQL Baseline 이 만든 run 에 Python 모델을 이어 붙입니다.
 * 서비스는 즉시 RUNNING 을 돌려주고 실제 계산은 백그라운드로 합니다.
 */
export async function runPythonForecast(
  runId: string,
  note?: string | null,
): Promise<ServiceRunResult> {
  if (!isServiceConfigured()) {
    return {
      ok: false,
      runId,
      status: null,
      models: [],
      message: null,
      error: '예측 서비스가 설정되지 않았습니다',
    };
  }

  const { data, error } = await call('/forecast/run', {
    method: 'POST',
    body: { run_id: runId, note: note ?? null },
    timeoutMs: RUN_TIMEOUT_MS,
  });

  if (error || !data) {
    return { ok: false, runId, status: null, models: [], message: null, error: error ?? '응답이 비어 있습니다' };
  }

  return {
    ok: true,
    runId: typeof data.run_id === 'string' ? data.run_id : runId,
    status: typeof data.status === 'string' ? data.status : null,
    models: Array.isArray(data.models) ? data.models.map(String) : [],
    message: typeof data.message === 'string' ? data.message : null,
    error: null,
  };
}

/** GET /forecast/run/{run_id} — 진행 상황 */
export async function getServiceRun(runId: string): Promise<ServiceRunStatus> {
  const empty: ServiceRunStatus = {
    ok: false,
    runId,
    status: null,
    nModels: null,
    nItems: null,
    nRows: null,
    message: null,
    error: null,
  };

  if (!isServiceConfigured()) {
    return { ...empty, error: '예측 서비스가 설정되지 않았습니다' };
  }

  const { data, error } = await call(`/forecast/run/${encodeURIComponent(runId)}`, {
    timeoutMs: HEALTH_TIMEOUT_MS,
  });
  if (error || !data) return { ...empty, error: error ?? '응답이 비어 있습니다' };

  return {
    ok: true,
    runId: typeof data.run_id === 'string' ? data.run_id : runId,
    status: typeof data.status === 'string' ? data.status : null,
    nModels: num(data.n_models),
    nItems: num(data.n_items),
    nRows: num(data.n_rows),
    message: typeof data.message === 'string' ? data.message : null,
    error: null,
  };
}
