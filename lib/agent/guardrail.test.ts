import assert from 'node:assert/strict';
import test from 'node:test';
import { collectToolNumbers, extractNumbers, isDerivable, verifyAnswer } from './guardrail.ts';
import { cannotAnswer, type AgentAnswer } from './schema.ts';

function answerWith(text: string, evidenceValue: number | null = null): AgentAnswer {
  return {
    answer: text,
    verdict: null,
    evidence: evidenceValue === null ? [] : [{ label: '값', value: evidenceValue, unit: null, source_tool: 'getStockoutRisk' }],
    risk: 'SAFE',
    recommended_action: null,
    data_as_of: '2026-09-09',
    cannot_answer: false,
    cannot_answer_reason: null,
  };
}

test('쉼표 · 소수 · 음수를 숫자로 뽑는다', () => {
  const tokens = extractNumbers('가용 1,200개, 오차 -0.35, 소진 18.04일');
  assert.deepEqual(tokens.map((t) => t.value), [1200, -0.35, 18.04]);
});

test('품목코드 · 날짜 · P80 안의 숫자는 업무 수치로 뽑지 않는다', () => {
  const tokens = extractNumbers('ITEM012 는 2026-09-09 기준이며 P80 은 28일입니다. MA_3M 모델.');
  assert.deepEqual(tokens.map((t) => t.value), [28]);
});

test('허용 목록에 있는 값과 반올림 · 백분율 환산은 통과한다', () => {
  const allowed = [0.124, 650];
  assert.equal(isDerivable(0.124, allowed), true);
  assert.equal(isDerivable(0.12, allowed), true, '반올림');
  assert.equal(isDerivable(12.4, allowed), true, '비율 → 백분율');
  assert.equal(isDerivable(650, allowed), true);
});

test('허용 목록에 없는 숫자는 막는다 — 650 만 있는데 700 을 쓰면 차단', () => {
  const allowed = [650];
  assert.equal(isDerivable(700, allowed), false);
  const result = verifyAnswer(answerWith('가용 수량은 700개입니다.'), allowed);
  assert.equal(result.ok, false);
  assert.deepEqual(result.offending.map((t) => t.text), ['700']);
});

test('null 을 0 으로 바꾼 답변을 막는다', () => {
  // 툴이 소진일수를 내지 못했으므로 허용 목록에 그 값이 없습니다.
  const result = verifyAnswer(answerWith('소진까지 0일 남았습니다.'), [24, 12]);
  assert.equal(result.ok, false);
});

test('근거(evidence)의 값도 검사한다', () => {
  const ok = verifyAnswer(answerWith('확인했습니다.', 650), [650]);
  assert.equal(ok.ok, true);
  const bad = verifyAnswer(answerWith('확인했습니다.', 700), [650]);
  assert.equal(bad.ok, false);
});

test('질문에 있던 숫자는 되풀이해도 통과한다', () => {
  const result = verifyAnswer(answerWith('향후 30일 안에는 문제가 없습니다.'), [], {
    question: '향후 30일 안에 위험한 품목이 있나요?',
  });
  assert.equal(result.ok, true);
});

test('산출 불가 답변은 검사할 숫자가 없다', () => {
  const result = verifyAnswer(cannotAnswer('NO_USAGE'), []);
  assert.equal(result.ok, true);
  assert.equal(result.checked, 0);
});

test('collectToolNumbers 는 null 을 허용 목록에 넣지 않는다', () => {
  const allowed = collectToolNumbers([
    { numbers: { a: 1, b: null } },
    { numbers: { c: 2.5 } },
  ]);
  assert.deepEqual(allowed.sort((x, y) => x - y), [1, 2.5]);
});
