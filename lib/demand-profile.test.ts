import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { classifyDemandType, demandProfileKpiCounts, seasonalityAvailability } from './demand-profile.ts';

test('수요 간격과 변동계수 제곱으로 SBC 네 가지 수요 유형을 분류한다', () => {
  assert.equal(classifyDemandType(1.1, 0.2), 'SMOOTH');
  assert.equal(classifyDemandType(1.5, 0.2), 'INTERMITTENT');
  assert.equal(classifyDemandType(1.1, 0.6), 'ERRATIC');
  assert.equal(classifyDemandType(1.5, 0.6), 'LUMPY');
});

test('계산 불가 ADI 또는 CV²는 수요 유형으로 임의 분류하지 않는다', () => {
  assert.equal(classifyDemandType(null, 0.2), null);
  assert.equal(classifyDemandType(1.5, null), null);
});

test('24개 기간 미만의 계절성은 false가 아닌 계산 불가로 표시한다', () => {
  assert.deepEqual(seasonalityAvailability(23, 0.4, 0.2), {
    value: null,
    reasonCode: 'INSUFFICIENT_PERIODS',
  });
});

test('충분한 기간의 계절성은 설정된 임계값으로 판정한다', () => {
  assert.deepEqual(seasonalityAvailability(24, 0.2, 0.2), { value: true, reasonCode: null });
  assert.deepEqual(seasonalityAvailability(24, 0.19, 0.2), { value: false, reasonCode: null });
});

// ── 수요 패턴 화면의 카운트 — 정합성 라운드 (2026-09-13) ──────────────────────

test('카드 세 개는 집계 뷰 합에서 온다 — 분모가 분자보다 작아지지 않는다', () => {
  // 2026-09-13 배포 DB 실측 analytics.v_item_demand_kpi (OPTION · PART · SUPPLY)
  const counts = demandProfileKpiCounts([
    { nItems: 3596, nCrostonCandidate: 2343, nUnknown: 995 },
    { nItems: 5968, nCrostonCandidate: 3597, nUnknown: 1823 },
    { nItems: 634, nCrostonCandidate: 193, nUnknown: 27 },
  ]);

  assert.equal(counts.itemCount, 10_198);
  assert.equal(counts.croston, 6_133);
  assert.equal(counts.unknown, 2_845);
  // 카운트를 다시 잘린 배열 길이로 되돌리면 1,000 < 6,133 이 되어 여기서 걸립니다.
  assert.ok(counts.itemCount! >= counts.croston!, '분석 품목이 Croston 후보보다 작으면 모순입니다');
  assert.ok(counts.itemCount! > 1000, '잘린 배열의 길이(1,000)를 세면 안 됩니다');
});

test('집계 행이 없으면 0 으로 채우지 않고 산출 불가로 둔다', () => {
  assert.deepEqual(demandProfileKpiCounts([]), { itemCount: null, croston: null, unknown: null });
});

test('수요 패턴 화면은 카운트를 잘린 배열에서 세지 않는다', () => {
  // 화면은 node --test 범위(lib/**) 밖이라 본문을 읽어 확인합니다
  // (tools.test.ts 의 "Agent 폴더는 Supabase 를 직접 조회하지 않는다" 와 같은 방식).
  const page = path.join(import.meta.dirname, '..', 'app', '(user)', 'analysis', 'demand-profile', 'page.tsx');
  const raw = readFileSync(page, 'utf8');
  // 주석은 뺍니다 — 무엇을 왜 고쳤는지 적은 설명에 rows.length 가 나오기 때문입니다.
  const code = raw
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    })
    .join('\n');

  assert.ok(code.includes('demandProfileKpiCounts'), '카운트는 집계 뷰 합에서 와야 합니다');
  assert.ok(!code.includes('rows.length'), 'rows.length 는 1,000행에서 잘린 배열의 길이입니다');
});
