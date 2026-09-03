// OpenAI 호환 Chat Completions 래퍼 — renew.prd 33 (AI · Tool Calling · Structured Outputs)
//
// SDK 를 설치하지 않고 fetch 로 직접 부릅니다. 2단계에서 고객사 사내 vLLM · Ollama 로 옮길 때
// base URL 하나만 바꾸면 같은 코드가 그대로 돌게 하려는 것입니다.
//
// ★ 이 파일은 예외를 던지지 않습니다. 네트워크 오류 · 타임아웃 · 4xx 를 전부 { error } 로
//   돌려줍니다. renew.prd 31.4 — LLM 이 죽어도 나머지 화면은 그대로 돌아야 합니다.
//
// fetch 를 주입할 수 있게 열어 둔 이유는 lib/agent/llm.test.ts 가 네트워크 없이
// 응답 파싱을 검사하기 위해서입니다.

import { ANSWER_JSON_SCHEMA } from './schema.ts';

export const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_TIMEOUT_MS = 60_000;

/** 대화 한 줄. tool 역할은 툴 결과를 모델에게 돌려줄 때 씁니다 */
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

export type LlmToolCall = { id: string; name: string; arguments: string };

export type LlmUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

/** 환경변수 판정 결과 */
export type LlmConfig = {
  configured: boolean;
  baseUrl: string;
  model: string;
  /** 비어 있는 환경변수 이름. 화면이 이것을 그대로 안내합니다 */
  missing: string[];
};

export type ChatResult = {
  message: { content: string | null };
  toolCalls: LlmToolCall[];
  usage: LlmUsage | null;
  /** json_schema 가 거절되어 json_object 로 내려앉았는가 */
  fellBackToJsonObject: boolean;
  status: number | null;
  error: string | null;
};

export type ResponseFormat =
  | { type: 'json_schema'; json_schema: typeof ANSWER_JSON_SCHEMA }
  | { type: 'json_object' };

/** 최종 답변용 response_format. 오케스트레이터가 그대로 넘깁니다 */
export const ANSWER_RESPONSE_FORMAT: ResponseFormat = {
  type: 'json_schema',
  json_schema: ANSWER_JSON_SCHEMA,
};

/**
 * json_schema 를 모르는 호환 서버용 형식.
 *
 * 한 번 400 을 맞은 뒤로는 오케스트레이터가 남은 라운드 내내 이것을 씁니다.
 * 매 라운드 400 을 다시 맞고 재시도하면 사내 vLLM 에서 호출이 두 배가 됩니다.
 */
export const JSON_OBJECT_RESPONSE_FORMAT: ResponseFormat = { type: 'json_object' };

type EnvLike = Record<string, string | undefined>;

/**
 * 환경변수를 읽습니다 — OPENAI_BASE_URL · OPENAI_API_KEY · OPENAI_MODEL.
 *
 * base URL 은 기본값(api.openai.com)이 있으므로 없어도 됩니다. 키와 모델은 대신 채울 값이
 * 없으므로 하나라도 비면 configured 가 false 입니다. 그때 /agent 화면은 "AI 가 설정되지
 * 않았습니다" 만 보이고, 나머지 화면은 아무 영향도 받지 않습니다 (renew.prd 31.4).
 */
export function readLlmConfig(env: EnvLike = process.env): LlmConfig {
  const baseUrl = (env.OPENAI_BASE_URL ?? '').trim() || DEFAULT_BASE_URL;
  const apiKey = (env.OPENAI_API_KEY ?? '').trim();
  const model = (env.OPENAI_MODEL ?? '').trim();

  const missing: string[] = [];
  if (apiKey === '') missing.push('OPENAI_API_KEY');
  if (model === '') missing.push('OPENAI_MODEL');

  return {
    configured: missing.length === 0,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model,
    missing,
  };
}

/**
 * `temperature` 를 거절하는 모델을 기억합니다 — `baseUrl|model` 이 열쇠입니다.
 *
 * 일부 모델(예: gpt-5-nano)은 기본값 외의 temperature 를 받지 않고 400 을 냅니다:
 *   Unsupported value: 'temperature' does not support 0 with this model.
 * 처음 한 번은 부딪혀 보고, 그 뒤로는 그 모델에 아예 안 보냅니다. 매번 재시도하면
 * 툴 루프가 최대 6회 도는 동안 호출이 두 배가 됩니다.
 *
 * 모델 이름을 열쇠에 넣었으므로 모델을 바꾸면 다시 판단합니다. 기억이 틀려도
 * 손해는 "결정성을 조금 잃는 것" 뿐입니다 — 답변 속 수치는 Guardrail 이
 * 툴 반환값과 대조하므로 temperature 와 무관하게 지켜집니다 (renew.prd 26.3).
 */
const noCustomTemperature = new Set<string>();

export type ChatRequest = {
  messages: ChatMessage[];
  tools?: { type: 'function'; function: { name: string; description: string; parameters: unknown } }[];
  responseFormat?: ResponseFormat;
  temperature?: number;
  /** 밖에서 만든 타임아웃 · 취소 신호 */
  signal?: AbortSignal;
  /** signal 을 주지 않았을 때만 씁니다 */
  timeoutMs?: number;
  /** 테스트용 주입. 기본은 전역 fetch */
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
    const fn = row.function as Record<string, unknown> | undefined;
    const name = fn?.name;
    if (typeof name !== 'string' || name === '') continue;
    calls.push({
      id: typeof row.id === 'string' && row.id !== '' ? row.id : `call_${calls.length}`,
      name,
      arguments: typeof fn?.arguments === 'string' ? (fn.arguments as string) : '{}',
    });
  }
  return calls;
}

function readUsage(raw: unknown): LlmUsage | null {
  if (raw === null || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const pick = (key: string) => {
    const value = row[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  return {
    promptTokens: pick('prompt_tokens'),
    completionTokens: pick('completion_tokens'),
    totalTokens: pick('total_tokens'),
  };
}

/**
 * 한 번의 호출. 오류를 던지지 않고 { error } 로 돌려줍니다.
 *
 * json_schema 를 지원하지 않는 호환 서버가 400 을 주면 { type: 'json_object' } 로 한 번만
 * 다시 시도합니다. 스키마 설명은 오케스트레이터가 시스템 프롬프트에 이미 넣어 두었습니다.
 */
export async function chatCompletion(request: ChatRequest): Promise<ChatResult> {
  const config = readLlmConfig(request.env);
  if (!config.configured) {
    return failure(`AI 가 설정되지 않았습니다. 환경변수 ${config.missing.join(' · ')} 를 채워주세요.`);
  }

  const doFetch = request.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') return failure('이 런타임에는 fetch 가 없습니다.');

  // signal 을 받지 않았으면 여기서 타임아웃을 겁니다 (renew.prd 31.4 — 무한정 기다리지 않습니다).
  const controller = request.signal ? null : new AbortController();
  const timer = controller
    ? setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    : null;
  const signal = request.signal ?? controller?.signal;

  // 환경변수의 앞뒤 공백을 떼고 씁니다. readLlmConfig 가 이미 다듬은 값으로 configured 를
  // 판정했으므로, 헤더만 원본을 쓰면 공백이 붙은 키가 통과했다가 서버에서 401 이 됩니다.
  const apiKey = ((request.env ?? process.env).OPENAI_API_KEY ?? '').trim();

  const modelKey = `${config.baseUrl}|${config.model}`;

  const send = async (format: ResponseFormat | undefined, withTemperature: boolean) => {
    const body: Record<string, unknown> = {
      model: config.model,
      messages: request.messages,
    };
    // 보내지 않으면 서버 기본값이 쓰입니다. 기본값만 받는 모델을 위해 뺄 수 있어야 합니다.
    if (withTemperature) body.temperature = request.temperature ?? 0;
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools;
      body.tool_choice = 'auto';
    }
    if (format) body.response_format = format;

    return doFetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  };

  try {
    let format = request.responseFormat;
    let fellBack = false;
    let withTemperature = !noCustomTemperature.has(modelKey);

    let response = await send(format, withTemperature);
    // 400 이면 본문을 여기서 한 번만 읽습니다. text() 는 본문을 소비하므로
    // 재시도 판단과 오류 메시지가 같은 값을 나눠 씁니다.
    let detail = response.ok ? '' : await response.text().catch(() => '');

    if (!response.ok && response.status === 400 && format?.type === 'json_schema') {
      // 호환 서버가 Structured Outputs 를 모릅니다. 한 번만 낮춰서 다시 겁니다.
      format = JSON_OBJECT_RESPONSE_FORMAT;
      fellBack = true;
      response = await send(format, withTemperature);
      detail = response.ok ? '' : await response.text().catch(() => '');
    }

    if (
      !response.ok &&
      response.status === 400 &&
      withTemperature &&
      /temperature/i.test(detail)
    ) {
      // 기본값 외의 temperature 를 받지 않는 모델입니다. 빼고 한 번만 다시 겁니다.
      // 다음부터는 이 모델에 아예 보내지 않습니다.
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

    if (!message) return failure('AI 응답을 읽지 못했습니다. 응답에 choices 가 없습니다.');

    return {
      message: { content: typeof message.content === 'string' ? message.content : null },
      toolCalls: readToolCalls(message.tool_calls),
      usage: readUsage(payload.usage),
      fellBackToJsonObject: fellBack,
      status: response.status,
      error: null,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'AbortError' || name === 'TimeoutError') {
      return failure('AI 응답이 제한 시간을 넘겼습니다. 질문을 좁혀 다시 물어봐 주세요.');
    }
    return failure(
      error instanceof Error ? `AI 호출에 실패했습니다: ${error.message}` : 'AI 호출에 실패했습니다.',
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}
