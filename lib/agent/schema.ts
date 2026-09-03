// AI Agent 최종 응답 스키마 — renew.prd 26.4
//
// LLM 이 자유 문장을 돌려주면 화면이 그것을 파싱해야 하고, 파싱은 매번 다르게 실패합니다.
// 그래서 답변의 모양을 JSON Schema 로 못박고(Structured Outputs), 앱은 그 모양만 믿습니다.
//
// renew.prd 26.4 — "판단 결과 · 근거 · 데이터 기준시각 · Risk · Recommended Action".
// 데이터가 부족하면 추측하지 않습니다. 그때는 cannot_answer 가 true 이고 사유가 붙습니다.
//
// 이 파일은 순수합니다. 상대 import 에는 .ts 를 붙입니다 — npm test 가 node --test 로
// 이 파일을 그대로 실행하기 때문입니다 (error.md #17).

import type { RiskStatus } from '../status.ts';

/** 근거 한 줄. 수치는 반드시 어느 툴이 준 값인지 밝힙니다 */
export type AgentEvidence = {
  label: string;
  value: number | string | null;
  unit?: string | null;
  /** 이 값을 돌려준 툴 이름. Guardrail 과 화면이 함께 씁니다 */
  source_tool: string;
  /** 값이 null 인 이유 (계산 불가 사유) */
  reason?: string | null;
};

/** renew.prd 26.4 의 답변 한 건 */
export type AgentAnswer = {
  answer: string;
  verdict: string | null;
  evidence: AgentEvidence[];
  /** 데이터 기준시각. 툴이 dataAsOf 를 하나도 못 주면 null 입니다 */
  data_as_of: string | null;
  risk: RiskStatus | null;
  recommended_action: string | null;
  cannot_answer: boolean;
  cannot_answer_reason: string | null;
};

/**
 * OpenAI Structured Outputs 용 JSON Schema.
 *
 * strict 모드의 제약이 셋 있습니다.
 *   ① 모든 property 가 required 여야 합니다 — "선택" 은 type 에 null 을 더해 표현합니다
 *   ② additionalProperties 는 false 여야 합니다
 *   ③ 중첩 객체에도 같은 규칙이 적용됩니다
 * 그래서 unit · reason 도 required 이고 null 을 허용합니다.
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
      'data_as_of',
      'risk',
      'recommended_action',
      'cannot_answer',
      'cannot_answer_reason',
    ],
    properties: {
      answer: { type: 'string', description: '한국어 답변 본문. 툴이 돌려준 수치만 인용합니다.' },
      verdict: { type: ['string', 'null'], description: '한 줄 판단 결과.' },
      evidence: {
        type: 'array',
        description: '근거 타일. 답변에 쓴 수치를 하나씩 풀어 적습니다.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'value', 'unit', 'source_tool', 'reason'],
          properties: {
            label: { type: 'string' },
            value: { type: ['number', 'string', 'null'] },
            unit: { type: ['string', 'null'] },
            source_tool: { type: 'string', description: '이 값을 돌려준 툴 이름' },
            reason: { type: ['string', 'null'], description: '값이 null 인 이유' },
          },
        },
      },
      data_as_of: { type: ['string', 'null'], description: '데이터 기준시각' },
      risk: {
        type: ['string', 'null'],
        enum: ['SAFE', 'WARNING', 'CRITICAL', 'CALCULATION_UNAVAILABLE', null],
      },
      recommended_action: { type: ['string', 'null'] },
      cannot_answer: { type: 'boolean' },
      cannot_answer_reason: { type: ['string', 'null'] },
    },
  },
} as const;

/**
 * json_schema 를 지원하지 않는 호환 서버(사내 vLLM · Ollama)용 설명.
 *
 * response_format 이 { type: 'json_object' } 로 내려앉으면 스키마를 강제할 수 없으므로,
 * 같은 내용을 프롬프트로 한 번 더 알려 줍니다.
 */
export const ANSWER_SCHEMA_TEXT = `{
  "answer": "한국어 답변 본문 (필수)",
  "verdict": "한 줄 판단 또는 null",
  "evidence": [{ "label": "항목명", "value": 숫자|문자열|null, "unit": "단위 또는 null",
                 "source_tool": "값을 돌려준 툴 이름", "reason": "값이 null 인 사유 또는 null" }],
  "data_as_of": "데이터 기준시각 또는 null",
  "risk": "SAFE|WARNING|CRITICAL|CALCULATION_UNAVAILABLE 또는 null",
  "recommended_action": "권고 행동 또는 null",
  "cannot_answer": true|false,
  "cannot_answer_reason": "산출할 수 없는 사유 또는 null"
}`;

function asRisk(value: unknown): RiskStatus | null {
  switch (value) {
    case 'SAFE':
    case 'WARNING':
    case 'CRITICAL':
    case 'CALCULATION_UNAVAILABLE':
      return value;
    default:
      return null;
  }
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function asEvidence(value: unknown): AgentEvidence[] {
  if (!Array.isArray(value)) return [];
  const rows: AgentEvidence[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const label = asText(row.label);
    if (label === null) continue;
    const raw = row.value;
    const cell =
      typeof raw === 'number' && Number.isFinite(raw)
        ? raw
        : raw === null || raw === undefined
          ? null
          : String(raw);
    rows.push({
      label,
      value: cell,
      unit: asText(row.unit),
      source_tool: asText(row.source_tool) ?? '',
      reason: asText(row.reason),
    });
  }
  return rows;
}

/**
 * 모델이 돌려준 본문을 AgentAnswer 로 읽습니다.
 *
 * 파싱할 수 없으면 지어내지 않고 null 을 돌려줍니다. 오케스트레이터가 그때
 * "산출할 수 없음" 응답으로 바꿉니다 (renew.prd 26.3).
 *
 * 일부 호환 서버는 JSON 을 ```json 펜스로 감싸 보냅니다. 그 껍데기는 벗겨 줍니다.
 */
export function parseAgentAnswer(raw: string | null): AgentAnswer | null {
  if (raw === null) return null;

  let body = raw.trim();
  if (body.startsWith('```')) {
    body = body.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  }
  if (body === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const row = parsed as Record<string, unknown>;
  const answer = asText(row.answer);
  const cannot = row.cannot_answer === true;

  // 본문도 없고 산출 불가 표시도 없으면 답변이라고 부를 수 없습니다.
  if (answer === null && !cannot) return null;

  return {
    answer: answer ?? '',
    verdict: asText(row.verdict),
    evidence: asEvidence(row.evidence),
    data_as_of: asText(row.data_as_of),
    risk: asRisk(row.risk),
    recommended_action: asText(row.recommended_action),
    cannot_answer: cannot,
    cannot_answer_reason: asText(row.cannot_answer_reason),
  };
}

/**
 * "산출할 수 없음" 응답 — renew.prd 26.3 · design.md §8.2.
 *
 * 숫자를 지어내느니 답을 하지 않습니다. 사유는 반드시 함께 냅니다.
 */
export function cannotAnswer(reason: string, dataAsOf: string | null = null): AgentAnswer {
  return {
    answer: '산출할 수 없습니다.',
    verdict: null,
    evidence: [],
    data_as_of: dataAsOf,
    risk: 'CALCULATION_UNAVAILABLE',
    recommended_action: null,
    cannot_answer: true,
    cannot_answer_reason: reason,
  };
}
