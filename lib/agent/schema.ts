// STEP 16 ① 답변 계약 — 6회차 슬라이드 57 · 69 (프롬프트 1)
//
// 자유 문장으로 답하면 화면이 "어디가 판단이고 어디가 근거인지" 를 매번 다시 추측해야 합니다.
// 그래서 답변의 **모양**을 JSON Schema 로 고정합니다. UI · 테스트 · Guardrail 이 같은 필드를 씁니다.
//
// ★ 선택값은 필드를 빼지 않고 null 을 허용합니다. 응답 모양이 항상 같아야 화면이 단순해지고,
//   실패 처리가 예외가 아니라 정상 경로가 됩니다 (슬라이드 09 · 61).
//
// 이 파일에는 LLM 호출도, 계산도, DB 조회도 없습니다.

/** 화면 배지와 1:1 입니다 (lib/status.ts 의 SystemStatus 와 같은 네 가지) */
export type AgentRisk = 'SAFE' | 'WARNING' | 'CRITICAL' | 'CALCULATION_UNAVAILABLE';

export type AgentEvidence = {
  label: string;
  value: string | number | null;
  unit: string | null;
  /** 이 값을 돌려준 툴 이름. 근거 타일에 그대로 나옵니다 */
  source_tool: string | null;
};

export type AgentAnswer = {
  answer: string;
  verdict: string | null;
  evidence: AgentEvidence[];
  risk: AgentRisk;
  recommended_action: string | null;
  /** 데이터 기준시각. 툴이 주지 않았으면 null 입니다 */
  data_as_of: string | null;
  cannot_answer: boolean;
  /** NO_USAGE · NO_LEADTIME · INSUFFICIENT_SAMPLE · UNKNOWN_ITEM 같은 사유 */
  cannot_answer_reason: string | null;
};

const RISKS: AgentRisk[] = ['SAFE', 'WARNING', 'CRITICAL', 'CALCULATION_UNAVAILABLE'];

/**
 * OpenAI Structured Outputs 용 스키마.
 *
 * strict 모드는 properties 에 있는 키가 **전부** required 여야 하고
 * additionalProperties 가 false 여야 합니다. 선택값은 required 에서 빼는 대신
 * 타입에 null 을 넣습니다.
 */
export const ANSWER_JSON_SCHEMA = {
  name: 'scm_agent_answer',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'answer',
      'verdict',
      'evidence',
      'risk',
      'recommended_action',
      'data_as_of',
      'cannot_answer',
      'cannot_answer_reason',
    ],
    properties: {
      answer: { type: 'string' },
      verdict: { type: ['string', 'null'] },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'value', 'unit', 'source_tool'],
          properties: {
            label: { type: 'string' },
            value: { type: ['string', 'number', 'null'] },
            unit: { type: ['string', 'null'] },
            source_tool: { type: ['string', 'null'] },
          },
        },
      },
      risk: { type: 'string', enum: RISKS },
      recommended_action: { type: ['string', 'null'] },
      data_as_of: { type: ['string', 'null'] },
      cannot_answer: { type: 'boolean' },
      cannot_answer_reason: { type: ['string', 'null'] },
    },
  },
} as const;

/** 시스템 프롬프트에 그대로 붙입니다 — json_object 로 내려앉았을 때도 모양을 알려 주어야 합니다 */
export const ANSWER_SCHEMA_TEXT = `{
  "answer": "사용자에게 보여 줄 설명 문장",
  "verdict": "한 줄 판단 또는 null",
  "evidence": [{ "label": "항목명", "value": 숫자|문자열|null, "unit": "단위 또는 null", "source_tool": "값을 준 툴 이름" }],
  "risk": "SAFE | WARNING | CRITICAL | CALCULATION_UNAVAILABLE",
  "recommended_action": "권고 또는 null",
  "data_as_of": "데이터 기준시각 또는 null",
  "cannot_answer": true | false,
  "cannot_answer_reason": "사유 코드 또는 null"
}`;

function asEvidence(value: unknown): AgentEvidence[] {
  if (!Array.isArray(value)) return [];
  const rows: AgentEvidence[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const label = typeof row.label === 'string' ? row.label : '';
    if (label === '') continue;
    const rawValue = row.value;
    rows.push({
      label,
      value:
        typeof rawValue === 'number' || typeof rawValue === 'string' ? rawValue : null,
      unit: typeof row.unit === 'string' ? row.unit : null,
      source_tool: typeof row.source_tool === 'string' ? row.source_tool : null,
    });
  }
  return rows;
}

/**
 * 모델이 보낸 문자열을 답변으로 읽습니다.
 *
 * ★ 예외를 던지지 않습니다. 읽지 못하면 null 이고, 부르는 쪽이 "형식으로 받지 못했다" 로
 *   처리합니다 (슬라이드 24 · 실패 시 동작).
 */
export function parseAgentAnswer(raw: string | null | undefined): AgentAnswer | null {
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  if (text === '') return null;
  // 코드펜스를 붙여 보내는 모델이 있습니다. 한 겹만 벗깁니다.
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const row = parsed as Record<string, unknown>;
  if (typeof row.answer !== 'string') return null;

  const risk = typeof row.risk === 'string' && (RISKS as string[]).includes(row.risk)
    ? (row.risk as AgentRisk)
    : 'CALCULATION_UNAVAILABLE';

  return {
    answer: row.answer,
    verdict: typeof row.verdict === 'string' ? row.verdict : null,
    evidence: asEvidence(row.evidence),
    risk,
    recommended_action: typeof row.recommended_action === 'string' ? row.recommended_action : null,
    data_as_of: typeof row.data_as_of === 'string' ? row.data_as_of : null,
    cannot_answer: row.cannot_answer === true,
    cannot_answer_reason:
      typeof row.cannot_answer_reason === 'string' ? row.cannot_answer_reason : null,
  };
}

/**
 * 산출할 수 없을 때의 답변.
 *
 * ★ 0 이나 평균값으로 채우지 않습니다. null 은 오류를 숨긴 값이 아니라 업무 상태입니다
 *   (슬라이드 61 · AGENTS.md 규칙 5).
 */
export function cannotAnswer(reason: string, dataAsOf: string | null = null): AgentAnswer {
  return {
    answer: '산출할 수 없습니다.',
    verdict: null,
    evidence: [],
    risk: 'CALCULATION_UNAVAILABLE',
    recommended_action: null,
    data_as_of: dataAsOf,
    cannot_answer: true,
    cannot_answer_reason: reason,
  };
}
