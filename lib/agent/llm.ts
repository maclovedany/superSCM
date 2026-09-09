// STEP 16 ③ LLM 어댑터 — 6회차 슬라이드 48~52 · 71 (프롬프트 3)
//
// 이 파일은 **모델과의 통신만** 합니다. SCM 계산도, DB 조회도 없습니다.
//
// 지키는 것 셋.
//   ① 예외를 던지지 않습니다. 어떤 실패도 { error } 로 돌아옵니다 — LLM 장애가 페이지를
//      터뜨리면 안 됩니다 (슬라이드 49).
//   ② secret 은 서버 실행 시점에만 읽습니다. NEXT_PUBLIC_ 접두어를 붙이지 않습니다.
//   ③ fetch 를 주입할 수 있습니다. 실제 API 비용 없이 실패를 재현하려고 그렇게 둡니다.

import { ANSWER_JSON_SCHEMA } from './schema.ts';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_TIMEOUT_MS = 60_000;

type EnvLike = Record<string, string | undefined>;

export type LlmConfig = {
  configured: boolean;
  baseUrl: string;
  model: string;
  /** 비어 있는 환경변수 이름. 화면이 이것을 그대로 안내합니다 */
  missing: string[];
};

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

export type LlmToolCall = { id: string; name: string; arguments: string };

export type ResponseFormat =
  | { type: 'json_object' }
  | { type: 'json_schema'; json_schema: typeof ANSWER_JSON_SCHEMA };

export const ANSWER_RESPONSE_FORMAT: ResponseFormat = {
  type: 'json_schema',
  json_schema: ANSWER_JSON_SCHEMA,
};

/** json_schema 를 모르는 호환 서버용. 한 번 400 을 맞으면 남은 라운드는 이것을 씁니다 */
export const JSON_OBJECT_RESPONSE_FORMAT: ResponseFormat = { type: 'json_object' };

export type ChatResult = {
  message: { content: string | null };
  toolCalls: LlmToolCall[];
  usage: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null } | null;
  /** json_schema 가 거절되어 json_object 로 내려앉았는가 */
  fellBackToJsonObject: boolean;
  status: number | null;
  error: string | null;
};

/**
 * 환경변수를 읽습니다 — OPENAI_BASE_URL · OPENAI_API_KEY · OPENAI_MODEL.
 *
 * base URL 은 기본값이 있으므로 없어도 됩니다. 키와 모델은 대신 채울 값이 없으므로
 * 하나라도 비면 configured 가 false 이고, 그때 /agent 만 안내를 보입니다.
 */
export function readLlmConfig(env: EnvLike = process.env): LlmConfig {
  const baseUrl = (env.OPENAI_BASE_URL ?? '').trim() || DEFAULT_BASE_URL;
  const apiKey = (env.OPENAI_API_KEY ?? '').trim();
  const model = (env.OPENAI_MODEL ?? '').trim();

  const missing: string[] = [];
  if (apiKey === '') missing.push('OPENAI_API_KEY');
  if (model === '') missing.push('OPENAI_MODEL');

  return { configured: missing.length === 0, baseUrl: baseUrl.replace(/\/+$/, ''), model, missing };
}

/**
 * 기본값 외의 temperature 를 거절하는 모델을 기억합니다 — `baseUrl|model` 이 열쇠입니다.
 *
 * 처음 한 번은 부딪혀 보고 그 뒤로는 보내지 않습니다. 매 라운드 400 을 다시 맞고
 * 재시도하면 호출이 두 배가 됩니다.
 */
const noCustomTemperature = new Set<string>();

/** OpenAI 호환 tools 배열. tools.ts 의 toOpenAiTools() 가 만드는 모양입니다 */
export type LlmToolSpec = {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
};

export type ChatRequest = {
  messages: ChatMessage[];
  tools?: LlmToolSpec[];
  responseFormat?: ResponseFormat;
  temperature?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  env?: EnvLike;
};

function failure(message: string, status: number | null = null): ChatResult {
  return {
    message: { content: null },
    toolCalls: [],
    usage: null,
    fellBackToJsonObject: false,
    status,
    error: message,
  };
}

function readToolCalls(raw: unknown): LlmToolCall[] {
  if (!Array.isArray(raw)) return [];
  const calls: LlmToolCall[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const fn = row.function;
    if (fn === null || typeof fn !== 'object') continue;
    const call = fn as Record<string, unknown>;
    const name = typeof call.name === 'string' ? call.name : '';
    if (name === '') continue;
    calls.push({
      id: typeof row.id === 'string' && row.id !== '' ? row.id : `call_${calls.length}`,
      name,
      arguments: typeof call.arguments === 'string' ? call.arguments : '{}',
    });
  }
  return calls;
}

function readUsage(raw: unknown): ChatResult['usage'] {
  if (raw === null || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const pick = (key: string) => (typeof row[key] === 'number' ? (row[key] as number) : null);
  return {
    promptTokens: pick('prompt_tokens'),
    completionTokens: pick('completion_tokens'),
    totalTokens: pick('total_tokens'),
  };
}

/**
 * `/chat/completions` 한 번.
 *
 * SDK 를 쓰지 않습니다. 1단계 클라우드에서 2단계 사내 서버로 옮기는 일이 **base URL 교체만**
 * 으로 끝나야 하기 때문입니다.
 */
export async function chatCompletion(request: ChatRequest): Promise<ChatResult> {
  const config = readLlmConfig(request.env);
  if (!config.configured) {
    return failure(`AI 가 설정되지 않았습니다. 환경변수 ${config.missing.join(' · ')} 를 채워주세요.`);
  }

  const doFetch = request.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') return failure('이 런타임에는 fetch 가 없습니다.');

  // signal 을 받지 않았으면 여기서 타임아웃을 겁니다 — 무한정 기다리지 않습니다.
  const controller = request.signal ? null : new AbortController();
  const timer = controller
    ? setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    : null;
  const signal = request.signal ?? controller?.signal;

  const apiKey = ((request.env ?? process.env).OPENAI_API_KEY ?? '').trim();
  const modelKey = `${config.baseUrl}|${config.model}`;

  const send = async (format: ResponseFormat | undefined, withTemperature: boolean) => {
    const body: Record<string, unknown> = { model: config.model, messages: request.messages };
    if (withTemperature) body.temperature = request.temperature ?? 0;
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools;
      body.tool_choice = 'auto';
    }
    if (format) body.response_format = format;

    return doFetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
  };

  try {
    let format = request.responseFormat;
    let fellBack = false;
    let withTemperature = !noCustomTemperature.has(modelKey);

    let response = await send(format, withTemperature);
    // 400 이면 본문을 한 번만 읽습니다. text() 는 본문을 소비합니다.
    let detail = response.ok ? '' : await response.text().catch(() => '');

    if (!response.ok && response.status === 400 && format?.type === 'json_schema') {
      // 호환 서버가 Structured Outputs 를 모릅니다. 한 번만 낮춰서 다시 겁니다.
      format = JSON_OBJECT_RESPONSE_FORMAT;
      fellBack = true;
      response = await send(format, withTemperature);
      detail = response.ok ? '' : await response.text().catch(() => '');
    }

    if (!response.ok && response.status === 400 && withTemperature && /temperature/i.test(detail)) {
      noCustomTemperature.add(modelKey);
      withTemperature = false;
      response = await send(format, withTemperature);
      detail = response.ok ? '' : await response.text().catch(() => '');
    }

    if (!response.ok) {
      return failure(
        `AI 응답에 실패했습니다 (HTTP ${response.status}). ${detail.slice(0, 300)}`.trim(),
        response.status,
      );
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const choices = payload.choices;
    const first = Array.isArray(choices) && choices.length > 0 ? choices[0] : null;
    const message =
      first !== null && typeof first === 'object'
        ? ((first as Record<string, unknown>).message as Record<string, unknown> | undefined)
        : undefined;

    return {
      message: { content: typeof message?.content === 'string' ? message.content : null },
      toolCalls: readToolCalls(message?.tool_calls),
      usage: readUsage(payload.usage),
      fellBackToJsonObject: fellBack,
      status: response.status,
      error: null,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return failure('AI 응답이 제한 시간을 넘겼습니다. 질문을 좁혀 다시 물어봐 주세요.');
    }
    return failure(error instanceof Error ? `AI 호출에 실패했습니다: ${error.message}` : 'AI 호출에 실패했습니다.');
  } finally {
    if (timer) clearTimeout(timer);
  }
}
