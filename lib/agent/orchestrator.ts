// 오케스트레이터 — renew.prd 26장
//
//   User → LLM Intent → Tool Calling → Backend Function → Structured Result → LLM Explanation
//
// 여기서 지키는 것 넷.
//   ① 숫자는 툴이 만든다. 모델은 고르고 설명만 한다 (renew.prd 32)
//   ② Role 별 툴 집합을 서버에서 거른다 (renew.prd 26.2 · AGENTS.md 규칙 8)
//   ③ 답변의 모든 수치를 Guardrail 이 다시 센다 (renew.prd 26.3)
//   ④ 무슨 일이 있어도 예외를 밖으로 던지지 않는다 (renew.prd 31.4)
//
// 이 파일은 Supabase 를 부르지 않습니다. 대화 저장은 lib/agent/conversation.ts 한 곳입니다.

import {
  chatCompletion,
  readLlmConfig,
  ANSWER_RESPONSE_FORMAT,
  JSON_OBJECT_RESPONSE_FORMAT,
  type ChatMessage,
  type ResponseFormat,
} from './llm.ts';
import { ANSWER_SCHEMA_TEXT, cannotAnswer, parseAgentAnswer, type AgentAnswer } from './schema.ts';
import { collectToolDates, collectToolNumbers, offendingMessage, verifyAnswer } from './guardrail.ts';
import {
  findTool,
  groupOf,
  toOpenAiTools,
  toolsFor,
  type ToolContext,
  type ToolGroup,
  type ToolResult,
  type ToolRole,
} from './tools.ts';
import { isSalesDepartment, stripToolResult } from './redact.ts';
// 영업 툴 6종을 레지스트리에 얹습니다 (import 부작용). STEP 17.
import './tools-sales.ts';

/** 툴 루프 상한 — 이 횟수를 넘으면 답을 만들지 못한 것으로 봅니다 */
export const MAX_TOOL_ROUNDS = 6;
/** 한 질문에 쓸 수 있는 전체 시간 */
export const RUN_TIMEOUT_MS = 60_000;

export type AgentUser = {
  userId: string;
  email: string;
  role: ToolRole;
  /**
   * core.app_user.department.
   *
   * Role 이 ADMIN · USER 둘뿐이라 영업 구분을 부서로 합니다 (renew.prd 4.1 · 4.5).
   * 없으면 SCM 사용자로 봅니다 — 모르는 사람에게 영업 제한을 걸면 SCM 담당자가
   * 자기 화면과 다른 답을 받습니다.
   */
  department?: string | null;
};

/**
 * 이 사용자에게 보일 툴 묶음 — renew.prd 4.5.
 *
 * ★ 관리자는 부서가 영업이어도 SCM 묶음입니다. 관리자는 renew.prd 4.2 로 모든 USER
 *   기능을 갖습니다. 부서로 관리자 권한을 좁히면 "관리자인데 화면마다 값이 다른" 상태가 됩니다.
 */
export function groupFor(user: AgentUser): ToolGroup {
  if (user.role === 'ADMIN') return 'SCM';
  return isSalesDepartment(user.department) ? 'SALES' : 'SCM';
}

/** 접힌 툴 호출 목록에 그대로 나갑니다 */
export type ToolTraceEntry = {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  ms: number;
  reason: string | null;
};

export type GuardrailTrace = {
  ok: boolean;
  /** 툴 결과에 없던 수치 */
  offending: string[];
  /** 재생성을 요청했는가 */
  regenerated: boolean;
  checked: number;
};

export type RunAgentResult = {
  configured: boolean;
  answer: AgentAnswer | null;
  toolTrace: ToolTraceEntry[];
  guardrail: GuardrailTrace | null;
  usage: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null } | null;
  error: string | null;
};

/**
 * 시스템 프롬프트 — 한국어.
 *
 * 규칙을 문장으로 적어 두는 것만으로는 부족합니다(그래서 Guardrail 이 있습니다). 그래도
 * 여기서 한 번 못박아 두면 재생성까지 가는 횟수가 줄어듭니다.
 */
export function systemPrompt(role: ToolRole, group: ToolGroup = 'SCM'): string {
  if (group === 'SALES') return salesSystemPrompt(role);
  return [
    '당신은 한국후지필름BI 의 SCM 의사결정 플랫폼 SuperSCM 의 분석 조수입니다.',
    '사용자는 구매·공급망 담당자입니다. 한국어로 답합니다.',
    '',
    '## 반드시 지킬 것',
    '1. 숫자를 스스로 계산하지 마세요. 덧셈·평균·비율 계산을 하지 않습니다.',
    '   답변에 쓰는 모든 수치는 툴이 돌려준 값을 그대로 옮긴 것이어야 합니다.',
    '2. 툴이 값을 주지 않았다면 그 수치는 쓰지 마세요. 모르는 값을 0 이나 어림수로 채우지 않습니다.',
    '3. 값이 null 이면 "산출할 수 없음" 이고, 사유 코드를 함께 알려 주세요',
    '   (NO_USAGE_HISTORY · NO_LEADTIME · NO_INVENTORY_DATA · NO_FORECAST · INSUFFICIENT_SAMPLE).',
    '4. 답할 재료가 없으면 추측하지 말고 cannot_answer 를 true 로 두고 사유를 적으세요.',
    '5. 데이터 기준시각(data_as_of)을 반드시 밝히세요. 툴이 준 dataAsOf 를 그대로 씁니다.',
    '6. 툴을 부르지 않고 답하지 마세요. 필요한 툴을 먼저 부르고, 그 결과로만 설명합니다.',
    '',
    '## 답변 구성 (renew.prd 26.4)',
    '판단 결과(verdict) · 근거(evidence) · 데이터 기준시각(data_as_of) · Risk · 권고(recommended_action).',
    'evidence 의 각 항목에는 그 값을 준 툴 이름(source_tool)을 적습니다.',
    'risk 는 SAFE · WARNING · CRITICAL · CALCULATION_UNAVAILABLE 중 하나이며, 툴이 준 판정을 따릅니다.',
    '',
    '## 응답 형식',
    '반드시 아래 모양의 JSON 하나만 출력합니다. 설명 문장이나 코드펜스를 덧붙이지 않습니다.',
    ANSWER_SCHEMA_TEXT,
    '',
    `## 현재 사용자 역할: ${role}`,
    '이 역할이 부를 수 있는 툴만 목록에 있습니다. 목록에 없는 툴을 부르지 마세요.',
  ].join('\n');
}

/**
 * 영업용 시스템 프롬프트 — renew.prd 27.5 의 응답 예시 문체.
 *
 * SCM 프롬프트와 다른 곳은 셋입니다.
 *   ① 즉시 출하 가능 수량과 입고예정 충당분을 나누어 말합니다
 *   ② P80 리드타임의 뜻(다섯 번 중 한 번 지연)과 여유일을 안내합니다
 *   ③ 예약을 만들었으면 반드시 번호와 유효기간을 알립니다
 */
function salesSystemPrompt(role: ToolRole): string {
  return [
    '당신은 한국후지필름BI 의 SCM 의사결정 플랫폼 SuperSCM 의 영업 지원 조수입니다.',
    '사용자는 영업 담당자입니다. 고객에게 납기를 약속하기 전에 묻습니다. 한국어로 답합니다.',
    '',
    '## 반드시 지킬 것',
    '1. 숫자를 스스로 계산하지 마세요. 덧셈·평균·비율 계산을 하지 않습니다.',
    '   답변에 쓰는 모든 수치는 툴이 돌려준 값을 그대로 옮긴 것이어야 합니다.',
    '2. 툴이 값을 주지 않았다면 그 수치는 쓰지 마세요. 모르는 값을 0 이나 어림수로 채우지 않습니다.',
    '3. 답할 재료가 없으면 추측하지 말고 cannot_answer 를 true 로 두고 사유를 적으세요.',
    '4. 데이터 기준시각(data_as_of)을 반드시 밝히세요. 툴이 준 dataAsOf 를 그대로 씁니다.',
    '5. 툴을 부르지 않고 답하지 마세요. 필요한 툴을 먼저 부르고, 그 결과로만 설명합니다.',
    '6. 단가 · 발주 금액 · 공급처 · 리드타임 통계 · 예측 정확도는 답변에 쓰지 않습니다.',
    '   물어보면 "영업 화면에서는 제공하지 않습니다" 라고 답하고 SCM 담당자에게 문의하도록 안내하세요.',
    '',
    '## 답변 문체 (renew.prd 27.5)',
    '- 즉시 출하 가능한 수량과, 입고 예정으로 충당되는 수량을 나누어 말합니다.',
    '  예: "즉시 출하 가능 수량은 180대입니다. 나머지 120대는 입고 예정 물량으로 충당됩니다."',
    '- 납기를 안내할 때는 여유일을 얹은 날짜를 권합니다.',
    '  계획 리드타임은 P80 기준이라 다섯 번 중 한 번은 지연됩니다. 그 사실을 함께 말합니다.',
    '- 전량이 어려우면 "일부 수량" 또는 "납기 조정" 중 무엇이 가능한지 분명히 합니다.',
    '- ★ 가예약(createSoftAllocation)을 만들었으면 예약 번호와 유효기간을 반드시 답변에 넣습니다.',
    '  예약은 실제로 재고를 잡습니다. 만들어 놓고 알리지 않으면 아무도 그것을 해제하지 않습니다.',
    '',
    '## 답변 구성 (renew.prd 26.4)',
    '판단 결과(verdict) · 근거(evidence) · 데이터 기준시각(data_as_of) · Risk · 권고(recommended_action).',
    'evidence 의 각 항목에는 그 값을 준 툴 이름(source_tool)을 적습니다.',
    'risk 는 SAFE · WARNING · CRITICAL · CALCULATION_UNAVAILABLE 중 하나이며, 툴이 준 판정을 따릅니다.',
    'verdict 에는 툴이 준 status 를 그대로 씁니다 (AVAILABLE · CONDITIONALLY_AVAILABLE · UNAVAILABLE · UNKNOWN).',
    '',
    '## 응답 형식',
    '반드시 아래 모양의 JSON 하나만 출력합니다. 설명 문장이나 코드펜스를 덧붙이지 않습니다.',
    ANSWER_SCHEMA_TEXT,
    '',
    `## 현재 사용자 역할: ${role} (영업)`,
    '이 역할이 부를 수 있는 툴만 목록에 있습니다. 목록에 없는 툴을 부르지 마세요.',
  ].join('\n');
}

/** 걸린 수치와 날짜를 한 목록으로. 대화 기록의 guardrail.offending 에 그대로 들어갑니다 */
function offendingTexts(check: {
  offending: { text: string }[];
  offendingDates: { text: string }[];
}): string[] {
  return [
    ...check.offending.map((token) => token.text),
    ...check.offendingDates.map((token) => token.text),
  ];
}

function argsOf(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 모델이 깨진 JSON 을 보냈습니다. 빈 인자로 넘기면 툴이 사유를 돌려줍니다.
  }
  return {};
}

/**
 * 툴 결과를 모델에게 돌려줄 문자열.
 *
 * numbers 와 dates 를 함께 실어 인용해도 되는 값을 분명히 합니다 — Guardrail 이
 * 허용하는 목록과 정확히 같은 목록입니다.
 */
function toolMessage(result: ToolResult): string {
  return JSON.stringify({
    ok: result.ok,
    reason: result.reason ?? null,
    dataAsOf: result.dataAsOf,
    numbers: result.numbers,
    dates: result.dates ?? null,
    data: result.data,
  });
}

/**
 * 한 질문을 처리합니다.
 *
 * 예외를 던지지 않습니다. 설정이 없으면 configured: false 로 조용히 돌아갑니다.
 */
export async function runAgent(input: {
  question: string;
  user: AgentUser;
  /** 같은 대화의 이전 문답. 최근 것부터가 아니라 시간 순서로 넣어 주세요 */
  history?: { role: 'user' | 'assistant'; content: string }[];
  /**
   * 테스트용 주입. 기본은 전역 fetch 입니다.
   *
   * 툴 루프와 Guardrail 재생성은 이 파일에서 가장 틀리기 쉬운 곳인데, 진짜 모델을 불러서는
   * 시험할 수 없습니다. lib/agent/orchestrator.test.ts 가 가짜 모델을 여기로 넣습니다.
   */
  fetchImpl?: typeof fetch;
}): Promise<RunAgentResult> {
  const question = input.question.trim();
  const empty: RunAgentResult = {
    configured: true,
    answer: null,
    toolTrace: [],
    guardrail: null,
    usage: null,
    error: null,
  };

  if (question === '') return { ...empty, error: '질문을 입력해주세요.' };

  const config = readLlmConfig();
  if (!config.configured) {
    return {
      ...empty,
      configured: false,
      error: `AI 가 설정되지 않았습니다. 환경변수 ${config.missing.join(' · ')} 를 채워주세요.`,
    };
  }

  // renew.prd 26.2 · 4.5 — Role 과 부서에 따라 호출 가능한 Tool 집합이 달라집니다.
  // 서버에서 거릅니다. 화면에서 거르지 않습니다 (AGENTS.md 규칙 8).
  const group = groupFor(input.user);
  const available = toolsFor(input.user.role, group);
  const openAiTools = toOpenAiTools(available);
  const context: ToolContext = {
    role: input.user.role,
    userId: input.user.userId,
    email: input.user.email,
    department: input.user.department ?? null,
    question,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(input.user.role, group) },
  ];
  for (const turn of input.history ?? []) {
    messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: 'user', content: question });

  // 호환 서버가 json_schema 를 거절하면 llm.ts 가 한 번 낮춰서 다시 겁니다. 그 사실을 여기서
  // 기억해 두지 않으면 남은 라운드마다 400 을 다시 맞고 재시도합니다 (사내 vLLM 에서 호출 두 배).
  let responseFormat: ResponseFormat = ANSWER_RESPONSE_FORMAT;

  const toolTrace: ToolTraceEntry[] = [];
  const toolNumbers: { name: string; numbers: Record<string, number | null> }[] = [];
  const toolDates: { name: string; dates?: string[] | null }[] = [];
  const dataAsOf: string[] = [];
  /**
   * 날짜 검사를 켜도 되는가 — STEP 17.
   *
   * ★ 성공한 툴이 **전부** dates 를 냈을 때만 켭니다.
   *   하나라도 내지 않으면 그 툴이 준 날짜가 허용 목록에 없어, 정상 답변이 매번
   *   재생성으로 밀립니다. STEP 16 의 SCM 툴 10종은 아직 dates 를 내지 않으므로
   *   SCM 경로의 동작은 그대로이고, 영업 툴 6종은 전부 내므로 영업 경로만 켜집니다.
   *   SCM 툴에 dates 를 채우는 순간 그 경로도 자동으로 켜집니다.
   */
  let dateCheckable = true;
  let anyToolSucceeded = false;
  let usage: RunAgentResult['usage'] = null;

  try {
    let raw: string | null = null;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const result = await chatCompletion({
        messages,
        tools: openAiTools,
        responseFormat,
        signal: controller.signal,
        fetchImpl: input.fetchImpl,
      });
      if (result.usage) usage = result.usage;
      if (result.fellBackToJsonObject) responseFormat = JSON_OBJECT_RESPONSE_FORMAT;
      if (result.error) return { ...empty, toolTrace, error: result.error };

      if (result.toolCalls.length === 0) {
        raw = result.message.content;
        break;
      }

      messages.push({
        role: 'assistant',
        content: result.message.content,
        tool_calls: result.toolCalls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.name, arguments: call.arguments },
        })),
      });

      for (const call of result.toolCalls) {
        const args = argsOf(call.arguments);
        const started = Date.now();
        const tool = findTool(call.name);
        // 목록에 없는 툴이거나, 이 역할·묶음이 부를 수 없는 툴이면 실행하지 않습니다.
        // ★ 묶음까지 봐야 합니다. roles 만 보면 영업 사용자가 이름만 알면
        //   SCM 툴(단가·정확도)을 그대로 부를 수 있습니다 (renew.prd 4.5).
        const permitted =
          tool !== null &&
          tool.enabled &&
          tool.roles.includes(input.user.role) &&
          groupOf(tool) === group;

        // 툴이 돌려주는 모양 그대로입니다. 여기서 다시 적지 않고 ToolResult 를 씁니다 —
        // 두 벌로 두면 dates 처럼 나중에 더한 필드가 조용히 빠집니다.
        let outcome: ToolResult;

        if (!permitted) {
          outcome = {
            ok: false,
            data: null,
            numbers: {},
            dataAsOf: null,
            reason: `호출할 수 없는 툴입니다: ${call.name}`,
          };
        } else {
          try {
            outcome = await tool.run(args, context);
          } catch (error) {
            outcome = {
              ok: false,
              data: null,
              numbers: {},
              dataAsOf: null,
              reason: error instanceof Error ? error.message : '툴 실행에 실패했습니다.',
            };
          }
        }

        // ★ 정보 접근 범위 (renew.prd 4.5) — 모든 툴 결과를 한 번 더 훑습니다.
        //   영업 사용자는 SCM 툴을 부를 수 없지만, 그 판정이 한 줄만 어긋나면 단가가
        //   그대로 답변에 실립니다. data 와 numbers 를 함께 가려야 Guardrail 이
        //   가려진 값을 인용하도록 허가하지 않습니다 (lib/agent/redact.ts).
        outcome = stripToolResult(outcome, input.user);

        toolTrace.push({
          name: call.name,
          args,
          ok: outcome.ok,
          ms: Date.now() - started,
          reason: outcome.reason ?? null,
        });
        toolNumbers.push({ name: call.name, numbers: outcome.numbers });
        toolDates.push({ name: call.name, dates: outcome.dates ?? null });
        if (outcome.ok) {
          anyToolSucceeded = true;
          if (!Array.isArray(outcome.dates)) dateCheckable = false;
        }
        if (outcome.dataAsOf) dataAsOf.push(outcome.dataAsOf);

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: toolMessage(outcome),
        });
      }
    }

    const allowed = collectToolNumbers(toolNumbers);
    // 날짜 검사가 꺼져 있으면 undefined 를 넘깁니다. verifyAnswer 는 dates 가 배열일
    // 때만 날짜를 봅니다 (VerifyOptions.dates 주석).
    const allowedDates =
      anyToolSucceeded && dateCheckable ? collectToolDates(toolDates) : undefined;
    const latestAsOf = dataAsOf.length > 0 ? dataAsOf.slice().sort().at(-1) ?? null : null;

    let answer = parseAgentAnswer(raw);
    if (!answer) {
      return {
        ...empty,
        toolTrace,
        usage,
        answer: cannotAnswer(
          '답변을 정해진 형식으로 받지 못했습니다. 질문을 조금 더 구체적으로 적어 주세요.',
          latestAsOf,
        ),
        guardrail: null,
      };
    }

    // ── Guardrail — renew.prd 26.3 ──────────────────────────
    let check = verifyAnswer(answer, allowed, { question, dates: allowedDates });
    let regenerated = false;

    if (!check.ok) {
      regenerated = true;
      messages.push({ role: 'assistant', content: raw });
      messages.push({
        role: 'user',
        content: offendingMessage(check.offending, check.offendingDates),
      });

      const retry = await chatCompletion({
        messages,
        responseFormat,
        signal: controller.signal,
        fetchImpl: input.fetchImpl,
      });
      if (retry.usage) usage = retry.usage;
      if (retry.fellBackToJsonObject) responseFormat = JSON_OBJECT_RESPONSE_FORMAT;

      const second = retry.error ? null : parseAgentAnswer(retry.message.content);
      if (second) {
        const recheck = verifyAnswer(second, allowed, { question, dates: allowedDates });
        if (recheck.ok) {
          answer = second;
          check = recheck;
        } else {
          // 두 번 다 실패했습니다. 숫자를 지어낸 답변을 사람에게 보이지 않습니다.
          return {
            ...empty,
            toolTrace,
            usage,
            answer: cannotAnswer(
              `툴 결과에 없는 수치가 답변에 남아 산출할 수 없습니다: ${offendingTexts(recheck).join(
                ', ',
              )}`,
              latestAsOf,
            ),
            guardrail: {
              ok: false,
              offending: offendingTexts(recheck),
              regenerated: true,
              checked: recheck.checked + recheck.checkedDates,
            },
          };
        }
      } else {
        return {
          ...empty,
          toolTrace,
          usage,
          answer: cannotAnswer('답변을 다시 만들지 못했습니다.', latestAsOf),
          guardrail: {
            ok: false,
            offending: offendingTexts(check),
            regenerated: true,
            checked: check.checked + check.checkedDates,
          },
        };
      }
    }

    // 기준시각을 모델이 비워 두면 툴이 준 값으로 채웁니다. 이것은 수치가 아니라 시각입니다.
    if (!answer.data_as_of && latestAsOf) answer = { ...answer, data_as_of: latestAsOf };

    return {
      configured: true,
      answer,
      toolTrace,
      usage,
      guardrail: {
        ok: check.ok,
        offending: offendingTexts(check),
        regenerated,
        checked: check.checked + check.checkedDates,
      },
      error: null,
    };
  } catch (error) {
    return {
      ...empty,
      toolTrace,
      usage,
      error: error instanceof Error ? `질문을 처리하지 못했습니다: ${error.message}` : '질문을 처리하지 못했습니다.',
    };
  } finally {
    clearTimeout(timer);
  }
}
