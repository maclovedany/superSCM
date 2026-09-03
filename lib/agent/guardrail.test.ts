import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectToolDates,
  collectToolNumbers,
  extractDates,
  extractNumbers,
  offendingMessage,
  verifyAnswer,
} from './guardrail.ts';
import type { AgentAnswer } from './schema.ts';

// Guardrail — renew.prd 26.3
//
// 여기서 지키는 것은 셋입니다.
//   ① 답변 문장에서 수치를 빠짐없이 뽑는다 (천단위 쉼표 · 소수 · 백분율 · 음수)
//   ② 식별자와 날짜 안의 숫자를 수치로 착각하지 않는다
//   ③ 툴이 돌려주지 않은 수치를 반드시 잡아낸다

const values = (text: string) => extractNumbers(text).map((token) => token.value);

test('천단위 쉼표 · 소수 · 음수를 뽑는다', () => {
  assert.deepEqual(values('현재 가용재고는 1,250대이고 예상 수요는 1,620.5 입니다.'), [1250, 1620.5]);
  assert.deepEqual(values('부족 수량은 -470 입니다.'), [-470]);
  // 유니코드 마이너스도 같은 값입니다.
  assert.deepEqual(values('부족 수량은 −470 입니다.'), [-470]);
});

test('품목코드 · 모델코드 안의 숫자는 수치가 아니다', () => {
  assert.deepEqual(values('ITEM012 는 MDL-X700 모델로 예측했습니다.'), []);
  assert.deepEqual(values('P80 마진과 v1 버전을 확인하세요.'), []);
  // 코드 뒤에 붙은 조사와 진짜 수치는 구분합니다.
  assert.deepEqual(values('ITEM012 의 안전재고는 400 입니다.'), [400]);
});

test('연도 · 기간 · 시각 안의 숫자는 수치가 아니다', () => {
  assert.deepEqual(values('데이터 기준 2026-09-30 입니다.'), []);
  assert.deepEqual(values('2026-09 기간의 적용수요입니다.'), []);
  assert.deepEqual(values('2026년 9월 예측입니다.'), []);
  assert.deepEqual(values('10월 15일 결품이 예상됩니다.'), []);
  assert.deepEqual(values('14:30 에 스캔했습니다.'), []);
});

test('목록 번호는 수치가 아니다', () => {
  assert.deepEqual(values('1. 발주를 올립니다\n2) 리드타임을 확인합니다'), []);
});

test('일 · 대 · 개월 단위 수치는 뽑는다 — 리드타임과 재고 여유는 검사 대상이다', () => {
  assert.deepEqual(values('공급 리드타임 42일 동안 700대가 필요합니다.'), [42, 700]);
  assert.deepEqual(values('재고 여유는 3개월입니다.'), [3]);
});

test('백분율을 뽑고 표시를 남긴다', () => {
  const tokens = extractNumbers('WAPE 는 12.4% 이고 개선률은 8 % 입니다.');
  assert.deepEqual(tokens.map((token) => token.value), [12.4, 8]);
  assert.deepEqual(tokens.map((token) => token.isPercent), [true, true]);
});

test('툴 값과 같은 수치는 통과한다', () => {
  const result = verifyAnswer('가용재고 1,250대에 300대가 입고 예정입니다.', {
    'calcOrderQuantity.current_inventory': 1250,
    'calcOrderQuantity.incoming_qty': 300,
  });
  assert.equal(result.ok, true);
  assert.equal(result.checked, 2);
});

test('표기 자릿수만큼 반올림을 허용한다', () => {
  // 정수로 썼으면 0.5, 소수 한 자리로 썼으면 0.05 까지 봅니다.
  assert.equal(verifyAnswer('약 1,620대입니다.', { 'x.qty': 1620.4 }).ok, true);
  assert.equal(verifyAnswer('18.0일 뒤 소진됩니다.', { 'x.days': 18.04 }).ok, true);
  assert.equal(verifyAnswer('18.0일 뒤 소진됩니다.', { 'x.days': 18.4 }).ok, false);
});

test('비율을 백분율로 옮겨 쓴 수치를 통과시킨다', () => {
  // 뷰는 WAPE 를 0.124 로 줍니다. 답변은 12.4% 로 씁니다.
  assert.equal(verifyAnswer('WAPE 는 12.4% 입니다.', { 'getForecastAccuracy.wape': 0.124 }).ok, true);
  assert.equal(verifyAnswer('서비스 수준은 95% 입니다.', { 'x.service_level': 0.95 }).ok, true);
  // 반대 방향은 두지 않습니다. 이 프로젝트의 비율은 전부 0~1 로 저장되므로 쓰일 일이 없고,
  // 열어 두면 MOQ 100 이 "1건" 을 허가하는 식의 오탐만 남습니다.
  assert.equal(verifyAnswer('서비스 수준은 0.95 입니다.', { 'x.service_level': 95 }).ok, false);
});

test('툴 결과에 없는 수치를 잡아낸다 ★', () => {
  const result = verifyAnswer('총 700대를 발주하시기 바랍니다.', { 'calcOrderQuantity.qty': 650 });
  assert.equal(result.ok, false);
  assert.deepEqual(result.offending.map((token) => token.text), ['700']);
});

test('툴이 null 을 준 값은 인용할 수 없다 — 계산 불가를 숫자로 채우지 않는다', () => {
  // AGENTS.md 규칙 5. null 은 허용 목록에 들어가지 않습니다.
  const result = verifyAnswer('결품까지 0일 남았습니다.', { 'getStockoutRisk.stockout_days': null });
  assert.equal(result.ok, false);
  assert.deepEqual(result.offending.map((token) => token.value), [0]);
});

test('질문에 있던 숫자를 되풀이하는 것은 지어낸 수치가 아니다', () => {
  const question = '향후 60일 결품 위험 품목 보여줘.';
  const answer = '향후 60일 안에 결품이 예상되는 품목은 3건입니다.';
  assert.equal(verifyAnswer(answer, { 'getStockoutRisk.count': 3 }, { question }).ok, true);
  // 질문을 주지 않으면 60 은 출처가 없는 수치입니다.
  assert.equal(verifyAnswer(answer, { 'getStockoutRisk.count': 3 }).ok, false);
});

test('AgentAnswer 를 주면 본문 · 판단 · 권고 · 근거 타일을 모두 본다', () => {
  const answer: AgentAnswer = {
    answer: '가용재고는 1,250대입니다.',
    verdict: '리드타임 이내 결품이 예상됩니다.',
    evidence: [
      { label: '가용재고', value: 1250, unit: '대', source_tool: 'calcOrderQuantity', reason: null },
      { label: '안전재고', value: 999, unit: '대', source_tool: 'calcOrderQuantity', reason: null },
    ],
    data_as_of: '2026-09-01',
    risk: 'WARNING',
    recommended_action: '470대를 발주하세요.',
    cannot_answer: false,
    cannot_answer_reason: null,
  };

  const result = verifyAnswer(answer, {
    'calcOrderQuantity.current_inventory': 1250,
    'calcOrderQuantity.shortage': 470,
  });
  assert.equal(result.ok, false);
  // 근거 타일의 999 만 걸립니다. 본문 1,250 과 권고 470 은 툴 값입니다.
  assert.deepEqual(result.offending.map((token) => token.value), [999]);
});

test('collectToolNumbers 는 툴 이름을 붙여 한 사전으로 모은다', () => {
  const merged = collectToolNumbers([
    { name: 'getSafetyStock', numbers: { safety_stock: 400, z_value: null } },
    { name: 'calcOrderQuantity', numbers: { safety_stock: 400, moq: 100 } },
  ]);
  assert.deepEqual(merged, {
    'getSafetyStock.safety_stock': 400,
    'getSafetyStock.z_value': null,
    'calcOrderQuantity.safety_stock': 400,
    'calcOrderQuantity.moq': 100,
  });
});

test('재생성 요청 문장에 걸린 숫자를 그대로 적는다', () => {
  const { offending } = verifyAnswer('700대와 42일이 필요합니다.', {});
  const message = offendingMessage(offending);
  assert.match(message, /700/);
  assert.match(message, /42/);
  assert.match(message, /툴이 돌려준 값만 쓰세요/);
});

test('숫자가 없는 답변은 검사할 것이 없다', () => {
  const result = verifyAnswer('데이터가 없어 산출할 수 없습니다.', {});
  assert.equal(result.ok, true);
  assert.equal(result.checked, 0);
});

// ── 수정 라운드 1 — 백분율 변환을 좁힌 뒤 ──────────────────────
//
// ×100 · ÷100 을 조건 없이 걸면 허용 목록이 세 배가 되고, 어떤 툴도 내놓지 않은 작은 정수가
// 통과합니다. 한국어 답변이 가장 자주 쓰는 모양이 그 작은 정수입니다.

test('% 가 붙지 않은 숫자를 툴 값의 100배로 인정하지 않는다 ★', () => {
  const numbers = {
    'calcOrderQuantity.incoming_qty': 300,
    'calcOrderQuantity.final_recommended_qty': 700,
    'calcOrderQuantity.safety_stock': 400,
  };
  // 입고예정 300 이 "3개월" 을, 추천수량 700 이 "7일 뒤" 를 허가하면 안 됩니다.
  assert.equal(verifyAnswer('향후 3개월 동안 여유가 있습니다.', numbers).ok, false);
  assert.equal(verifyAnswer('7일 뒤 결품이 예상됩니다.', numbers).ok, false);
  assert.equal(verifyAnswer('4일 안에 발주하세요.', numbers).ok, false);
  // 원래 값 그대로 쓰는 것은 그대로 통과합니다.
  assert.equal(verifyAnswer('300개가 입고 예정입니다.', numbers).ok, true);
});

test('비율이 아닌 툴 값은 백분율로 부풀릴 수 없다', () => {
  // 서비스 수준을 뷰가 95 로 준 경우, 9500% 는 값이 될 수 없습니다.
  assert.equal(verifyAnswer('서비스 수준은 9500% 입니다.', { 'x.service_level': 95 }).ok, false);
  // MOQ 100 이 "1건" 을 허가하지 않습니다 (역방향 변환을 두지 않기 때문입니다).
  assert.equal(verifyAnswer('보정이 1건 있습니다.', { 'calcOrderQuantity.moq': 100 }).ok, false);
});

test('비율 툴 값은 % 가 붙은 숫자에만 100배를 허용한다', () => {
  const numbers = { 'getForecastAccuracy.wape': 0.124 };
  assert.equal(verifyAnswer('WAPE 는 12.4% 입니다.', numbers).ok, true);
  // % 없이 쓴 12.4 는 툴 값(0.124)이 아닙니다.
  assert.equal(verifyAnswer('WAPE 는 12.4 입니다.', numbers).ok, false);
  // 원래 비율을 그대로 쓰는 것은 통과합니다.
  assert.equal(verifyAnswer('WAPE 는 0.124 입니다.', numbers).ok, true);
});

test('근거 타일의 라벨과 산출 불가 사유도 검사한다 — 화면에 그대로 보이기 때문이다', () => {
  const answer: AgentAnswer = {
    answer: '조회했습니다.',
    verdict: null,
    evidence: [
      // 라벨에 숨은 수치입니다. 값 칸이 아니라 라벨이라고 검사에서 빠지면 안 됩니다.
      { label: '700대 발주 필요', value: null, unit: null, source_tool: 'calcOrderQuantity', reason: null },
    ],
    data_as_of: null,
    risk: null,
    recommended_action: null,
    cannot_answer: false,
    cannot_answer_reason: null,
  };
  assert.deepEqual(verifyAnswer(answer, {}).offending.map((token) => token.value), [700]);

  const unavailable: AgentAnswer = {
    ...answer,
    evidence: [],
    cannot_answer: true,
    cannot_answer_reason: '입고 예정 500개를 확인할 수 없습니다.',
  };
  assert.deepEqual(verifyAnswer(unavailable, {}).offending.map((token) => token.value), [500]);
});

test('비율 값 하나가 작은 정수를 허가하지 않는다 ★', () => {
  // 서비스 수준 0.95 의 ±0.5 반올림 폭이 "1건" 을 삼키면 안 됩니다.
  const numbers = { 'calcOrderQuantity.service_level': 0.95, 'calcOrderQuantity.champion_wape': 0.124 };
  assert.equal(verifyAnswer('보정이 1건 있습니다.', numbers).ok, false);
  assert.equal(verifyAnswer('후보는 0건입니다.', numbers).ok, true); // 0 은 반올림으로 나올 수 있습니다
  // 큰 값의 반올림은 그대로 통과합니다.
  assert.equal(verifyAnswer('약 1,620대입니다.', { 'x.qty': 1620.4 }).ok, true);
});

// ── 날짜 (STEP 17 · 리뷰 Important 4) ──────────────────────────
//
// 수치 추출은 날짜를 일부러 가립니다. 그래서 날짜는 오랫동안 아무 검사도 받지
// 않았습니다 — 영업 답변은 거의 전부가 날짜인데도요.

test('extractDates 는 완전한 날짜와 연도 없는 날짜를 구별해 뽑는다', () => {
  const tokens = extractDates('2026-10-10 까지 가능하고, 2026년 11월 3일 입고되며 12월 1일에 끝납니다');
  assert.deepEqual(
    tokens.map((token) => [token.iso, token.monthDay]),
    [
      ['2026-10-10', null],
      ['2026-11-03', null],
      [null, '12-01'],
    ],
  );
});

test('한 자리 월·일도 두 자리로 다듬는다', () => {
  assert.equal(extractDates('2026-9-3').at(0)?.iso, '2026-09-03');
  assert.equal(extractDates('2026년 9월 3일').at(0)?.iso, '2026-09-03');
});

test('기간은 날짜가 아니다 — 2026-09 · 2026년 9월 을 뽑지 않는다', () => {
  // 예측 기간의 이름입니다. 뽑으면 수요 예측 답변이 매번 재생성으로 밀립니다.
  assert.deepEqual(extractDates('2026-09 예측은 1,620개입니다'), []);
  assert.deepEqual(extractDates('2026년 9월 예측'), []);
});

test('★ dates 를 주지 않으면 날짜를 검사하지 않는다 — STEP 16 동작 그대로', () => {
  const check = verifyAnswer('2099-01-01 에 입고됩니다.', {});
  assert.equal(check.ok, true);
  assert.deepEqual(check.offendingDates, []);
  assert.equal(check.checkedDates, 0);
});

test('★ 툴이 내지 않은 날짜를 말하면 잡는다', () => {
  const check = verifyAnswer('2026-10-10 까지 납품 가능합니다.', {}, { dates: ['2026-11-20'] });
  assert.equal(check.ok, false);
  assert.deepEqual(check.offendingDates.map((token) => token.text), ['2026-10-10']);
  assert.equal(check.checkedDates, 1);
});

test('툴이 낸 날짜는 표기가 달라도 통과한다', () => {
  for (const text of ['2026-11-20 입고', '2026년 11월 20일 입고']) {
    const check = verifyAnswer(text, {}, { dates: ['2026-11-20'] });
    assert.equal(check.ok, true, text);
  }
});

test('시각이 붙은 툴 날짜도 같은 날로 본다', () => {
  const check = verifyAnswer('2026-11-20 입고', {}, { dates: ['2026-11-20T09:00:00Z'] });
  assert.equal(check.ok, true);
});

test('연도를 생략한 날짜는 월·일만 맞으면 통과한다', () => {
  // 사람이 "11월 20일" 이라고 말하는 것은 자연스럽습니다.
  assert.equal(verifyAnswer('11월 20일 출고', {}, { dates: ['2026-11-20'] }).ok, true);
  assert.equal(verifyAnswer('11월 21일 출고', {}, { dates: ['2026-11-20'] }).ok, false);
});

test('질문에 있던 날짜는 통과한다', () => {
  // "10월 15일까지 700대 납품 가능해?" (renew.prd 27.2)
  const check = verifyAnswer('2026-10-15 까지는 어렵습니다.', {}, {
    dates: [],
    question: '2026-10-15 까지 700대 납품 가능해?',
  });
  assert.equal(check.ok, true);
});

test('툴이 날짜를 하나도 내지 않았으면 답변의 날짜는 전부 걸린다', () => {
  const check = verifyAnswer('2026-12-31 에 가능합니다.', {}, { dates: [] });
  assert.equal(check.ok, false);
  assert.equal(check.offendingDates.length, 1);
});

test('AgentAnswer 의 모든 문장에서 날짜를 본다', () => {
  const check = verifyAnswer(
    {
      answer: '가능합니다.',
      verdict: null,
      evidence: [
        { label: '안전 납기', value: '2026-10-10', unit: null, source_tool: 'x', reason: null },
      ],
      data_as_of: '2026-09-01T00:00:00Z',
      risk: 'SAFE',
      recommended_action: '2026-12-25 에 다시 확인하세요.',
      cannot_answer: false,
      cannot_answer_reason: null,
    },
    {},
    { dates: ['2026-10-10'] },
  );
  assert.equal(check.ok, false);
  assert.deepEqual(check.offendingDates.map((token) => token.text), ['2026-12-25']);
});

test('collectToolDates 는 툴들의 날짜를 모으고 빈 값을 버린다', () => {
  assert.deepEqual(
    collectToolDates([
      { name: 'getATP', dates: ['2026-09-17', '2026-10-03'] },
      { name: 'getSupplyStatus', dates: [] },
      { name: 'getAlerts' },
      { name: 'x', dates: ['', '  '] },
    ]),
    ['2026-09-17', '2026-10-03'],
  );
});

test('offendingMessage 는 숫자와 날짜를 함께 알린다', () => {
  const check = verifyAnswer('2026-12-25 에 999개 가능합니다.', {}, { dates: [] });
  const message = offendingMessage(check.offending, check.offendingDates);
  assert.match(message, /999/);
  assert.match(message, /2026-12-25/);
  assert.match(message, /날짜는 툴 결과에 없습니다/);
});
