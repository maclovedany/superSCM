// Guardrail — renew.prd 26.3 후처리 검증 ★
//
// LLM 은 숫자를 계산하지 않습니다. 툴이 돌려준 값만 인용합니다.
// 그 약속을 프롬프트로만 걸어 두면 반드시 깨집니다 — 모델은 "대략 700대" 같은 문장을
// 자연스럽게 만들어 냅니다. 그래서 답변을 사람에게 보이기 전에 기계로 한 번 더 셉니다.
//
//   ① extractNumbers  답변 문장에서 수치를 뽑는다
//   ①' extractDates   날짜를 따로 뽑는다 (STEP 17 — 아래 ★ 참조)
//   ② verifyAnswer    뽑은 수치가 전부 툴 결과 안에 있는지 본다
//   ③ 하나라도 없으면 오케스트레이터가 1회 재생성을 요청하고,
//      그래도 남으면 답변을 버리고 "산출할 수 없음" 을 냅니다 (design.md §8.2)
//
// ★ 알려진 한계 — 값만 대조하며 필드 단위는 확인하지 않습니다.
//   renew.prd 26.3 은 "Tool 반환값에 없는 수치는 응답에 포함 금지" 를 말합니다. 그래서 이 검사는
//   "이 숫자가 툴 numbers 의 값 중에 있는가" 만 봅니다. 평평한 사전에는 단위가 없으므로,
//   MOQ 100 이 있으면 "100일 뒤 결품" 도, 안전재고 400 이 있으면 "단가는 400원" 도 통과합니다.
//   즉 이 Guardrail 은 **지어낸 숫자**를 막고, **잘못 붙인 숫자**는 막지 못합니다.
//   막으려면 툴 결과에 단위와 필드 뜻을 함께 실어 evidence.source_tool 과 대조해야 합니다.
//
// ★ 날짜 (STEP 17 에서 더함)
//   수치 추출은 날짜를 일부러 가립니다(MASKED_PATTERNS). 그래서 날짜는 오랫동안
//   **아무 검사도 받지 않았습니다.** 영업 답변은 거의 전부가 날짜라 그 구멍이 큽니다 —
//   가예약 만료일 · 가장 이른 안전 납기 · 신규 공급 가능일.
//   이제 툴이 `dates` 를 함께 내고, verifyAnswer 에 `options.dates` 를 주면 답변의
//   날짜 토큰을 그 목록과 대조합니다. **주지 않으면 검사하지 않습니다** — STEP 16 이
//   만든 호출부의 동작을 바꾸지 않기 위해서입니다.
//
// 이 파일은 순수 함수만 둡니다. Supabase 도 fetch 도 부르지 않습니다 —
// lib/agent/guardrail.test.ts 가 그대로 실행합니다.
// 상대 import 에 .ts 를 붙이는 이유는 error.md #17 입니다.

import type { AgentAnswer } from './schema.ts';

/** 답변에서 뽑아낸 수치 하나 */
export type NumberToken = {
  /** 원문 그대로 (쉼표 · % 포함) */
  text: string;
  /** 쉼표를 뺀 값. `12.5%` 는 12.5 입니다 */
  value: number;
  /** 문장 안 위치 */
  index: number;
  /** `%` 가 붙어 있었는가 */
  isPercent: boolean;
  /** 소수점 아래 자릿수 — 허용 오차를 여기서 정합니다 */
  decimals: number;
};

/** 답변에서 뽑아낸 날짜 하나 */
export type DateToken = {
  /** 원문 그대로 (`2026-10-10` · `10월 15일`) */
  text: string;
  /** 연·월·일이 다 있으면 `YYYY-MM-DD`, 아니면 null */
  iso: string | null;
  /** 연도가 없을 때의 `MM-DD`. 연도가 있으면 null */
  monthDay: string | null;
  index: number;
};

export type Verification = {
  ok: boolean;
  /** 툴 결과에 없는 수치 */
  offending: NumberToken[];
  /** 툴 결과에 없는 날짜. dates 를 주지 않으면 항상 빈 배열입니다 */
  offendingDates: DateToken[];
  /** 검사한 수치 개수 */
  checked: number;
  /** 검사한 날짜 개수 */
  checkedDates: number;
};

/**
 * 수치로 세지 않는 구간.
 *
 * 여기 걸리는 문자열은 통째로 가려서(같은 길이의 `·` 로 바꿔) 다음 단계가 보지 못하게 합니다.
 * 길이를 유지하는 이유는 원문에서의 위치를 그대로 쓰기 위해서입니다.
 *
 * 무엇을 가리는가
 *   ① 품목코드 · 모델코드 — `ITEM012` · `MDL-X700` · `B-4092` · `P80` · `v1`
 *      "글자에 붙어 있는 숫자는 식별자다" 가 규칙입니다 (design.md §2 ⑤).
 *   ② 날짜와 기간 — `2026-09` · `2026-09-30` · `2026년 9월` · `10월 15일`
 *   ③ 시각 — `14:30`
 *   ④ 목록 번호 — 줄 앞의 `1.` · `2)`
 *
 * `42일` · `3개월` 은 가리지 않습니다. 리드타임과 재고 여유 개월은 툴이 돌려주는 수치이고,
 * 그것을 검사하는 것이 이 파일의 목적이기 때문입니다.
 */
const MASKED_PATTERNS: RegExp[] = [
  // 날짜 · 기간 (먼저 가립니다. 아래 식별자 규칙보다 앞서야 2026-09 가 통째로 가려집니다)
  /\d{4}-\d{1,2}(?:-\d{1,2})?/g,
  /\d{4}년(?:\s*\d{1,2}월)?(?:\s*\d{1,2}일)?/g,
  /\d{1,2}월(?:\s*\d{1,2}일)?/g,
  /\d{1,2}:\d{2}(?::\d{2})?/g,
  /\d+분기/g,
  // 식별자 — 글자로 시작해 숫자를 품은 토큰
  /[A-Za-z][A-Za-z0-9_-]*\d[A-Za-z0-9_-]*/g,
  // 목록 번호
  /^[ \t]*\d+[.)](?=\s)/gm,
];

/** 숫자 후보 — 부호 · 천단위 쉼표 · 소수 · 백분율 */
const NUMBER_PATTERN = /[-−]?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:\s*%)?|[-−]?\d+(?:\.\d+)?(?:\s*%)?/g;

function maskExcluded(text: string): string {
  let masked = text;
  for (const pattern of MASKED_PATTERNS) {
    masked = masked.replace(new RegExp(pattern.source, pattern.flags), (hit) => '·'.repeat(hit.length));
  }
  return masked;
}

/** 숫자 바로 앞뒤에 글자가 붙어 있으면 식별자의 일부입니다 */
function touchesLetter(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : '';
  const after = end < text.length ? text[end] : '';
  return /[A-Za-z]/.test(before) || /[A-Za-z]/.test(after);
}

/**
 * 답변 문장에서 수치를 뽑습니다.
 *
 * 천단위 쉼표 · 소수 · 백분율 · 음수를 읽고, 위 MASKED_PATTERNS 에 걸리는 구간은 건너뜁니다.
 */
export function extractNumbers(text: string): NumberToken[] {
  if (!text) return [];

  const masked = maskExcluded(text);
  const tokens: NumberToken[] = [];

  // matchAll 대신 exec 반복입니다. tsconfig 의 target 이 es5 라 이터레이터를 펼칠 수 없습니다.
  const pattern = new RegExp(NUMBER_PATTERN.source, NUMBER_PATTERN.flags);
  let hit = pattern.exec(masked);
  for (; hit !== null; hit = pattern.exec(masked)) {
    const raw = hit[0];
    const index = hit.index;
    if (touchesLetter(masked, index, index + raw.length)) continue;

    const isPercent = raw.trimEnd().endsWith('%');
    const body = raw.replace(/[\s%]/g, '').replace(/,/g, '').replace(/−/g, '-');
    const value = Number(body);
    if (!Number.isFinite(value)) continue;

    const dot = body.indexOf('.');
    tokens.push({
      text: raw.trim(),
      value,
      index,
      isPercent,
      decimals: dot === -1 ? 0 : body.length - dot - 1,
    });
  }

  return tokens;
}

/**
 * 답변 문장에서 날짜를 뽑습니다 — renew.prd 26.3 을 날짜까지 넓힌 것입니다.
 *
 * 왜 필요한가. 위 MASKED_PATTERNS 가 날짜를 통째로 가려 **수치 검사에서 빠집니다.**
 * SCM 답변에서는 날짜가 대개 기간 이름(`2026-09`)이라 문제가 적었지만, 영업 답변은
 * 거의 전부가 날짜입니다 — 가예약 만료일 · 가장 이른 안전 납기 · 신규 공급 가능일.
 * 수량은 검사되고 그 옆의 날짜는 검사되지 않으면, 모델이 "10월 10일까지 620개" 에서
 * 620 은 못 지어내고 10월 10일은 지어낼 수 있습니다.
 *
 * 무엇을 뽑는가
 *   `2026-10-10` · `2026-9-3` · `2026년 10월 10일`   → iso
 *   `10월 15일`                                        → monthDay (연도가 없음)
 *
 * 무엇을 뽑지 않는가 — **기간**입니다. `2026-09` · `2026년 9월` 은 예측 기간의 이름이지
 * 날짜가 아닙니다. 뽑으면 수요 예측 답변이 매번 재생성으로 밀립니다.
 */
export function extractDates(text: string): DateToken[] {
  if (!text) return [];

  const tokens: DateToken[] = [];
  const push = (raw: string, index: number, iso: string | null, monthDay: string | null) => {
    tokens.push({ text: raw.trim(), iso, monthDay, index });
  };

  const pad = (value: string) => value.padStart(2, '0');
  // 같은 자리를 두 번 읽지 않도록, 이미 뽑은 구간은 가려 둡니다.
  let rest = text;
  const mask = (index: number, length: number) => {
    rest = rest.slice(0, index) + '·'.repeat(length) + rest.slice(index + length);
  };

  // matchAll 대신 exec 반복입니다 (error.md #21 — tsconfig 의 target 이 es5).
  const patterns: { re: RegExp; read: (hit: RegExpExecArray) => [string | null, string | null] }[] = [
    {
      re: /(\d{4})-(\d{1,2})-(\d{1,2})/g,
      read: (hit) => [`${hit[1]}-${pad(hit[2])}-${pad(hit[3])}`, null],
    },
    {
      re: /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g,
      read: (hit) => [`${hit[1]}-${pad(hit[2])}-${pad(hit[3])}`, null],
    },
    {
      re: /(\d{1,2})월\s*(\d{1,2})일/g,
      read: (hit) => [null, `${pad(hit[1])}-${pad(hit[2])}`],
    },
  ];

  for (const { re, read } of patterns) {
    const pattern = new RegExp(re.source, re.flags);
    let hit = pattern.exec(rest);
    const found: { raw: string; index: number; iso: string | null; monthDay: string | null }[] = [];
    for (; hit !== null; hit = pattern.exec(rest)) {
      const [iso, monthDay] = read(hit);
      found.push({ raw: hit[0], index: hit.index, iso, monthDay });
    }
    for (const item of found) {
      push(item.raw, item.index, item.iso, item.monthDay);
      mask(item.index, item.raw.length);
    }
  }

  return tokens.sort((a, b) => a.index - b.index);
}

/** 툴이 낸 날짜 문자열을 `YYYY-MM-DD` 로 다듬습니다. 못 읽으면 버립니다 */
function normalizeDate(value: string): string | null {
  const hit = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value.trim());
  if (!hit) return null;
  return `${hit[1]}-${hit[2].padStart(2, '0')}-${hit[3].padStart(2, '0')}`;
}

/**
 * 표기 자릿수만큼의 허용 오차.
 *
 * 답변이 `1,620` 이라고 썼다면 툴 값 1,620.4 를 반올림한 것일 수 있습니다.
 * 소수 1자리로 썼다면 오차는 0.05 입니다.
 */
function toleranceOf(token: NumberToken): number {
  return 0.5 * Math.pow(10, -token.decimals) + 1e-9;
}

function near(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

/**
 * 이 수치가 툴 값 하나와 맞는가.
 *
 * 백분율 변환은 **한 방향으로만, 비율에만** 겁니다.
 *
 *   허용   답변이 `12.4%` 이고 툴이 0.124 를 준 경우 — 토큰에 % 가 붙어 있고 툴 값이 |v| ≤ 1 일 때
 *   불허   그 밖의 모든 ×100 · ÷100
 *
 * 조건 없이 양방향으로 걸면 허용 목록이 세 배로 늘고, 어떤 툴도 내놓지 않은 작은 정수가
 * 통과합니다 — 입고예정 300 이 "3개월" 을, 추천수량 700 이 "7일 뒤" 를, MOQ 100 이 "1건" 을
 * 허가해 버립니다. 한국어 SCM 답변이 가장 자주 쓰는 모양이 바로 그 작은 정수입니다.
 *
 * 반대 방향(답변 `0.95` ↔ 툴 95)은 두지 않습니다. 이 프로젝트의 비율은 전부 0~1 로
 * 저장됩니다 — core.policy_config 의 SERVICE_LEVEL_DEFAULT 는 0.95 이고(단위 '비율'),
 * WAPE · Bias · 개선률도 모두 비율입니다. 쓰이지 않을 변환을 열어 두면 오탐만 남습니다.
 */
function matchesAny(token: NumberToken, values: number[]): boolean {
  const tolerance = toleranceOf(token);

  // 정수로 쓴 수치(0 은 제외)는 |v| < 1 인 비율 값과 맞추지 않습니다.
  //
  // 정수 토큰의 허용 오차는 ±0.5 입니다. 그 폭이 비율 전체를 삼켜, 서비스 수준 0.95 하나가
  // "보정이 1건 있습니다" 를 허가해 버립니다. 1,620.4 를 "1,620" 으로 줄여 쓰는 것은
  // 자연스럽지만, 0.95 를 "1" 로 줄여 쓰는 사람은 없습니다.
  // 0 은 예외입니다 — 0.4일을 "0일" 로 반올림해 쓰는 것은 있을 수 있습니다.
  const integerToken = token.decimals === 0 && !token.isPercent && token.value !== 0;

  for (const value of values) {
    if (near(token.value, value, tolerance) && !(integerToken && Math.abs(value) < 1)) return true;
    if (token.isPercent && Math.abs(value) <= 1 && near(token.value, value * 100, tolerance)) {
      return true;
    }
  }
  return false;
}

/** 툴 numbers 사전에서 null 을 뺀 값 목록 */
function usableValues(toolNumbers: Record<string, number | null>): number[] {
  const values: number[] = [];
  for (const value of Object.values(toolNumbers)) {
    if (typeof value === 'number' && Number.isFinite(value)) values.push(value);
  }
  return values;
}

export type VerifyOptions = {
  /**
   * 사용자가 던진 질문.
   *
   * 질문에 들어 있던 숫자를 답변이 되풀이하는 것은 지어낸 수치가 아닙니다
   * ("향후 60일 결품 위험 품목 보여줘" → "향후 60일 동안…"). 그 숫자는 통과시킵니다.
   * 날짜도 같습니다 ("10월 15일까지 700대 납품 가능해?").
   */
  question?: string | null;
  /**
   * 툴이 돌려준 날짜 문자열 전부 (STEP 17).
   *
   * ★ **주지 않으면 날짜를 검사하지 않습니다.** 이것이 기본값입니다 —
   *   STEP 16 이 만든 호출부(그리고 그 테스트)의 동작을 바꾸지 않기 위해서입니다.
   *   검사를 켜려면 `collectToolDates(...)` 의 결과를 그대로 넘기세요.
   */
  dates?: string[] | null;
};

/**
 * 답변의 모든 수치가 툴 결과에서 왔는지 검사합니다 — renew.prd 26.3.
 *
 * 문자열을 주면 그 문장만, AgentAnswer 를 주면 화면에 렌더되는 모든 문장
 * (본문 · 판단 · 권고 · 산출 불가 사유 · 근거 타일의 라벨과 사유)과 근거 타일의 숫자 값을
 * 함께 봅니다.
 */
export function verifyAnswer(
  answer: string | AgentAnswer,
  toolNumbers: Record<string, number | null>,
  options: VerifyOptions = {},
): Verification {
  const values = usableValues(toolNumbers);
  const allowed = options.question
    ? extractNumbers(options.question).map((token) => token.value)
    : [];

  // 날짜 검사는 dates 를 준 호출에서만 켜집니다 (VerifyOptions.dates 주석).
  const checkDates = Array.isArray(options.dates);
  const allowedDates = new Set<string>();
  if (checkDates) {
    for (const value of options.dates ?? []) {
      const iso = normalizeDate(value);
      if (iso) allowedDates.add(iso);
    }
    // 질문이 준 날짜는 모델이 지어낸 것이 아닙니다.
    for (const token of extractDates(options.question ?? '')) {
      if (token.iso) allowedDates.add(token.iso);
    }
  }

  const texts: string[] = [];
  const evidenceValues: number[] = [];

  if (typeof answer === 'string') {
    texts.push(answer);
  } else {
    // 화면에 렌더되는 문장은 빠짐없이 봅니다. 검사하지 않은 채 보이는 수치가 하나라도 있으면
    // 사람은 그것도 검증된 값으로 읽습니다 (app/(user)/agent/page.tsx 의 근거 타일 · 산출 불가 카드).
    texts.push(answer.answer);
    if (answer.verdict) texts.push(answer.verdict);
    if (answer.recommended_action) texts.push(answer.recommended_action);
    if (answer.cannot_answer_reason) texts.push(answer.cannot_answer_reason);
    for (const item of answer.evidence) {
      texts.push(item.label);
      if (item.reason) texts.push(item.reason);
      if (typeof item.value === 'number' && Number.isFinite(item.value)) {
        evidenceValues.push(item.value);
      } else if (typeof item.value === 'string') {
        texts.push(item.value);
      }
    }
  }

  const tokens: NumberToken[] = [];
  for (const text of texts) tokens.push(...extractNumbers(text));

  // 근거 타일의 숫자는 문장이 아니므로 자릿수를 값에서 되읽습니다.
  for (const value of evidenceValues) {
    const body = String(value);
    const dot = body.indexOf('.');
    tokens.push({
      text: body,
      value,
      index: -1,
      isPercent: false,
      decimals: dot === -1 ? 0 : body.length - dot - 1,
    });
  }

  const offending = tokens.filter((token) => {
    if (matchesAny(token, values)) return false;
    // 질문이 준 숫자는 모델이 지어낸 것이 아닙니다.
    if (allowed.some((value) => near(token.value, value, toleranceOf(token)))) return false;
    return true;
  });

  // ── 날짜 (STEP 17) ────────────────────────────────────────
  const dateTokens: DateToken[] = [];
  if (checkDates) {
    for (const text of texts) dateTokens.push(...extractDates(text));
  }

  // Set 을 for...of 로 펼치지 않습니다 — tsconfig 의 target 이 es5 라
  // TS2802 로 막힙니다 (error.md #21 과 같은 원인).
  const monthDays = new Set<string>();
  allowedDates.forEach((iso) => monthDays.add(iso.slice(5)));

  const offendingDates = dateTokens.filter((token) => {
    if (token.iso) return !allowedDates.has(token.iso);
    // 연도가 없는 날짜("10월 15일")는 월·일만 견줍니다. 툴이 낸 날짜 중 하나와
    // 월·일이 같으면 통과입니다 — 사람이 연도를 생략해 말하는 것이 자연스럽습니다.
    if (token.monthDay) return !monthDays.has(token.monthDay);
    return false;
  });

  return {
    ok: offending.length === 0 && offendingDates.length === 0,
    offending,
    offendingDates,
    checked: tokens.length,
    checkedDates: dateTokens.length,
  };
}

/**
 * 툴 결과들이 낸 날짜를 한 목록으로 모읍니다 (STEP 17).
 *
 * `collectToolNumbers` 와 짝입니다. 툴이 `dates` 를 내지 않으면 그 툴은 날짜를
 * 허용 목록에 아무것도 넣지 않습니다 — 즉 그 툴만 부른 답변에 날짜가 있으면 걸립니다.
 */
export function collectToolDates(
  results: { name: string; dates?: string[] | null }[],
): string[] {
  const merged: string[] = [];
  for (const result of results) {
    for (const value of result.dates ?? []) {
      if (typeof value === 'string' && value.trim() !== '') merged.push(value);
    }
  }
  return merged;
}

/**
 * 툴 결과들의 numbers 를 한 사전으로 모읍니다.
 *
 * 키에 툴 이름을 붙여 어느 툴이 준 값인지 남깁니다. 같은 이름의 값이 겹쳐 사라지지 않도록
 * 하려는 것이고, 검사 자체는 값만 봅니다.
 */
export function collectToolNumbers(
  results: { name: string; numbers: Record<string, number | null> }[],
): Record<string, number | null> {
  const merged: Record<string, number | null> = {};
  for (const result of results) {
    for (const [key, value] of Object.entries(result.numbers)) {
      merged[`${result.name}.${key}`] = value;
    }
  }
  return merged;
}

/** 재생성을 요청할 때 모델에게 보낼 문장 */
export function offendingMessage(
  offending: NumberToken[],
  offendingDates: DateToken[] = [],
): string {
  const parts: string[] = [];
  if (offending.length > 0) {
    parts.push(`다음 숫자는 툴 결과에 없습니다: ${offending.map((token) => token.text).join(', ')}.`);
  }
  if (offendingDates.length > 0) {
    parts.push(`다음 날짜는 툴 결과에 없습니다: ${offendingDates.map((token) => token.text).join(', ')}.`);
  }
  parts.push(
    '툴이 돌려준 값만 쓰세요. 툴에 없는 값은 문장에서 빼고, ' +
      '꼭 필요한 값이면 cannot_answer 를 true 로 두고 사유를 적으세요.',
  );
  return parts.join(' ');
}
