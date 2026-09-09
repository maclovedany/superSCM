import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANSWER_JSON_SCHEMA,
  cannotAnswer,
  parseAgentAnswer,
  type AgentAnswer,
} from './schema.ts';

const VALID: AgentAnswer = {
  answer: 'ITEM012 는 약 18일 뒤 소진 예상입니다.',
  verdict: '리드타임 안에 결품 가능',
  evidence: [{ label: '소진예상일수', value: 18.04, unit: '일', source_tool: 'getStockoutRisk' }],
  risk: 'CRITICAL',
  recommended_action: '즉시 발주 검토',
  data_as_of: '2026-09-09',
  cannot_answer: false,
  cannot_answer_reason: null,
};

test('strict 스키마는 모든 필드를 required 로 두고 추가 필드를 막는다', () => {
  const schema = ANSWER_JSON_SCHEMA.schema;
  assert.equal(ANSWER_JSON_SCHEMA.strict, true);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(
    Array.from(schema.required).sort(),
    Object.keys(schema.properties).sort(),
    'strict 모드는 properties 와 required 가 같아야 합니다',
  );
});

test('정상 JSON 을 읽는다', () => {
  const parsed = parseAgentAnswer(JSON.stringify(VALID));
  assert.deepEqual(parsed, VALID);
});

test('코드펜스를 붙여 보내도 한 겹 벗겨 읽는다', () => {
  const parsed = parseAgentAnswer('```json\n' + JSON.stringify(VALID) + '\n```');
  assert.equal(parsed?.answer, VALID.answer);
});

test('깨진 JSON · 빈 문자열 · answer 누락은 null 이고 예외를 던지지 않는다', () => {
  assert.equal(parseAgentAnswer('{'), null);
  assert.equal(parseAgentAnswer(''), null);
  assert.equal(parseAgentAnswer(null), null);
  assert.equal(parseAgentAnswer(JSON.stringify({ verdict: '판단만 있음' })), null);
});

test('알 수 없는 risk 는 CALCULATION_UNAVAILABLE 로 내려앉는다', () => {
  const parsed = parseAgentAnswer(JSON.stringify({ ...VALID, risk: 'VERY_BAD' }));
  assert.equal(parsed?.risk, 'CALCULATION_UNAVAILABLE');
});

test('evidence 는 label 이 있는 항목만 남기고 값 타입을 좁힌다', () => {
  const parsed = parseAgentAnswer(
    JSON.stringify({
      ...VALID,
      evidence: [
        { label: '정상', value: 1, unit: null, source_tool: 'getStockoutRisk' },
        { label: '', value: 2, unit: null, source_tool: null },
        { label: '객체값', value: { a: 1 }, unit: null, source_tool: null },
      ],
    }),
  );
  assert.equal(parsed?.evidence.length, 2);
  assert.equal(parsed?.evidence[1].value, null, '객체 값은 null 로 좁힙니다');
});

test('cannotAnswer 는 0 이 아니라 사유를 담는다', () => {
  const answer = cannotAnswer('NO_USAGE', '2026-09-09');
  assert.equal(answer.cannot_answer, true);
  assert.equal(answer.cannot_answer_reason, 'NO_USAGE');
  assert.equal(answer.risk, 'CALCULATION_UNAVAILABLE');
  assert.equal(answer.evidence.length, 0);
  assert.equal(answer.data_as_of, '2026-09-09');
});
