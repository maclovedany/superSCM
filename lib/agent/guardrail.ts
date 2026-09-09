// STEP 16 ⑤ 숫자 Guardrail — 6회차 슬라이드 57~60 · 73 (프롬프트 5)
//
// Structured Output 은 **모양**을 보장합니다. 모양이 맞다는 것과 사실이 맞다는 것은 다릅니다.
// `availableQty` 자리에 700 을 넣어도 타입은 숫자라 Schema 는 통과합니다.
//
// 그래서 답변 속 숫자를 전부 뽑아 **툴이 돌려준 값 사전과 대조**합니다. Guardrail 은
// 모델에게 "조심해" 라고 부탁하는 것이 아니라 코드로 확인하는 절차입니다.
//
// 알려진 한계 — 값만 대조하고 필드의 뜻은 보지 않습니다. `moq 100` 이라는 툴 값이
// "100일 뒤" 라는 문장을 통과시킬 수 있습니다. 막으려면 근거의 출처 툴과 필드 의미까지
// 대조해야 하고, 그것은 아직 하지 않았습니다 (슬라이드 58).

import type { AgentAnswer } from './schema.ts';
import type { ToolResult } from './tools.ts';

export type NumberToken = { text: string; value: number };

export type VerifyResult = {
  ok: boolean;
  /** 툴 결과에 없던 숫자 */
  offending: NumberToken[];
  /** 검사한 숫자 개수 */
  checked: number;
};

/** 허용 오차 — 반올림 표기를 통과시키기 위한 폭입니다 */
const EPSILON = 1e-6;

/**
 * 검사에서 빼는 표현.
 *
 * ★ 품목코드(ITEM012 · 602K02693) · 날짜(2026-09-09) · P80 · 백분위 표기는 업무 수치가
 *   아니라 이름표입니다. 이것을 수치로 뽑으면 정상 답변이 매번 막힙니다 (슬라이드 60).
 */
const SKIP_PATTERNS: RegExp[] = [
  /\b\d{4}-\d{2}-\d{2}\b/g, // 날짜
  /\b\d{4}-\d{2}\b/g, // 연-월
  /\b[A-Za-z]+[-_]?\d+[A-Za-z0-9-]*\b/g, // ITEM012 · MA_3M · 602K02693
  /\bP\d{1,3}\b/gi, // P50 · P80 · P90
];

/** 숫자 하나를 뽑는 정규식 — 쉼표 · 소수 · 음수 · 백분율 */
const NUMBER_PATTERN = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/g;

/** 답변 텍스트에서 검사 대상 숫자를 뽑습니다 */
export function extractNumbers(text: string): NumberToken[] {
  let masked = text;
  for (const pattern of SKIP_PATTERNS) {
    masked = masked.replace(pattern, (matched) => ' '.repeat(matched.length));
  }
  const tokens: NumberToken[] = [];
  const found = masked.match(NUMBER_PATTERN) ?? [];
  for (const raw of found) {
    const value = Number(raw.replace(/,/g, ''));
    if (Number.isFinite(value)) tokens.push({ text: raw, value });
  }
  return tokens;
}

/** 툴들이 돌려준 숫자를 하나의 허용 목록으로 모읍니다 */
export function collectToolNumbers(results: { numbers: Record<string, number | null> }[]): number[] {
  const allowed: number[] = [];
  for (const result of results) {
    for (const value of Object.values(result.numbers)) {
      if (typeof value === 'number' && Number.isFinite(value)) allowed.push(value);
    }
  }
  return allowed;
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

/**
 * 이 숫자가 허용 목록에서 나왔다고 볼 수 있는가.
 *
 * 허용하는 변환은 셋뿐입니다.
 *   ① 같은 값
 *   ② 반올림 — 0.1234 를 0.12 로 적는 것
 *   ③ 비율 → 백분율 — 0.124 를 12.4 로 적는 것 (한 방향만)
 */
export function isDerivable(value: number, allowed: number[]): boolean {
  for (const source of allowed) {
    if (close(value, source)) return true;
    // 반올림: 소수 자리를 줄여 적은 경우
    for (let digits = 0; digits <= 4; digits += 1) {
      if (close(value, Number(source.toFixed(digits)))) return true;
    }
    // 비율 → 백분율. 0~1 사이 값에만 적용합니다 (양방향으로 열면 100 배 오류가 통과합니다)
    if (source >= -1 && source <= 1) {
      const percent = source * 100;
      for (let digits = 0; digits <= 2; digits += 1) {
        if (close(value, Number(percent.toFixed(digits)))) return true;
      }
    }
  }
  return false;
}

/** 답변에서 검사할 문자열만 모읍니다 — 근거의 값도 포함합니다 */
function answerText(answer: AgentAnswer): string {
  const parts = [answer.answer, answer.verdict ?? '', answer.recommended_action ?? ''];
  for (const item of answer.evidence) {
    parts.push(item.label);
    if (typeof item.value === 'number') parts.push(String(item.value));
    else if (typeof item.value === 'string') parts.push(item.value);
  }
  return parts.join('\n');
}

/**
 * 답변을 검사합니다.
 *
 * 질문에 있던 숫자는 통과시킵니다 — "향후 30일" 을 되풀이할 때의 30 은 모델이 지어낸
 * 값이 아닙니다.
 */
export function verifyAnswer(
  answer: AgentAnswer,
  allowed: number[],
  options: { question?: string } = {},
): VerifyResult {
  const fromQuestion = options.question ? extractNumbers(options.question).map((t) => t.value) : [];
  const pool = allowed.concat(fromQuestion);
  const tokens = extractNumbers(answerText(answer));
  const offending = tokens.filter((token) => !isDerivable(token.value, pool));
  return { ok: offending.length === 0, offending, checked: tokens.length };
}

/** 재생성을 요청할 때 모델에게 보낼 문장 */
export function offendingMessage(offending: NumberToken[]): string {
  const list = offending.map((token) => token.text).join(', ');
  return [
    `답변에 툴 결과에 없는 수치가 있습니다: ${list}`,
    '툴이 돌려준 값만 사용해 답을 다시 만드세요.',
    '해당 값을 낼 수 없으면 그 수치를 빼고, cannot_answer 를 true 로 두고 사유를 적으세요.',
    '설명 문장이나 코드펜스 없이 JSON 하나만 출력합니다.',
  ].join('\n');
}

/** 툴 결과 배열에서 허용 목록을 만드는 짧은 도우미 */
export function allowedFrom(results: ToolResult[]): number[] {
  return collectToolNumbers(results);
}
